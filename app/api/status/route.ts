import { CRON_BATCHES } from '@/config/cron';
import { cronAuthError } from '@/lib/cron-auth';
import { jsonStore } from '@/lib/json-store';
import { batchKey, due, emptyBatch } from '@/lib/jobs';
import type { BatchState } from '@/lib/jobs';

export const dynamic = 'force-dynamic';
async function readStatus(request: Request) {
  const params = new URL(request.url).searchParams;
  const limit = Math.max(1, Math.min(100, Number(params.get('limit')) || 20));
  const batches = await Promise.all(CRON_BATCHES.map(async batch => {
    const state = (await jsonStore.read<BatchState>(batchKey(batch)))?.value || emptyBatch();
    const jobs = Object.values(state.jobs);
    const failures = Object.entries(state.feeds).filter(([, f]) => !!f.error);
    const discoveryStale = !state.lastDiscoveryAt || Date.now() - Date.parse(state.lastDiscoveryAt) > 8 * 3600_000;
    const stale = !state.lastRun || Date.now() - Date.parse(state.lastRun.finishedAt) > 8 * 3600_000;
    return { batch, healthy: !stale && !discoveryStale && !state.lastDiscoveryError && !state.lastRun?.error && !failures.length && !jobs.some(j => j.stage === 'failed') && !state.configuration?.degraded,
      stale, discoveryStale, lastDiscoveryAt: state.lastDiscoveryAt, lastDiscoveryError: state.lastDiscoveryError, recentRuns: state.recentRuns, configuration: state.configuration, lastRun: state.lastRun, feeds: state.feeds,
      counts: { total: jobs.length, completed: jobs.filter(j => j.stage === 'complete').length,
        failed: jobs.filter(j => j.stage === 'failed').length, due: jobs.filter(j => due(j)).length,
        pending: jobs.filter(j => j.stage !== 'complete').length },
      jobs: jobs.filter(j => (!params.get('state') || j.stage === params.get('state')) &&
        (!params.get('feed') || j.feedId === params.get('feed')))
        .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)).slice(0, limit) };
  }));
  const healthy = batches.every(b => b.healthy);
  return Response.json({ healthy, checkedAt: new Date().toISOString(), batches },
    { status: healthy ? 200 : 503, headers: { 'Cache-Control': 'private, no-store' } });
}

export async function GET(request: Request) {
  const denied = cronAuthError(request);
  if (denied) return denied;
  try { return await readStatus(request); }
  catch (error) {
    console.error('Status storage unavailable:', error);
    return Response.json({ healthy: false, error: 'Status storage unavailable' },
      { status: 503, headers: { 'Cache-Control': 'private, no-store' } });
  }
}
