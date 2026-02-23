import express from "express";
import cors from "cors";
import { getVideos } from "../db.js";

const app = express();

app.use(cors());

app.get("/api/v1/videos", async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 20, 50);
  const after = req.query.after || null;

  let rows = await getVideos(after, limit);

  const ids = rows.map((r) => r.video_id);
  console.log("ids called", ids);
  res.json({
    data: ids,
    nextCursor: ids.length ? ids[ids.length - 1] : null,
    hasMore: ids.length === limit,
  });
});

app.listen(3000, () => {
  console.log("running on port 3000");
});
