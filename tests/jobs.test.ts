import assert from 'node:assert/strict';
import { test } from 'node:test';
import { enqueueJob, jobKey, newJob, processJob } from '../lib/jobs.ts';
import type { ArticleJob } from '../lib/jobs.ts';
import { memoryStore } from './memory-store.ts';
import type { ChunkProvider } from '../lib/translator.ts';
import { cronAuthError } from '../lib/cron-auth.ts';

const feed = { id: 'example', name: 'Example', url: 'https://example.com/rss', enabled: true };
const item = { guid: 'guid', title: 'Title', content: '<p>' + 'Long original content. '.repeat(1600) + '</p>',
  link: 'https://example.com/article', pubDate: '2026-10-16T00:00:00Z' };
const provider: ChunkProvider = async chunk => ({ texts: Object.fromEntries(chunk.units.map(u => [u.id, `译文 ${u.text}`])), inputTokens: 10, outputTokens: 10 });

test('queued long article survives repeated runs; publishes only after all chunks', async () => {
  const store = memoryStore();
  const queued = await enqueueJob(newJob(feed, item, { feedTitle: 'Example' }), store);
  let published = 0;
  const dependencies = { store, provider, publish: async (_job: ArticleJob, result: { translationComplete?: boolean; originalContent: string }) => {
    published++; assert.equal(result.translationComplete, true); assert.equal(result.originalContent, item.content);
  } };
  let run = await processJob(queued.id, 0, Date.now() + 30_000, { remaining: 1 }, dependencies);
  assert.equal(run.summary?.stage, 'translate');
  assert.equal(published, 0);
  for (let i = 0; i < 30 && run.summary?.stage !== 'complete'; i++) {
    run = await processJob(queued.id, 0, Date.now() + 30_000, { remaining: 2 }, dependencies);
  }
  assert.equal(run.summary?.stage, 'complete');
  assert.equal(published, 1);
  const repeat = await processJob(queued.id, 0, Date.now() + 30_000, { remaining: 2 }, dependencies);
  assert.equal(repeat.usage.calls, 0);
  assert.equal(published, 1);
});

test('failed publishing retries without translating again; records stage and retry time', async () => {
  const store = memoryStore();
  const queued = await enqueueJob(newJob(feed, { ...item, content: '<p>' + 'Hello '.repeat(200) + '</p>' }, { feedTitle: 'Example' }), store);
  let calls = 0;
  let publishes = 0;
  const dependencies = { store, provider: (async (...args) => { calls++; return provider(...args); }) as ChunkProvider,
    publish: async () => { publishes++; if (publishes === 1) throw new Error('Index write unavailable'); } };
  const first = await processJob(queued.id, 0, Date.now() + 30_000, { remaining: 8 }, dependencies);
  assert.equal(first.summary?.stage, 'failed');
  assert.equal(first.summary?.error?.stage, 'publish');
  assert.ok(first.summary?.retryAt);
  const before = calls;
  const second = await processJob(queued.id, 0, Date.now() + 30_000, { remaining: 8 }, dependencies);
  assert.equal(second.summary?.stage, 'complete');
  assert.equal(calls, before);
});

test('extraction failure remains retryable and never publishes a snippet', async () => {
  const store = memoryStore();
  const queued = await enqueueJob(newJob(feed, { ...item, content: 'snippet' }, { feedTitle: 'Example' }), store);
  const first = await processJob(queued.id, 0, Date.now() + 30_000, { remaining: 8 }, { store,
    extract: async () => ({ attempted: true, content: null, error: 'timeout' }),
    publish: async () => { throw new Error('must not publish'); } });
  assert.equal(first.summary?.stage, 'failed');
  assert.equal(first.summary?.error?.stage, 'fetch');
  assert.equal((await store.read<ArticleJob>(jobKey(queued.id)))!.value.result, undefined);
});

test('cron and operational status fail closed without credentials', async () => {
  const previous = process.env.CRON_SECRET;
  delete process.env.CRON_SECRET;
  assert.equal(cronAuthError(new Request('https://example.com'))?.status, 503);
  process.env.CRON_SECRET = 'test-only';
  assert.equal(cronAuthError(new Request('https://example.com'))?.status, 401);
  assert.equal(cronAuthError(new Request('https://example.com', { headers: { authorization: 'Bearer test-only' } })), null);
  if (previous === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = previous;
});

test('recover payloads orphaned by a crash before the batch manifest was saved', async () => {
  const { recoverQueue } = await import('../lib/queue-recovery.ts');
  const store = memoryStore();
  const queued = await enqueueJob(newJob(feed, item, { feedTitle: 'Example' }), store, 2);
  const recovered = await recoverQueue(2, { jobs: {}, feeds: {} }, store,
    async () => [{ key: jobKey(queued.id, 2), uploadedAt: Date.now() }]);
  assert.equal(recovered[queued.id].stage, 'fetch');
  assert.equal(recovered[queued.id].feedId, feed.id);
});
