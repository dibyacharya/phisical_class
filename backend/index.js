require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const fileUpload = require("express-fileupload");
const connectDB = require("./config/database");

const app = express();

// Ensure required directories exist
const tmpDir = path.join(__dirname, "tmp");
const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

// Middleware
app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(fileUpload({
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB max
  useTempFiles: true,
  tempFileDir: tmpDir,
}));

// Serve uploaded recordings
app.use("/uploads", express.static(uploadsDir));

// Serve static test pages (hardware-test.html for browser-side camera/mic
// probing). HTTPS inherited from Railway custom domain so getUserMedia works.
app.use("/static", express.static(path.join(__dirname, "static")));

// Root & Health check (Render health check hits "/" by default)
app.get("/", (_req, res) => res.json({ status: "ok", service: "LectureLens API" }));
app.get("/health", (_req, res) => res.json({ status: "ok" }));

// v3.1.21 — Azure readiness probe. Returns what the backend's azureBlob
// helper sees for its connection-string + container-name env vars. Lets us
// verify from the outside whether Railway has actually injected the vars
// (previous recordings went to /uploads/ even though the variable WAS set
// in the Railway dashboard — suggesting either a deploy-after-var-set
// gap, a trailing-whitespace paste issue, or the helper seeing a different
// string than what the dashboard shows). Only reveals boolean + length
// flags; never the actual secret.
app.get("/health/azure", (_req, res) => {
  const cs = process.env.AZURE_STORAGE_CONNECTION_STRING || "";
  const container = process.env.AZURE_STORAGE_CONTAINER || "";
  const prefix = process.env.AZURE_BLOB_PREFIX || "";
  res.json({
    configured: !!cs && cs.length > 0,
    connectionStringLength: cs.length,
    containerSet: !!container,
    container: container || "(default: lms-storage)",
    prefix: prefix || "(none)",
    startsWithDefaultEndpoints: cs.startsWith("DefaultEndpointsProtocol"),
    hasAccountName: cs.includes("AccountName="),
    hasAccountKey: cs.includes("AccountKey="),
    hasEndpointSuffix: cs.includes("EndpointSuffix="),
  });
});

// v3.1.21 — live Azure upload test. Writes a 32-byte test blob so we can see
// the actual error message if the real credentials/container fail. Returns
// the SDK error verbatim — removes the silent-fallback mystery that's made
// previous recordings land on /uploads/ despite the env var being set.
app.post("/health/azure/test-upload", async (_req, res) => {
  try {
    const { uploadToBlob } = require("./utils/azureBlob");
    const testBuf = Buffer.from("lecturelens-azure-probe-" + Date.now(), "utf-8");
    const blobName = `probe_${Date.now()}.txt`;
    try {
      const url = await uploadToBlob(testBuf, blobName, "text/plain");
      if (!url) {
        return res.status(500).json({
          ok: false,
          stage: "uploadToBlob-returned-null",
          hint: "Either Azure client wasn't initialised (no connection string) OR the SDK caught an exception internally. Check Railway logs for [AzureBlob] lines.",
        });
      }
      return res.json({ ok: true, url, blobName });
    } catch (err) {
      return res.status(500).json({
        ok: false,
        stage: "uploadToBlob-threw",
        error: err.message,
        code: err.code || err.statusCode || "no-code",
        requestId: err.requestId || null,
      });
    }
  } catch (err) {
    return res.status(500).json({ ok: false, stage: "route-handler", error: err.message });
  }
});


// Routes
app.use("/api/auth", require("./routes/auth"));
app.use("/api/classes", require("./routes/classes"));
app.use("/api/recordings", require("./routes/recordings"));
app.use("/api/attendance", require("./routes/attendance"));
app.use("/api/classroom-recording", require("./routes/classroomRecording"));
app.use("/api/users", require("./routes/users"));
app.use("/api/batches", require("./routes/batches"));
app.use("/api/courses", require("./routes/courses"));
app.use("/api/rooms", require("./routes/rooms"));
app.use("/api/licenses", require("./routes/licenses"));
app.use("/api/app", require("./routes/appUpdate"));
app.use("/api/analytics", require("./routes/analytics"));
app.use("/api/remote", require("./routes/remote"));

// Global error handler — returns JSON instead of ugly HTML stack traces
app.use((err, _req, res, _next) => {
  console.error("Unhandled error:", err.message);
  res.status(500).json({ error: "Internal server error" });
});

// Start
const PORT = process.env.PORT || 5020;
connectDB().then(async () => {
  // One-time migration: drop old sparse unique index on Room.spaceCode
  // (replaced by partial filter expression index that correctly skips empty strings)
  try {
    const db = require("mongoose").connection.db;
    const indexes = await db.collection("lcs_rooms").indexes();
    const oldIdx = indexes.find(i => i.key?.spaceCode && i.sparse);
    if (oldIdx) {
      await db.collection("lcs_rooms").dropIndex(oldIdx.name);
      console.log(`[Migration] Dropped old sparse index "${oldIdx.name}" on lcs_rooms.spaceCode`);
    }
  } catch (e) {
    // Ignore — index may already be gone or collection may not exist yet
    if (!e.message.includes("ns not found")) console.log("[Migration] spaceCode index:", e.message);
  }

  // v2.6.0: probe ffmpeg at boot so the first merge doesn't pay the
  // "fork a process to learn if ffmpeg exists" penalty, and so the deploy
  // log immediately surfaces an install regression (missing nixpacks.toml
  // change on a re-deploy) rather than hiding it until the first class
  // ends and a merge fails.
  try {
    const { probeFfmpeg } = require("./utils/segmentMerger");
    const ok = await probeFfmpeg();
    console.log(`[Boot] ffmpeg on PATH: ${ok ? "yes (segment merge enabled)" : "NO — segment merge disabled"}`);
  } catch (e) {
    console.warn("[Boot] ffmpeg probe threw:", e.message);
  }

  // v2.6.3: reset any recordings that got stuck at mergeStatus="merging"
  // because the previous instance crashed mid-ffmpeg. Without this, they'd
  // be permanently wedged — runMergeForRecording's atomic claim refuses to
  // start work on a doc that's already "merging".
  //
  // Only reset entries older than 1h so we don't clobber a merge that was
  // genuinely in progress during a rolling restart.
  try {
    const Recording = require("./models/Recording");
    const cutoff = new Date(Date.now() - 60 * 60 * 1000);
    const result = await Recording.updateMany(
      {
        mergeStatus: "merging",
        $or: [
          { mergedAt: { $lt: cutoff } },
          { mergedAt: { $exists: false } },
          { mergedAt: null },
        ],
      },
      { $set: { mergeStatus: "pending", mergeError: "Interrupted by server restart" } }
    );
    if (result.modifiedCount > 0) {
      console.log(`[Boot] Reset ${result.modifiedCount} stale merge job(s) to pending (>1h old)`);
    }
  } catch (e) {
    console.warn("[Boot] Stale-merge reset failed:", e.message);
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Lecture Capture Backend running on http://0.0.0.0:${PORT}`);
  });
}).catch((err) => {
  console.error("Failed to start server:", err.message);
  process.exit(1);
});
