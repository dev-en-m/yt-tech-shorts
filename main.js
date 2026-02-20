import csv from "csv-parser";
import { createObjectCsvWriter } from "csv-writer";
import fs from "fs";
import dotenv from "dotenv";
import { exit } from "process";
import { updateChannelActivity } from "./db.js";
dotenv.config();

const API_KEY = process.env.API_KEY;

async function loadAllChannels() {
  try {
    return new Promise((resolve, reject) => {
      const channels = [];
      fs.createReadStream("./csv/channels_with_ids.csv")
        .pipe(csv())
        .on("data", (data) => channels.push(data))
        .on("end", () => resolve(channels))
        .on("error", (error) => reject(error));
    });
  } catch (error) {
    console.error(error);
  }
}

async function searchLatestVideos(channelId, publishedAfter) {
  const url =
    `https://www.googleapis.com/youtube/v3/search` +
    `?part=id` +
    `&channelId=${channelId}` +
    `&order=date` +
    `&publishedAfter=${publishedAfter}` +
    `&maxResults=25` +
    `&type=video` +
    `&key=${API_KEY}`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    if (!res.ok) {
      console.log("searchLatestVideos", data);
      exit(1);
    }
    return data.items.map((item) => item.id.videoId);
  } catch (error) {
    console.error("Error in searchLatestVideos", error);
  }
}

async function fetchVideoDetails(videoIds) {
  const url =
    `https://www.googleapis.com/youtube/v3/videos` +
    `?part=snippet,contentDetails` +
    `&id=${videoIds.join(",")}` +
    `&key=${API_KEY}`;

  const res = await fetch(url);
  const data = await res.json();
  if (!res.ok) {
    console.error("fetchVideoDetails", data);
    exit(1);
  }
  return data.items;
}

function isShort(duration) {
  const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);

  const hours = parseInt(match?.[1] || 0);
  const minutes = parseInt(match?.[2] || 0);
  const seconds = parseInt(match?.[3] || 0);

  const totalSeconds = hours * 3600 + minutes * 60 + seconds;

  return totalSeconds > 0 && totalSeconds <= 60;
}

function normalizedVideos(videosDetails, channelId) {
  return videosDetails?.map((v) => ({
    video_id: v.id,
    channel_id: channelId,
    title: v.snippet.title,
    published_at: v.snippet.publishedAt,
    duration: v.contentDetails.duration,
    is_short: isShort(v.contentDetails.duration),
  }));
}

async function fetchNewVideosForChannels(channel) {
  const publishedAfter = "2026-01-25T06:00:00.000Z";
  const videoIds = await searchLatestVideos(channel.channel_id, publishedAfter);
  if (videoIds.length === 0) return [];
  // const videosDetails = await fetchVideoDetails([
  //   "iCSg_ul3G2w",
  //   "zPAY2VxfFBk",
  //   "Qr4anBkL2_A",
  //   "LXmNeVLM4e4",
  //   "vZdbbN3FCzE",
  // ]);

  // Read JSON file and pass to normalizedVideos
  const videoDetailsJson = await fs.promises.readFile(
    "video-details.json",
    "utf-8",
  );
  const videosDetails = JSON.parse(videoDetailsJson);
  // const videosDetails = await fetchVideoDetails(videoIds);
  return normalizedVideos(videosDetails, channel.channel_id);
}

function createSaveVideoWriter() {
  const fileExist = fs.existsSync("./csv/videos-list.csv");
  const saveVideoWriter = createObjectCsvWriter({
    path: "./csv/videos-list.csv",
    header: [
      {
        id: "video_id",
        title: "video_id",
      },
      {
        id: "channel_id",
        title: "channel_id",
      },
      {
        id: "title",
        title: "title",
      },
      {
        id: "published_at",
        title: "published_at",
      },
      {
        id: "is_short",
        title: "is_short",
      },
    ],
    append: fileExist,
  });
  return saveVideoWriter;
}

async function saveVideos(videos) {
  const createWriter = createSaveVideoWriter();
  await createWriter.writeRecords(videos);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

(async function () {
  const channels = await loadAllChannels();

  for (const channel of channels) {
    try {
      const videos = await fetchNewVideosForChannels(channel);
      if (videos.length > 0) {
        await saveVideos(videos);
        await updateChannelActivity(videos);
      }
      sleep(1000);
    } catch (error) {
      console.error(error);
    }
  }
})();
