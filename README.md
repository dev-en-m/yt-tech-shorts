# YouTube Shorts - Tech Edition

> YouTube Shorts, but only tech. A curated aggregator for tech-focused YouTube Shorts from the best creators in the industry.

[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green)](https://nodejs.org)
[![License](https://img.shields.io/badge/License-ISC-blue)](LICENSE)

## 📺 About

This project collects and curates YouTube Shorts from popular tech YouTube channels, making it easy to discover short-form tech content in one place. Instead of doom-scrolling through mixed content, get a focused feed of tech reviews, coding tips, gadget unboxings, and technology news.

### Supported Channels

The project tracks 48 popular tech YouTube channels including:
- **Tech Reviewers**: MKBHD, Mrwhosetheboss, Linus Tech Tips, Dave2D, JerryRigEverything
- **Developers**: Fireship, Traversy Media, freeCodeCamp, Web Dev Simplified, The Coding Train
- **Tech News**: Bloomberg Technology, The Verge, CNET, Engadget, TechCrunch
- **Official Dev Channels**: Google Developers, Microsoft Developer, Apple Developer, TensorFlow, Meta Developers, Android Developers

## 🚀 Features

- 📱 **Shorts Detection**: Automatically identifies videos that qualify as YouTube Shorts (≤60 seconds)
- 🔄 **Automated Fetching**: Scheduled collection of latest videos from tracked channels
- 💾 **SQLite Storage**: Persistent database for channel activity tracking
- 📊 **CSV Export**: Easy data export for analysis
- 🌐 **Web Player**: Simple HTML interface for viewing Shorts

## 🛠️ Tech Stack

- **Runtime**: Node.js 18+
- **Database**: SQLite (via `better-sqlite3`)
- **Data Processing**: CSV parsing and writing (`csv-parser`, `csv-writer`)
- **API**: YouTube Data API v3

## 📁 Project Structure

```
youtube-shorts/
├── main.js              # Main entry point - fetches and saves videos
├── db.js                # SQLite database operations
├── util.js              # Utility functions for channel ID fetching
├── index.html           # Web player for viewing Shorts
├── package.json         # Project dependencies
├── .env                 # Environment variables (API key)
├── csv/
│   ├── channels_with_ids.csv    # Channel data with YouTube IDs
│   ├── top_tech_youtube_channels.csv  # Source channel list
│   └── videos-list.csv          # Collected video data
└── app.db               # SQLite database (generated)
```

## ⚙️ Setup

### Prerequisites

- Node.js 18 or higher
- YouTube Data API v3 key

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
   
   Create a `.env` file in the project root:
   ```bash
   cp .env.example .env
   ```
   
   Add your YouTube API key:
   ```env
   API_KEY=your_youtube_api_key_here
   ```

   > **Note**: Get your API key from [Google Cloud Console](https://console.cloud.google.com/). Enable YouTube Data API v3 for your project.

### Usage

**Run the video fetcher:**
```bash
npm run dev
```

This will:
1. Load all tracked channels from `csv/channels_with_ids.csv`
2. Fetch the latest videos from each channel using YouTube API
3. Identify which videos are Shorts (≤60 seconds)
4. Save results to `csv/videos-list.csv`
5. Update channel activity in the SQLite database

**View Shorts:**
Open `index.html` in a browser to see the embedded Shorts player.

## 🔧 Adding New Channels

1. Add the channel to `csv/top_tech_youtube_channels.csv`:
   ```csv
   channel_name,youtube_url
   Channel Name,https://www.youtube.com/@handle
   ```

2. Run the channel ID fetcher:
   ```bash
   node util.js
   ```

   This will populate `channel_id` in `channels_with_ids.csv`.

3. The channel will be automatically included in future fetches.

## 🤝 Contributing

Contributions are welcome! Here's how you can help:

### Ways to Contribute

- 🐛 **Bug Reports**: Open an issue if you find a bug
- 💡 **Feature Suggestions**: Share ideas for new features
- 🔧 **Code Contributions**: Submit PRs for improvements
- 📝 **Documentation**: Improve README or add wiki pages
- 📺 **Channel Suggestions**: Suggest new tech channels to track

### Development Workflow

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Test locally
5. Commit your changes (`git commit -m 'Add amazing feature'`)
6. Push to the branch (`git push origin feature/amazing-feature`)
7. Open a Pull Request

### Coding Standards

- Use ES6+ syntax with imports
- Follow existing code formatting
- Add comments for complex logic
- Test changes before submitting

## 📋 Roadmap

- [ ] Web interface with video grid
- [ ] Filter by channel
- [ ] Search functionality
- [ ] Automatic refresh scheduling
- [ ] Video metadata enrichment (views, likes)
- [ ] RSS feed generation
- [ ] Browser extension

## ⚠️ Known Limitations

- YouTube API quota limits apply (10,000 units/day free tier)
- Some channels may not have Shorts content
- Rate limiting implemented to respect API limits

## 📜 License

ISC License - see LICENSE file for details.

## 🙏 Acknowledgments

- [YouTube Data API](https://developers.google.com/youtube/v3)
- All the amazing tech content creators
