import type { JsonStore, Snapshot } from '../lib/json-store.ts';
// Test-only atomic backend. Production always uses Blob or the filesystem.
export function memoryStore(): JsonStore {
  const rows = new Map<string, Snapshot<unknown>>();
  let revision = 0;
  return {
    async read<T>(key: string) { return structuredClone(rows.get(key) as Snapshot<T> | undefined) || null; },
    async compareAndSwap<T>(key: string, value: T, etag: string | null) {
      if ((rows.get(key)?.etag ?? null) !== etag) return false;
      rows.set(key, { value: structuredClone(value), etag: String(++revision) });
      return true;
    },
  };
}
