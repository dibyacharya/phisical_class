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

// ── TEMPORARY SEED ENDPOINT (remove after first use) ─────────────────────────
app.post("/api/internal/seed", async (req, res) => {
  if (req.query.key !== "seed-kiit-2026") return res.status(403).json({ error: "forbidden" });
  try {
    const bcrypt = require("bcryptjs");
    const mongoose = require("mongoose");
    const db = mongoose.connection.db;

    const results = { users: [], rooms: [] };

    // ── Admin user ──────────────────────────────────────────────────────────
    const existing = await db.collection("lcs_users").findOne({ email: "admin@kiit.ac.in" });
    if (!existing) {
      const hash = await bcrypt.hash("admin123", 10);
      await db.collection("lcs_users").insertOne({
        name: "Admin User", email: "admin@kiit.ac.in",
        password: hash, role: "admin",
        createdAt: new Date(), updatedAt: new Date(),
      });
      results.users.push("admin@kiit.ac.in created");
    } else {
      results.users.push("admin@kiit.ac.in already exists");
    }

    // ── Rooms ───────────────────────────────────────────────────────────────
    const CAMPUS = "KIIT Campus";
    const ROOMS = [
      { campus: CAMPUS, block: "Block 14", floor: "Ground Floor", roomNumber: "G-101", roomName: "Lecture Hall A",      spaceType: "room",             capacity: 80  },
      { campus: CAMPUS, block: "Block 14", floor: "Ground Floor", roomNumber: "G-102", roomName: "Lecture Hall B",      spaceType: "room",             capacity: 80  },
      { campus: CAMPUS, block: "Block 14", floor: "1st Floor",    roomNumber: "101",   roomName: "Smart Class Room 1",  spaceType: "room",             capacity: 60  },
      { campus: CAMPUS, block: "Block 14", floor: "1st Floor",    roomNumber: "102",   roomName: "Smart Class Room 2",  spaceType: "room",             capacity: 60  },
      { campus: CAMPUS, block: "Block 14", floor: "2nd Floor",    roomNumber: "202",   roomName: "Smart Class Room 3",  spaceType: "room",             capacity: 60  },
      { campus: CAMPUS, block: "Block 15", floor: "Ground Floor", roomNumber: "CF-01", roomName: "Main Conference Hall",spaceType: "conference_hall",  capacity: 120 },
      { campus: CAMPUS, block: "Block 15", floor: "1st Floor",    roomNumber: "201",   roomName: "Research Lab",        spaceType: "room",             capacity: 40  },
      { campus: CAMPUS, block: "Tech Block", floor: "Ground Floor",roomNumber: "AUD-1",roomName: "Central Auditorium",  spaceType: "auditorium",       capacity: 500 },
      { campus: CAMPUS, block: "Tech Block", floor: "1st Floor",  roomNumber: "T-101", roomName: "Innovation Lab",      spaceType: "room",             capacity: 50  },
      { campus: CAMPUS, block: "Tech Block", floor: "2nd Floor",  roomNumber: "T-201", roomName: "AI Research Lab",     spaceType: "room",             capacity: 30  },
    ];
    let added = 0;
    for (const r of ROOMS) {
      const exists = await db.collection("lcs_rooms").findOne({ roomNumber: r.roomNumber, campus: r.campus });
      if (!exists) {
        await db.collection("lcs_rooms").insertOne({ ...r, isActive: true, createdAt: new Date(), updatedAt: new Date() });
        added++;
      }
    }
    results.rooms.push(`${added} rooms added (duplicates skipped)`);

    res.json({ ok: true, results });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
// ── END TEMPORARY SEED ────────────────────────────────────────────────────────

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
