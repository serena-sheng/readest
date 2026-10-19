import { useCallback, useEffect, useRef, useState } from 'react';
import { FoliateView } from '@/types/view';
import { UseTranslatorOptions } from '@/services/translators';
import { useReaderStore } from '@/store/readerStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { getBookProgress, useBookProgress } from '@/store/readerProgressStore';
import { useTranslator } from '@/hooks/useTranslator';
import { useTranslation } from '@/hooks/useTranslation';
import { eventDispatcher } from '@/utils/event';
import { walkTextNodes } from '@/utils/walk';
import { debounce } from '@/utils/debounce';
import { getLocale } from '@/utils/misc';
import { getDirFromLanguage } from '@/utils/rtl';
import { getTranslators } from '@/services/translators';
import {
  extractSourcePayload,
  sanitizeTranslatedMarkup,
  splitMarkupIntoChunks,
} from '@/app/reader/utils/translationMarkup';
import { splitTextIntoChunks } from '@/services/translators/utils';
import {
  estimateScreenChars,
  selectNodesForTranslation,
} from '@/services/translators/viewportBudget';
import {
  getMany,
  getTranslation,
  makeTranslationKey,
  setTranslation,
} from '@/services/translators/translationCache';

/**
 * Normalized paragraph text: the same value used for requests, cache keys and
 * the screen-character budget, so all three agree on what a paragraph is.
 */
const getParagraphText = (el: HTMLElement) => el.textContent?.replaceAll('\n', '').trim() ?? '';

/**
 * Markup inflates the payload and the provider's length cap counts the tags,
 * while the chunker splits on sentence boundaries and would cut through a tag.
 * Rather than build markup-aware chunking, longer formatted paragraphs fall
 * back to the plain-text path (losing formatting, exactly as before).
 *
 * Set to the verified hard limit of the only provider that currently opts in:
 * Bing accepts exactly 1000 UTF-16 code units and answers `statusCode: 400` at
 * 1001. Anything lower needlessly gives up formatting on paragraphs that would
 * have fit.
 */
const MAX_MARKUP_PAYLOAD_CHARS = 1000;

/**
 * Builds the node appended to a source paragraph to carry its translation.
 *
 * A single <font> rather than nested wrappers: it keeps the CFI path into
 * translated text two levels shallower, and puts `display: block` on the
 * element itself instead of on a block nested inside an inline parent. <font>
 * specifically because book CSS never targets it (so the wrapper picks up no
 * styling from the book) and because it is on INLINE_FORMATTING_TAGS, so the
 * enclosing source div keeps its paragraph layout.
 *
 * `content` may be a plain string or a sanitized fragment carrying the source's
 * inline formatting — the markup inside is *meant* to inherit the book's rules
 * so the translation matches the original's styling.
 */
export const createTranslationTargetNode = ({
  translatedText,
  content,
  lang,
  targetBlockClassName,
  hidden,
  widthLineBreak,
}: {
  translatedText?: string;
  content?: DocumentFragment;
  lang: string;
  targetBlockClassName: string;
  hidden: boolean;
  widthLineBreak: boolean;
}) => {
  const wrapper = document.createElement('font');
  wrapper.className = `translation-target ${targetBlockClassName} ${hidden ? 'hidden' : ''}`.trim();
  wrapper.setAttribute('translation-element-mark', '1');
  wrapper.setAttribute('lang', lang);
  // Set the base direction from the target language so justified RTL text
  // (e.g. Arabic) aligns to the start (right) instead of inheriting the
  // source document's LTR direction.
  wrapper.setAttribute('dir', getDirFromLanguage(lang));
  if (widthLineBreak) {
    wrapper.appendChild(document.createElement('br'));
  }

  if (content) {
    wrapper.appendChild(content);
  } else {
    wrapper.appendChild(document.createTextNode(translatedText ?? ''));
  }
  return wrapper;
};

const SOURCE_HIDDEN_CLASS = 'translation-source-hidden';

