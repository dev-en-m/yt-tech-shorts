import dotenv from "dotenv";
import fs from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import csv from "csv-parser";
import { createObjectCsvWriter } from "csv-writer";
import { sleep } from "./utils.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config();

const API_KEY = process.env.GOOGLE_API_KEY;
const API_URL = process.env.GOOGLE_API_URL;

/***
 * @param {string} handler
 * @returns {string}
 * ***/
async function fetchChannelId(handler) {
  try {
    const getChannelIdUrl = `${API_URL}?part=id&forHandle=${handler}&key=${API_KEY}`;
    console.log("Fetching channel:", handler);
    const res = await fetch(getChannelIdUrl);
    console.log("Response status:", res.status);
    const data = await res.json();
    if (!res.ok) {
      console.error("API Error:", data);
      process.exit(1);
    }
    if (!data.items || data.items.length === 0) {
      console.log(`No channel found for handle: ${handler}`);
      return null;
    }
    return data.items[0].id;
  } catch (error) {
    console.error("Error:", error);
  }
}

const csvWriter = createObjectCsvWriter({
  path: join(__dirname, "..", "csv", "channels_with_ids.csv"),
  header: [
    { id: "youtube_url", title: "youtube_url" },
    { id: "handle", title: "handle" },
    { id: "channel_id", title: "channel_id" },
  ],
});

/**
 * @summary Resolves YouTube channel handler IDs from a CSV file.
 *
 * Reads the `curated_channels.csv` file, queries the YouTube Console API
 * to resolve handler IDs for each channel, and writes the enriched
 * channel data back to a CSV file.
 *
 * @async
 * @returns {Promise<void>} Resolves when the CSV file has been updated.
 */
function getChannelIdsFromCSV() {
  const results = [];
  fs.createReadStream(join(__dirname, "..", "csv", "curated_channels.csv"))
    .pipe(csv())
    .on("error", (error) => console.error("getChannelIdsFromCSV Error", error))
    .on("data", (data) => results.push(data))
    .on("end", () => {
      (async () => {
        // Read existing CSV to preserve previous data
        let existingRecords = [];
        try {
          if (fs.existsSync(join(__dirname, "..", "csv", "channels_with_ids.csv"))) {
            fs.createReadStream(join(__dirname, "..", "csv", "channels_with_ids.csv"))
              .pipe(csv())
              .on("data", (data) => existingRecords.push(data))
              .on("end", () => {
                processChannels(results, existingRecords);
              });
          } else {
            processChannels(results, []);
          }
        } catch (err) {
          console.error("Error reading existing CSV:", err);
          processChannels(results, []);
        }
      })().catch(console.error);
    });
}

async function processChannels(results, existingRecords) {
  const existingMap = new Map(existingRecords.map(r => [r.handle, r]));
  let outputs = [...existingRecords];
  
  for (let i = 0; i < results.length; i++) {
    const ytChannel = results[i];
    const url = ytChannel.youtube_url;
    const handler = url.slice(url.lastIndexOf("@"));
    
    // Skip if already processed
    if (existingMap.has(handler)) {
      console.log(`[${i + 1}/${results.length}] Skipping (already exists): ${handler}`);
      continue;
    }
    
    console.log(`[${i + 1}/${results.length}] Processing: ${handler}`);
    const channelId = await fetchChannelId(handler);
    if (channelId) {
      outputs.push({
        handle: handler,
        channel_id: channelId,
        youtube_url: url,
      });
    }
    await sleep(150); // rate limit
  }
  await csvWriter.writeRecords(outputs);
}

getChannelIdsFromCSV();
