/**
 * Margin notes ("the reading margin").
 *
 * The reader keeps its annotations in the book config, but the margin rail is
 * a *reading trace*: translations, dictionary glosses and quick thoughts the
 * reader left beside a paragraph. They are per book, in memory plus
 * localStorage, and never touch the book file or cloud sync.
 *
 * The snapshot returned by `list()` is stable between mutations, which lets
 * `useSyncExternalStore` subscribe to it without an infinite render loop.
 */

export interface MarginNote {
  id: string;
  anchorCfi: string;
  kind: 'translation' | 'dictionary' | 'note';
  text: string;
  at: number;
}

export type MarginNoteKind = MarginNote['kind'];

const STORAGE_PREFIX = 'readest-marginalia:';
const KINDS: Record<string, true> = {
  translation: true,
  dictionary: true,
  note: true,
};

const cache = new Map<string, MarginNote[]>();
const listeners = new Set<() => void>();

const storageKey = (bookKey: string) => `${STORAGE_PREFIX}${bookKey}`;

const isValidNote = (value: unknown): value is MarginNote => {
  if (!value || typeof value !== 'object') return false;
  const note = value as Partial<MarginNote>;
  return (
    typeof note.id === 'string' &&
    note.id.length > 0 &&
    typeof note.anchorCfi === 'string' &&
    note.anchorCfi.length > 0 &&
    typeof note.kind === 'string' &&
    KINDS[note.kind] === true &&
    typeof note.text === 'string' &&
    typeof note.at === 'number' &&
    Number.isFinite(note.at)
  );
};

const getStorage = (): Storage | null => {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
};

const readStorage = (bookKey: string): MarginNote[] => {
  try {
    const raw = getStorage()?.getItem(storageKey(bookKey));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    // A truncated / hand-edited / version-mismatched entry degrades to an
    // empty margin rather than breaking the reader.
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidNote);
  } catch {
    return [];
  }
};

const writeStorage = (bookKey: string, notes: MarginNote[]) => {
  try {
    const storage = getStorage();
    if (notes.length === 0) storage?.removeItem(storageKey(bookKey));
    else storage?.setItem(storageKey(bookKey), JSON.stringify(notes));
  } catch {
    // Private browsing / quota — the in-memory copy still works for this
    // session, which is better than losing the note outright.
  }
};

const emit = () => {
  listeners.forEach((listener) => listener());
};

const commit = (bookKey: string, notes: MarginNote[]) => {
  cache.set(bookKey, notes);
  writeStorage(bookKey, notes);
  emit();
};

/** Current snapshot for one book. Never rebuilds an unchanged array. */
export const list = (bookKey: string): MarginNote[] => {
  const cached = cache.get(bookKey);
  if (cached) return cached;
  const notes = readStorage(bookKey);
  cache.set(bookKey, notes);
  return notes;
};

/**
 * Adds a note, replacing an earlier note of the same kind at the same anchor.
 * A translation is a property of the paragraph, not a timeline of retries, so
 * looking the same passage up again updates its margin note in place.
 */
export const add = (bookKey: string, note: MarginNote): MarginNote => {
  const notes = list(bookKey);
  // A lookup is a property of the paragraph and is replaced on repeat. Thoughts
  // on one paragraph stack, but re-saving the same annotation updates its note.
  const existing =
    note.kind === 'note'
      ? notes.findIndex((candidate) => candidate.id === note.id)
      : notes.findIndex(
          (candidate) => candidate.anchorCfi === note.anchorCfi && candidate.kind === note.kind,
        );
  const next =
    existing === -1
      ? [...notes, note]
      : notes.map((candidate, index) => (index === existing ? note : candidate));
  commit(bookKey, next);
  return note;
};

export const remove = (bookKey: string, id: string): void => {
  const notes = list(bookKey);
  if (!notes.some((note) => note.id === id)) return;
  commit(
    bookKey,
    notes.filter((note) => note.id !== id),
  );
};

export const clear = (bookKey: string): void => {
  commit(bookKey, []);
};

/** Subscribe to any book's margin changing. Returns the unsubscribe. */
export const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/**
 * Whether the reader has mounted a margin rail to write into. The Annotator
 * falls back to its floating surfaces when it is rendered on its own (tests,
 * embeds), so a note is never written where nobody can see it.
 */
export const isMarginRailAvailable = (): boolean =>
  typeof document !== 'undefined' && document.querySelector('[data-margin-rail-host]') !== null;
