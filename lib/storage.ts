import { put, head, list } from '@vercel/blob';
import { promises as fs } from 'fs';
import path from 'path';

export interface TranslatedItem {
  guid: string;
  originalTitle: string;
  translatedTitle: string;
  originalContent: string;
  translatedContent: string;
  link: string;
  pubDate: string;
  author?: string;
  categories?: string[];
  translatedAt: string;
  translated: boolean;
  // 失败重试控制（PR-B）：translated=false 且未 permanentlyFailed 时才会被下一次 cron 拉起
  attempts?: number;           // 已经尝试过的次数；成功置 0/omit
  nextRetryAt?: string;        // ISO；未到该时间不重试
  permanentlyFailed?: boolean; // 达到上限后置 true，人工 reset 才会再试
  // 来源feed信息，用于聚合输出时区分
  sourceFeedId?: string;
  sourceFeedName?: string;
}

export interface ItemStatus {
  translated: boolean;
  permanentlyFailed: boolean;
  nextRetryAt?: string;
  attempts: number;
}

// 指数 backoff 时间表：第 N 次失败后 attempts=N，下次重试间隔
// attempts=1:6h, 2:24h, 3:72h, 4:168h。第 5 次失败置 permanentlyFailed
const BACKOFF_HOURS = [6, 24, 72, 168];
export const MAX_RETRY_ATTEMPTS = BACKOFF_HOURS.length + 1;

export function computeRetryState(prevAttempts: number): {
  attempts: number;
  nextRetryAt?: string;
  permanentlyFailed: boolean;
} {
  const attempts = prevAttempts + 1;
  if (attempts >= MAX_RETRY_ATTEMPTS) {
    return { attempts, permanentlyFailed: true };
  }
  const hours = BACKOFF_HOURS[attempts - 1];
  const nextRetryAt = new Date(Date.now() + hours * 3600_000).toISOString();
  return { attempts, nextRetryAt, permanentlyFailed: false };
}

export interface StoredFeed {
  feedId: string;
  feedTitle: string;
  feedDescription?: string;
  feedLink?: string;
  items: TranslatedItem[];
  lastUpdated: string;
  version?: number;
}

const BLOB_PREFIX = 'feeds/';
const RECENT_INDEX_LEGACY_PATH = 'feeds/_recent_items.json';
// cron 3 批各自写独立文件，读时合并，消除并发覆盖
const RECENT_INDEX_BATCHES = 3;
function recentIndexPath(batch: number): string {
  return `feeds/_recent_items_b${batch}.json`;
}
const RECENT_INDEX_CACHE_TTL_MS = 30_000;

function isBlobEnabled(): boolean {
  return !!process.env.BLOB_READ_WRITE_TOKEN;
}

// ── Blob URL 缓存 ──

let blobBaseUrl: string | null = null;

async function getBlobBaseUrl(): Promise<string> {
  if (blobBaseUrl) return blobBaseUrl;
  try {
    const result = await list({ prefix: BLOB_PREFIX, limit: 1 });
    if (result.blobs.length > 0) {
      const url = new URL(result.blobs[0].url);
      blobBaseUrl = url.origin;
    }
  } catch (error) {
    console.error('Failed to get blob base URL:', error);
  }
  return blobBaseUrl || '';
}

// ── Blob 实现 ──

function blobPath(feedId: string): string {
  return `${BLOB_PREFIX}${feedId}.json`;
}

async function blobSaveFeed(feed: StoredFeed): Promise<void> {
  await put(blobPath(feed.feedId), JSON.stringify(feed), {
    access: 'public',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json',
  });
}

async function fetchAndParse(url: string): Promise<StoredFeed | null> {
  const res = await fetch(url);
  if (!res.ok) return null;
  return (await res.json()) as StoredFeed;
}

async function blobLoadFeed(feedId: string): Promise<StoredFeed | null> {
  try {
    const base = await getBlobBaseUrl();
    if (base) {
      try {
        return await fetchAndParse(`${base}/${blobPath(feedId)}`);
      } catch (error) {
        console.error(`Failed to load feed ${feedId} via cached URL, falling back to head():`, error);
      }
    }
    // fallback to head()
    const meta = await head(blobPath(feedId));
    return await fetchAndParse(meta.url);
  } catch (error) {
    console.error(`Failed to load feed ${feedId} from blob:`, error);
    return null;
  }
}

