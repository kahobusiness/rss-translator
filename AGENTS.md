# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Build & Dev Commands

- `npm run dev` — Start Next.js dev server (http://localhost:3000)
- `npm run build` — Production build (includes type checking and linting)
- `npm run lint` — ESLint (v9 flat config in `eslint.config.mjs`)
- No test framework is configured

## Architecture

RSS Translator is a Next.js 15 App Router application deployed on Vercel that automatically translates RSS feeds into Chinese using MiniMax-M2.7 via Anthropic-compatible API. It fetches feed lists from an OPML source, filters to a curated 20-feed allowlist, translates articles with token-budget dynamic batching, and serves translated content as RSS feeds.

### Data Flow

```
OPML source (GitHub Gist) → opml-parser.ts → config/feeds.ts
    → CURATED_FEED_IDS filter (20 of 92) → cached in memory + Blob (_opml_cache.json)
                                                    ↓
Vercel cron (4 staggered batch jobs, every 6hrs) → /api/cron
    → rss-parser.ts (fetch, 15s timeout)
    → storage.ts (filter new + retry untranslated via translated:boolean field)
    → article-fetcher.ts (full content extraction for short articles)
    → translator.ts (batch translate via Codex with system prompt)
    → storage.ts (persist to Vercel Blob + update _recent_items.json index)
                                                    ↓
/api/feed/[id] or /api/feed/all → serve translated RSS XML
    → escapeHtml() for user content, stripHtmlTags() for descriptions
```

### Key Modules

- **`lib/storage.ts`** — Vercel Blob persistence (prod) / filesystem (dev). Blob URL caching avoids double HTTP. `TranslatedItem.translated` tracks success for retry. `_recent_items.json` aggregated index avoids full scan. Optimistic locking via `version` field. Keeps last 100 items per feed.
- **`lib/translator.ts`** — MiniMax-M2.7 via Anthropic-compatible API. Token-budget strategy for 204,800-token window: single-article HTML-safe chunking (50K limit), greedy packing into 140K input budget, dynamic max_tokens (up to 50K), 5x concurrency, exponential backoff with jitter on 429/5xx. System prompt enforces translation rules (preserve HTML/code, technical term format). ARTICLE_N delimiter format. 90s per-call timeout, 250s deadline for batch.
- **`lib/rss-parser.ts`** — RSS fetching with 15s overall timeout wrapping `rss-parser` library's 10s socket timeout.
- **`lib/article-fetcher.ts`** — Full article extraction via `@extractus/article-extractor` for RSS items under 1000 chars. Exports `withTimeout` utility used by rss-parser.
- **`lib/utils.ts`** — `escapeHtml()` and `stripHtmlTags()` for safe XML output.
- **`config/feeds.ts`** — OPML loading with 3-tier cache (memory → Blob → fetch). `CURATED_FEED_IDS` allowlist filters 92 OPML feeds to 20. Set to `null` to use all feeds.
- **`lib/opml-parser.ts`** — OPML parsing with GitHub Gist API support and optional `GITHUB_TOKEN` auth.

### API Routes

- `GET /api/feeds` — JSON list of all enabled feeds
- `GET /api/feed/all` — Aggregated RSS feed (uses `_recent_items.json` index)
- `GET /api/feed/[id]` — Individual translated feed RSS
- `GET /api/cron?batch=N` — Cron handler, processes 5 feeds per batch with 250s deadline, protected by `CRON_SECRET`

### Cron System

`vercel.json` defines 4 staggered cron jobs (batch=0..3) running every 6 hours. Each batch processes 5 feeds (20 total) with a 250s deadline. Failed translations are saved with `translated: false` and retried on the next cron run. After saving, cron updates the `_recent_items.json` aggregated index.

## Environment Variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `BLOB_READ_WRITE_TOKEN` | Yes (prod) | Vercel Blob storage token |
| `API_KEY` | Yes | MiniMax API key (or Anthropic) |
| `API_BASE_URL` | No | Custom API endpoint (default: `https://api.minimaxi.com/anthropic`) |
| `MODEL_NAME` | No | Translation model (default: `MiniMax-M2.7`) |
| `CRON_SECRET` | No | Bearer token for cron endpoint auth |
| `OPML_URL` | No | Custom OPML feed source URL |
| `GITHUB_TOKEN` | No | GitHub API token to avoid rate limits on OPML fetch |
