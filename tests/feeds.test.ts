import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import defaults from '../config/default-feeds.json' with { type: 'json' };

test('OPML failures retain stale persisted configuration; zero eligible feeds never replace it', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'rss-opml-'));
  const cwd = process.cwd();
  const url = process.env.OPML_URL;
  process.chdir(dir);
  process.env.OPML_URL = 'https://example.com/feeds.opml';
  let response = 'failure';
  let requests = 0;
  t.mock.method(console, 'warn', () => {});
  t.mock.method(globalThis, 'fetch', async () => {
    requests++;
    if (response === 'failure') throw new Error('upstream unavailable');
    return new Response(response);
  });
  try {
    const fresh = (scenario: string) => import(`../config/feeds.ts?case=${scenario}`) as Promise<typeof import('../config/feeds.ts')>;
    const cold = await fresh('cold');
    assert.equal((await cold.getEnabledFeeds()).length, 20);
    assert.equal(cold.getFeedConfigurationHealth().source, 'snapshot');
    assert.equal(cold.getFeedConfigurationHealth().degraded, true);
    await mkdir(path.join(dir, 'data'), { recursive: true });
    const cache = { feeds: defaults, cachedAt: 1000 };
    const file = path.join(dir, 'data/_opml_cache.json');
    await writeFile(file, JSON.stringify(cache));
    const stale = await fresh('stale');
    assert.equal((await stale.getEnabledFeeds()).length, 20);
    assert.equal(stale.getFeedConfigurationHealth().source, 'stale-cache');
    const before = requests;
    await stale.getEnabledFeeds();
    assert.equal(requests, before, 'retry cooldown must avoid an upstream request storm');
    const now = Date.now();
    const clock = t.mock.method(Date, 'now', () => now + 61_000);
    await stale.getEnabledFeeds();
    assert.ok(requests > before, 'retry after cooldown must use original stale timestamp');
    clock.mock.restore();
    assert.equal(JSON.parse(await readFile(file, 'utf8')).cachedAt, 1000);
    response = '<opml><head><title>Empty allowlist</title></head><body><outline title="hacker news" xmlUrl="https://example.com/rss" /></body></opml>';
    const zero = await fresh('zero');
    assert.equal((await zero.getEnabledFeeds()).length, 20);
    assert.match(zero.getFeedConfigurationHealth().error!, /zero eligible/);
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), cache);
    response = '<opml><head><title>Valid</title></head><body><outline title="simonwillison.net" xmlUrl="https://example.com/rss" /></body></opml>';
    const valid = await fresh('valid');
    assert.equal((await valid.getEnabledFeeds())[0].id, 'simonwillison-net');
    assert.equal(valid.getFeedConfigurationHealth().degraded, false);
  } finally {
    process.chdir(cwd);
    if (url === undefined) delete process.env.OPML_URL; else process.env.OPML_URL = url;
    await rm(dir, { recursive: true, force: true });
  }
});
