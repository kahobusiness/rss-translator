# AGENTS.md

Guidance for coding agents working in this repository. Keep README.md brief and user-facing; put deployment and troubleshooting details in [docs/operations.md](docs/operations.md).

## Commands

Use Node.js 24 and the committed lockfile / `.npmrc`.

- `npm ci` — Install dependencies.
- `npm run dev` — Start Next.js on localhost:3000.
- `npm test` — Node's built-in test runner with `tests/setup.ts` (clears inherited production credentials).
- `npm run lint` — ESLint 9 flat config for app, lib, config.
- `npx tsc --noEmit` — Type checking.
- `npm run build` — Next.js production build; does not run ESLint.
- `npm run check` — Tests, lint, type check, production build.

Vercel builds run tests and lint before the production build. No external services are required for unit tests.

## Architecture

Next.js 16 App Router / React 19, deployed on Vercel. The default model is `MiniMax-M3.1-Flash-Preview` through an Anthropic-compatible endpoint; environment overrides are supported. Read `lib/model-config.ts` for current model budgets.

```text
OPML → curated 20-feed allowlist → RSS discovery → persistent article jobs
     → fetch linked article body → translate HTML text in checkpointed chunks
     → publish complete result → per-feed archive + per-batch recent index → RSS
```

### Key modules

- `config/feeds.ts`, `lib/opml-parser.ts` — OPML loading, allowlist and cache fallback. Preserve valid stale caches and `config/default-feeds.json` when upstream fails. Never replace good configuration with empty/invalid results.
- `config/cron.ts`, `vercel.json` — Batch coverage and schedules. Four discovery batches of five feeds every six hours; four work-only schedules every 15 minutes. Schedules use UTC.
- `lib/cron-runner.ts` — Discovery, historical backfill, queue recovery, batch lease and workers. A run has a 240-second deadline, up to four workers and eight model calls. Live RSS entries take precedence over historical copies of the same GUID.
- `lib/rss-parser.ts` — RSS/Atom parsing, encoded content preference, stable GUID/date fallbacks, 20-second request timeout and 10 MB XML limit.
- `lib/article-fetcher.ts` — Extracts linked article HTML with a 12-second timeout and verified canonical URL fallbacks. Fetch every linked item regardless of RSS length or full-content markers, including link-blog commentary. Without a link, accept only explicitly full RSS content. Fetch failures remain retryable, never publish a snippet as full text.
- `lib/jobs.ts`, `lib/queue-recovery.ts` — Persistent fetch/translate/publish state machine, leases, recovery, retry and content-profile upgrades. Changing acquisition policy must invalidate stale prepared content as well as completed translations. Legacy archived translations are queued for full-article backfill.
- `lib/translation-plan.ts`, `lib/translator.ts`, `lib/chunk-cache.ts` — Translate text nodes and image alt attributes, retaining HTML and protected code in the application. Validate required text-unit IDs and checkpoint successful chunks; never truncate or summarize. Each article processes at most two chunks per worker turn. See source for current provider tool schema and budgets.
- `lib/json-store.ts` — Private Blob state with uncached origin reads and strong ETag conditional writes; local `data/` uses locks and atomic replacement. Old public Blob is read-only compatibility input. Read errors must not be treated as missing data.
- `lib/storage.ts` — Last 100 GUIDs per feed, per-batch recent-index shards and legacy index merge. Failed retries cannot overwrite successful translations. Full results also remain in private job payloads after leaving the rolling RSS window.
- `lib/rss-response.ts`, `lib/utils.ts` — Stream RSS as UTF-8, escape metadata and generate plain descriptions; include complete translated HTML and original content.
- `lib/web-analytics.ts`, `lib/rss-observability.ts`, `lib/monitored-rss.ts` — Vercel Analytics and structured origin logs. Copy events represent intent, not subscriber counts; origin logs exclude CDN hits. Custom metrics are opt-in.

## Invariants

- Publish only after every required translation chunk is complete. Retain checkpoints across retries and persist publish results so storage failures do not cause another model call.
- Translation checkpoint identity includes original text/title, model, endpoint, prompt and budgets. Do not mix different profiles.
- Respect article and batch leases; check ownership before writes. Use `updateJson` / conditional writes for mutable state.
- Retry failures with backoff (up to 24 hours). Provider content-policy failures, including MiniMax 1026/1027 wrapped in HTTP 500, wait at least 24 hours.
- Historical backfill is incremental and bounded. Deployment does not immediately retranslate the archive.
- Use stable `SITE_URL` / production domain for subscription URLs, never deployment-specific `VERCEL_URL`.

## Homepage and reading

Each feed card loads its latest successful translation from its own archive (not the capped aggregate index), with a title, publication date and plain-text excerpt. A failed preview read must not break subscription controls or other feeds. `/read/[id]?guid=...` reads the selected archived translation; missing articles return 404. `lib/article-preview.ts` handles selection, excerpts, dates and a restricted HTML allowlist; never render raw publisher HTML directly on the site.

## Routes

| GET endpoint | Behavior |
| --- | --- |
| `/read/[id]?guid=...` | Public translated article reading page |
| `/api/feeds` | Enabled feed configuration |
| `/api/feed/all` | Aggregated Chinese RSS, latest 100 articles |
| `/api/feed/[id]` | Individual Chinese RSS |
| `/api/cron?batch=N` | Discover and process; requires Bearer `CRON_SECRET` |
| `/api/cron?batch=N&work=1` | Process queue only |
| `/api/cron?batch=N&dryRun=1` | Authenticated, strictly read-only diagnostic; no leases, writes or model calls |
| `/api/status` | Authenticated health, queue and token usage; filters: `state`, `feed`, `limit` |

Cron and status fail closed when `CRON_SECRET` is missing. Health returns 503 for uninitialized/stale discovery, degraded configuration, feed errors or failed jobs.

## Configuration and operations

See `.env.example` and [docs/operations.md](docs/operations.md) for setup and maintenance commands.

- Required for translation: `API_KEY`; optional `API_BASE_URL` (default `https://api.minimax.cn/anthropic`) and `MODEL_NAME`.
- Production private state: `STATE_BLOB_STORE_ID` with project OIDC, or `STATE_BLOB_READ_WRITE_TOKEN` / `RSS_STATE_READ_WRITE_TOKEN`. `BLOB_READ_WRITE_TOKEN` only supports legacy public reads.
- `CRON_SECRET` protects operational endpoints; `SITE_URL` identifies the public domain.
- `OPML_URL`, `GITHUB_TOKEN`, `TRANSLATION_PROMPT_VERSION` are optional overrides. `RSS_CUSTOM_METRICS_ENABLED` is opt-in and requires appropriate Vercel plan support.
- Never print credentials, commit `.env.local`, or run maintenance mutations against production as part of ordinary tests. Repair scripts default to read-only and require explicit write flags/backups.
- `main` is the production branch; pushing it triggers deployment. Preserve private state during rollback.
- For changes to translation/storage, add meaningful regression tests and run `npm run check`. Documentation-only edits need link/path and diff checks.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
