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
}

const BLOB_PREFIX = 'feeds/';

function useBlob(): boolean {
  return !!process.env.BLOB_READ_WRITE_TOKEN;
}

// ── Blob 实现 ──

function blobPath(feedId: string): string {
  return `${BLOB_PREFIX}${feedId}.json`;
}

async function blobSaveFeed(feed: StoredFeed): Promise<void> {
  await put(blobPath(feed.feedId), JSON.stringify(feed), {
    access: 'public',
    addRandomSuffix: false,
    contentType: 'application/json',
  });
}

async function blobLoadFeed(feedId: string): Promise<StoredFeed | null> {
  try {
    const meta = await head(blobPath(feedId));
    const res = await fetch(meta.url);
    if (!res.ok) return null;
    return (await res.json()) as StoredFeed;
  } catch {
    return null;
  }
}

async function blobLoadAllFeeds(): Promise<StoredFeed[]> {
  try {
    let allBlobs: { url: string }[] = [];
    let cursor: string | undefined;
    do {
      const result = await list({ prefix: BLOB_PREFIX, cursor });
      allBlobs = allBlobs.concat(result.blobs);
      cursor = result.hasMore ? result.cursor : undefined;
    } while (cursor);

    if (allBlobs.length === 0) return [];

    const feeds = await Promise.all(
      allBlobs.map(async (blob) => {
        try {
          const res = await fetch(blob.url);
          if (!res.ok) return null;
          return (await res.json()) as StoredFeed;
        } catch {
          return null;
        }
      })
    );

    return feeds.filter((f): f is StoredFeed => f !== null);
  } catch {
    return [];
  }
}

// ── 文件系统 fallback（本地开发） ──

const DATA_DIR = path.join(process.cwd(), 'data');

async function ensureDataDir() {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
  } catch {
    // 目录已存在
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
  } catch {
    return null;
  }
}

async function fsLoadAllFeeds(): Promise<StoredFeed[]> {
  await ensureDataDir();
  try {
    const files = await fs.readdir(DATA_DIR);
    const jsonFiles = files.filter(f => f.endsWith('.json'));
    const feeds: StoredFeed[] = [];
    for (const file of jsonFiles) {
      try {
        const data = await fs.readFile(path.join(DATA_DIR, file), 'utf-8');
        feeds.push(JSON.parse(data));
      } catch {
        // 跳过损坏的文件
      }
    }
    return feeds;
  } catch {
    return [];
  }
}

// ── 公开 API（接口不变） ──

export async function saveFeed(feed: StoredFeed): Promise<void> {
  if (useBlob()) {
    await blobSaveFeed(feed);
  } else {
    await fsSaveFeed(feed);
  }
}

export async function loadFeed(feedId: string): Promise<StoredFeed | null> {
  if (useBlob()) {
    return blobLoadFeed(feedId);
  }
  return fsLoadFeed(feedId);
}

export async function loadAllFeeds(): Promise<StoredFeed[]> {
  if (useBlob()) {
    return blobLoadAllFeeds();
  }
  return fsLoadAllFeeds();
}

export async function getExistingGuids(feedId: string): Promise<Set<string>> {
  const feed = await loadFeed(feedId);
  if (!feed) return new Set();
  return new Set(feed.items.map(item => item.guid));
}

export async function appendItems(
  feedId: string,
  feedTitle: string,
  feedDescription: string | undefined,
  feedLink: string | undefined,
  newItems: TranslatedItem[]
): Promise<void> {
  const existingFeed = await loadFeed(feedId);

  const feed: StoredFeed = {
    feedId,
    feedTitle,
    feedDescription,
    feedLink,
    items: existingFeed ? [...newItems, ...existingFeed.items] : newItems,
    lastUpdated: new Date().toISOString(),
  };

  // 只保留最近100条
  feed.items = feed.items.slice(0, 100);

  await saveFeed(feed);
}

// 获取所有翻译过的文章（按时间排序）
export async function getAllTranslatedItems(limit: number = 100): Promise<TranslatedItem[]> {
  const feeds = await loadAllFeeds();
  const allItems: TranslatedItem[] = [];

  for (const feed of feeds) {
    for (const item of feed.items) {
      // 确保每个item都有来源信息
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
