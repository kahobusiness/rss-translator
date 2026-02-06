# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Dev Commands

- `npm run dev` — Start Next.js dev server (http://localhost:3000)
- `npm run build` — Production build
- `npm run lint` — ESLint
- No test framework is configured

## Architecture

RSS Translator is a Next.js 14 App Router application deployed on Vercel that automatically translates RSS feeds into Chinese using the Claude API. It fetches feed lists from an OPML source (typically a GitHub Gist), translates articles via batch Claude API calls, and serves translated content as RSS feeds.

### Data Flow

```
OPML source (GitHub Gist) → opml-parser.ts → config/feeds.ts (cached 1hr)
                                                    ↓
Vercel cron (19 staggered batch jobs, every 6hrs) → /api/cron
    → rss-parser.ts (fetch feeds) → storage.ts (filter new) → translator.ts (batch translate via Claude)
    → storage.ts (persist)
                                                    ↓
/api/feed/[id] or /api/feed/all → serve translated RSS XML
```

### Key Modules

- **`lib/translator.ts`** — Claude API integration. Batch translates up to 3 articles per API call using delimiter format (ARTICLE_N_TITLE/CONTENT tags), auto-splits large batches, truncates content at 40k chars. Supports 250s deadline protection and custom API base URL (Zenmux or official Anthropic).
- **`lib/storage.ts`** — File-based persistence. Dev: `./data/`, production (Vercel): `/tmp/rss-data/` (ephemeral). Keeps last 100 items per feed, one JSON file per feed.
- **`lib/rss-parser.ts`** — RSS fetching with 10s timeout via `rss-parser` library.
- **`lib/opml-parser.ts`** — OPML parsing with GitHub Gist API support. Generates URL-friendly feed IDs from titles.
- **`config/feeds.ts`** — Feed configuration loader with 1-hour in-memory cache.

### API Routes

- `GET /api/feeds` — JSON list of all feeds
- `GET /api/feed/all` — Aggregated RSS feed (all sources combined)
- `GET /api/feed/[id]` — Individual translated feed RSS
- `GET /api/cron?batch=N` — Cron handler, processes 5 feeds per batch with 250s deadline, protected by optional `CRON_SECRET`

### Cron System

`vercel.json` defines 19 staggered cron jobs (batch=0..18) running every 6 hours at minutes 0-18. Each batch processes 5 feeds with a 250s deadline (50s buffer for RSS fetch/save) to stay within Vercel's 300s function timeout. Translation API calls are made sequentially to avoid rate limiting. Untranslated articles due to deadline use original content as fallback.

## Environment Variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `API_KEY` | Yes | Claude API key |
| `API_BASE_URL` | No | Custom API endpoint (default: Zenmux) |
| `MODEL_NAME` | No | Claude model (default: `anthropic/claude-sonnet-4.5`) |
| `CRON_SECRET` | No | Bearer token for cron endpoint auth |
| `OPML_URL` | No | Custom OPML feed source URL |
