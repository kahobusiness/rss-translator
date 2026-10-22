import { createHash } from 'node:crypto';
import { jsonStore, updateJson, acquireLease } from './json-store.ts';
import type { JsonStore } from './json-store.ts';
import { translateArticle } from './translator.ts';
import type { ChunkProvider, Usage } from './translator.ts';
import { translationVersion } from './translation-plan.ts';
import { fetchArticleContent, needsFetch } from './article-fetcher.ts';
import { appendItems, saveRecentIndex } from './storage.ts';
import type { StoredFeed, TranslatedItem } from './storage.ts';
import type { ParsedItem } from './rss-parser.ts';
import type { FeedConfig } from '../config/feeds.ts';

export type JobStage = 'fetch' | 'translate' | 'publish' | 'complete' | 'failed';
export interface JobError { stage: string; code: string; message: string; at: string }
export interface ArticleJob {
  id: string; inputVersion: string; feed: FeedConfig; item: ParsedItem; feedTitle: string; feedDescription?: string; feedLink?: string;
  stage: JobStage; profile: string; createdAt: string; updatedAt: string; lastAttemptAt?: string;
  retryAt?: string; failures: number; completedChunks: number; totalChunks: number;
  preparedContent?: string; result?: TranslatedItem; error?: JobError; usage: Usage;
  preparedUrl?: string;
}
export interface JobSummary {
  id: string; feedId: string; title: string; stage: JobStage; createdAt: string; updatedAt: string;
  lastAttemptAt?: string; retryAt?: string; failures: number; completedChunks: number; totalChunks: number; error?: JobError; usage: Usage;
}
export interface FeedHealth { lastAttemptAt: string; lastSuccessAt?: string; consecutiveFailures: number; error?: string }
export interface RunReport {
  startedAt: string; finishedAt: string; durationMs: number; discovered: number; processed: number; completed: number;
  usage: Usage; error?: string;
}
export interface BatchState {
  jobs: Record<string, JobSummary>; feeds: Record<string, FeedHealth>; lastRun?: RunReport;
  reconciledThrough?: string;
  lastDiscoveryAt?: string; lastDiscoveryError?: string; recentRuns?: RunReport[];
  configuration?: { source: string; degraded: boolean; lastSuccessAt: string | null; error: string | null };
}
export const activeProfile = () => translationVersion('', '');
export const emptyUsage = (): Usage => ({ calls: 0, cacheHits: 0, inputTokens: 0, outputTokens: 0 });
export const addUsage = (a: Usage, b: Usage): Usage => ({ calls: a.calls + b.calls, cacheHits: a.cacheHits + b.cacheHits,
  inputTokens: a.inputTokens + b.inputTokens, outputTokens: a.outputTokens + b.outputTokens });
export const sourceVersion = (item: Pick<ParsedItem, 'title' | 'content' | 'link'>) => createHash('sha256').update(JSON.stringify([item.title, item.content, item.link])).digest('hex');
export const jobId = (feedId: string, guid: string) => createHash('sha256').update(`${feedId}\0${guid}`).digest('hex');
export const jobKey = (id: string, batch = 0) => `operations/jobs/b${batch}/${id}.json`;
export const batchKey = (batch: number) => `operations/batches/${batch}.json`;
export const emptyBatch = (): BatchState => ({ jobs: {}, feeds: {} });
export function summarize(job: ArticleJob): JobSummary {
  const { id, feed, item, stage, createdAt, updatedAt, lastAttemptAt, retryAt, failures, completedChunks, totalChunks, error, usage } = job;
  return { id, feedId: feed.id, title: item.title, stage, createdAt, updatedAt, lastAttemptAt, retryAt, failures, completedChunks, totalChunks, error, usage };
}
export function needsTranslation(item: TranslatedItem | undefined) {
  if (!item || !item.translated) return true;
  if (item.translationComplete === true) return item.translationProfile !== activeProfile();
  // Old cron truncated long originals before translation. Reconcile those
  // historical articles too, even after they disappear from the live RSS.
  return item.originalContent.length > 15_000;
}
export function due(job: JobSummary, now = Date.now()) {
  return job.stage !== 'complete' && (!job.retryAt || Date.parse(job.retryAt) <= now);
}
export function newJob(feed: FeedConfig, item: ParsedItem, metadata: Pick<StoredFeed, 'feedTitle' | 'feedDescription' | 'feedLink'>): ArticleJob {
  const now = new Date().toISOString();
  return { id: jobId(feed.id, item.guid), inputVersion: sourceVersion(item), feed, item, ...metadata,
    stage: 'fetch', profile: activeProfile(), createdAt: now, updatedAt: now,
    failures: 0, completedChunks: 0, totalChunks: 0, usage: emptyUsage() };
}

