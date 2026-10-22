import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CRON_BATCHES } from '../config/cron.ts';
import type { TranslatedItem } from '../lib/storage.ts';

function item(guid: string, day: number, translated = true): TranslatedItem {
  return {
    guid, originalTitle: guid, translatedTitle: `中文 ${guid}`,
    originalContent: '<p>original</p>', translatedContent: '<p>译文</p>',
    link: `https://example.com/${guid}`, pubDate: `2026-10-${String(day).padStart(2, '0')}T00:00:00Z`,
    translatedAt: '2026-10-16T00:00:00Z', translated,
  };
}

test('persistent storage regressions: retries, history, all scheduled shards and read failures', async () => {
  const cwd = process.cwd();
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  const dir = await mkdtemp(path.join(tmpdir(), 'rss-storage-test-'));
  delete process.env.BLOB_READ_WRITE_TOKEN;
  process.chdir(dir);
  try {
    const storage = await import('../lib/storage.ts');
    assert.deepEqual(CRON_BATCHES, [0, 1, 2, 3]);
    await storage.appendItems('example', 'Example', undefined, undefined, [item('first', 1), item('second', 2)]);
    await storage.appendItems('example', 'Example', undefined, undefined, [item('second', 2, false), item('third', 3)]);
    let feed = await storage.loadFeed('example');
    assert.deepEqual(feed?.items.map(i => i.guid), ['third', 'second', 'first']);
    assert.equal(feed?.items.find(i => i.guid === 'second')?.translated, true);

    await storage.appendItems('retry', 'Retry', undefined, undefined, [item('retry', 1, false)]);
    await storage.appendItems('retry', 'Retry', undefined, undefined, [item('retry', 1)]);
    feed = await storage.loadFeed('retry');
    assert.equal(feed?.items.length, 1);
    assert.equal(feed?.items[0].translated, true);

    await storage.saveRecentIndex([item('first', 1), item('second', 2, false)], 0);
    await storage.saveRecentIndex([item('third', 3), item('second', 2)], 0);
    await storage.saveRecentIndex([item('fourth-batch', 16)], 3);
    await writeFile(path.join(dir, 'data/_recent_items.json'), JSON.stringify([item('legacy', 4)]));
    const index = await storage.loadRecentIndex();
    assert.deepEqual(index.map(i => i.guid), ['fourth-batch', 'legacy', 'third', 'second', 'first']);
    assert.equal(index.find(i => i.guid === 'second')?.translated, true);
    assert.deepEqual((await storage.getAllTranslatedItems(2)).map(i => i.guid), ['fourth-batch', 'legacy']);

    await storage.saveRecentIndex(Array.from({ length: 110 }, (_, i) => item(`item-${i}`, 10)), 1);
    const capped = JSON.parse(await readFile(path.join(dir, 'data/_recent_items_b1.json'), 'utf8'));
    assert.equal(capped.length, 100);
    await mkdir(path.join(dir, 'data'), { recursive: true });
    await writeFile(path.join(dir, 'data/_recent_items_b2.json'), 'broken json');
    await assert.rejects(storage.saveRecentIndex([item('must-not-overwrite', 16)], 2));
    assert.equal(await readFile(path.join(dir, 'data/_recent_items_b2.json'), 'utf8'), 'broken json');
  } finally {
    process.chdir(cwd);
    if (token === undefined) delete process.env.BLOB_READ_WRITE_TOKEN;
    else process.env.BLOB_READ_WRITE_TOKEN = token;
    await rm(dir, { recursive: true, force: true });
  }
});
