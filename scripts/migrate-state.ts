// Copy legacy data into the strongly consistent private store. Old public data
// stays untouched. Re-running never overwrites an existing private document.
import { head, BlobNotFoundError } from '@vercel/blob';
import { mkdir, writeFile } from 'node:fs/promises';
import { jsonStore } from '../lib/json-store.ts';
import { CRON_BATCHES } from '../config/cron.ts';
import defaults from '../config/default-feeds.json' with { type: 'json' };
import type { StoredFeed, TranslatedItem } from '../lib/storage.ts';

const token = process.env.BLOB_READ_WRITE_TOKEN;
if (!token || !process.env.STATE_BLOB_STORE_ID) throw new Error('Both legacy and private store configuration are required');
const keys = [...defaults.map(f => `feeds/${f.id}.json`), ...CRON_BATCHES.map(b => `feeds/_recent_items_b${b}.json`),
  'feeds/_recent_items.json', 'feeds/_opml_cache.json'];
const documents: Record<string, unknown> = {};
for (const key of keys) {
  try {
    const meta = await head(key, { token });
    const res = await fetch(meta.url, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`${key}: HTTP ${res.status}`);
    documents[key] = await res.json();
  } catch (error) {
    if (!(error instanceof BlobNotFoundError)) throw error;
    console.log(`No legacy document: ${key}`);
  }
}
const dir = '/tmp/rss-state-migration-backup';
await mkdir(dir, { recursive: true });
const backup = `${dir}/legacy-${Date.now()}.json`;
await writeFile(backup, JSON.stringify(documents), { flag: 'wx', mode: 0o600 });
console.log(`Legacy backup saved: ${backup}`);
let migrated = 0;
let removedDuplicates = 0;
for (const [key, original] of Object.entries(documents)) {
  let value = original;
  if (/^feeds\/[^_][^/]*\.json$/.test(key)) {
    const feed = original as StoredFeed;
    const unique = new Map<string, TranslatedItem>();
    for (const item of feed.items) {
      const previous = unique.get(item.guid);
      if (!previous || (previous.translated === false && item.translated !== false)) unique.set(item.guid, item);
    }
    removedDuplicates += feed.items.length - unique.size;
    value = { ...feed, items: [...unique.values()].sort((a, b) => Date.parse(b.pubDate) - Date.parse(a.pubDate)) };
  }
  if (await jsonStore.compareAndSwap(key, value, null)) migrated++;
  else console.log(`Private document already exists, preserved: ${key}`);
}
console.log(JSON.stringify({ migrated, removedDuplicates, legacyDocumentsUntouched: true, backup }));
