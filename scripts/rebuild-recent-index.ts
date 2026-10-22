// Node 24: node --env-file=.env.production.local scripts/rebuild-recent-index.ts
// Defaults to read-only. --write requires a backup directory outside the repo.
import { parseArgs } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { jsonStore } from '../lib/json-store.ts';
import { CRON_BATCHES, FEEDS_PER_BATCH } from '../config/cron.ts';
import { loadFeed, saveRecentIndex } from '../lib/storage.ts';
import type { StoredFeed, TranslatedItem } from '../lib/storage.ts';
import { getSiteUrl } from '../lib/site-url.ts';

async function main() {
  const { values } = parseArgs({ options: {
    write: { type: 'boolean', default: false },
    'backup-dir': { type: 'string' },
  } });
  if (!process.env.BLOB_READ_WRITE_TOKEN) throw new Error('Production Blob credentials are required');
  if (values.write && !values['backup-dir']) throw new Error('--write requires --backup-dir');
  const response = await fetch(`${getSiteUrl()}/api/feeds`, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Feed configuration: HTTP ${response.status}`);
  const { feeds } = await response.json() as { feeds: { id: string; name: string }[] };
  if (!feeds.length || feeds.some((_, i) => !CRON_BATCHES.includes(Math.floor(i / FEEDS_PER_BATCH)))) {
    throw new Error('Enabled feeds exceed the scheduled batch coverage');
  }

  // Read every enabled archive before writing anything. Transport errors abort;
  // a confirmed missing Blob means this source has never produced an archive.
  const archives: StoredFeed[] = [];
  const batches = new Map<number, TranslatedItem[]>();
  for (const [i, config] of feeds.entries()) {
    const feed = await loadFeed(config.id);
    if (!feed) { console.log(`No archive yet: ${config.id}`); continue; }
    archives.push(feed);
    const batch = Math.floor(i / FEEDS_PER_BATCH);
    batches.set(batch, [...(batches.get(batch) || []), ...feed.items.map(item => ({
      ...item, sourceFeedId: config.id, sourceFeedName: config.name,
    }))]);
  }
  if (!archives.length) throw new Error('No archives found; refusing to rebuild');
  console.log(JSON.stringify({ mode: values.write ? 'write' : 'dry-run', feeds: archives.length,
    batches: [...batches].map(([batch, items]) => ({ batch, archived: items.length, unique: new Set(items.map(i => i.guid)).size })) }));
  if (!values.write) return;

  const backupDir = path.resolve(values['backup-dir']!);
  await mkdir(backupDir, { recursive: true });
  const oldShards: Record<string, unknown> = {};
  for (const batch of CRON_BATCHES) {
    const key = `feeds/_recent_items_b${batch}.json`;
    oldShards[key] = (await jsonStore.read<TranslatedItem[]>(key))?.value ?? null;
  }
  const backup = path.join(backupDir, `rss-index-backup-${Date.now()}.json`);
  await writeFile(backup, JSON.stringify({ feeds, archives, oldShards }), { flag: 'wx', mode: 0o600 });
  console.log(`Backup saved: ${backup}`);
  for (const [batch, items] of batches) await saveRecentIndex(items, batch);
  console.log('Rebuilt all scheduled index shards from enabled feed archives.');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
