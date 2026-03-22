# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Curated aggregator for tech-focused YouTube Shorts. Fetches short-form videos (<=60s) from 48+ tech YouTube channels into SQLite, serves them via REST API, and renders a TikTok-style vertical swipe player.

## Commands

```bash
# Install dependencies (uses npm workspaces)
npm install

# Start API server with hot reload (runs on port 3000)
cd api && npm run dev

# Resolve channel @handles to YouTube channel IDs
node api/getChannelInfo.js

# Fetch new videos from all channels into DB
node api/getNewYTVideos.js

# Docker build & run
docker build -t yt-shorts-api -f api/Dockerfile .
docker run -p 3000:3000 -v $(pwd)/app.db:/data/app.db yt-shorts-api

# Docker Compose (API + UI)
docker compose up --build
```

The UI is static files in `ui/` — open `ui/index.html` or serve via a static server. It expects the API at `http://localhost:3000/api/v1/videos`.

No automated tests exist yet.

## Architecture

**Data pipeline:** `csv/curated_channels.csv` -> `getChannelInfo.js` -> `csv/channels_with_ids.csv` -> `getNewYTVideos.js` (cron: 3 AM daily) -> SQLite `app.db` -> `api.js` REST endpoint -> `ui/index.js` player

**Backend (`api/`):**
- `api.js` — Express server: `GET /health`, `GET /api/v1/videos?after=&limit=` (cursor-based pagination, returns Shorts only)
- `db.js` — SQLite layer (better-sqlite3). Tables: `channel_activity`, `videos`
- `getNewYTVideos.js` — YouTube API fetcher with cron scheduling. Flags videos <=60s as Shorts
- `getChannelInfo.js` — Resolves @handles to channel IDs via YouTube API

**Frontend (`ui/`):**
- `index.js` — Four-class architecture: `FeedManager` (API + caching), `DOMManager` (DOM + transforms), `PlayerManager` (sole playback authority), `App` (navigation state)
- Uses YouTube IFrame API. 5-slide DOM window with infinite scroll

## Code Conventions

- **ESM modules** throughout — use explicit `.js` extension on all local imports
- Express 5 (not 4)
- SQLite transactions for batched writes
- API rate limiting: 15 requests per 15 minutes

## Frontend Invariants (must preserve)

1. `PlayerManager` is the **only** entity that may call `playVideo()`/`pauseVideo()`
2. CSS transform must be re-anchored after any DOM mutation (trim/prepend)
3. Only one trim timer pending at a time (`#trimTimerId`)
4. `#onEnded` routes through `#tryNavigate` so `navLock` is respected
5. `autoplay:0` on all players — playback starts only via `activate()`
6. Keep `TRANSITION_MS` in `index.js` aligned with `#track` transition duration in `style.css`

## Environment Variables

Required for ingest scripts: `GOOGLE_API_KEY`, `GOOGLE_API_URL`, `GOOGLE_YT_SEARCH_URL`, `GOOGLE_YT_VIDEOS_URL`

API server: `PORT` (default 3000), `NODE_ENV`, `ALLOWED_ORIGINS` (comma-separated)

## Known Issues

None currently tracked.
