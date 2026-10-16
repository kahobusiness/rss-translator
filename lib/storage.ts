import { list } from '@vercel/blob';
import { promises as fs } from 'fs';
import path from 'path';
import { CRON_BATCHES } from '../config/cron.ts';
import { jsonStore, updateJson, stateBlobOptions, blobConfigured, ConflictError } from './json-store.ts';

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
  translationComplete?: boolean;
  translationVersion?: string;
  translationProfile?: string;
  sourceVersion?: string;
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

const RECENT_INDEX_LEGACY_PATH = 'feeds/_recent_items.json';
const recentIndexPath = (batch: number) => `feeds/_recent_items_b${batch}.json`;
const blobPath = (id: string) => `feeds/${id}.json`;
const RECENT_INDEX_CACHE_TTL_MS = 30_000;

// ── 公开 API ──

export async function saveFeed(feed: StoredFeed): Promise<void> {
  await updateJson<StoredFeed>(blobPath(feed.feedId), current => {
    if (current && feed.version !== (current.version || 0) + 1) throw new ConflictError('Stale feed version');
    return feed;
  });
}
export async function loadFeed(feedId: string): Promise<StoredFeed | null> {
  return (await jsonStore.read<StoredFeed>(blobPath(feedId)))?.value ?? null;
}
export async function loadAllFeeds(): Promise<StoredFeed[]> {
  const ids = new Set<string>();
  if (blobConfigured()) {
    const connections = [stateBlobOptions(), ...(process.env.BLOB_READ_WRITE_TOKEN ? [{ token: process.env.BLOB_READ_WRITE_TOKEN }] : [])];
    for (const credentials of connections) {
      let cursor: string | undefined;
      do {
        const result = await list({ ...credentials, prefix: 'feeds/', cursor });
        for (const blob of result.blobs) {
          const match = /^feeds\/([^/_][^/]*)\.json$/.exec(blob.pathname);
          if (match) ids.add(match[1]);
        }
        cursor = result.hasMore ? result.cursor : undefined;
      } while (cursor);
    }
  } else {
    try {
      for (const file of await fs.readdir(path.join(process.cwd(), 'data'))) {
        if (/^[^_].*\.json$/.test(file)) ids.add(file.slice(0, -5));
      }
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  const feeds = await Promise.all([...ids].map(loadFeed));
  return feeds.filter((f): f is StoredFeed => f !== null);
}

export async function getExistingStatus(feedId: string): Promise<Map<string, ItemStatus>> {
  const feed = await loadFeed(feedId);
  if (!feed) return new Map();
  return new Map(
    dedupeAndSort(feed.items).map(item => [
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
  await updateJson<StoredFeed>(blobPath(feedId), existing => ({
    feedId, feedTitle, feedDescription, feedLink,
    items: dedupeAndSort([...newItems, ...(existing?.items || [])]).slice(0, 100),
    lastUpdated: new Date().toISOString(),
    version: (existing?.version || 0) + 1,
  }));
}

// ── 聚合索引 ──
//
// 每批 cron 写自己的 `_recent_items_b{batch}.json`，读时合并所有批次 + legacy
// 索引（存在则包含），避免不同批次并发写同一文件互相覆盖。

function dedupeAndSort(items: TranslatedItem[]): TranslatedItem[] {
  const byGuid = new Map<string, TranslatedItem>();
  for (const it of items) {
    const previous = byGuid.get(it.guid);
    // New entries win, but a failed retry must not replace a success.
    // Missing translated flags represent successful legacy translations.
    if (!previous || (previous.translated === false && it.translated !== false) ||
        (previous.translationComplete !== true && it.translationComplete === true)) {
      byGuid.set(it.guid, it);
    }
  }
  return [...byGuid.values()].sort((a, b) => new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime());
}

// 只写当前批次的分片索引，不读其他批次
export async function saveRecentIndex(newItems: TranslatedItem[], batch: number): Promise<void> {
  await updateJson<TranslatedItem[]>(recentIndexPath(batch), existing =>
    dedupeAndSort([...newItems, ...(existing || [])]).slice(0, 100));
  recentIndexCache = null;
}

// 读路径：合并所有已配置批次 + legacy + 30s 进程内缓存
let recentIndexCache: { at: number; items: TranslatedItem[] } | null = null;

async function loadOneShard(shardPath: string): Promise<TranslatedItem[]> {
  return (await jsonStore.read<TranslatedItem[]>(shardPath))?.value || [];
}

export async function loadRecentIndex(): Promise<TranslatedItem[]> {
  if (recentIndexCache && Date.now() - recentIndexCache.at < RECENT_INDEX_CACHE_TTL_MS) {
    return recentIndexCache.items;
  }
  const shardPaths = CRON_BATCHES.map(recentIndexPath);
  // 包含 legacy 单文件以兼容历史数据（存在则读，不存在返回空）
  const allPaths = [...shardPaths, RECENT_INDEX_LEGACY_PATH];
  const shards = await Promise.all(allPaths.map(p => loadOneShard(p)));
  const merged = dedupeAndSort(shards.flat()).filter(i => i.translated !== false).slice(0, 100);
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

  return dedupeAndSort(allItems).filter(i => i.translated !== false).slice(0, limit);
}
