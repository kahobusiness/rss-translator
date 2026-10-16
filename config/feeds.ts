import { fetchOPML } from '../lib/opml-parser.ts';
import { jsonStore, updateJson } from '../lib/json-store.ts';
import defaults from './default-feeds.json' with { type: 'json' };

export interface FeedConfig {
  id: string; name: string; url: string; htmlUrl?: string; enabled: boolean;
}
export const OPML_URL = process.env.OPML_URL ||
  'https://gist.githubusercontent.com/emschwartz/e6d2bf860ccc367fe37ff953ba6de66b/raw/426957f043dc0054f95aae6c19de1d0b4ecc2bb2/hn-popular-blogs-2025.opml';

// 精选信源白名单（从 92 个中筛选的 20 个高质量信源）
// 设为 null 则不过滤，使用 OPML 中的全部信源
const CURATED_FEED_IDS: Set<string> | null = new Set([
  // AI 与深度思考
  'simonwillison-net',
  'dwarkesh-com',
  'gwern-net',
  'garymarcus-substack-com',
  'wheresyoured-at',
  // 系统与工程实践
  'antirez-com',
  'rachelbythebay-com',
  'lucumr-pocoo-org',
  'mitchellh-com',
  // 科技行业与文化
  'daringfireball-net',
  'construction-physics-com',
  'paulgraham-com',
  'pluralistic-net',
  'anildash-com',
  'tedium-co',
  // 安全
  'krebsonsecurity-com',
  'troyhunt-com',
  'lcamtuf-substack-com',
  // 硬件与底层
  'righto-com',
  'fabiensanglard-net',
]);


interface OPMLCache { feeds: FeedConfig[]; cachedAt: number }
let memory: OPMLCache | null = null;
let refreshAfter = 0;
const CACHE_DURATION = 3600_000;
const OPML_CACHE_PATH = 'feeds/_opml_cache.json';
let health = { source: 'snapshot', degraded: false, lastSuccessAt: null as string | null, error: null as string | null };
export const getFeedConfigurationHealth = () => ({ ...health });

function usable(feeds: FeedConfig[]): boolean {
  return Array.isArray(feeds) && feeds.length > 0 && feeds.every(f =>
    typeof f.id === 'string' && typeof f.name === 'string' && /^https?:\/\//.test(f.url)) &&
    feeds.some(f => f.enabled && (!CURATED_FEED_IDS || CURATED_FEED_IDS.has(f.id)));
}

export async function loadFeedsFromOPML(): Promise<FeedConfig[]> {
  if (memory && (Date.now() - memory.cachedAt < CACHE_DURATION || (health.degraded && Date.now() < refreshAfter))) return memory.feeds;
  let persisted: OPMLCache | null = null;
  try {
    persisted = (await jsonStore.read<OPMLCache>(OPML_CACHE_PATH))?.value ?? null;
    if (persisted && !usable(persisted.feeds)) persisted = null;
  } catch (error) { console.warn('OPML cache unavailable:', error instanceof Error ? error.message : 'read failed'); }
  if (persisted && Date.now() - persisted.cachedAt < CACHE_DURATION) {
    memory = persisted;
    health = { source: 'cache', degraded: false, lastSuccessAt: new Date(persisted.cachedAt).toISOString(), error: null };
    return persisted.feeds;
  }
  try {
    const parsed = await fetchOPML(OPML_URL);
    const feeds = parsed.outlines.map(f => ({ id: f.id, name: f.title, url: f.xmlUrl, htmlUrl: f.htmlUrl, enabled: true }));
    if (!usable(feeds)) throw new Error('OPML returned zero eligible feeds or invalid feed configuration');
    const next = { feeds, cachedAt: Date.now() };
    memory = next;
    health = { source: 'opml', degraded: false, lastSuccessAt: new Date(next.cachedAt).toISOString(), error: null };
    // A cache write failure must not discard a successfully fetched configuration.
    try { await updateJson<OPMLCache>(OPML_CACHE_PATH, () => next); }
    catch (error) { console.warn('OPML cache save failed:', error instanceof Error ? error.message : 'write failed'); }
    return feeds;
  } catch (error) {
    const fallback = memory || persisted;
    refreshAfter = Date.now() + 60_000;
    health = { source: fallback?.cachedAt ? 'stale-cache' : 'snapshot', degraded: true,
      lastSuccessAt: fallback?.cachedAt ? new Date(fallback.cachedAt).toISOString() : null,
      error: error instanceof Error ? error.message : 'OPML fetch failed' };
    console.warn('OPML degraded:', JSON.stringify(health));
    // Never refresh cachedAt on failure: every subsequent attempt can retry the
    // upstream and the last real success remains visible to monitoring.
    if (fallback) { memory = fallback; return fallback.feeds; }
    memory = { feeds: defaults, cachedAt: 0 };
    return defaults;
  }
}
export async function getFeedConfig(id: string) {
  return (await loadFeedsFromOPML()).find(feed => feed.id === id);
}
export async function getEnabledFeeds() {
  return (await loadFeedsFromOPML()).filter(feed => feed.enabled && (!CURATED_FEED_IDS || CURATED_FEED_IDS.has(feed.id)));
}
export async function getAllFeedIds() { return (await loadFeedsFromOPML()).map(feed => feed.id); }
