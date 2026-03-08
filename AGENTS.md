# AGENTS.md

## Purpose
This repository aggregates tech YouTube Shorts into SQLite and serves them to a vertical swipe UI.

## Architecture At A Glance
1. `api/getChannelInfo.js` reads `csv/curated_channels.csv`, resolves `@handle` to channel IDs, and writes `csv/channels_with_ids.csv`.
2. `api/db.js` manages SQLite (`app.db`) and creates:
   - `channel_activity(channel_id, last_publish_at)`
   - `videos(video_id, channel_id, title, published_at, duration, is_short)`
3. `api/getNewYTVideos.js` fetches recent videos per channel, flags Shorts (`<= 60s`), saves to DB, and updates `channel_activity`.
4. `api/api.js` serves paginated video IDs at `GET /api/v1/videos`.
5. `ui/index.js` fetches IDs and renders a Shorts-style player with the YouTube IFrame API.

## Repo Map
- `api/api.js`: Express API server (CORS, rate limit, health check, pagination endpoint).
- `api/db.js`: DB schema + read/write helpers.
- `api/getChannelInfo.js`: channel ID enrichment from CSV.
- `api/getNewYTVideos.js`: scheduled YouTube fetcher.
- `ui/index.html`, `ui/index.js`, `ui/style.css`: client app.
- `csv/`: curated channel lists and ID mapping.
- `app.db`: local SQLite database.

## Environment Variables
Required for ingest scripts:
- `GOOGLE_API_KEY`
- `GOOGLE_API_URL`
- `GOOGLE_YT_SEARCH_URL`
- `GOOGLE_YT_VIDEOS_URL`

Used by API server:
- `PORT` (default `3000`)
- `NODE_ENV` (default `development`)
- `ALLOWED_ORIGINS` (comma-separated)

## Runbook
- Install dependencies from repo root:
  - `npm install`
- Start API server:
  - `cd api && npm run dev`
- Open player UI:
  - Open `ui/index.html` in a browser (or serve `ui/` via a static server).
  - UI expects API at `http://localhost:3000/api/v1/videos`.

## Data Operations
- Resolve channel IDs:
  - `node api/getChannelInfo.js`
- Fetch new videos:
  - `node api/getNewYTVideos.js`
  - Note: current code schedules cron at `0 3 * * *` and does not run an immediate fetch at startup.

## Agent Notes
- Use ESM-style imports with explicit `.js` extension for local files.
- Keep `TRANSITION_MS` in `ui/index.js` aligned with `#track` transform transition duration in `ui/style.css`.
- Preserve current frontend invariants:
  - `PlayerManager` is the only playback authority.
  - Re-anchor transform after DOM trim/prepend operations.
  - Keep single trim timer behavior.
- Prefer SQLite transactions for batched DB writes.
- Never commit secrets from `.env`.

## Known Gaps
- `README.md` does not fully match current file structure/scripts.
- `.env.example` currently omits required `GOOGLE_*` keys used by ingest scripts.
- `api/getChannelInfo.js` imports `./utils` without `.js`; fix if touching that file.
