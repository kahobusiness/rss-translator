// Inspect by default. --write retries only the captured failed IDs, using the
// ordinary leases, checkpoints and publication path. Never clears the queue.
import { readFile, writeFile } from 'node:fs/promises';
import { acquireLease, jsonStore } from '../lib/json-store.ts';
import { activeProfile, batchKey, jobKey, processJob, saveBatch } from '../lib/jobs.ts';
import type { ArticleJob, BatchState } from '../lib/jobs.ts';

const write = process.argv.includes('--write');
const snapshot = process.argv.find(arg => arg.startsWith('--snapshot='))?.slice(11);
const rounds = Number(process.argv.find(arg => arg.startsWith('--rounds='))?.slice(9) || 1);
if (!Number.isInteger(rounds) || rounds < 1 || rounds > 40) throw new Error('rounds must be 1..40');
if (write && !snapshot) throw new Error('--write requires --snapshot=/absolute/path.json');
const selection = snapshot ? JSON.parse(await readFile(snapshot, 'utf8')) as { batch: number; job: ArticleJob }[] : null;
const targets: { batch: number; job: ArticleJob }[] = [];
for (let batch = 0; batch < 4; batch++) {
  const state = (await jsonStore.read<BatchState>(batchKey(batch)))?.value;
  for (const summary of Object.values(state?.jobs || {})) {
    if (selection ? !selection.some(row => row.batch === batch && row.job.id === summary.id) : summary.stage !== 'failed') continue;
    const job = (await jsonStore.read<ArticleJob>(jobKey(summary.id, batch)))?.value;
    if (!job) throw new Error(`Missing payload: ${summary.id}`);
    if (job.profile !== activeProfile()) throw new Error('Configuration differs from production job profile; refusing to reset checkpoints');
    targets.push({ batch, job });
  }
}
if (write) {
  const backup = `/tmp/rss-failed-before-retry-${Date.now()}.json`;
  await writeFile(backup, JSON.stringify(targets), { mode: 0o600, flag: 'wx' });
  console.log(JSON.stringify({ backup, count: targets.length }));
}
const stopped = new Set<string>();
for (let round = 0; round < (write ? rounds : 1); round++) {
  for (let batch = 0; batch < 4; batch++) {
    const selected = targets.filter(row => row.batch === batch && !stopped.has(row.job.id));
    if (!selected.length) continue;
    const lease = write ? await acquireLease(`operations/leases/batch-${batch}.json`) : null;
    if (write && !lease) { console.log(JSON.stringify({ batch, skipped: 'batch already running' })); continue; }
    try {
      const deadline = Date.now() + 240_000;
      const budget = { remaining: 8 };
      for (const { job } of selected) {
        if (Date.now() > deadline - 20_000 || (write && !budget.remaining)) break;
        const result = write ? await processJob(job.id, batch, deadline, budget) : null;
        if (result?.summary) {
          await lease!.assertOwned();
          await saveBatch(batch, { jobs: { [job.id]: result.summary } });
        }
        const summary = result?.summary || job;
        console.log(JSON.stringify({ round, batch, id: job.id, stage: summary.stage,
          completedChunks: summary.completedChunks, totalChunks: summary.totalChunks, error: summary.error, usage: result?.usage }));
        if (summary.stage === 'complete' || (write && summary.stage === 'failed')) stopped.add(job.id);
      }
    } finally { await lease?.release(); }
  }
  if (stopped.size === targets.length) break;
}
