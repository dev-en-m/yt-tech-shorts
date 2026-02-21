import dotenv from "dotenv";
import { exit } from "process";
import {
  updateChannelActivity,
  getChannelActivity,
  closeDb,
  saveVideos,
} from "./db.js";
dotenv.config();

const API_KEY = process.env.API_KEY;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  const publishedAfter = channel.last_publish_at;
  const videoIds = await searchLatestVideos(channel.channel_id, publishedAfter);
  if (videoIds.length === 0) return [];
  const videoDetails = await fetchVideoDetails(videoIds);
  return normalizedVideos(videoDetails, channel.channel_id);
}

// function createSaveVideoWriter() {
//   const fileExist = fs.existsSync("./csv/videos-list.csv");
//   const saveVideoWriter = createObjectCsvWriter({
//     path: "./csv/videos-list.csv",
//     header: [
//       {
//         id: "video_id",
//         title: "video_id",
//       },
//       {
//         id: "channel_id",
//         title: "channel_id",
//       },
//       {
//         id: "title",
//         title: "title",
//       },
//       {
//         id: "published_at",
//         title: "published_at",
//       },
//       {
//         id: "is_short",
//         title: "is_short",
//       },
//     ],
//     append: fileExist,
//   });
//   return saveVideoWriter;
// }

// async function saveVideos(videos) {
//   const createWriter = createSaveVideoWriter();
//   await createWriter.writeRecords(videos);
// }

function main() {
  (async function () {
    const channels = await getChannelActivity();

    for (const channel of channels) {
      try {
        const videos = await fetchNewVideosForChannels(channel);
        if (videos.length > 0) {
          await saveVideos(videos);
          await updateChannelActivity(videos);
        }
        await sleep(1000);
      } catch (error) {
        console.error(error);
      } finally {
        closeDb();
        exit(0);
      }
    }
  })();
}

await main();