async function blobLoadAllFeeds(): Promise<StoredFeed[]> {
  try {
    let allBlobs: { url: string }[] = [];
    let cursor: string | undefined;
    do {
      const result = await list({ prefix: BLOB_PREFIX, cursor });
      // 排除索引文件和缓存文件（per-batch 索引、老 legacy 索引、opml 缓存均过滤）
      const feedBlobs = result.blobs.filter(
        b => !/\/_recent_items(_b\d+)?\.json$/.test(b.url) && !b.url.includes('_opml_cache.json')
      );
      allBlobs = allBlobs.concat(feedBlobs);
      cursor = result.hasMore ? result.cursor : undefined;
    } while (cursor);

    if (allBlobs.length === 0) return [];

    const feeds = await Promise.all(
      allBlobs.map(async (blob) => {
        try {
          const res = await fetch(blob.url);
          if (!res.ok) return null;
          return (await res.json()) as StoredFeed;
        } catch (error) {
          console.error(`Failed to fetch blob ${blob.url}:`, error);
          return null;
        }
      })
    );

    return feeds.filter((f): f is StoredFeed => f !== null);
  } catch (error) {
    console.error('Failed to load all feeds from blob:', error);
    return [];
  }
}

// ── 文件系统 fallback（本地开发） ──

const DATA_DIR = path.join(process.cwd(), 'data');

async function ensureDataDir() {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
  } catch (error) {
    console.error('Failed to create data directory:', error);
  }
}

function getFilePath(feedId: string): string {
  return path.join(DATA_DIR, `${feedId}.json`);
}

async function fsSaveFeed(feed: StoredFeed): Promise<void> {
  await ensureDataDir();
  await fs.writeFile(getFilePath(feed.feedId), JSON.stringify(feed, null, 2), 'utf-8');
}

async function fsLoadFeed(feedId: string): Promise<StoredFeed | null> {
  await ensureDataDir();
  try {
    const data = await fs.readFile(getFilePath(feedId), 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.error(`Failed to load feed ${feedId} from filesystem:`, error);
    }
    return null;
  }
}

async function fsLoadAllFeeds(): Promise<StoredFeed[]> {
  await ensureDataDir();
  try {
    const files = await fs.readdir(DATA_DIR);
    const jsonFiles = files.filter(f => f.endsWith('.json') && !f.startsWith('_'));
    const feeds: StoredFeed[] = [];
    for (const file of jsonFiles) {
      try {
        const data = await fs.readFile(path.join(DATA_DIR, file), 'utf-8');
        feeds.push(JSON.parse(data));
      } catch (error) {
        console.error(`Failed to parse feed file ${file}:`, error);
      }
    }
    return feeds;
  } catch (error) {
    console.error('Failed to read data directory:', error);
    return [];
  }
}

// ── 公开 API ──

export async function saveFeed(feed: StoredFeed): Promise<void> {
  if (isBlobEnabled()) {
    await blobSaveFeed(feed);
  } else {
    await fsSaveFeed(feed);
  }
}

export async function loadFeed(feedId: string): Promise<StoredFeed | null> {
  if (isBlobEnabled()) {
    return blobLoadFeed(feedId);
  }
  return fsLoadFeed(feedId);
}

export async function loadAllFeeds(): Promise<StoredFeed[]> {
  if (isBlobEnabled()) {
    return blobLoadAllFeeds();
  }
  return fsLoadAllFeeds();
}

export async function getExistingStatus(feedId: string): Promise<Map<string, ItemStatus>> {
  const feed = await loadFeed(feedId);
  if (!feed) return new Map();
  return new Map(
    feed.items.map(item => [
      item.guid,
      {
        translated: item.translated ?? true,
        permanentlyFailed: item.permanentlyFailed ?? false,
        nextRetryAt: item.nextRetryAt,
        attempts: item.attempts ?? 0,
      },
    ])
  );
}

export async function appendItems(
  feedId: string,
  feedTitle: string,
  feedDescription: string | undefined,
  feedLink: string | undefined,
  newItems: TranslatedItem[]
): Promise<void> {
  const existingFeed = await loadFeed(feedId);
  const currentVersion = existingFeed?.version || 0;

  const feed: StoredFeed = {
    feedId,
    feedTitle,
    feedDescription,
    feedLink,
    items: existingFeed ? [...newItems, ...existingFeed.items] : newItems,
    lastUpdated: new Date().toISOString(),
    version: currentVersion + 1,
  };

  // 只保留最近100条
  feed.items = feed.items.slice(0, 100);

  await saveFeed(feed);
}

