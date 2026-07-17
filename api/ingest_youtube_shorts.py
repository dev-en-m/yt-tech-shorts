import csv
import json
import os
import re
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent
ROOT_DIR = BASE_DIR.parent
DATA_DIR = Path(os.environ.get("DATA_DIR", BASE_DIR))

CHANNELS_CSV = ROOT_DIR / "csv" / "channels_with_ids.csv"
DB_PATH = DATA_DIR / "app.db"
STATE_FILE = DATA_DIR / "last_run_by_channel.json"

GOOGLE_YT_SEARCH_URL = os.environ.get(
    "GOOGLE_YT_SEARCH_URL",
    "https://www.googleapis.com/youtube/v3/search",
)
GOOGLE_YT_VIDEOS_URL = os.environ.get(
    "GOOGLE_YT_VIDEOS_URL",
    "https://www.googleapis.com/youtube/v3/videos",
)


def load_channels():
    with CHANNELS_CSV.open(newline="") as f:
        return [row for row in csv.DictReader(f) if row.get("channel_id")]


def parse_duration_seconds(duration):
    match = re.fullmatch(
        r"PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?",
        duration,
    )
    if not match:
        return 0
    hours, minutes, seconds = (int(part or 0) for part in match.groups())
    return hours * 3600 + minutes * 60 + seconds


def search_video_ids(api_key, channel_id, published_after, published_before):
    params = {
        "part": "id",
        "channelId": channel_id,
        "type": "video",
        "videoDuration": "short",
        "order": "date",
        "maxResults": 50,
        "publishedAfter": published_after,
        "publishedBefore": published_before,
        "key": api_key,
    }
    response = requests.get(GOOGLE_YT_SEARCH_URL, params=params, timeout=30)
    response.raise_for_status()
    data = response.json()
    return [
        item["id"]["videoId"]
        for item in data.get("items", [])
        if item.get("id", {}).get("videoId")
    ]


def fetch_video_details(api_key, video_ids):
    if not video_ids:
        return []

    response = requests.get(
        GOOGLE_YT_VIDEOS_URL,
        params={
            "part": "snippet,contentDetails",
            "id": ",".join(video_ids),
            "key": api_key,
        },
        timeout=30,
    )
    response.raise_for_status()

    videos = []
    for item in response.json().get("items", []):
        duration_seconds = parse_duration_seconds(
            item.get("contentDetails", {}).get("duration", "")
        )
        if duration_seconds > 60:
            continue
        snippet = item.get("snippet", {})
        video_id = item["id"]
        videos.append({
            "video_id": video_id,
            "channel_id": snippet.get("channelId", ""),
            "title": snippet.get("title", ""),
            "published_at": snippet.get("publishedAt", ""),
            "duration_seconds": duration_seconds,
            "youtube_url": f"https://www.youtube.com/watch?v={video_id}",
        })
    return videos


def ingest_channel(db, api_key, channel, state, run_started_at):
    channel_id = channel["channel_id"]
    published_after = state.get(channel_id)
    if not published_after:
        published_after = (
            run_started_at - timedelta(days=10)
        ).isoformat().replace("+00:00", "Z")

    run_started_at_iso = run_started_at.isoformat().replace("+00:00", "Z")
    ids = search_video_ids(api_key, channel_id, published_after, run_started_at_iso)
    videos = fetch_video_details(api_key, ids)
    db.executemany("""
        INSERT OR IGNORE INTO videos (
            video_id, channel_id, title, published_at, duration_seconds, youtube_url
        ) VALUES (
            :video_id, :channel_id, :title, :published_at, :duration_seconds, :youtube_url
        )
    """, videos)

    state[channel_id] = run_started_at_iso
    db.execute("""
        INSERT INTO channel_activity (channel_id, handle, last_run_at)
        VALUES (?, ?, ?)
        ON CONFLICT(channel_id) DO UPDATE SET
            handle = excluded.handle,
            last_run_at = excluded.last_run_at
    """, (channel_id, channel.get("handle"), state[channel_id]))
    db.commit()

    return len(ids), len(videos)


def main():
    load_dotenv(BASE_DIR / ".env")
    api_key = os.environ.get("GOOGLE_API_KEY")
    if not api_key:
        raise SystemExit("GOOGLE_API_KEY is required")

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    channels = load_channels()
    state = json.loads(STATE_FILE.read_text()) if STATE_FILE.exists() else {}
    run_started_at = datetime.now(timezone.utc).replace(microsecond=0)

    with sqlite3.connect(DB_PATH) as db:
        db.execute("""
            CREATE TABLE IF NOT EXISTS videos (
                video_id TEXT PRIMARY KEY,
                channel_id TEXT NOT NULL,
                title TEXT NOT NULL,
                published_at TEXT NOT NULL,
                duration_seconds INTEGER NOT NULL,
                youtube_url TEXT NOT NULL
            )
        """)
        db.execute("""
            CREATE TABLE IF NOT EXISTS channel_activity (
                channel_id TEXT PRIMARY KEY,
                handle TEXT,
                last_run_at TEXT NOT NULL
            )
        """)
        for channel in channels:
            try:
                found, saved = ingest_channel(db, api_key, channel, state, run_started_at)
                print(f"{channel['handle']}: found={found} shorts={saved}")
            except requests.HTTPError as err:
                print(f"{channel['handle']}: failed {err}", flush=True)

    STATE_FILE.write_text(json.dumps(state, indent=2, sort_keys=True) + "\n")
    print(f"done channels={len(channels)}")


if __name__ == "__main__":
    main()