export const groupTextNodesByDocument = (nodes: HTMLElement[]) => {
  const grouped = new Map<Document, HTMLElement[]>();
  nodes.forEach((node) => {
    const documentNodes = grouped.get(node.ownerDocument);
    if (documentNodes) {
      documentNodes.push(node);
    } else {
      grouped.set(node.ownerDocument, [node]);
    }
  });
  return grouped;
};

export const observeTextNodesByDocument = (
  nodes: HTMLElement[],
  createObserver: (document: Document) => IntersectionObserver,
) =>
  Array.from(groupTextNodesByDocument(nodes), ([document, documentNodes]) => {
    const observer = createObserver(document);
    documentNodes.forEach((node) => observer.observe(node));
    return observer;
  });

/**
 * Maps a fresh walk of the (possibly already translated) DOM back to one entry
 * per source paragraph.
 *
 * Two shapes have to be normalized. Generated `.translation-target` wrappers are
 * never source text, so they are dropped outright. A hidden original is *wrapped*
 * rather than erased, so `walkTextNodes` stops seeing direct text on the
 * paragraph, descends past it, and emits the `.translation-source-hidden` wrapper
 * instead — that one is folded back to the paragraph that owns it.
 *
 * Folding rather than dropping matters because `allTextNodes` is addressed by
 * index: the viewport budget selects a window around the visible nodes and
 * `findNodeIndicesInRange` maps the reading position to a slot. Dropping an
 * already translated paragraph shifts every index after it and leaves the
 * reading position unresolvable, which silently kills the read-ahead. Keeping
 * the paragraph is safe because `scheduleTranslation` and `translateElement`
 * both already bail when it holds a `.translation-target`.
 */
export const resolveTranslationSourceNodes = (nodes: HTMLElement[]) => {
  const sources: HTMLElement[] = [];
  const seen = new Set<HTMLElement>();
  for (const node of nodes) {
    if (node.closest('.translation-target')) continue;
    const hider = node.closest<HTMLElement>(`.${SOURCE_HIDDEN_CLASS}`);
    const source = hider?.parentElement ?? node;
    if (seen.has(source)) continue;
    seen.add(source);
    sources.push(source);
  }
  return sources;
};

export const getTranslationContextNodes = (
  nodes: HTMLElement[],
  document: Document,
  visibleElements: Set<HTMLElement>,
) => {
  const documentNodes = nodes.filter((node) => node.ownerDocument === document);
  if (documentNodes.length === 0 || visibleElements.size === 0) return [];

  let firstIdx = documentNodes.length;
  let lastIdx = -1;
  for (const element of visibleElements) {
    const index = documentNodes.indexOf(element);
    if (index !== -1) {
      if (index < firstIdx) firstIdx = index;
      if (index > lastIdx) lastIdx = index;
    }
  }
  if (lastIdx === -1) return [];

  return documentNodes.slice(
    Math.max(0, firstIdx - 1),
    Math.min(documentNodes.length, lastIdx + 3),
  );
};

/**
 * Hides or restores a paragraph's original text.
 *
 * The original is wrapped in a `cfi-skip` element rather than having its text
 * erased. cfi-skip hoists the wrapper's children for indexing, so every source
 * text node keeps the exact index and offset it had unwrapped — a highlight on
 * the original still resolves whether or not the original is on screen. Erasing
 * the text (the previous approach) destroyed that anchor.
 */
export const setSourceVisibility = (el: HTMLElement, visible: boolean) => {
  const existing = el.querySelector(`:scope > .${SOURCE_HIDDEN_CLASS}`);
  if (visible) {
    if (existing) existing.replaceWith(...Array.from(existing.childNodes));
    return;
  }
  if (existing) return;

  const sourceNodes = Array.from(el.childNodes).filter(
    (node) =>
      !(node.nodeType === Node.ELEMENT_NODE && (node as Element).closest('.translation-target')),
  );
  if (!sourceNodes.length) return;

  const hider = document.createElement('font');
  hider.className = SOURCE_HIDDEN_CLASS;
  hider.setAttribute('cfi-skip', '');
  el.insertBefore(hider, sourceNodes[0]!);
  sourceNodes.forEach((node) => hider.appendChild(node));
};

