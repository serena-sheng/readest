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
import { getActiveEndpoint } from '@/services/translators/endpoints';
import {
  extractSourcePayload,
  sanitizeTranslatedMarkup,
  splitMarkupIntoChunks,
} from '@/app/reader/utils/translationMarkup';
import { withGlossaryRevision } from '@/services/translators/glossary';
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
import type { TaskStatus } from '../components/TaskStatusBar';

/**
 * Normalized paragraph text: the same value used for requests, cache keys and
 * the screen-character budget, so all three agree on what a paragraph is.
 */
const getParagraphText = (el: HTMLElement) => el.textContent?.replaceAll('\n', '').trim() ?? '';

/** A provider failure reduced to the sentence the status bar can show. */
export interface TranslationFailureReason {
  key: string;
  values?: Record<string, string>;
}

/**
 * Turns a provider error into the one thing a reader can act on. Providers
 * throw `emm: …` console jargon (an HTTP status, a URL, a raw `fetch` error);
 * showing that is unreadable, and hiding it behind a count says nothing about
 * what went wrong. The status bar shows this, with the paragraph count as a
 * secondary line.
 */
export const describeTranslationFailure = (
  error: unknown,
  baseUrl: string,
): TranslationFailureReason => {
  const message = error instanceof Error ? error.message : String(error ?? '');
  if (/HTTP\s*(401|403)/i.test(message)) return { key: 'API Key 被拒' };
  if (/HTTP\s*429/i.test(message)) return { key: '请求太频繁' };
  if (/(AbortError|TimeoutError|timeout|timed out|超时)/i.test(message)) {
    return { key: '请求超时' };
  }
  if (/(NetworkError|Failed to fetch|fetch failed|翻译端点不可用)/i.test(message)) {
    return { key: '连不上 {{baseUrl}}', values: { baseUrl } };
  }
  const detail = message.replace(/^emm:\s*/i, '').trim();
  return { key: detail || '翻译失败' };
};

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

/**
 * Text worth sending to a translator. Navigation labels are not prose: a comic
 * TOC is a list of file names (`page03.png`), and sending one costs a request
 * and gets back a model apology that then replaces the label.
 */
export const isTranslatableText = (text: string): boolean => {
  const value = text.trim();
  if (!value) return false;
  if (/^[\w .()\-]+\.(png|jpe?g|webp|gif|bmp|svg|avif|html?|xhtml|md|txt|pdf|epub|cbz|fb2)$/i.test(value)) {
    return false;
  }
  // A bare key such as `page03`, `001` or `img_12` carries no prose, while a
  // real title like `Chapter 1` does.
  if (/^(page|p|img|image|scan|pic|photo|fig|figure)?[\s_\-]*\d{1,4}$/i.test(value)) return false;
  // Needs at least one letter or CJK character to be translatable at all.
  if (!/[\p{L}]/u.test(value)) return false;
  return true;
};

/**
 * Model replies that talk about the request instead of translating it. They
 * must never be rendered: the reader would show "please paste the text" as if
 * it were the paragraph.
 */
const REFUSAL_MARKERS = [
  "i don't see",
  'i do not see',
  "i can't translate",
  'i cannot translate',
  'no text to translate',
  'there is no text',
  'please paste',
  'please provide the text',
  '没有可翻译',
  '没有需要翻译',
  '请提供',
  '无法翻译',
  '找不到可翻译',
];

export const looksLikeTranslationRefusal = (text: string): boolean => {
  const value = text.trim().toLowerCase();
  if (!value) return false;
  return REFUSAL_MARKERS.some((marker) => value.includes(marker));
};

const SOURCE_TINT_CLASS = 'translation-source-tint';

/**
 * Wraps a paragraph's original text so it can carry a tinted background
 * without painting the translation that sits inside the same paragraph.
 *
 * The wrapper is `cfi-skip` for the same reason the hidden wrapper is: its
 * children keep the exact text-node indexes and offsets they had unwrapped, so
 * highlights and progress anchors still resolve.
 */
export const markSourceTranslated = (el: HTMLElement) => {
  let wrapper = el.querySelector<HTMLElement>(`:scope > .${SOURCE_TINT_CLASS}`);
  if (!wrapper) {
    const sourceNodes = Array.from(el.childNodes).filter(
      (node) =>
        !(node.nodeType === Node.ELEMENT_NODE && (node as Element).classList.contains('translation-target')),
    );
    if (!sourceNodes.length) return;
    wrapper = el.ownerDocument.createElement('font');
    wrapper.className = `${SOURCE_TINT_CLASS} cfi-skip`;
    el.insertBefore(wrapper, sourceNodes[0]!);
    sourceNodes.forEach((node) => wrapper!.appendChild(node));
  }
  wrapper.classList.add('translation-source-done');
};

