import { put, head } from '@vercel/blob';
import { fetchOPML, OPMLOutline } from '@/lib/opml-parser';

export interface FeedConfig {
  id: string;
  name: string;
  url: string;
  htmlUrl?: string;
  enabled: boolean;
}

// OPML源URL - 从这里加载所有RSS源
export const OPML_URL = process.env.OPML_URL ||
  'https://gist.githubusercontent.com/emschwartz/e6d2bf860ccc367fe37ff953ba6de66b/raw/426957f043dc0054f95aae6c19de1d0b4ecc2bb2/hn-popular-blogs-2025.opml';

// 精选信源白名单（从 92 个中筛选的 30 个高质量信源）
// 设为 null 则不过滤，使用 OPML 中的全部信源
const CURATED_FEED_IDS: Set<string> | null = new Set([
  // AI 与产品趋势
  'simonwillison-net',
  'garymarcus-substack-com',
  'mitchellh-com',
  'paulgraham-com',
  'steveblank-com',
  'ericmigi-com',
  'dwarkesh-com',
  'geohot-github-io',
  // 科技行业与文化洞察
  'daringfireball-net',
  'pluralistic-net',
  'wheresyoured-at',
  'anildash-com',
  'construction-physics-com',
  // 系统与工程实践
  'antirez-com',
  'rachelbythebay-com',
  'lucumr-pocoo-org',
  'overreacted-io',
  'buttondown-com-hillelwayne',
  'devblogs-microsoft-com-oldnewthing',
  // 安全
  'krebsonsecurity-com',
  'troyhunt-com',
  'lcamtuf-substack-com',
  // 硬件与底层
  'righto-com',
  'xania-org',
  'berthub-eu',
  // 科学/数学 + 复古
  'gwern-net',
  'johndcook-com',
  'fabiensanglard-net',
  // 行业分析
  'derekthompson-org',
  'dynomight-net',
]);

// 内存缓存（同一函数实例内有效）
let cachedFeeds: FeedConfig[] | null = null;
let cacheTime: number = 0;
const CACHE_DURATION = 60 * 60 * 1000; // 1小时缓存

const OPML_CACHE_PATH = 'feeds/_opml_cache.json';

interface OPMLCache {
  feeds: FeedConfig[];
  cachedAt: number;
}

function isBlobEnabled(): boolean {
  return !!process.env.BLOB_READ_WRITE_TOKEN;
}

async function loadCachedOPML(): Promise<FeedConfig[] | null> {
  if (!isBlobEnabled()) return null;
  try {
    const meta = await head(OPML_CACHE_PATH);
    const res = await fetch(meta.url);
    if (!res.ok) return null;
    const cache = (await res.json()) as OPMLCache;
    // 检查 TTL
    if (Date.now() - cache.cachedAt < CACHE_DURATION) {
      return cache.feeds;
    }
    return null;
  } catch {
    return null;
  }
}

async function saveCachedOPML(feeds: FeedConfig[]): Promise<void> {
  if (!isBlobEnabled()) return;
  try {
    const cache: OPMLCache = { feeds, cachedAt: Date.now() };
    await put(OPML_CACHE_PATH, JSON.stringify(cache), {
      access: 'public',
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: 'application/json',
    });
  } catch (error) {
    console.error('Failed to save OPML cache to blob:', error);
  }
}

function outlineToFeedConfig(outline: OPMLOutline): FeedConfig {
  return {
    id: outline.id,
    name: outline.title,
    url: outline.xmlUrl,
    htmlUrl: outline.htmlUrl,
    enabled: true,
  };
}

export async function loadFeedsFromOPML(): Promise<FeedConfig[]> {
  // 检查内存缓存
  if (cachedFeeds && Date.now() - cacheTime < CACHE_DURATION) {
    return cachedFeeds;
  }

  // 检查 Blob 缓存
  const blobCached = await loadCachedOPML();
  if (blobCached) {
    cachedFeeds = blobCached;
    cacheTime = Date.now();
    console.log(`Loaded ${cachedFeeds.length} feeds from OPML blob cache`);
    return cachedFeeds;
  }

  try {
    console.log('Loading feeds from OPML:', OPML_URL);
    const opml = await fetchOPML(OPML_URL);
    cachedFeeds = opml.outlines.map(outlineToFeedConfig);
    cacheTime = Date.now();
    console.log(`Loaded ${cachedFeeds.length} feeds from OPML`);

    // 保存到 Blob 缓存
    await saveCachedOPML(cachedFeeds);

    return cachedFeeds;
  } catch (error) {
    console.error('Failed to load OPML:', error);
    // 如果有内存缓存则返回旧缓存
    if (cachedFeeds) {
      return cachedFeeds;
    }
    // 返回默认feeds
    return getDefaultFeeds();
  }
}

// 默认feeds作为fallback
function getDefaultFeeds(): FeedConfig[] {
  return [
    {
      id: 'hacker-news',
      name: 'Hacker News',
      url: 'https://hnrss.org/frontpage',
      enabled: true,
    },
  ];
}

export async function getFeedConfig(id: string): Promise<FeedConfig | undefined> {
  const feeds = await loadFeedsFromOPML();
  return feeds.find(feed => feed.id === id);
}

export async function getEnabledFeeds(): Promise<FeedConfig[]> {
  const feeds = await loadFeedsFromOPML();
  return feeds.filter(feed => feed.enabled && (!CURATED_FEED_IDS || CURATED_FEED_IDS.has(feed.id)));
}

// 获取所有feed的id列表
export async function getAllFeedIds(): Promise<string[]> {
  const feeds = await loadFeedsFromOPML();
  return feeds.map(feed => feed.id);
}
