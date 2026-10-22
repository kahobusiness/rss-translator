import { list } from '@vercel/blob';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { blobConfigured, jsonStore, stateBlobOptions } from './json-store.ts';
import type { JsonStore } from './json-store.ts';
import { summarize } from './jobs.ts';
import type { ArticleJob, BatchState, JobSummary } from './jobs.ts';

interface Entry { key: string; uploadedAt: number }
async function listEntries(batch: number): Promise<Entry[]> {
  const prefix = `operations/jobs/b${batch}/`;
  if (blobConfigured()) {
    const entries: Entry[] = [];
    let cursor: string | undefined;
    do {
      const result = await list({ ...stateBlobOptions(), prefix, cursor });
      entries.push(...result.blobs.map(b => ({ key: b.pathname, uploadedAt: b.uploadedAt.getTime() })));
      cursor = result.hasMore ? result.cursor : undefined;
    } while (cursor);
    return entries;
  }
  const dir = path.join(process.cwd(), 'data', prefix);
  try {
    const names = (await fs.readdir(dir)).filter(f => f.endsWith('.json'));
    return Promise.all(names.map(async name => ({ key: `${prefix}${name}`, uploadedAt: (await fs.stat(path.join(dir, name))).mtimeMs })));
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
}

// Payload creation and a batch manifest cannot form a cross-Blob transaction.
// Reconcile the canonical payload directory on every run, so a crash between
// those two writes cannot orphan an article after it disappears from its RSS.
export async function recoverQueue(batch: number, state: BatchState, store: JsonStore = jsonStore,
  enumerate: () => Promise<Entry[]> = () => listEntries(batch)): Promise<Record<string, JobSummary>> {
  const recovered: Record<string, JobSummary> = {};
  const since = state.reconciledThrough ? Date.parse(state.reconciledThrough) - 5 * 60_000 : 0;
  for (const entry of await enumerate()) {
    const id = entry.key.split('/').pop()!.replace(/\.json$/, '');
    if (state.jobs[id] || entry.uploadedAt < since) continue;
    const saved = await store.read<ArticleJob>(entry.key);
    if (saved) recovered[id] = summarize(saved.value);
  }
  return recovered;
}