/** Removes the tint wrapper, restoring the paragraph's original children. */
export const clearSourceTint = (el: HTMLElement) => {
  const wrapper = el.querySelector<HTMLElement>(`:scope > .${SOURCE_TINT_CLASS}`);
  if (wrapper) wrapper.replaceWith(...Array.from(wrapper.childNodes));
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
    // The glossary revision is part of the scope: editing a term changes every
    // key, so cached paragraphs translated under the old terms miss instead of
    // being reused. Nothing is cleared; the old entries age out.
    style: withGlossaryRevision(`${provider ?? ''}|${promptId ?? ''}`),
  };
  // Progress feedback: counts paragraphs handed to the provider versus ones
  // that finished (cached hits and failures included), so the hint can show
  // "translating 3/12" instead of an open-ended spinner.
  const progressRef = useRef({ total: 0, done: 0, ok: 0, lastSentAt: 0, timer: null as ReturnType<typeof setTimeout> | null });
  // One status source for every kind of feedback. Success is not announced:
  // the bar clears instead of flashing a completion message.
  const [taskStatus, setTaskStatus] = useState<TaskStatus | null>(null);
  // Paragraphs the provider rejected in the current run, kept so Retry can
  // re-request exactly those instead of re-translating the whole page.
  const failedElementsRef = useRef<HTMLElement[]>([]);
  // The provider's last rejection, kept until the run ends so the bar can say
  // why the paragraphs failed instead of only how many did.
  const failureReasonRef = useRef<TranslationFailureReason | null>(null);
  // Bumped whenever the current run is torn down (provider change, translation
  // switched off, unmount). A failure that lands after that is a cancellation,
  // not something the reader asked to know about.
  const runIdRef = useRef(0);
  const progressStartedAtRef = useRef<number | null>(null);
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
    const startedAt = Date.now();
    progressStartedAtRef.current = startedAt;
    setTaskStatus({ kind: 'progress', message: _('Translating...'), startedAt });
    hintTimerRef.current = setTimeout(() => {
      hintTimerRef.current = null;
      setIsLoading(bookKey, false);
      // Nothing was queued, so there is no progress to report and no failure.
      if (progressRef.current.total === 0) {
        progressStartedAtRef.current = null;
        setTaskStatus(null);
      }
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
      clearSourceTint(element);
      const translationTargets = element.querySelectorAll('.translation-target');
      translationTargets.forEach((target) => target.remove());
      // The hidden source wrapper is `display: none`, so a paragraph left with
      // neither a target nor a visible original renders blank for as long as the
      // re-translation is in flight, and stays blank if that translation fails.
      setSourceVisibility(element, true);
    });

    translatedElements.current = [];
    failedElementsRef.current = [];
    failureReasonRef.current = null;
    runIdRef.current += 1;
    resetProgress();
    setTaskStatus(null);
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
    // Filenames and bare keys are not prose; translating them wastes a request
    // and invites the model to answer with an apology instead of a translation.
    if (!isTranslatableText(getParagraphText(el))) return;
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
    if (looksLikeTranslationRefusal(translatedText)) {
      console.warn('Discarding a translation that answers the request instead of translating.');
      return;
    }
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
      // Tint only the original text: the wrapper excludes the translation
      // target that is appended below, so the translation keeps no background.
      markSourceTranslated(el);
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
    progressStartedAtRef.current ??= now;
    setTaskStatus({
      kind: 'progress',
      message: _('Translating {{done}}/{{total}}', {
        done: progress.done,
        total: progress.total,
      }),
      startedAt: progressStartedAtRef.current,
    });
  };

  const resetProgress = () => {
    progressRef.current = { total: 0, done: 0, ok: 0, lastSentAt: 0, timer: null };
    progressStartedAtRef.current = null;
  };

  const finishProgress = () => {
    const progress = progressRef.current;
    if (progress.total === 0) return;
    // Success and cache hits stay silent; only a failed run asks for action.
    if (failedElementsRef.current.length > 0) {
      const failure = failureReasonRef.current;
      setTaskStatus({
        kind: 'error',
        message: failure ? _(failure.key, failure.values) : _('翻译失败'),
        detail: _('{{count}} 段未完成', { count: failedElementsRef.current.length }),
      });
      failureReasonRef.current = null;
    } else {
      setTaskStatus(null);
    }
    resetProgress();
  };

  /**
   * Re-request the paragraphs the provider rejected. A retry starts a fresh
   * progress run so the bar reflects the new attempt rather than the old one.
   */
  const retryFailedTranslations = () => {
    const failed = failedElementsRef.current.splice(0);
    if (failed.length === 0) return;
    failureReasonRef.current = null;
    setTaskStatus(null);
    resetProgress();
    progressStartedAtRef.current = Date.now();
    failed.forEach((element) => scheduleTranslation(element));
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
    // The run this request belongs to; a teardown while it is in flight turns
    // its rejection into a cancellation rather than a failure.
    const runId = runIdRef.current;
    const text = getParagraphText(el);
    if (!text) {
      markProgressDone();
      return;
    }

    if (el.classList.contains('translation-target')) {
      markProgressDone();
      return;
    }

    let succeeded = false;
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
          succeeded = true;
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
      succeeded = true;
    } catch (err) {
      // A request torn down by the reader (translation switched off, provider
      // changed, view unmounted) is not a failure: reporting it as a timeout
      // would blame the service for the reader's own cancel.
      if (
        runId !== runIdRef.current ||
        ((err as Error | undefined)?.name === 'AbortError' && !enabled.current)
      ) {
        return;
      }
      if (!failedElementsRef.current.includes(el)) {
        failedElementsRef.current.push(el);
      }
      failureReasonRef.current = describeTranslationFailure(err, getActiveEndpoint().baseUrl);
      console.warn('Translation failed:', err);
    } finally {
      // A paragraph that succeeded later in the run is no longer a failure.
      if (succeeded) {
        failedElementsRef.current = failedElementsRef.current.filter((item) => item !== el);
      }
      markProgressDone(succeeded);
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
      } else {
        failedElementsRef.current = [];
        failureReasonRef.current = null;
        runIdRef.current += 1;
        resetProgress();
        setTaskStatus(null);
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
      failedElementsRef.current = [];
      failureReasonRef.current = null;
      runIdRef.current += 1;
      resetProgress();
      setTaskStatus(null);
      setIsLoading(bookKey, false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  return { status: taskStatus, retry: retryFailedTranslations };
}
