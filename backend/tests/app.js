/**
 * Express app factory for testing — same middleware as production,
 * but doesn't call listen() or connectDB().
 */
const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const fileUpload = require("express-fileupload");

function createApp() {
  const app = express();

  const tmpDir = path.join(__dirname, "..", "tmp");
  const uploadsDir = path.join(__dirname, "..", "uploads");
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

  app.use(cors());
  app.use(express.json({ limit: "10mb" }));
  app.use(fileUpload({
    limits: { fileSize: 500 * 1024 * 1024 },
    useTempFiles: true,
    tempFileDir: tmpDir,
  }));

  app.use("/uploads", express.static(uploadsDir));

  // Routes
  app.use("/api/auth", require("../routes/auth"));
  app.use("/api/classes", require("../routes/classes"));
  app.use("/api/recordings", require("../routes/recordings"));
  app.use("/api/attendance", require("../routes/attendance"));
  app.use("/api/classroom-recording", require("../routes/classroomRecording"));
  app.use("/api/users", require("../routes/users"));
  app.use("/api/batches", require("../routes/batches"));
  app.use("/api/rooms", require("../routes/rooms"));
  app.use("/api/licenses", require("../routes/licenses"));
  app.use("/api/app", require("../routes/appUpdate"));
  app.use("/api/analytics", require("../routes/analytics"));
  app.use("/api/remote", require("../routes/remote"));

  // Global error handler
  app.use((err, _req, res, _next) => {
    console.error("Test error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  });

  return app;
}

module.exports = createApp;
