import assert from 'node:assert/strict';
import { test } from 'node:test';
import { publicAnalyticsEvent, subscriptionCopyProperties } from '../lib/web-analytics.ts';
import { emitOriginMetrics, originTelemetry, type RssOriginObservation } from '../lib/rss-observability.ts';
import { monitoredRss } from '../lib/monitored-rss.ts';
import { rssResponse } from '../lib/rss-response.ts';

const observation: RssOriginObservation = { feedId: 'all', userAgent: 'Feedly/private-token', status: 200, items: 5, durationMs: 42 };

test('web analytics includes only public homepage and strips URL secrets', () => {
  assert.deepEqual(publicAnalyticsEvent({ type: 'pageview', url: 'https://rss.example/?token=secret#private' }),
    { type: 'pageview', url: 'https://rss.example/' });
  for (const url of ['https://rss.example/monitoring', 'https://rss.example/api/status?secret=test', 'invalid', 'file:///']) {
    assert.equal(publicAnalyticsEvent({ url }), null);
  }
  assert.deepEqual(subscriptionCopyProperties('/api/feed/all'), { feed_id: 'all', feed_type: 'aggregate' });
  assert.deepEqual(subscriptionCopyProperties('/api/feed/simonwillison-net'), { feed_id: 'simonwillison-net', feed_type: 'single' });
  for (const path of ['https://example.com/feed', '/api/feed/all?token=secret', '/api/feed/../status', '/api/feed/a#secret']) {
    assert.equal(subscriptionCopyProperties(path), null);
  }
});

test('native metrics emit origin counters with bounded, nonsensitive dimensions', () => {
  const samples: { name: string; value: number; tags: Record<string, string> }[] = [];
  emitOriginMetrics(observation, (name, value, tags) => samples.push({ name, value, tags }));
  assert.deepEqual(samples.map(s => [s.name, s.value]), [
    ['rss.origin_requests', 1], ['rss.origin_duration_ms', 42],
    ['rss.origin_content_responses', 1], ['rss.origin_item_appearances', 5],
  ]);
  assert.deepEqual(samples[0].tags, { feed: 'all', reader: 'feedly', status_class: '2xx' });
  assert.ok(!JSON.stringify(samples).includes('private-token'));
  assert.equal(originTelemetry({ ...observation, feedId: '../../private?secret=test' }).feed, 'other');
  samples.length = 0;
  emitOriginMetrics({ ...observation, status: 500 }, (name, value, tags) => samples.push({ name, value, tags }));
  assert.equal(samples.length, 2, 'errors must not count as successful content responses');
  assert.equal(originTelemetry({ ...observation, status: 404 }).items, 0);
  assert.equal(originTelemetry({ ...observation, items: 0 }).hasContent, false);
  assert.equal(originTelemetry({ ...observation, items: NaN, durationMs: NaN }).items, 0);
});

test('instrumented GET retains CDN cache, excludes HEAD, records errors and survives telemetry failures', async t => {
  const saved = { vercel: process.env.VERCEL, custom: process.env.RSS_CUSTOM_METRICS_ENABLED };
  const logs: string[] = [];
  t.mock.method(console, 'info', (text: string) => logs.push(text));
  t.mock.method(console, 'error', () => {});
  process.env.VERCEL = '1';
  delete process.env.RSS_CUSTOM_METRICS_ENABLED;
  const request = new Request('https://rss.example/api/feed/all');
  try {
    const response = await monitoredRss(request, 'all', async () => rssResponse('<rss/>', 1));
    assert.equal(response.headers.get('cache-control'), 'public, max-age=300, s-maxage=300');
    assert.equal(response.headers.get('vercel-cdn-cache-control'), null);
    assert.equal(response.status, 200);
    assert.equal(JSON.parse(logs[0]).hasContent, true);
    assert.equal(JSON.parse(logs[0]).items, 1);
    logs.length = 0;
    await monitoredRss(new Request(request, { method: 'HEAD' }), 'all', async () => rssResponse('<rss/>'));
    assert.equal(logs.length, 0);
    await assert.rejects(monitoredRss(request, 'all', async () => { throw new Error('storage unavailable'); }), /storage unavailable/);
    assert.equal(JSON.parse(logs[0]).status, 500);
    t.mock.method(console, 'info', () => { throw new Error('logging unavailable'); });
    const healthy = await monitoredRss(request, 'all', async () => rssResponse('<rss/>', 1));
    assert.equal(healthy.status, 200);
    assert.equal(await healthy.text(), '<rss/>');
  } finally {
    if (saved.vercel === undefined) delete process.env.VERCEL; else process.env.VERCEL = saved.vercel;
    if (saved.custom === undefined) delete process.env.RSS_CUSTOM_METRICS_ENABLED; else process.env.RSS_CUSTOM_METRICS_ENABLED = saved.custom;
  }
});
