/**
 * This toolchain's jsdom environment exposes a `localStorage` accessor that
 * resolves to `undefined` (Node's experimental Web Storage without a backing
 * file), which breaks every test that reads or writes storage. Tests that need
 * it install this Map-backed `Storage` for the duration of their file.
 */
export const installMemoryStorage = (): Storage => {
  const backing = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return backing.size;
    },
    clear() {
      backing.clear();
    },
    getItem(key) {
      return backing.get(key) ?? null;
    },
    key(index) {
      return [...backing.keys()][index] ?? null;
    },
    removeItem(key) {
      backing.delete(key);
    },
    setItem(key, value) {
      backing.set(key, String(value));
    },
  };
  if (!window.localStorage) {
    Object.defineProperty(window, 'localStorage', { value: storage, configurable: true });
  }
  return window.localStorage;
};
