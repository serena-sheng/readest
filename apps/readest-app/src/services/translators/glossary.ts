/**
 * The reader's own glossary for cloud translation endpoints.
 *
 * The local expert service already accepts a glossary per expert, but an
 * OpenAI-compatible chat endpoint has nowhere to send it: the only per-request
 * carrier is the system prompt. This module owns the plain-text form the panel
 * edits (`原词=译名` per line), parses it into the pairs `systemPromptFor`
 * expects, and keeps a revision counter so a changed glossary produces new
 * cache keys instead of serving translations made under the old terms.
 *
 * The text and the revision are separate `localStorage` keys. A revision is a
 * monotonically increasing integer: the panel rewrites the text on every save
 * and the cache key builder folds the current revision in. Entries made before
 * a term change stay in IndexedDB but are never looked up again.
 *
 * Storage can be unavailable (private mode, a locked Tauri store, tests). Every
 * access degrades to an empty glossary, a no-op write, or revision 0 instead of
 * throwing, so a blocked store never fails a translation.
 */

export type Glossary = Record<string, string>;

export const GLOSSARY_STORAGE_KEY = 'emm.translation.glossary';
export const GLOSSARY_REVISION_KEY = 'emm.translation.glossaryRevision';

const storage = (): Storage | null => {
  try {
    if (typeof window === 'undefined') return null;
    return window.localStorage ?? null;
  } catch {
    return null;
  }
};

/**
 * Parse `原词=译名` lines. Blank lines, `#` comments and lines with an empty
 * side are ignored; everything after the first `=` is the translation, so a
 * target may itself contain `=`. When a term repeats, the last line wins.
 */
export function parseGlossary(text: string): Glossary {
  const glossary: Glossary = {};
  if (typeof text !== 'string' || !text.trim()) return glossary;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const at = line.indexOf('=');
    if (at <= 0) continue;
    const source = line.slice(0, at).trim();
    const target = line.slice(at + 1).trim();
    if (!source || !target) continue;
    glossary[source] = target;
  }
  return glossary;
}

/** The raw text the panel edits; `''` when nothing is stored. */
export function getGlossaryText(): string {
  try {
    return storage()?.getItem(GLOSSARY_STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

/** The parsed pairs, ready for `systemPromptFor`. */
export function getGlossary(): Glossary {
  return parseGlossary(getGlossaryText());
}

/** Bumped on every save; folded into translation cache keys. */
export function getGlossaryRevision(): number {
  try {
    const raw = storage()?.getItem(GLOSSARY_REVISION_KEY);
    if (raw === null || raw === undefined) return 0;
    const revision = Number.parseInt(raw, 10);
    return Number.isFinite(revision) && revision > 0 ? revision : 0;
  } catch {
    return 0;
  }
}

/**
 * Persist the editor's text and bump the revision, which is what invalidates
 * cached translations made under the previous terms.
 */
export function setGlossaryText(text: string): void {
  const store = storage();
  if (!store) return;
  try {
    const revision = getGlossaryRevision() + 1;
    store.setItem(GLOSSARY_STORAGE_KEY, text);
    store.setItem(GLOSSARY_REVISION_KEY, String(revision));
  } catch {
    // Storage blocked or full: the caller keeps its in-memory copy.
  }
}

/**
 * Fold the current glossary revision into a cache scope string. Providers that
 * ignore the glossary still get a valid key; the revision simply never moves
 * while no glossary is edited.
 */
export const withGlossaryRevision = (scope: string): string =>
  `${scope}|g${getGlossaryRevision()}`;
