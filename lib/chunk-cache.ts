import { createHash } from 'node:crypto';
import { jsonStore, updateJson } from './json-store.ts';
import type { JsonStore } from './json-store.ts';

export interface CachedChunk {
  texts: Record<string, string>;
  cachedAt: string;
  inputTokens: number;
  outputTokens: number;
}
export const hashGuid = (guid: string) => createHash('sha256').update(guid).digest('hex');
export const hashChunkContent = (text: string) => createHash('sha256').update(text).digest('hex');
const indexKey = (id: string, version: string) => `feeds/_chunks/v3/${hashGuid(id)}/${version}/index.json`;
export async function getChunkCache(id: string, version: string, store: JsonStore = jsonStore) {
  return (await store.read<Record<string, CachedChunk>>(indexKey(id, version)))?.value || {};
}
export async function getCachedChunk(id: string, version: string, index: number, hash: string,
  store: JsonStore = jsonStore): Promise<CachedChunk | null> {
  return (await getChunkCache(id, version, store))[`${index}-${hash}`] || null;
}
// One checkpoint per article/version keeps a long article's resume to one read,
// instead of hundreds of serial cache requests. Existing chunk entries are immutable.
export async function setCachedChunk(id: string, version: string, index: number, hash: string,
  value: CachedChunk, store: JsonStore = jsonStore): Promise<void> {
  const entry = `${index}-${hash}`;
  await updateJson<Record<string, CachedChunk>>(indexKey(id, version), current =>
    current?.[entry] ? undefined : { ...current, [entry]: value }, store);
}
