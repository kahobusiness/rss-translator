import { put, list, del } from '@vercel/blob';
import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';

// 每个 chunk 翻译结果的持久化缓存
//
// 目的：长文被切成多 chunk 后，任一 chunk 失败原本会导致整篇下次全量重译；
// 缓存让成功的 chunk 免于重跑，只跑缺失的。key 里含 chunk 原文 hash，原文改了会自动 invalidate。
//
// 路径：feeds/_chunks/{guidHash16}/{chunkIndex}_{contentHash12}.json

export interface CachedChunk {
  translatedTitle: string;
  translatedContent: string;
  cachedAt: string; // ISO
}

const CHUNK_PREFIX = 'feeds/_chunks/';

function sha1Hex(s: string): string {
  return createHash('sha1').update(s).digest('hex');
}

export function hashGuid(guid: string): string {
  return sha1Hex(guid).slice(0, 16);
}

export function hashChunkContent(content: string): string {
  return sha1Hex(content).slice(0, 12);
}

function chunkDir(guid: string): string {
  return `${CHUNK_PREFIX}${hashGuid(guid)}/`;
}

function chunkPath(guid: string, chunkIndex: number, contentHash: string): string {
  return `${chunkDir(guid)}${chunkIndex}_${contentHash}.json`;
}

function isBlobEnabled(): boolean {
  return !!process.env.BLOB_READ_WRITE_TOKEN;
}

// ── 本地 fs fallback（开发） ──
const DATA_DIR = path.join(process.cwd(), 'data');
function fsChunkPath(guid: string, chunkIndex: number, contentHash: string): string {
  const dir = path.join(DATA_DIR, '_chunks', hashGuid(guid));
  return path.join(dir, `${chunkIndex}_${contentHash}.json`);
}

// ── Blob base URL（复用 storage.ts 的模式）──
let chunkBlobBaseUrl: string | null = null;
async function getChunkBlobBaseUrl(): Promise<string> {
  if (chunkBlobBaseUrl) return chunkBlobBaseUrl;
  try {
    const result = await list({ prefix: CHUNK_PREFIX, limit: 1 });
    if (result.blobs.length > 0) {
      chunkBlobBaseUrl = new URL(result.blobs[0].url).origin;
    }
  } catch (error) {
    console.error('Failed to get chunk blob base URL:', error);
  }
  return chunkBlobBaseUrl || '';
}

export async function getCachedChunk(
  guid: string,
  chunkIndex: number,
  contentHash: string,
): Promise<CachedChunk | null> {
  const key = chunkPath(guid, chunkIndex, contentHash);
  if (isBlobEnabled()) {
    try {
      const base = await getChunkBlobBaseUrl();
      if (base) {
        const res = await fetch(`${base}/${key}`);
        if (res.ok) return (await res.json()) as CachedChunk;
        if (res.status === 404) return null;
      }
    } catch (error) {
      console.error(`chunk cache miss (fetch error) ${key}:`, error);
    }
    return null;
  }
  try {
    const data = await fs.readFile(fsChunkPath(guid, chunkIndex, contentHash), 'utf-8');
    return JSON.parse(data) as CachedChunk;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.error(`chunk cache read error:`, error);
    }
    return null;
  }
}

// 写入后删除同 (guid, chunkIndex) 下的旧 contentHash 版本，保证单目录大小稳定
export async function setCachedChunk(
  guid: string,
  chunkIndex: number,
  contentHash: string,
  result: { translatedTitle: string; translatedContent: string },
): Promise<void> {
  const key = chunkPath(guid, chunkIndex, contentHash);
  const payload: CachedChunk = { ...result, cachedAt: new Date().toISOString() };

  if (isBlobEnabled()) {
    try {
      await put(key, JSON.stringify(payload), {
        access: 'public',
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: 'application/json',
      });
      // 清掉同 chunkIndex 的过期 hash 版本，避免积累
      const prefix = `${chunkDir(guid)}${chunkIndex}_`;
      const existing = await list({ prefix, limit: 100 });
      const stale = existing.blobs
        .map(b => b.pathname)
        .filter(p => p !== key);
      if (stale.length > 0) await del(stale);
    } catch (error) {
      console.error(`chunk cache write error ${key}:`, error);
    }
    return;
  }
  try {
    const file = fsChunkPath(guid, chunkIndex, contentHash);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify(payload, null, 2), 'utf-8');
    // fs 版本的旧 hash 清理
    const dir = path.dirname(file);
    const entries = await fs.readdir(dir);
    const target = path.basename(file);
    const prefix = `${chunkIndex}_`;
    await Promise.all(
      entries
        .filter(e => e.startsWith(prefix) && e !== target)
        .map(e => fs.unlink(path.join(dir, e))),
    );
  } catch (error) {
    console.error(`chunk cache fs write error:`, error);
  }
}
