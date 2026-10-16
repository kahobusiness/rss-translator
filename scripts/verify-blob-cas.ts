import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { del } from '@vercel/blob';
import { jsonStore, updateJson, acquireLease, stateBlobOptions } from '../lib/json-store.ts';

stateBlobOptions();
const root = `operations/probes/${randomUUID()}`;
const key = `${root}/counter.json`;
const leaseKey = `${root}/lease.json`;
try {
  assert.equal(await jsonStore.compareAndSwap(key, { count: 0 }, null), true);
  const initial = (await jsonStore.read<{ count: number }>(key))!;
  assert.equal(initial.value.count, 0);
  await Promise.all([1, 2].map(() => updateJson<{ count: number }>(key, current => ({ count: current!.count + 1 }))));
  assert.equal((await jsonStore.read<{ count: number }>(key))!.value.count, 2);
  assert.equal(await jsonStore.compareAndSwap(key, { count: 99 }, initial.etag), false);
  const leases = await Promise.all([acquireLease(leaseKey), acquireLease(leaseKey)]);
  assert.equal(leases.filter(Boolean).length, 1);
  await leases.find(Boolean)!.assertOwned();
  await leases.find(Boolean)!.release();
  console.log('PASS: real Blob CAS conflict/retry, stale write rejection, single lease owner.');
} finally {
  await del([key, leaseKey], stateBlobOptions());
  console.log('Isolated probe objects deleted.');
}
