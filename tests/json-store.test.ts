import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createJsonStore, updateJson, acquireLease } from '../lib/json-store.ts';

test('concurrent read/modify/write preserves every update and rejects stale ETags', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'rss-cas-'));
  try {
    const store = createJsonStore(dir);
    await Promise.all(Array.from({ length: 12 }, () => updateJson<{ count: number }>('counter.json',
      current => ({ count: (current?.count || 0) + 1 }), store)));
    const a = (await store.read<{ count: number }>('counter.json'))!;
    assert.equal(a.value.count, 12);
    assert.equal(await store.compareAndSwap('counter.json', { count: 13 }, a.etag), true);
    assert.equal(await store.compareAndSwap('counter.json', { count: 99 }, a.etag), false);
    assert.equal(await store.compareAndSwap('counter.json', { count: 0 }, null), false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('only one lease holder; an expired holder cannot release its successor', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'rss-lease-'));
  try {
    const store = createJsonStore(dir);
    const acquired = await Promise.all(Array.from({ length: 8 }, () => acquireLease('lease.json', 1000, store)));
    assert.equal(acquired.filter(Boolean).length, 1);
    const first = acquired.find(Boolean)!;
    await first.assertOwned();
    await first.release();
    const second = (await acquireLease('lease.json', 1000, store))!;
    await first.release();
    await second.assertOwned();
    await assert.rejects(first.assertOwned());
  } finally { await rm(dir, { recursive: true, force: true }); }
});
