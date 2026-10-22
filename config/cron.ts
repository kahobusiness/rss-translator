import deploymentConfig from '../vercel.json' with { type: 'json' };

export const FEEDS_PER_BATCH = 5;

// Derive shard coverage from the actual cron schedule, rather than another count.
export const CRON_BATCHES = [...new Set(deploymentConfig.crons.flatMap(({ path }) => {
  const url = new URL(path, 'https://cron.local');
  const batch = url.searchParams.get('batch');
  return url.pathname === '/api/cron' && batch !== null && /^\d+$/.test(batch)
    ? [Number(batch)]
    : [];
}))].sort((a, b) => a - b);
