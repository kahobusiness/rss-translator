import defaults from '../config/default-feeds.json' with { type: 'json' };

const knownFeeds = new Set(['all', ...defaults.map(feed => feed.id)]);

export function readerFamily(ua: string): string {
  for (const [name, pattern] of [
    ['feedly', /feedly/i], ['inoreader', /inoreader/i], ['netnewswire', /netnewswire/i],
    ['freshrss', /freshrss/i], ['miniflux', /miniflux/i], ['reeder', /reeder/i],
    ['newsblur', /newsblur/i], ['other_bot', /bot|crawler|spider/i],
    ['browser', /mozilla|chrome|safari/i],
  ] as const) if (pattern.test(ua)) return name;
  return 'unknown';
}

export interface RssOriginObservation {
  feedId: string;
  userAgent: string;
  status: number;
  items: number;
  durationMs: number;
}
export type MetricSink = (name: string, value: number, tags: Record<string, string>) => void;

export function originTelemetry(observation: RssOriginObservation) {
  const { feedId, status } = observation;
  const items = Number.isFinite(observation.items) ? Math.max(0, Math.floor(observation.items)) : 0;
  return {
    event: 'rss_origin_response',
    // Fixed allowlist prevents scanners/custom OPML URLs from creating an
    // unbounded number of metric dimensions. Raw URLs and UA are never emitted.
    feed: knownFeeds.has(feedId) ? feedId : 'other',
    reader: readerFamily(observation.userAgent.slice(0, 1024)),
    status,
    hasContent: status >= 200 && status < 300 && items > 0,
    items: status >= 200 && status < 300 ? items : 0,
    durationMs: Number.isFinite(observation.durationMs) ? Math.max(0, observation.durationMs) : 0,
  };
}

export function emitOriginMetrics(observation: RssOriginObservation, emit: MetricSink) {
  const data = originTelemetry(observation);
  const tags = { feed: data.feed, reader: data.reader, status_class: `${Math.floor(data.status / 100)}xx` };
  // Origin-only: CDN cache hits never execute these measurements. Count total
  // RSS pulls with Vercel CDN Requests, not the sum of these origin samples.
  emit('rss.origin_requests', 1, tags);
  emit('rss.origin_duration_ms', data.durationMs, tags);
  if (data.hasContent) {
    emit('rss.origin_content_responses', 1, tags);
    emit('rss.origin_item_appearances', data.items, tags);
  }
}
