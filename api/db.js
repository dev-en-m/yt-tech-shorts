import Database from "better-sqlite3";
import { createReadStream } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import csv from "csv-parser";


const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const dbPath = process.env.DB_PATH || join(__dirname, "..", "app.db");
const db = new Database(dbPath);

// channel_activity
db.prepare(
  `
  CREATE TABLE IF NOT EXISTS channel_activity (
    channel_id TEXT PRIMARY KEY,
    last_publish_at TEXT
  )
`,
).run();

// videos
db.prepare(
  `
   CREATE TABLE IF NOT EXISTS videos (
    video_id TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL,
    title TEXT NOT NULL,
    published_at TEXT NOT NULL,
    duration TEXT,
    is_short INTEGER NOT NULL
  )
`,
).run();

// Migrate: add duration column for pre-existing databases
const cols = db.prepare(`PRAGMA table_info(videos)`).all().map(c => c.name);
if (!cols.includes("duration")) {
  db.prepare(`ALTER TABLE videos ADD COLUMN duration TEXT`).run();
}

// Index for pagination queries (covers both initial and cursor branches)
db.prepare(
  `CREATE INDEX IF NOT EXISTS idx_videos_short_published ON videos(is_short, published_at DESC)`,
).run();

/***
 * @return {Array}
 * ***/
export async function getChannelActivity() {
  try {
    const channelActivities = db
      .prepare(`SELECT * FROM channel_activity`)
      .all();
    return channelActivities;
  } catch (error) {
    console.error("getChannelActivity Error", error);
    throw error;
  }
}

/***
 * @param {Array<Object>} videos
 * @summary update channel activity by tracking latest published videos
 * ***/
export async function updateChannelActivity(videos) {
  const latestVideoByChannel = new Map();
  try {
    for (const video of videos) {
      const current = latestVideoByChannel.get(video.channel_id);
      if (!current || video.published_at > current) {
        latestVideoByChannel.set(video.channel_id, video.published_at);
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
      for (const [channelId, lastPublishAt] of latestVideoByChannel) {
        upsertStmt.run(channelId, lastPublishAt);
      }
    });

    transaction();

    console.log("updateChannelActivity: update operation completed");
  } catch (error) {
    console.error("updateChannelActivity:", error);
  }
}

/**
 * @return {Array<Object>}
 * @param {string} after - Video ID to cursor after
 * @param {number} limit - Maximum number of videos to return
 *  ***/
export async function getYTVideos(after, limit) {
  let rows = [];
  if (after) {
    rows = db
      .prepare(
        `
      SELECT video_id
      FROM videos
      WHERE is_short = 1
        AND published_at < (
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

/***
 * @param {Array<Object>} videos
 * ***/
export async function saveYTVideos(videos) {
  try {
    const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO videos (video_id, channel_id, title, published_at, duration, is_short)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

    const transaction = db.transaction(() => {
      for (const element of videos) {
        insertStmt.run(
          element.video_id,
          element.channel_id,
          element.title,
          element.published_at,
          element.duration,
          element.is_short === "true" || element.is_short === true ? 1 : 0,
        );
      }
    });

    transaction();
    console.log(`Newly Inserted ${videos.length} videos`);
  } catch (error) {
    console.error("saveYTVideos:", error);
  }
}

export function pruneOldVideos(daysToKeep = 90) {
  const cutoff = new Date(
    Date.now() - daysToKeep * 24 * 60 * 60 * 1000,
  ).toISOString();
  const result = db
    .prepare(`DELETE FROM videos WHERE published_at < ?`)
    .run(cutoff);
  console.log(`Pruned ${result.changes} videos older than ${daysToKeep} days`);
  return result.changes;
}

export function closeDb() {
  db.close();
  console.log("Database connection closed");
}

function storeNewChannels() {
  const channelIds = [];
  const csvPath = join(__dirname, "..", "csv", "channels_with_ids.csv");

  createReadStream(csvPath)
    .pipe(csv())
    .on("data", (id) => channelIds.push(id))
    .on("end", () => {
      (async function () {
        const insertStmt = db.prepare(`
      INSERT OR IGNORE INTO channel_activity (channel_id,last_publish_at)
      VALUES (?, ?)
    `);
        const transaction = db.transaction(() => {
          for (const channelId of channelIds) {
            insertStmt.run(channelId.channel_id, "");
          }
        });
        transaction();
        console.log(`total ${channelIds.length} New channels Added`);
      })().catch(console.error);
    })
    .on("error", (error) => console.error(error));
}

storeNewChannels()