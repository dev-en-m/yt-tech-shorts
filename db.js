import csv from "csv-parser";
import fs from "fs";
import Database from "better-sqlite3";

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
