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
}

export interface StoredFeed {
  feedId: string;
  feedTitle: string;
  feedDescription?: string;
  feedLink?: string;
  items: TranslatedItem[];
  lastUpdated: string;
}

// 在Vercel上使用/tmp目录存储缓存数据
// 注意：/tmp在serverless环境中是临时的，重启后会清空
// 生产环境建议使用Vercel KV或外部数据库
const DATA_DIR = process.env.NODE_ENV === 'production'
  ? '/tmp/rss-data'
  : path.join(process.cwd(), 'data');

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

export async function saveFeed(feed: StoredFeed): Promise<void> {
  await ensureDataDir();
  const filePath = getFilePath(feed.feedId);
  await fs.writeFile(filePath, JSON.stringify(feed, null, 2), 'utf-8');
}

export async function loadFeed(feedId: string): Promise<StoredFeed | null> {
  await ensureDataDir();
  const filePath = getFilePath(feedId);

  try {
    const data = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(data);
  } catch {
    return null;
  }
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
