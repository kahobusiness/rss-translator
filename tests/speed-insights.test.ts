import assert from 'node:assert/strict';
import { test } from 'node:test';
import { publicPerformanceEvent } from '../lib/speed-insights.ts';

test('performance events strip URL parameters and fragments while preserving metric metadata', () => {
  const event = { type: 'vital', url: 'https://rss.kaho.io/read/simonwillison-net?guid=article&token=secret#paragraph', route: '/read/[id]' };
  assert.deepEqual(publicPerformanceEvent(event), { ...event, url: 'https://rss.kaho.io/read/simonwillison-net' });
  assert.equal(publicPerformanceEvent({ url: 'https://rss.kaho.io/?key=secret#feed' })?.url, 'https://rss.kaho.io/');
  assert.equal(event.url.includes('guid='), true);
});

test('performance events exclude APIs, unknown routes and invalid URLs', () => {
  for (const url of ['https://rss.kaho.io/api/cron?secret=test', 'https://rss.kaho.io/api/feed/all',
    'https://rss.kaho.io/admin', 'file:///read/example', 'invalid']) {
    assert.equal(publicPerformanceEvent({ url }), null);
  }
});
