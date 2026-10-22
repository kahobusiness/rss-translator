import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { del } from '@vercel/blob';
import { jsonStore, updateJson, acquireLease, stateBlobOptions } from '../lib/json-store.ts';

stateBlobOptions();
const root = `operations/probes/${randomUUID()}`;
const key = `${root}/counter.json`;
const leaseKey = `${root}/lease.json`;
try {
  const payload = '真实长正文与压缩响应 ETag 验证。'.repeat(4000);
  assert.equal(await jsonStore.compareAndSwap(key, { count: 0, payload }, null), true);
  const initial = (await jsonStore.read<{ count: number; payload: string }>(key))!;
  assert.equal(initial.value.count, 0);
  assert.equal(initial.value.payload, payload);
  assert.ok(initial.etag && !initial.etag.startsWith('W/'), 'CAS requires a strong origin ETag');
  await Promise.all([1, 2].map(() => updateJson<{ count: number; payload: string }>(key,
    current => ({ ...current!, count: current!.count + 1 }))));
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
