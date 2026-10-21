/**
 * Selection actions that land in the margin instead of a floating card.
 *
 * These are plain async functions rather than hooks: the Annotator calls them
 * from its own event handlers and must not grow a translator/dictionary React
 * subtree just to write a note. The translator and dictionary services are
 * still the real ones — a margin note is the result of the same lookup the
 * popup would have shown.
 */

import { isCustomTranslatorAllowed } from '@/utils/access';
import { uniqueId } from '@/utils/misc';
import { LOCAL_UNLOCK } from '@/utils/localUnlock';
import { add, type MarginNote } from '@/services/marginalia/store';
import {
  getTranslators,
  isTranslatorAvailable,
  type TranslationProvider,
} from '@/services/translators';
import { getEnabledProviders } from '@/services/dictionaries/registry';
import type { DictionarySettings, ImportedDictionary } from '@/services/dictionaries/types';
import type { AppService } from '@/types/system';

export type TranslateFn = (
  input: string[],
  options?: { source?: string; target?: string; useCache?: boolean },
) => Promise<string[]>;

export interface AnchorTranslationRequest {
  bookKey: string;
  anchorCfi: string;
  text: string;
  provider?: string;
  sourceLang?: string;
  targetLang?: string;
  promptId?: string;
  bookTitle?: string;
  bookAuthor?: string;
  /** Injectable for tests; defaults to the configured translation provider. */
  translate?: TranslateFn;
  /** Fires instead of writing when the margin surface is unavailable. */
  openLegacySurface?: () => void;
  marginAvailable?: boolean;
  onError?: (error: unknown) => void;
  now?: number;
  id?: string;
}

const decodeEntities = (value: string): string => {
  if (typeof document === 'undefined') return value;
  // Keep any markup literal (providers may return `<b>` etc.); only decode
  // character entities.
  const decoder = document.createElement('textarea');
  decoder.innerHTML = value.replaceAll('<', '&lt;');
  return decoder.value;
};

const resolveProvider = (name: string | undefined, token: string | null) => {
  const translators = getTranslators();
  const hasPremium = LOCAL_UNLOCK || isCustomTranslatorAllowed(token);
  const configured = translators.find((translator) => translator.name === name);
  return [configured, ...translators].find(
    (translator): translator is TranslationProvider =>
      !!translator && isTranslatorAvailable(translator, !!token, hasPremium),
  );
};

/**
 * Translate a selection and leave it in the margin. Returns the written note,
 * or `null` when the input is empty / the provider returned nothing.
 */
export const translateToMargin = async (
  request: AnchorTranslationRequest,
): Promise<MarginNote | null> => {
  const text = request.text.replaceAll('\n', '').trim();
  if (!text) return null;

  if (request.marginAvailable === false) {
    request.openLegacySurface?.();
    return null;
  }

  try {
    let translate = request.translate;
    if (!translate) {
      let token: string | null = null;
      try {
        token = typeof window === 'undefined' ? null : window.localStorage.getItem('token');
      } catch {
        token = null;
      }
      const provider = resolveProvider(request.provider, token);
      if (!provider) throw new Error('No translation provider available');
      translate = (input, options) =>
        provider.translate(
          input,
          options?.source ?? request.sourceLang ?? 'AUTO',
          options?.target ?? request.targetLang ?? 'EN',
          token,
          options?.useCache ?? false,
          undefined,
          {
            promptId: request.promptId,
            bookTitle: request.bookTitle,
            bookAuthor: request.bookAuthor,
          },
        );
    }

    const [translated] = await translate([text], {
      source: request.sourceLang,
      target: request.targetLang,
    });
    const body = decodeEntities(translated ?? '').trim();
    if (!body) return null;

    return add(request.bookKey, {
      id: request.id ?? uniqueId(),
      anchorCfi: request.anchorCfi,
      kind: 'translation',
      text: body,
      at: request.now ?? Date.now(),
    });
  } catch (error) {
    request.onError?.(error);
    throw error;
  }
};

export interface AnchorDictionaryRequest {
  bookKey: string;
  anchorCfi: string;
  word: string;
  lang?: string | string[];
  dictionaries: ImportedDictionary[];
  settings: DictionarySettings;
  fs?: AppService | null;
  now?: number;
  id?: string;
}

/**
 * Look the selection up in the enabled dictionaries and keep the first
 * definition in the margin. `null` means there is nothing to show — the caller
 * lets the legacy lookup surface handle it.
 */
export const dictionaryToMargin = async (
  request: AnchorDictionaryRequest,
): Promise<MarginNote | null> => {
  const word = request.word.trim();
  if (!word) return null;

  const providers = getEnabledProviders({
    settings: request.settings,
    dictionaries: request.dictionaries,
    fs: request.fs ?? undefined,
  });
  const provider = providers.find((candidate) => candidate.kind !== 'web');
  if (!provider) return null;

  const container = document.createElement('div');
  const controller = new AbortController();
  try {
    const outcome = await provider.lookup(word, {
      lang: Array.isArray(request.lang) ? request.lang[0] : request.lang,
      signal: controller.signal,
      container,
    });
    if (!outcome.ok) return null;

    const definition = (container.textContent ?? '').replace(/\s+/g, ' ').trim();
    const body = definition.slice(0, 600);
    if (!body) return null;

    return add(request.bookKey, {
      id: request.id ?? uniqueId(),
      anchorCfi: request.anchorCfi,
      kind: 'dictionary',
      text: body,
      at: request.now ?? Date.now(),
    });
  } catch {
    return null;
  } finally {
    controller.abort();
  }
};
