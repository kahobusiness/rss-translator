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
  // 来源feed信息，用于聚合输出时区分
  sourceFeedId?: string;
  sourceFeedName?: string;
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
const RECENT_INDEX_PATH = 'feeds/_recent_items.json';

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
      // 排除索引文件和缓存文件
      const feedBlobs = result.blobs.filter(
        b => !b.url.includes('_recent_items.json') && !b.url.includes('_opml_cache.json')
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

export async function getExistingGuids(feedId: string): Promise<Map<string, boolean>> {
  const feed = await loadFeed(feedId);
  if (!feed) return new Map();
  return new Map(feed.items.map(item => [item.guid, item.translated ?? true]));
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

export async function saveRecentIndex(newItems: TranslatedItem[]): Promise<void> {
  try {
    const existing = await loadRecentIndex();
    const merged = [...newItems, ...existing];

    // 按 pubDate 排序，保留前 100 条
    merged.sort((a, b) => {
      const dateA = new Date(a.pubDate).getTime();
      const dateB = new Date(b.pubDate).getTime();
      return dateB - dateA;
    });

    // 按 guid 去重
    const seen = new Set<string>();
    const deduped = merged.filter(item => {
      if (seen.has(item.guid)) return false;
      seen.add(item.guid);
      return true;
    });

    const items = deduped.slice(0, 100);

    if (isBlobEnabled()) {
      await put(RECENT_INDEX_PATH, JSON.stringify(items), {
        access: 'public',
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: 'application/json',
      });
    } else {
      await ensureDataDir();
      await fs.writeFile(
        path.join(DATA_DIR, '_recent_items.json'),
        JSON.stringify(items, null, 2),
        'utf-8'
      );
    }
  } catch (error) {
    console.error('Failed to save recent index:', error);
  }
}

export async function loadRecentIndex(): Promise<TranslatedItem[]> {
  try {
    if (isBlobEnabled()) {
      const base = await getBlobBaseUrl();
      if (base) {
        try {
          const res = await fetch(`${base}/${RECENT_INDEX_PATH}`);
          if (res.ok) return (await res.json()) as TranslatedItem[];
        } catch (error) {
          console.error('Failed to load recent index via cached URL:', error);
        }
      }
      // fallback to head()
      const meta = await head(RECENT_INDEX_PATH);
      const res = await fetch(meta.url);
      if (res.ok) return (await res.json()) as TranslatedItem[];
      return [];
    } else {
      const data = await fs.readFile(path.join(DATA_DIR, '_recent_items.json'), 'utf-8');
      return JSON.parse(data) as TranslatedItem[];
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.error('Failed to load recent index:', error);
    }
    return [];
  }
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
