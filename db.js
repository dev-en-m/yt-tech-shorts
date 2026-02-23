import csv from "csv-parser";
import fs from "fs";
import Database from "better-sqlite3";
import { exit } from "process";
const db = new Database("app.db");

// 1. Ensure table exists (safe to run every time)
db.prepare(
  `
  CREATE TABLE IF NOT EXISTS channel_activity (
    channel_id TEXT PRIMARY KEY,
    last_publish_at TEXT
  )
`,
).run();

db.prepare(
  `
   CREATE TABLE IF NOT EXISTS videos (
    video_id TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL,
    title TEXT NOT NULL,
    published_at TEXT NOT NULL, 
    is_short INTEGER NOT NULL  
  )
`,
).run();

export async function getVideos(after, limit) {
  let rows = [];
  if (after) {
    rows = db
      .prepare(
        `
      SELECT video_id
      FROM videos
      WHERE published_at < (
        SELECT published_at FROM videos WHERE video_id = ? AND is_short=1
      )
      ORDER BY published_at DESC
      LIMIT ?
    `,
      )
      .all(after, limit);
  } else {
    rows = db
      .prepare(
        `
      SELECT video_id
      FROM videos WHERE is_short=1
      ORDER BY published_at DESC
      LIMIT ?
    `,
      )
      .all(limit);
  }
  return rows;
}

async function getNewVideos() {
  return new Promise((resolve, reject) => {
    const results = [];
    fs.createReadStream("./csv/videos-list.csv")
      .pipe(csv())
      .on("data", (result) => results.push(result))
      .on("end", () => resolve(results))
      .on("error", (error) => reject(error));
  });
}

export async function getChannelActivity() {
  try {
    const channel_activities = db
      .prepare(`SELECT * FROM channel_activity`)
      .all();
    return channel_activities;
  } catch (error) {
    console.error("getChannelActity Error", error);
    exit(1);
  }
}

export async function updateChannelActivity(videos) {
  const latestByChannel = new Map();

  for (const v of videos) {
    const current = latestByChannel.get(v.channel_id);
    if (!current || v.published_at > current) {
      latestByChannel.set(v.channel_id, v.published_at);
    }
  }

  // 3. Upsert (insert or update)
  const upsertStmt = db.prepare(`
    INSERT INTO channel_activity (channel_id, last_publish_at)
    VALUES (?, ?)
    ON CONFLICT(channel_id)
    DO UPDATE SET
      last_publish_at = MAX(last_publish_at, excluded.last_publish_at)
  `);

  const transaction = db.transaction(() => {
    for (const [channelId, lastPublishAt] of latestByChannel) {
      upsertStmt.run(channelId, lastPublishAt);
    }
  });

  transaction();

  console.log("db operation complete");
}

export function closeDb() {
  db.close();
  console.log("Database connection closed");
}

export async function saveVideos(videos) {
  try {
    const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO videos (video_id, channel_id, title, published_at, is_short)
    VALUES (?, ?, ?, ?, ?)
  `);

    const transaction = db.transaction(() => {
      for (const element of videos) {
        insertStmt.run(
          element.video_id,
          element.channel_id,
          element.title,
          element.published_at,
          element.is_short === "true" || element.is_short === true ? 1 : 0,
        );
      }
    });

    transaction();
    console.log(`Inserted ${videos.length} videos`);
  } catch (error) {
    console.error(error);
  }
}
