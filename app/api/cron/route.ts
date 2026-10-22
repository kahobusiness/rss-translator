import { CRON_BATCHES } from '@/config/cron';
import { cronAuthError } from '@/lib/cron-auth';
import { runCronBatch } from '@/lib/cron-runner';
import { ConflictError } from '@/lib/json-store';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const denied = cronAuthError(request);
  if (denied) return denied;
  const params = new URL(request.url).searchParams;
  const raw = params.get('batch') || '0';
  const batch = Number(raw);
  if (!/^\d+$/.test(raw) || !CRON_BATCHES.includes(batch)) {
    return Response.json({ error: 'Invalid or unscheduled batch' }, { status: 400 });
  }
  // A diagnostic dry-run is strictly read-only: no model calls, leases or writes.
  if (params.get('dryRun') === '1') return Response.json({ success: true, dryRun: true, batch,
    discovery: params.get('work') !== '1', scheduledBatches: CRON_BATCHES });
  try {
    return Response.json(await runCronBatch(batch, params.get('work') === '1'));
  } catch (error) {
    console.error('Cron run failed:', error);
    return Response.json({ success: false, error: error instanceof Error ? error.message : 'Cron failed' },
      { status: error instanceof ConflictError ? 503 : 500 });
  }
}
