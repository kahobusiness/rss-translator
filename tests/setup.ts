// Never allow unit tests (including Vercel build-time tests) to use production
// storage or model credentials inherited from the build environment.
for (const key of ['BLOB_READ_WRITE_TOKEN', 'BLOB_STORE_ID', 'STATE_BLOB_STORE_ID',
  'STATE_BLOB_READ_WRITE_TOKEN', 'RSS_STATE_READ_WRITE_TOKEN', 'VERCEL_OIDC_TOKEN',
  'API_KEY', 'ANTHROPIC_API_KEY', 'CRON_SECRET']) delete process.env[key];
