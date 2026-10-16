import { head, get, put, BlobNotFoundError, BlobPreconditionFailedError } from '@vercel/blob';
import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

export interface Snapshot<T> { value: T; etag: string | null }
export interface JsonStore {
  read<T>(key: string): Promise<Snapshot<T> | null>;
  compareAndSwap<T>(key: string, value: T, etag: string | null): Promise<boolean>;
}

export class ConflictError extends Error {}
export function isConditionalConflict(error: unknown): boolean {
  return error instanceof BlobPreconditionFailedError || (error instanceof Error &&
    /conditional request cannot succeed due to a conflicting operation/i.test(error.message));
}
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const blobConfigured = () => !!(process.env.BLOB_READ_WRITE_TOKEN || process.env.STATE_BLOB_STORE_ID || process.env.STATE_BLOB_READ_WRITE_TOKEN || process.env.RSS_STATE_READ_WRITE_TOKEN);
export function stateBlobOptions() {
  const token = process.env.STATE_BLOB_READ_WRITE_TOKEN || process.env.RSS_STATE_READ_WRITE_TOKEN;
  const storeId = process.env.STATE_BLOB_STORE_ID;
  if (!token && !storeId) throw new Error('STATE_BLOB_STORE_ID is required for strongly consistent state');
  return token ? { token } : { storeId };
}

export function createJsonStore(root = path.join(process.cwd(), 'data')): JsonStore {
  const localPath = (key: string) => {
    if (key.includes('..') || key.startsWith('/')) throw new Error('Invalid storage key');
    return path.join(/* turbopackIgnore: true */ root, key.startsWith('feeds/') ? key.slice(6) : key);
  };
  async function read<T>(key: string): Promise<Snapshot<T> | null> {
    if (blobConfigured()) {
      const result = await get(key, { ...stateBlobOptions(), access: 'private', useCache: false,
        abortSignal: AbortSignal.timeout(20_000) });
      if (result?.statusCode === 200) {
        return { value: await new Response(result.stream).json() as T, etag: result.blob.etag };
      }
      // Existing public archives are a read-only migration source. A null ETag
      // means the first mutation must atomically CREATE in the private store.
      if (key.startsWith('feeds/') && process.env.BLOB_READ_WRITE_TOKEN) {
        try {
          const meta = await head(key, { token: process.env.BLOB_READ_WRITE_TOKEN, abortSignal: AbortSignal.timeout(15_000) });
          const res = await fetch(meta.url, { signal: AbortSignal.timeout(20_000), cache: 'no-store' });
          if (!res.ok) throw new Error(`Legacy read ${key}: HTTP ${res.status}`);
          return { value: await res.json() as T, etag: null };
        } catch (error) {
          if (!(error instanceof BlobNotFoundError)) throw error;
        }
      }
      return null;
    }
    try {
      const text = await fs.readFile(/* turbopackIgnore: true */ localPath(key), 'utf8');
      return { value: JSON.parse(text) as T, etag: hash(text) };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }
  return {
    read,
    async compareAndSwap<T>(key: string, value: T, etag: string | null) {
      if (blobConfigured()) {
        try {
          await put(key, JSON.stringify(value), {
            ...stateBlobOptions(), access: 'private', addRandomSuffix: false, contentType: 'application/json',
            cacheControlMaxAge: 60, allowOverwrite: etag !== null,
            ...(etag !== null ? { ifMatch: etag } : {}),
            abortSignal: AbortSignal.timeout(20_000),
          });
          return true;
        } catch (error) {
          if (isConditionalConflict(error)) return false;
          // An atomic create with allowOverwrite=false can lose a race too.
          if (etag === null && error instanceof Error && /already exists|already used|already been uploaded/i.test(error.message)) return false;
          throw error;
        }
      }
      const file = localPath(key);
      await fs.mkdir(path.dirname(file), { recursive: true });
      const lock = `${file}.lock`;
      let acquired = false;
      for (let i = 0; i < 100; i++) {
        try { await fs.mkdir(lock); acquired = true; break; }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
          await pause(10);
        }
      }
      if (!acquired) throw new ConflictError(`Local write lock busy: ${key}`);
      const temp = `${file}.${randomUUID()}.tmp`;
      try {
        const current = await read<T>(key);
        if ((current?.etag ?? null) !== etag) return false;
        await fs.writeFile(temp, JSON.stringify(value), { flag: 'wx' });
        await fs.rename(temp, file);
        return true;
      } finally {
        await fs.rm(temp, { force: true });
        await fs.rmdir(lock);
      }
    },
  };
}

export const jsonStore = createJsonStore();

// Updaters must be pure: a conflicting write re-reads and reapplies the change.
export async function updateJson<T>(key: string, update: (current: T | null) => T | undefined,
  store: JsonStore = jsonStore): Promise<T | null> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const current = await store.read<T>(key);
    const next = update(current?.value ?? null);
    if (next === undefined) return current?.value ?? null;
    if (await store.compareAndSwap(key, next, current?.etag ?? null)) return next;
    await pause(Math.min(25 * 2 ** attempt, 500) + Math.random() * 30);
  }
  throw new ConflictError(`Concurrent updates did not settle: ${key}`);
}

export interface Lease { owner: string; expiresAt: number }
export async function acquireLease(key: string, ttlMs = 330_000, store: JsonStore = jsonStore) {
  const owner = randomUUID();
  const value = await updateJson<Lease>(key, current => {
    if (current && current.expiresAt > Date.now()) return undefined;
    return { owner, expiresAt: Date.now() + ttlMs };
  }, store);
  if (value?.owner !== owner) return null;
  return {
    owner,
    async assertOwned() {
      const lease = await store.read<Lease>(key);
      if (lease?.value.owner !== owner || lease.value.expiresAt <= Date.now()) {
        throw new ConflictError(`Lease expired: ${key}`);
      }
    },
    async release() {
      await updateJson<Lease>(key, current => current?.owner === owner
        ? { owner, expiresAt: 0 } : undefined, store);
    },
  };
}