export function useTextTranslation(
  bookKey: string,
  view: FoliateView | HTMLElement | null,
  widthLineBreak = false,
  targetBlockClassName = 'translation-target-block',
) {
  const _ = useTranslation();
  const getViewSettings = useReaderStore((s) => s.getViewSettings);
  const setIsLoading = useReaderStore((s) => s.setIsLoading);
  const viewSettings = getViewSettings(bookKey);
  // Reactive: triggers translate-in-range on every page turn so the
  // visible viewport's translations refresh. Reads from
  // readerProgressStore only.
  const progress = useBookProgress(bookKey);

  const enabled = useRef(viewSettings?.translationEnabled);
  const [provider, setProvider] = useState(viewSettings?.translationProvider);
  const [targetLang, setTargetLang] = useState(viewSettings?.translateTargetLang);
  const [promptId, setPromptId] = useState(viewSettings?.translationPromptId);
  const book = useBookDataStore((s) => s.getBookData(bookKey)?.book);
  const showTranslateSourceRef = useRef(viewSettings?.showTranslateSource);

  const { translate, translator } = useTranslator({
    provider,
    targetLang: targetLang || getLocale(),
    promptId,
    bookTitle: book?.title,
    bookAuthor: book?.author,
  } as UseTranslatorOptions);

  const translateRef = useRef(translate);
  // `translationProvider` is a loose string in settings, so match by name
  // rather than narrowing to TranslatorName.
  const translatorPreservesMarkup = !!getTranslators().find(
    (translator) => translator.name === provider,
  )?.preservesMarkup;
  const observerRefs = useRef<IntersectionObserver[]>([]);
  const translatedElements = useRef<HTMLElement[]>([]);
  const allTextNodes = useRef<HTMLElement[]>([]);
  const translationQueue = useRef<HTMLElement[]>([]);
  const activeTranslations = useRef(0);
  // Read through a ref: the queue drains from observer callbacks created on
  // earlier renders. Batching providers ask for more in-flight paragraphs.
  const maxConcurrentRef = useRef(5);
  maxConcurrentRef.current = translator?.concurrency ?? 5;
  // Cache scope for the current render. Read through a ref because queue
  // entries and prefetch callbacks outlive the render that created them.
  const translationScopeRef = useRef({ targetLang: '', style: '' });
  translationScopeRef.current = {
    targetLang: targetLang || getLocale(),
    style: `${provider ?? ''}|${promptId ?? ''}`,
  };
  // Progress feedback: counts paragraphs handed to the provider versus ones
  // that finished (cached hits and failures included), so the hint can show
  // "translating 3/12" instead of an open-ended spinner.
  const progressRef = useRef({ total: 0, done: 0, ok: 0, lastSentAt: 0, timer: null as ReturnType<typeof setTimeout> | null });
  const pendingDOMUpdates = useRef<Array<() => void>>([]);
  const batchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const toggleTranslationVisibility = (visible: boolean) => {
    translatedElements.current.forEach((element) => {
      const translationTargets = element.querySelectorAll('.translation-target');
      translationTargets.forEach((target) => {
        if (visible) {
          target.classList.remove('hidden');
        } else {
          target.classList.add('hidden');
        }
      });
    });
  };

  useEffect(() => {
    translateRef.current = translate;
  }, [translate]);

  const hintInitialTranslating = () => {
    setIsLoading(bookKey, true);
    eventDispatcher.dispatch('hint', {
      bookKey,
      message: _('Translating...'),
    });
    hintTimerRef.current = setTimeout(() => {
      hintTimerRef.current = null;
      setIsLoading(bookKey, false);
    }, 2000);
  };

  const observeTextNodes = () => {
    if (!view || !enabled.current) return;

    const nodes = resolveTranslationSourceNodes(walkTextNodes(view, ['pre', 'code', 'math']));
    console.log(
      'Observing text nodes for translation:',
      nodes.length,
      // nodes.map((n) => n.textContent),
    );
    allTextNodes.current = nodes;
    observerRefs.current.forEach((observer) => observer.disconnect());
    observerRefs.current = observeTextNodesByDocument(nodes, createTranslationObserver);
    // Observer callbacks arrive on the next frame; start loading the cache for
    // the reading position's window immediately so a reopened book paints its
    // translations without waiting for the provider.
    prefetchTranslationWindow();
  };

  const updateTranslation = () => {
    translationQueue.current = [];
    activeTranslations.current = 0;
    if (batchTimerRef.current) {
      clearTimeout(batchTimerRef.current);
      batchTimerRef.current = null;
    }
    pendingDOMUpdates.current = [];
    translatedElements.current.forEach((element) => {
      element.classList.remove('translation-source-done');
      const translationTargets = element.querySelectorAll('.translation-target');
      translationTargets.forEach((target) => target.remove());
      // The hidden source wrapper is `display: none`, so a paragraph left with
      // neither a target nor a visible original renders blank for as long as the
      // re-translation is in flight, and stays blank if that translation fails.
      setSourceVisibility(element, true);
    });

    translatedElements.current = [];
    resetProgress();
    if (viewSettings?.translationEnabled && view) {
      recreateTranslationObserver();
    }
  };

  const createTranslationObserver = (document: Document) => {
    const visibleElements = new Set<HTMLElement>();
    const Observer = document.defaultView?.IntersectionObserver ?? IntersectionObserver;
    return new Observer(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            visibleElements.add(entry.target as HTMLElement);
          } else {
            visibleElements.delete(entry.target as HTMLElement);
          }
        }

        const documentNodes = allTextNodes.current.filter(
          (node) => node.ownerDocument === document,
        );
        const visibleIndexes = Array.from(visibleElements)
          .map((element) => documentNodes.indexOf(element))
          .filter((index) => index !== -1);
        const selected = selectTranslationWindow(documentNodes, visibleIndexes);
        // Batch-read the cache first: hits paint immediately and only the
        // misses reach the provider queue.
        void prefetchTranslations(selected).then((misses) =>
          misses.forEach((node) => scheduleTranslation(node)),
        );
      },
      { threshold: 0 },
    );
  };

  const scheduleTranslation = (el: HTMLElement) => {
    if (!enabled.current) return;
    if (el.classList.contains('translation-target')) return;
    if (el.querySelector('.translation-target')) return;
    if (translationQueue.current.indexOf(el) !== -1) return;
    translationQueue.current.push(el);
    progressRef.current.total += 1;
    publishProgress();
    drainTranslationQueue();
  };

  const drainTranslationQueue = () => {
    while (
      activeTranslations.current < maxConcurrentRef.current &&
      translationQueue.current.length > 0
    ) {
      const el = translationQueue.current.shift()!;
      if (el.querySelector('.translation-target') || !enabled.current) continue;
      activeTranslations.current++;
      translateElement(el).finally(() => {
        activeTranslations.current--;
        drainTranslationQueue();
      });
    }
    if (translationQueue.current.length === 0 && activeTranslations.current === 0) {
      setTimeout(() => {
        setIsLoading(bookKey, false);
      }, 500);
    }
  };

  const batchDOMUpdate = (update: () => void) => {
    pendingDOMUpdates.current.push(update);
    if (!batchTimerRef.current) {
      batchTimerRef.current = setTimeout(() => {
        batchTimerRef.current = null;
        const updates = pendingDOMUpdates.current.splice(0);
        updates.forEach((fn) => fn());
      }, 50);
    }
  };

  const getTranslationCacheKey = (el: HTMLElement) => {
    const text = getParagraphText(el);
    if (!text) return null;
    const { targetLang: lang, style } = translationScopeRef.current;
    return makeTranslationKey(bookKey, lang, style, text);
  };

  /**
   * The single DOM path for a translation, whether it came from the cache or
   * from the provider. Keeping one function is what makes a cached paragraph
   * indistinguishable from a freshly translated one.
   */
  const renderTranslation = (
    el: HTMLElement,
    translatedText: string,
    content?: DocumentFragment,
  ) => {
    if (!enabled.current || el.querySelector('.translation-target')) return;
    const wrapper = createTranslationTargetNode({
      translatedText,
      content,
      lang: translationScopeRef.current.targetLang,
      targetBlockClassName,
      hidden: !enabled.current,
      widthLineBreak,
    });
    batchDOMUpdate(() => {
      if (!enabled.current || el.querySelector('.translation-target')) return;
      el.classList.add('translation-source');
      // Remembers that this paragraph already has a translation, so the
      // original can carry a tinted background when it is shown side by side.
      el.classList.add('translation-source-done');
      setSourceVisibility(el, !!showTranslateSourceRef.current);
      el.appendChild(wrapper);
      translatedElements.current.push(el);
      // Translations land long after the section's annotations were drawn, so
      // any highlight anchored inside this paragraph has to be re-attached.
      eventDispatcher.dispatch('translation-inserted', { bookKey, element: el });
    });
  };

  /**
   * Batch cache lookup for a window. Hits render straight away; the returned
   * nodes are the ones that still need a provider round trip.
   */
  const prefetchTranslations = async (elements: HTMLElement[]) => {
    const entries: Array<{ el: HTMLElement; key: string }> = [];
    for (const el of elements) {
      const key = getTranslationCacheKey(el);
      if (key) entries.push({ el, key });
    }
    if (entries.length === 0) return [];

    const hits = await getMany(entries.map((entry) => entry.key));
    const misses: HTMLElement[] = [];
    for (const { el, key } of entries) {
      const cached = hits.get(key);
      if (cached !== undefined) {
        renderTranslation(el, cached);
      } else if (!el.querySelector('.translation-target')) {
        misses.push(el);
      }
    }
    return misses;
  };

  /**
   * Visible nodes plus the read-ahead budget, in document order. The budget
   * replaces the old fixed ±N window: it never reaches before the first
   * visible node, so scrolling back does not re-translate what was passed.
   */
  const selectTranslationWindow = (documentNodes: HTMLElement[], visibleIndexes: number[]) => {
    const translated = new Set<number>();
    documentNodes.forEach((node, index) => {
      if (node.querySelector('.translation-target')) translated.add(index);
    });
    const visibleChars = visibleIndexes.reduce(
      (total, index) => total + getParagraphText(documentNodes[index]!).length,
      0,
    );
    const selection = selectNodesForTranslation({
      nodes: documentNodes,
      visibleIndexes,
      translated,
      screenChars: estimateScreenChars(visibleChars),
      charOf: (node) => getParagraphText(node).length,
    });
    return [...selection.visible, ...selection.lookahead]
      .sort((a, b) => a - b)
      .map((index) => documentNodes[index]!);
  };

  /**
   * Prefetch the reading position's window right after the document is
   * observed. `translateInRange` also prefetches, but it only runs when
   * progress changes; on reopen the position is already current.
   */
  const prefetchTranslationWindow = () => {
    const nodes = allTextNodes.current;
    const range = getBookProgress(bookKey)?.range;
    if (nodes.length === 0 || !range) return;
    const { startIndex, endIndex } = findNodeIndicesInRange(range, nodes);
    if (startIndex === -1) return;
    const visibleIndexes: number[] = [];
    for (let index = startIndex; index <= endIndex; index++) {
      visibleIndexes.push(index);
    }
    const selected = selectTranslationWindow(nodes, visibleIndexes);
    void prefetchTranslations(selected).then((misses) =>
      misses.forEach((node) => scheduleTranslation(node)),
    );
  };

  const recreateTranslationObserver = () => {
    observerRefs.current.forEach((observer) => observer.disconnect());
    observerRefs.current = observeTextNodesByDocument(
      allTextNodes.current,
      createTranslationObserver,
    );
  };

  const publishProgress = (force = false) => {
    const progress = progressRef.current;
    if (progress.total === 0) return;
    const now = Date.now();
    if (!force && now - progress.lastSentAt < 400) return;
    progress.lastSentAt = now;
    if (progress.timer) {
      clearTimeout(progress.timer);
      progress.timer = null;
    }
    eventDispatcher.dispatch('hint', {
      bookKey,
      message: _('Translating {{done}}/{{total}}', {
        done: progress.done,
        total: progress.total,
      }),
      timeout: 1400,
    });
  };

  const resetProgress = () => {
    progressRef.current = { total: 0, done: 0, ok: 0, lastSentAt: 0, timer: null };
  };

  const finishProgress = () => {
    const progress = progressRef.current;
    if (progress.total === 0) return;
    if (progress.ok > 0) {
      eventDispatcher.dispatch('hint', {
        bookKey,
        message: _('Translation ready · {{count}} paragraphs', { count: progress.ok }),
        timeout: 1200,
      });
    }
    resetProgress();
  };

  const markProgressDone = (succeeded = false) => {
    const progress = progressRef.current;
    progress.done += 1;
    if (succeeded) progress.ok += 1;
    if (progress.done >= progress.total) {
      finishProgress();
    } else {
      publishProgress();
    }
  };

  const translateElement = async (el: HTMLElement) => {
    if (!enabled.current) return;
    const text = getParagraphText(el);
    if (!text) {
      markProgressDone();
      return;
    }

    if (el.classList.contains('translation-target')) {
      markProgressDone();
      return;
    }

    try {
      // Round-trip the paragraph's inline markup when the provider repositions
      // tags for us; otherwise send bare text. Markup is split at run
      // boundaries so a long formatted paragraph still keeps its formatting
      // instead of falling back — each chunk is well-formed on its own.
      const payload = extractSourcePayload(el);
      const markupChunks =
        translatorPreservesMarkup && payload.hasMarkup
          ? splitMarkupIntoChunks(payload.html, MAX_MARKUP_PAYLOAD_CHARS, splitTextIntoChunks)
          : [];
      const useMarkup = markupChunks.length > 0;

      // Markup translations are stored as markup and rendered through the
      // sanitizer, so they do not share the plain-text cache entry.
      const cacheKey = useMarkup ? null : getTranslationCacheKey(el);
      if (cacheKey) {
        const cached = await getTranslation(cacheKey);
        if (cached !== null) {
          renderTranslation(el, cached);
          markProgressDone(true);
          return;
        }
      }

      const translated = await translateRef.current(useMarkup ? markupChunks : [text]);
      const translatedText = translated.join('');
      if (!translatedText || text === translatedText) {
        return;
      }

      let content: DocumentFragment | undefined;
      if (useMarkup) {
        // Sanitize per chunk: each was translated independently, and a chunk
        // that loses everything must not discard its siblings.
        const combined = el.ownerDocument.createDocumentFragment();
        for (const chunk of translated) {
          const part = sanitizeTranslatedMarkup(chunk, payload.allowedAttrs, el.ownerDocument);
          if (part) combined.appendChild(part);
        }
        content = combined.childNodes.length ? combined : undefined;
      }

      if (cacheKey) {
        // Fire-and-forget: the memory layer is already updated synchronously,
        // and a storage failure must not block the render.
        void setTranslation(cacheKey, translatedText);
      }

      // Falls back to the raw string when markup was not used or did not
      // survive sanitizing, which is exactly the previous behaviour.
      renderTranslation(el, translatedText, content);
      markProgressDone(true);
    } catch (err) {
      console.warn('Translation failed:', err);
    } finally {
      markProgressDone();
    }
  };

  const findNodeIndicesInRange = (range: Range, nodes: HTMLElement[]) => {
    const startContainer = range.startContainer;
    const endContainer = range.endContainer;

    let startIndex = -1;
    let endIndex = -1;
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i]!;
      if (node === startContainer || node.contains(startContainer)) {
        if (startIndex === -1) startIndex = i;
      }
      if (node === endContainer || node.contains(endContainer)) {
        endIndex = i;
      }
    }
    if (startIndex !== -1 && endIndex === -1) {
      endIndex = startIndex;
    }

    return { startIndex, endIndex };
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const translateInRange = useCallback(
    debounce((range: Range) => {
      const nodes = allTextNodes.current;
      if (nodes.length === 0) {
        console.warn('No text nodes available for translation.');
        return;
      }
      const { startIndex, endIndex } = findNodeIndicesInRange(range, nodes);
      if (startIndex === -1) {
        console.log('Range not found in text nodes');
        return;
      }
      const visibleIndexes: number[] = [];
      for (let index = startIndex; index <= endIndex; index++) {
        visibleIndexes.push(index);
      }
      // Visible range plus read-ahead, never the paragraphs before it.
      const selected = selectTranslationWindow(nodes, visibleIndexes);
      void prefetchTranslations(selected).then((misses) =>
        misses.forEach((node) => scheduleTranslation(node)),
      );
    }, 500),
    [scheduleTranslation],
  );

  useEffect(() => {
    if (enabled.current && progress) {
      const { range } = progress;
      translateInRange(range);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress]);

  useEffect(() => {
    if (!viewSettings) return;

    const enabledChanged = enabled.current !== viewSettings.translationEnabled;
    const providerChanged = provider !== viewSettings.translationProvider;
    const targetLangChanged = targetLang !== viewSettings.translateTargetLang;
    const promptChanged = promptId !== viewSettings.translationPromptId;
    const showTranslateSourceChanged =
      showTranslateSourceRef.current !== viewSettings.showTranslateSource;

    if (enabledChanged) {
      enabled.current = viewSettings.translationEnabled;
    }

    if (providerChanged) {
      setProvider(viewSettings.translationProvider);
    }

    if (targetLangChanged) {
      setTargetLang(viewSettings.translateTargetLang);
    }

    if (promptChanged) {
      setPromptId(viewSettings.translationPromptId);
    }

    if (showTranslateSourceChanged) {
      showTranslateSourceRef.current = viewSettings.showTranslateSource;
    }

    if (enabledChanged) {
      toggleTranslationVisibility(viewSettings.translationEnabled);
      if (enabled.current) {
        observeTextNodes();
      }
    } else if (
      providerChanged ||
      targetLangChanged ||
      promptChanged ||
      showTranslateSourceChanged
    ) {
      updateTranslation();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookKey, viewSettings, provider, targetLang, promptId]);

  useEffect(() => {
    if (!view || !enabled.current) return;

    if ('renderer' in view) {
      view.addEventListener('load', observeTextNodes);
      view.addEventListener('load', hintInitialTranslating);
    } else {
      observeTextNodes();
    }
    return () => {
      if ('renderer' in view) {
        view.removeEventListener('load', observeTextNodes);
        view.removeEventListener('load', hintInitialTranslating);
      }
      observerRefs.current.forEach((observer) => observer.disconnect());
      observerRefs.current = [];
      translatedElements.current = [];
      translationQueue.current = [];
      activeTranslations.current = 0;
      if (batchTimerRef.current) {
        clearTimeout(batchTimerRef.current);
        batchTimerRef.current = null;
      }
      if (hintTimerRef.current) {
        clearTimeout(hintTimerRef.current);
        hintTimerRef.current = null;
      }
      pendingDOMUpdates.current = [];
      setIsLoading(bookKey, false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);
}