export async function enqueueJob(job: ArticleJob, store: JsonStore = jsonStore, batch = 0) {
  const saved = await updateJson<ArticleJob>(jobKey(job.id, batch), current => {
    if (!current) return job;
    if (current.profile !== activeProfile() || current.inputVersion !== job.inputVersion) {
      const preparedContent = current.inputVersion === job.inputVersion ? current.preparedContent : undefined;
      return { ...job, preparedContent, createdAt: current.createdAt, stage: preparedContent ? 'translate' : 'fetch' };
    }
    return undefined;
  }, store);
  return summarize(saved!);
}

export async function saveBatch(batch: number, patch: Partial<BatchState>, store: JsonStore = jsonStore) {
  return updateJson<BatchState>(batchKey(batch), current => {
    const state = current || emptyBatch();
    const jobs = { ...state.jobs, ...patch.jobs };
    const complete = Object.values(jobs).filter(j => j.stage === 'complete')
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
    for (const old of complete.slice(200)) delete jobs[old.id];
    return { ...state, ...patch, jobs, feeds: { ...state.feeds, ...patch.feeds },
      recentRuns: patch.lastRun && patch.lastRun.startedAt !== state.lastRun?.startedAt
        ? [patch.lastRun, ...(state.recentRuns || [])].slice(0, 48) : state.recentRuns };
  }, store);
}

export interface JobDependencies {
  store?: JsonStore; provider?: ChunkProvider;
  extract?: typeof fetchArticleContent;
  publish?: (job: ArticleJob, result: TranslatedItem, batch: number) => Promise<void>;
}

