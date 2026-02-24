import dotenv from "dotenv";
import { exit } from "process";
import {
  updateChannelActivity,
  getChannelActivity,
  closeDb,
  saveYTVideos,
} from "./db.js";
import { sleep } from "./utils.js";
import cron from "node-cron";

dotenv.config();

const API_KEY = process.env.GOOGLE_API_KEY;
const API_SEARCH_URL = process.env.GOOGLE_YT_SEARCH_URL;
const API_VIDEOS_URL = process.env.GOOGLE_YT_VIDEOS_URL;

async function searchLatestVideos(channelId, publishedAfter) {
  const url =
    `${API_SEARCH_URL}` +
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
    `${API_VIDEOS_URL}` +
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
  return videosDetails?.map((video) => ({
    video_id: video.id,
    channel_id: channelId,
    title: video.snippet.title,
    published_at: video.snippet.publishedAt,
    duration: video.contentDetails.duration,
    is_short: isShort(video.contentDetails.duration),
  }));
}

function getLastPublishedAt(channel, days = 15) {
  const now = new Date();
  const past = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const lastPublishedAt =
    channel.last_publish_at && channel.last_publish_at.trim() !== ""
      ? channel.last_publish_at
      : past.toISOString();
  return lastPublishedAt;
}

async function fetchNewVideosForChannel(channel) {
  const lastPublishedAt = getLastPublishedAt(channel);
  const videoIds = await searchLatestVideos(
    channel.channel_id,
    lastPublishedAt,
  );
  if (videoIds.length === 0) return [];
  const videoDetails = await fetchVideoDetails(videoIds);
  return normalizedVideos(videoDetails, channel.channel_id);
}

function main() {
  (async () => {
    const channels = await getChannelActivity();
    for (let i = 0; i < channels.length; i++) {
      try {
        const videos = await fetchNewVideosForChannel(channels[i]);
        console.log(
          `[${i + 1}/${channels.length}] found ${videos.length} videos for channel: ${channels[i].channel_id}`,
        );
        if (videos.length > 0) {
          await saveYTVideos(videos);
          await updateChannelActivity(videos);
        }
        await sleep(1000);
      } catch (error) {
        console.error(error);
      }
    }
    closeDb();
    exit(0);
  })();
}

cron.schedule("0 3 * * *", main);
