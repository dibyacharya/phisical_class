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

// Root & Health check (Render health check hits "/" by default)
app.get("/", (_req, res) => res.json({ status: "ok", service: "LectureLens API" }));
app.get("/health", (_req, res) => res.json({ status: "ok" }));


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

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Lecture Capture Backend running on http://0.0.0.0:${PORT}`);
  });
}).catch((err) => {
  console.error("Failed to start server:", err.message);
  process.exit(1);
});
