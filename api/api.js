import dotenv from "dotenv";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import rateLimit from "express-rate-limit";
import cron from "node-cron";
import { getYTVideos } from "./db.js";
import { fetchAllChannels } from "./getNewYTVideos.js";

dotenv.config();

const app = express();

// Configuration from environment variables
const PORT = process.env.PORT || 3000;
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",")
  : ["http://localhost:3000", "http://localhost:5173"];

// Security middleware
app.use(helmet()); 

// Compression middleware
app.use(compression());

// CORS configuration
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps or curl requests)
      if (!origin) {
        return callback(null, true);
      }
      if (ALLOWED_ORIGINS.indexOf(origin) === -1) {
        const msg =
          "The CORS policy for this site does not allow access from the specified Origin.";
        return callback(new Error(msg), false);
      }
      return callback(null, true);
    },
    credentials: true,
  }),
);

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  message: { error: "Too many requests, please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use("/api/", limiter);

// Body parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging (simple console logging)
app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    const duration = Date.now() - start;
    console.log(
      `${new Date().toISOString()} ${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms`,
    );
  });
  next();
});

// Video fetch state
let lastFetchAt = null;
let lastFetchResult = null;
let isFetching = false;

async function runFetch() {
  if (isFetching) {
    console.log("[Cron] Fetch already in progress, skipping");
    return;
  }
  isFetching = true;
  const start = Date.now();
  try {
    console.log(`[Cron] Starting video fetch at ${new Date().toISOString()}`);
    const count = await fetchAllChannels();
    lastFetchResult = { status: "success", videosFound: count, durationMs: Date.now() - start };
    console.log(`[Cron] Fetch complete: ${count} videos in ${Date.now() - start}ms`);
  } catch (error) {
    lastFetchResult = { status: "error", error: error.message, durationMs: Date.now() - start };
    console.error("[Cron] Fetch failed:", error);
  } finally {
    lastFetchAt = new Date().toISOString();
    isFetching = false;
  }
}

// Health check endpoint
app.get("/health", (req, res) => {
  res.status(200).json({
    status: "ok",
    timestamp: new Date().toISOString(),
    fetch: {
      lastRun: lastFetchAt,
      lastResult: lastFetchResult,
      inProgress: isFetching,
      schedule: "0 3 * * * (daily 3 AM UTC)",
    },
  });
});

// API endpoint with error handling and input validation
app.get("/api/v1/videos", async (req, res) => {
  try {
    // Input validation
    const limitParam = req.query.limit;
    const afterParam = req.query.after;

    let limit = 20; // default
    if (limitParam !== undefined) {
      const parsed = parseInt(limitParam, 10);
      if (isNaN(parsed) || parsed < 1) {
        return res
          .status(400)
          .json({
            error: "Invalid 'limit' parameter. Must be a positive integer.",
          });
      }
      limit = Math.min(parsed, 50); // Cap at 50
    }

    // Validate 'after' parameter (YouTube video IDs are 11 chars: [a-zA-Z0-9_-])
    let after = null;
    if (afterParam && typeof afterParam === "string") {
      if (!/^[a-zA-Z0-9_-]{11}$/.test(afterParam)) {
        return res
          .status(400)
          .json({ error: "Invalid 'after' cursor." });
      }
      after = afterParam;
    }

    const rows = await getYTVideos(after, limit);

    const ids = rows.map((r) => r.video_id);
    res.status(200).json({
      data: ids,
      nextCursor: ids.length ? ids[ids.length - 1] : null,
      hasMore: ids.length === limit,
    });
  } catch (error) {
    console.error("Error fetching videos:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: "Not found" });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);

  // Handle CORS errors
  if (err.message.includes("CORS")) {
    return res.status(403).json({ error: err.message });
  }

  res.status(500).json({ error: "Internal server error" });
});

// Graceful shutdown
let server;

const startServer = () => {
  server = app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || "development"}`);
  });
};

const shutdown = async (signal) => {
  console.log(`${signal} received. Starting graceful shutdown...`);

  if (server) {
    server.close(async () => {
      console.log("HTTP server closed");

      // Import and close database connection
      try {
        const { closeDb } = await import("./db.js");
        closeDb();
      } catch (err) {
        console.error("Error closing database:", err);
      }

      process.exit(0);
    });

    // Force shutdown after 10 seconds
    setTimeout(() => {
      console.error("Forced shutdown after timeout");
      process.exit(1);
    }, 10000);
  } else {
    process.exit(0);
  }
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// Start the server
startServer();

// Schedule daily video fetch (requires Google API keys)
const canFetch = !!(
  process.env.GOOGLE_API_KEY &&
  process.env.GOOGLE_YT_SEARCH_URL &&
  process.env.GOOGLE_YT_VIDEOS_URL
);

if (canFetch) {
  cron.schedule("0 3 * * *", runFetch);
  setTimeout(runFetch, 5000);
  console.log("Video fetch cron scheduled (daily 3 AM UTC)");
} else {
  console.log("GOOGLE_API_* env vars not set — video fetch disabled");
}

export default app;
