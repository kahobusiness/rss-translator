import { getEnabledFeeds, getFeedConfigurationHealth } from '../config/feeds.ts';
import { FEEDS_PER_BATCH, CRON_BATCHES } from '../config/cron.ts';
import { parseFeed } from './rss-parser.ts';
import { recoverQueue } from './queue-recovery.ts';
import { jsonStore, acquireLease } from './json-store.ts';
import type { StoredFeed } from './storage.ts';
import { addUsage, batchKey, due, emptyBatch, emptyUsage, enqueueJob, jobId, needsTranslation, newJob, processJob, saveBatch, sourceVersion } from './jobs.ts';
import type { BatchState, FeedHealth, JobSummary } from './jobs.ts';

export async function runCronBatch(batch: number, workOnly = false) {
  const lease = await acquireLease(`operations/leases/batch-${batch}.json`);
  if (!lease) return { success: true, skipped: 'batch already running', batch };
  const started = Date.now();
  const deadline = started + 240_000;
  let discovered = 0;
  let processed = 0;
  let completed = 0;
  let usage = emptyUsage();
  let runError: string | undefined;
  try {
    let state = (await jsonStore.read<BatchState>(batchKey(batch)))?.value || emptyBatch();
    if (!workOnly) {
      const feeds = await getEnabledFeeds();
      if (!feeds.length) throw new Error('No enabled feeds; discovery aborted');
      const required = Math.ceil(feeds.length / FEEDS_PER_BATCH);
      if (Array.from({ length: required }, (_, i) => i).some(i => !CRON_BATCHES.includes(i))) {
        throw new Error(`Cron coverage incomplete: ${feeds.length} feeds require ${required} batches`);
      }
      const selected = feeds.slice(batch * FEEDS_PER_BATCH, (batch + 1) * FEEDS_PER_BATCH);
      const feedUpdates: Record<string, FeedHealth> = {};
      const jobUpdates: Record<string, JobSummary> = {};
      await Promise.all(selected.map(async config => {
        const at = new Date().toISOString();
        try {
          const [parsed, archived] = await Promise.all([parseFeed(config.url), jsonStore.read<StoredFeed>(`feeds/${config.id}.json`)]);
          const archive = archived?.value;
          const previous = new Map(archive?.items.map(i => [i.guid, i]));
          const historical = (archive?.items || []).filter(needsTranslation).map(i => ({
            guid: i.guid, title: i.originalTitle, content: i.originalContent, link: i.link, pubDate: i.pubDate,
            author: i.author, categories: i.categories,
          }));
          const candidates = [...new Map([...historical, ...parsed.items].map(i => [i.guid, i])).values()]
            .filter(i => { const old = previous.get(i.guid); return needsTranslation(old) ||
              !!(old?.sourceVersion && old.sourceVersion !== sourceVersion(i)); });
          // Bound discovery writes, not article completeness. Subsequent runs
          // discover additional unseen candidates; queued work is never evicted.
          let created = 0;
          for (const item of candidates) {
            if (Date.now() > deadline - 60_000 || created >= 10) break;
            const id = jobId(config.id, item.guid);
            const known = state.jobs[id];
            if (known && known.stage !== 'complete') continue;
            const summary = await enqueueJob(newJob(config, item, {
              feedTitle: parsed.title, feedDescription: parsed.description, feedLink: parsed.link,
            }), jsonStore, batch);
            if (summary.stage !== 'complete') { jobUpdates[id] = summary; created++; discovered++; }
          }
          feedUpdates[config.id] = { lastAttemptAt: at, lastSuccessAt: at, consecutiveFailures: 0 };
        } catch (error) {
          const previous = state.feeds[config.id];
          feedUpdates[config.id] = { lastAttemptAt: at, lastSuccessAt: previous?.lastSuccessAt,
            consecutiveFailures: (previous?.consecutiveFailures || 0) + 1,
            error: error instanceof Error ? error.message.slice(0, 300) : 'Feed discovery failed' };
          console.error(JSON.stringify({ event: 'feed_discovery_failed', feedId: config.id, ...feedUpdates[config.id] }));
        }
      }));
      await lease.assertOwned();
      state = (await saveBatch(batch, { jobs: jobUpdates, feeds: feedUpdates, configuration: getFeedConfigurationHealth(), lastDiscoveryAt: new Date().toISOString(), lastDiscoveryError: undefined }))!;
    }
    const recovered = await recoverQueue(batch, state);
    state = (await saveBatch(batch, { jobs: recovered, reconciledThrough: new Date(started).toISOString() }))!;
    const ready = Object.values(state.jobs).filter(j => due(j))
      .sort((a, b) => Date.parse(a.lastAttemptAt || a.createdAt) - Date.parse(b.lastAttemptAt || b.createdAt));
    const budget = { remaining: 8 };
    let next = 0;
    const workers = await Promise.allSettled(Array.from({ length: Math.min(4, ready.length) }, async () => {
      while (next < ready.length && budget.remaining > 0 && Date.now() < deadline - 20_000) {
        const job = ready[next++];
        const result = await processJob(job.id, batch, deadline, budget);
        if (result.summary) {
          processed++;
          if (result.summary.stage === 'complete') completed++;
          usage = addUsage(usage, result.usage);
          await saveBatch(batch, { jobs: { [job.id]: result.summary } });
        }
      }
    }));
    const failedWorker = workers.find(result => result.status === 'rejected');
    if (failedWorker?.status === 'rejected') throw failedWorker.reason;
    return { success: true, batch, discovered, processed, completed, usage, durationMs: Date.now() - started };
  } catch (error) {
    runError = error instanceof Error ? error.message.slice(0, 300) : 'Cron failed';
    throw error;
  } finally {
    try {
      await lease.assertOwned();
      await saveBatch(batch, { ...(!workOnly && runError ? { lastDiscoveryError: runError } : {}), lastRun: { startedAt: new Date(started).toISOString(), finishedAt: new Date().toISOString(),
        durationMs: Date.now() - started, discovered, processed, completed, usage, ...(runError ? { error: runError } : {}) } });
      console.log(JSON.stringify({ event: 'cron_batch_finished', batch, discovered, processed, completed, usage, error: runError }));
    } finally { await lease.release(); }
  }
}
