require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const fileUpload = require("express-fileupload");
const connectDB = require("./config/database");

const app = express();

// Middleware
const allowedOrigins = process.env.ALLOWED_ORIGINS === "*" ? true : (process.env.ALLOWED_ORIGINS?.split(",") || ["http://localhost:5174", "http://localhost:5175"]);
app.use(cors({
  origin: allowedOrigins,
  credentials: true,
}));
app.use(express.json({ limit: "10mb" }));
app.use(fileUpload({
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB max
  useTempFiles: true,
  tempFileDir: path.join(__dirname, "tmp"),
}));

// Serve uploaded recordings
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// Health check
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

// Start
const PORT = process.env.PORT || 4000;
connectDB().then(() => {
  app.listen(PORT, () => {
    console.log(`Lecture Capture Backend running on http://localhost:${PORT}`);
  });
});