// ── 聚合索引 ──
//
// 每批 cron 写自己的 `_recent_items_b{batch}.json`，读时合并所有批次 + legacy
// 索引（存在则包含），避免 3 批并发写同一文件互相覆盖。

function dedupeAndSort(items: TranslatedItem[]): TranslatedItem[] {
  items.sort((a, b) => new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime());
  const seen = new Set<string>();
  const out: TranslatedItem[] = [];
  for (const it of items) {
    if (seen.has(it.guid)) continue;
    seen.add(it.guid);
    out.push(it);
  }
  return out;
}

// 只写当前批次的分片索引，不读其他批次
export async function saveRecentIndex(newItems: TranslatedItem[], batch: number): Promise<void> {
  try {
    const shardPath = recentIndexPath(batch);
    // 单批次内部也要去重 + 排序，保留本批最近 100 条
    const items = dedupeAndSort(newItems).slice(0, 100);

    if (isBlobEnabled()) {
      await put(shardPath, JSON.stringify(items), {
        access: 'public',
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: 'application/json',
      });
    } else {
      await ensureDataDir();
      await fs.writeFile(
        path.join(DATA_DIR, path.basename(shardPath)),
        JSON.stringify(items, null, 2),
        'utf-8'
      );
    }
    // 写入后使相关读缓存失效
    recentIndexCache = null;
  } catch (error) {
    console.error(`Failed to save recent index shard b${batch}:`, error);
  }
}

// 读路径：合并 3 批 + legacy + 30s 进程内缓存
let recentIndexCache: { at: number; items: TranslatedItem[] } | null = null;

async function loadOneShard(shardPath: string): Promise<TranslatedItem[]> {
  try {
    if (isBlobEnabled()) {
      const base = await getBlobBaseUrl();
      if (base) {
        const res = await fetch(`${base}/${shardPath}`);
        if (res.ok) return (await res.json()) as TranslatedItem[];
        if (res.status === 404) return [];
      }
      try {
        const meta = await head(shardPath);
        const res = await fetch(meta.url);
        if (res.ok) return (await res.json()) as TranslatedItem[];
      } catch { /* 404 视为空 */ }
      return [];
    } else {
      const data = await fs.readFile(path.join(DATA_DIR, path.basename(shardPath)), 'utf-8');
      return JSON.parse(data) as TranslatedItem[];
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.error(`Failed to load recent index shard ${shardPath}:`, error);
    }
    return [];
  }
}

export async function loadRecentIndex(): Promise<TranslatedItem[]> {
  if (recentIndexCache && Date.now() - recentIndexCache.at < RECENT_INDEX_CACHE_TTL_MS) {
    return recentIndexCache.items;
  }
  const shardPaths = Array.from({ length: RECENT_INDEX_BATCHES }, (_, i) => recentIndexPath(i));
  // 包含 legacy 单文件以兼容历史数据（存在则读，不存在返回空）
  const allPaths = [...shardPaths, RECENT_INDEX_LEGACY_PATH];
  const shards = await Promise.all(allPaths.map(p => loadOneShard(p)));
  const merged = dedupeAndSort(shards.flat()).slice(0, 100);
  recentIndexCache = { at: Date.now(), items: merged };
  return merged;
}

// 获取所有翻译过的文章（按时间排序）
export async function getAllTranslatedItems(limit: number = 100): Promise<TranslatedItem[]> {
  // 优先使用聚合索引
  const indexed = await loadRecentIndex();
  if (indexed.length > 0) {
    return indexed.slice(0, limit);
  }

  // fallback 到全量扫描
  const feeds = await loadAllFeeds();
  const allItems: TranslatedItem[] = [];

  for (const feed of feeds) {
    for (const item of feed.items) {
      allItems.push({
        ...item,
        sourceFeedId: item.sourceFeedId || feed.feedId,
        sourceFeedName: item.sourceFeedName || feed.feedTitle,
      });
    }
  }

  // 按发布时间排序（最新的在前）
  allItems.sort((a, b) => {
    const dateA = new Date(a.pubDate).getTime();
    const dateB = new Date(b.pubDate).getTime();
    return dateB - dateA;
  });

  return allItems.slice(0, limit);
}
