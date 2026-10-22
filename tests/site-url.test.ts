import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { getSiteUrl } from '../lib/site-url.ts';

const originalEnv = { ...process.env };
afterEach(() => { process.env = { ...originalEnv }; });

test('explicit public site origin overrides a protected deployment hostname', () => {
  process.env.SITE_URL = 'https://rss.kaho.io/';
  process.env.VERCEL_URL = 'protected-deployment.vercel.app';
  assert.equal(getSiteUrl({ url: 'https://preview.vercel.app/api/feeds' }), 'https://rss.kaho.io');
});

test('stable production hostname is used when available', () => {
  delete process.env.SITE_URL;
  process.env.VERCEL_PROJECT_PRODUCTION_URL = 'rss.example.com';
  assert.equal(getSiteUrl(), 'https://rss.example.com');
});

test('without configuration the request origin is used, never VERCEL_URL', () => {
  delete process.env.SITE_URL;
  delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
  process.env.VERCEL_URL = 'protected-deployment.vercel.app';
  assert.equal(getSiteUrl({ url: 'https://rss.example.com/api/feeds' }), 'https://rss.example.com');
  assert.equal(getSiteUrl({ url: 'http://localhost:3000/api/feeds' }), 'http://localhost:3000');
});

test('non-HTTP site URLs are rejected', () => {
  process.env.SITE_URL = 'file:///tmp/rss';
  assert.throws(() => getSiteUrl(), /Invalid SITE_URL/);
});
