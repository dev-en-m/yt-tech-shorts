import dotenv from "dotenv";
import fs from "fs";
import csv from "csv-parser";
import { createObjectCsvWriter } from "csv-writer";
dotenv.config();

const API_KEY = process.env.API_KEY;

async function fetchChannelId(handler) {
  try {
    const getChannelIdUrl = `https://www.googleapis.com/youtube/v3/channels?part=id&forHandle=${handler}&key=${API_KEY}`;
    console.log("Fetching from:", getChannelIdUrl);
    const res = await fetch(getChannelIdUrl);
    console.log("Response status:", res.status);
    const data = await res.json();
    if (!res.ok) {
      console.error(data);
      exit(0);
    }
    return data.items[0].id;
  } catch (error) {
    console.error("Error:", error);
  }
}

const csvWriter = createObjectCsvWriter({
  path: "./csv/channels_with_ids.csv",
  header: [
    { id: "youtube_url", title: "youtube_url" },
    { id: "handle", title: "handle" },
    { id: "channel_id", title: "channel_id" },
  ],
});

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const results = [];

try {
  fs.createReadStream("./csv/top_tech_youtube_channels.csv")
    .pipe(csv())
    .on("data", (data) => results.push(data))
    .on("end", () => {
      (async () => {
        let outputs = [];
        for (const ytChannel of results) {
          const url = ytChannel.youtube_url;
          const handler = url.slice(url.lastIndexOf("@"));
          const channelId = await fetchChannelId(handler);
          outputs.push({
            handle: handler,
            channel_id: channelId,
            youtube_url: url,
          });
          await sleep(150); // rate limit
        }
        await csvWriter.writeRecords(outputs);
      })().catch(console.error);
    });
} catch (error) {
  console.error(error);
}
