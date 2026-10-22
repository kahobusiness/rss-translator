import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rssResponse } from '../lib/rss-response.ts';

test('stream large RSS without truncating bytes or breaking Unicode', async () => {
  const xml = '<?xml version="1.0"?><rss><channel><item>中文😀'.repeat(120_000) + '</item></channel></rss>';
  const response = rssResponse(xml);
  assert.equal(response.headers.get('content-type'), 'application/rss+xml; charset=utf-8');
  const reader = response.body!.getReader();
  const parts: Uint8Array[] = [];
  for (;;) { const { done, value } = await reader.read(); if (done) break; assert.ok(value.length <= 65536); parts.push(value); }
  assert.ok(parts.length > 60);
  assert.equal(Buffer.concat(parts).toString('utf8'), xml);
});
