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

// 缓存已加载的feeds
let cachedFeeds: FeedConfig[] | null = null;
let cacheTime: number = 0;
const CACHE_DURATION = 60 * 60 * 1000; // 1小时缓存

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
  // 检查缓存是否有效
  if (cachedFeeds && Date.now() - cacheTime < CACHE_DURATION) {
    return cachedFeeds;
  }

  try {
    console.log('Loading feeds from OPML:', OPML_URL);
    const opml = await fetchOPML(OPML_URL);
    cachedFeeds = opml.outlines.map(outlineToFeedConfig);
    cacheTime = Date.now();
    console.log(`Loaded ${cachedFeeds.length} feeds from OPML`);
    return cachedFeeds;
  } catch (error) {
    console.error('Failed to load OPML:', error);
    // 如果有缓存则返回旧缓存
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
  return feeds.filter(feed => feed.enabled);
}

// 获取所有feed的id列表
export async function getAllFeedIds(): Promise<string[]> {
  const feeds = await loadFeedsFromOPML();
  return feeds.map(feed => feed.id);
}
