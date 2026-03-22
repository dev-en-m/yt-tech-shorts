# YouTube Shorts - Tech Edition

> YouTube Shorts, but only tech. A curated aggregator for tech-focused YouTube Shorts from the best creators in the industry.

[![Node.js](https://img.shields.io/badge/Node.js-20%2B-green)](https://nodejs.org)
[![License](https://img.shields.io/badge/License-ISC-blue)](LICENSE)

## About

This project collects and curates YouTube Shorts from popular tech YouTube channels, making it easy to discover short-form tech content in one place. Instead of doom-scrolling through mixed content, get a focused feed of tech reviews, coding tips, gadget unboxings, and technology news — served via a TikTok-style vertical swipe player.

### Supported Channels

The project tracks 48+ popular tech YouTube channels including:
- **Tech Reviewers**: MKBHD, Mrwhosetheboss, Linus Tech Tips, Dave2D, JerryRigEverything
- **Developers**: Fireship, Traversy Media, freeCodeCamp, Web Dev Simplified, The Coding Train
- **Tech News**: Bloomberg Technology, The Verge, CNET, Engadget, TechCrunch
- **Official Dev Channels**: Google Developers, Microsoft Developer, Apple Developer, TensorFlow, Meta Developers, Android Developers

## Features

- **Shorts Detection**: Automatically identifies videos that qualify as YouTube Shorts (<=60 seconds)
- **Automated Fetching**: Scheduled daily collection (3 AM UTC) of latest videos from tracked channels
- **SQLite Storage**: Persistent database with cursor-based pagination
- **REST API**: Express 5 server with rate limiting, CORS, and compression
- **Web Player**: TikTok-style vertical swipe player with infinite scroll using YouTube IFrame API

## Tech Stack

- **Runtime**: Node.js 20+
- **Backend**: Express 5, better-sqlite3, node-cron
- **Frontend**: Vanilla JS (four-class architecture), YouTube IFrame API
- **Security**: Helmet, CORS whitelist, rate limiting

## Project Structure

```
youtube-shorts/
├── api/
│   ├── api.js              # Express REST server
│   ├── db.js               # SQLite database operations
│   ├── getNewYTVideos.js   # YouTube video fetcher (cron: 3 AM daily)
│   ├── getChannelInfo.js   # Channel @handle -> ID resolver
│   ├── utils.js            # Utility functions
│   ├── Dockerfile          # Container config
│   └── package.json        # Backend dependencies
├── ui/
│   ├── index.html          # HTML shell
│   ├── index.js            # Four-class player (FeedManager, DOMManager, PlayerManager, App)
│   └── style.css           # Styles
├── csv/
│   ├── curated_channels.csv     # Source channel list (48+ channels)
│   └── channels_with_ids.csv   # Channels with resolved YouTube IDs
├── .env.example            # Environment variable template
├── package.json            # Workspace root
└── app.db                  # SQLite database (generated)
```

## Setup

### Prerequisites

- Node.js 20 or higher
- YouTube Data API v3 key ([Google Cloud Console](https://console.cloud.google.com/))

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/yourusername/youtube-shorts.git
   cd youtube-shorts
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure environment variables**
   ```bash
   cp .env.example .env
   ```
   Fill in your `GOOGLE_API_KEY` in the `.env` file.

### Usage

**Start the API server (with hot reload):**
```bash
cd api && npm run dev
```

**Resolve channel handles to IDs (one-time setup):**
```bash
node api/getChannelInfo.js
```

**Fetch new videos from all channels:**
```bash
node api/getNewYTVideos.js
```

**View the player:**
Open `ui/index.html` in a browser (or serve via a static server). It expects the API at `http://localhost:3000/api/v1/videos`.

### Docker

```bash
docker build -t yt-shorts-api ./api
docker run -p 3000:3000 -v $(pwd)/app.db:/data/app.db yt-shorts-api
```

## API

| Endpoint | Description |
|----------|-------------|
| `GET /health` | Health check |
| `GET /api/v1/videos?after=<cursor>&limit=<n>` | Paginated Shorts (default limit: 20, max: 50) |

## Adding New Channels

1. Add the channel to `csv/curated_channels.csv`
2. Run the channel ID resolver:
   ```bash
   node api/getChannelInfo.js
   ```
3. The channel will be included in the next fetch cycle.

## Contributing

Contributions are welcome! Fork the repo, create a feature branch, and open a PR.

## Known Limitations

- YouTube API quota limits apply (10,000 units/day free tier)
- Some channels may not have Shorts content

## License

ISC License - see LICENSE file for details.