export async function processJob(id: string, batch: number, deadline: number, budget: { remaining: number },
  dependencies: JobDependencies = {}): Promise<{ summary: JobSummary | null; usage: Usage }> {
  const store = dependencies.store || jsonStore;
  const lease = await acquireLease(`operations/leases/article-${id}.json`, 330_000, store);
  if (!lease) return { summary: null, usage: emptyUsage() };
  let job: ArticleJob | null = null;
  let stage: JobStage = 'fetch';
  let usage = emptyUsage();
  try {
    job = (await store.read<ArticleJob>(jobKey(id, batch)))?.value ?? null;
    if (!job) throw new Error(`Queued article payload missing: ${id}`);
    if (job.stage === 'complete' && job.profile === activeProfile()) return { summary: summarize(job), usage };
    if (job.profile !== activeProfile()) {
      job = { ...job, profile: activeProfile(), result: undefined, stage: job.preparedContent ? 'translate' : 'fetch',
        completedChunks: 0, totalChunks: 0, failures: 0, error: undefined, retryAt: undefined };
    }
    job.lastAttemptAt = new Date().toISOString();
    if (!job.preparedContent) {
      stage = 'fetch';
      let content = job.item.content;
      // Atom content and content:encoded are full posts regardless of length.
      // Older Daring Fireball jobs predate that flag; their author permalink
      // identifies a complete link-blog post, not the external linked article.
      const fullPost = job.item.contentIsFull || (job.feed.id === 'daringfireball-net' &&
        /https:\/\/daringfireball\.net\/linked\//.test(content));
      if (!fullPost && needsFetch(content)) {
        const fetched = await (dependencies.extract || fetchArticleContent)(job.item.link,
          AbortSignal.timeout(Math.max(1, Math.min(15_000, deadline - Date.now()))), content);
        if (fetched.attempted && !fetched.content) throw new Error(fetched.error || 'Full article extraction failed');
        if (fetched.content) content = fetched.content;
        if (fetched.url) job.preparedUrl = fetched.url;
      }
      job.preparedContent = content;
      job.stage = 'translate';
      await updateJson<ArticleJob>(jobKey(id, batch), () => job!, store);
    }
    if (!job.result) {
      stage = 'translate';
      const progress = await translateArticle({ id, title: job.item.title, content: job.preparedContent! },
        { deadline, maxChunks: 2, budget, store, provider: dependencies.provider });
      usage = progress.usage;
      job.usage = addUsage(job.usage, usage);
      const advanced = progress.completedChunks > job.completedChunks;
      job.completedChunks = progress.completedChunks;
      job.totalChunks = progress.totalChunks;
      if (advanced) job.failures = 0;
      if (progress.error) throw Object.assign(new Error(progress.error), { code: progress.errorCode });
      if (progress.result) {
        job.result = {
          guid: job.item.guid, originalTitle: job.item.title, originalContent: job.preparedContent!,
          ...progress.result, link: job.preparedUrl || job.item.link, pubDate: job.item.pubDate,
          author: job.item.author, categories: job.item.categories,
          translatedAt: new Date().toISOString(), translated: true, translationComplete: true,
          translationVersion: progress.version, translationProfile: activeProfile(), sourceVersion: job.inputVersion,
          sourceFeedId: job.feed.id, sourceFeedName: job.feed.name,
        };
        job.stage = 'publish';
      } else {
        job.stage = 'translate';
        job.error = undefined;
        job.retryAt = new Date().toISOString();
      }
      await lease.assertOwned();
      await updateJson<ArticleJob>(jobKey(id, batch), () => ({ ...job!, updatedAt: new Date().toISOString() }), store);
    }
    if (job.result) {
      stage = 'publish';
      await lease.assertOwned();
      if (dependencies.publish) await dependencies.publish(job, job.result, batch);
      else {
        await appendItems(job.feed.id, job.feedTitle, job.feedDescription, job.feedLink, [job.result]);
        await saveRecentIndex([job.result], batch);
      }
      job.stage = 'complete';
      job.error = undefined;
      job.retryAt = undefined;
      // Avoid storing a second copy of a completed article forever.
      job.result = undefined;
      job.preparedContent = undefined;
      job.item = { ...job.item, content: '' };
    }
    job.updatedAt = new Date().toISOString();
    await lease.assertOwned();
    await updateJson<ArticleJob>(jobKey(id, batch), () => job!, store);
    return { summary: summarize(job), usage };
  } catch (error) {
    if (!job) throw error;
    job.stage = 'failed';
    job.failures++;
    job.updatedAt = new Date().toISOString();
    job.retryAt = new Date(Date.now() + Math.min(24 * 3600_000, 15 * 60_000 * 2 ** Math.min(job.failures - 1, 7))).toISOString();
    if ((error as { code?: string }).code === 'provider_content_policy') {
      job.retryAt = new Date(Date.now() + 24 * 3600_000).toISOString();
    }
    job.error = { stage, code: String((error as { code?: string }).code || (error as { name?: string }).name || 'error'),
      message: error instanceof Error ? error.message.slice(0, 300) : 'Job failed', at: job.updatedAt };
    await lease.assertOwned();
    await updateJson<ArticleJob>(jobKey(id, batch), () => job!, store);
    return { summary: summarize(job), usage };
  } finally { await lease.release(); }
}
