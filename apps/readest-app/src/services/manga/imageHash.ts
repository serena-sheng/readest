/**
 * FNV-1a, 32 bit, over raw bytes.
 *
 * The manga cache identifies a page by the bytes the user is looking at, not
 * by a file name: the same page may be reached through a different archive
 * path or a re-encoded CBZ entry. Collision resistance only needs to hold
 * within one reader session's page set, so a cheap non-cryptographic hash is
 * enough. The hex form matches `hashTranslationText`.
 */
export function hashBytes(bytes: Uint8Array): string {
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
