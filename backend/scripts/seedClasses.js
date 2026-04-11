/**
 * seedClasses.js  — Add realistic scheduled classes + recordings for demo
 * Run: node scripts/seedClasses.js
 */
require("dotenv").config();
const mongoose = require("mongoose");

const MONGO_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/lecture_capture";

const ScheduledClass = mongoose.model("LCS_ScheduledClass", new mongoose.Schema({
  title: String, course: mongoose.Schema.Types.ObjectId,
  teacher: mongoose.Schema.Types.ObjectId,
  courseName: String, courseCode: String, teacherName: String,
  roomNumber: String, date: Date, startTime: String, endTime: String,
  status: { type: String, default: "completed" },
  createdBy: mongoose.Schema.Types.ObjectId,
}, { timestamps: true, collection: "lcs_scheduledclasses" }));

const Recording = mongoose.model("LCS_Recording", new mongoose.Schema({
  scheduledClass: mongoose.Schema.Types.ObjectId,
  title: String, videoUrl: String,
  duration: Number, fileSize: Number, status: String,
  recordingStart: Date, recordingEnd: Date, isPublished: Boolean,
}, { timestamps: true, collection: "lcs_recordings" }));

// Teacher & course IDs from existing DB
const TEACHER_ID = new mongoose.Types.ObjectId("69c39f6a1d64ebb05987a4a3");
const COURSE_MATH = new mongoose.Types.ObjectId("69c39f1c1d64ebb05987a471");
const COURSE_ODIA = new mongoose.Types.ObjectId("69c39f2c1d64ebb05987a47f");
const ADMIN_ID   = new mongoose.Types.ObjectId("69c39ced1d64ebb05987a2f6");

// Helper to create date at IST time
const dt = (dateStr) => new Date(`${dateStr}T00:00:00.000+05:30`);

// ── Classes to seed ────────────────────────────────────────────────────────────
const CLASSES = [
  // Room 202 — multiple dates
  { roomNumber: "202", date: "2026-03-26", startTime: "09:00", endTime: "10:30", courseName: "Mathematics", courseCode: "m1", course: COURSE_MATH, title: "Calculus - Limits & Derivatives", hasRec: true,  recDuration: 90 },
  { roomNumber: "202", date: "2026-03-26", startTime: "11:00", endTime: "12:30", courseName: "Odia Language", courseCode: "o1", course: COURSE_ODIA, title: "Odia Prose - Chapter 3", hasRec: true,  recDuration: 89 },
  { roomNumber: "202", date: "2026-03-27", startTime: "09:00", endTime: "10:30", courseName: "Mathematics", courseCode: "m1", course: COURSE_MATH, title: "Calculus - Integration", hasRec: true,  recDuration: 88 },
  { roomNumber: "202", date: "2026-03-27", startTime: "14:00", endTime: "15:30", courseName: "Odia Language", courseCode: "o1", course: COURSE_ODIA, title: "Odia Poetry - Kabita", hasRec: false, recDuration: 0 },
  { roomNumber: "202", date: "2026-03-28", startTime: "09:00", endTime: "10:30", courseName: "Mathematics", courseCode: "m1", course: COURSE_MATH, title: "Calculus - Differential Equations", hasRec: true,  recDuration: 90 },
  { roomNumber: "202", date: "2026-03-28", startTime: "11:00", endTime: "12:30", courseName: "Odia Language", courseCode: "o1", course: COURSE_ODIA, title: "Odia Grammar - Sandhi", hasRec: true,  recDuration: 85 },
  { roomNumber: "202", date: "2026-04-01", startTime: "09:00", endTime: "10:30", courseName: "Mathematics", courseCode: "m1", course: COURSE_MATH, title: "Vectors & 3D Geometry", hasRec: true,  recDuration: 92 },
  { roomNumber: "202", date: "2026-04-01", startTime: "11:00", endTime: "12:30", courseName: "Odia Language", courseCode: "o1", course: COURSE_ODIA, title: "Odia Literature - Modern", hasRec: true,  recDuration: 87 },
  { roomNumber: "202", date: "2026-04-02", startTime: "09:00", endTime: "10:30", courseName: "Mathematics", courseCode: "m1", course: COURSE_MATH, title: "Probability & Statistics", hasRec: true,  recDuration: 90 },
  { roomNumber: "202", date: "2026-04-03", startTime: "09:00", endTime: "10:30", courseName: "Mathematics", courseCode: "m1", course: COURSE_MATH, title: "Matrices & Determinants", hasRec: true,  recDuration: 89 },
  { roomNumber: "202", date: "2026-04-04", startTime: "11:00", endTime: "12:30", courseName: "Odia Language", courseCode: "o1", course: COURSE_ODIA, title: "Odia - Essay Writing", hasRec: false, recDuration: 0 },
  { roomNumber: "202", date: "2026-04-07", startTime: "09:00", endTime: "10:30", courseName: "Mathematics", courseCode: "m1", course: COURSE_MATH, title: "Complex Numbers", hasRec: true,  recDuration: 91 },
  { roomNumber: "202", date: "2026-04-08", startTime: "09:00", endTime: "10:30", courseName: "Mathematics", courseCode: "m1", course: COURSE_MATH, title: "Permutations & Combinations", hasRec: true,  recDuration: 88 },
  { roomNumber: "202", date: "2026-04-09", startTime: "11:00", endTime: "12:30", courseName: "Odia Language", courseCode: "o1", course: COURSE_ODIA, title: "Odia Conversation Practice", hasRec: true,  recDuration: 84 },
  { roomNumber: "202", date: "2026-04-10", startTime: "09:00", endTime: "10:30", courseName: "Mathematics", courseCode: "m1", course: COURSE_MATH, title: "Revision - Unit Test", hasRec: true,  recDuration: 90 },
  { roomNumber: "202", date: "2026-04-11", startTime: "09:00", endTime: "10:30", courseName: "Mathematics", courseCode: "m1", course: COURSE_MATH, title: "Unit Test - Chapter 4", hasRec: false, recDuration: 0, status: "live" },

  // Room 101 — separate classes
  { roomNumber: "101", date: "2026-04-07", startTime: "10:00", endTime: "11:30", courseName: "Mathematics", courseCode: "m1", course: COURSE_MATH, title: "Trigonometry - Identities", hasRec: true, recDuration: 89 },
  { roomNumber: "101", date: "2026-04-08", startTime: "14:00", endTime: "15:30", courseName: "Odia Language", courseCode: "o1", course: COURSE_ODIA, title: "Odia - Short Stories", hasRec: true, recDuration: 88 },
  { roomNumber: "101", date: "2026-04-09", startTime: "10:00", endTime: "11:30", courseName: "Mathematics", courseCode: "m1", course: COURSE_MATH, title: "Algebra - Polynomials", hasRec: true, recDuration: 90 },

  // CF-01 — Conference Hall
  { roomNumber: "CF-01", date: "2026-04-05", startTime: "10:00", endTime: "12:00", courseName: "Mathematics", courseCode: "m1", course: COURSE_MATH, title: "Faculty Development Program - Maths", hasRec: true, recDuration: 120 },
  { roomNumber: "CF-01", date: "2026-04-10", startTime: "14:00", endTime: "16:00", courseName: "Odia Language", courseCode: "o1", course: COURSE_ODIA, title: "Seminar - Odia Literature", hasRec: true, recDuration: 118 },
];

async function main() {
  await mongoose.connect(MONGO_URI);
  console.log("✅  Connected to MongoDB");

  let created = 0, recs = 0;
  for (const c of CLASSES) {
    // Avoid duplicates
    const existing = await ScheduledClass.findOne({ roomNumber: c.roomNumber, date: dt(c.date), startTime: c.startTime });
    if (existing) { console.log(`   skip (exists): ${c.roomNumber} ${c.date} ${c.startTime}`); continue; }

    const cls = await ScheduledClass.create({
      title:       c.title,
      course:      c.course,
      teacher:     TEACHER_ID,
      courseName:  c.courseName,
      courseCode:  c.courseCode,
      teacherName: "Rishi",
      roomNumber:  c.roomNumber,
      date:        dt(c.date),
      startTime:   c.startTime,
      endTime:     c.endTime,
      status:      c.status || "completed",
      createdBy:   ADMIN_ID,
    });
    created++;

    if (c.hasRec && c.recDuration > 0) {
      await Recording.create({
        scheduledClass: cls._id,
        title:          `Recording - ${c.title}`,
        videoUrl:       `/uploads/${cls._id}_recording.mp4`,
        duration:       c.recDuration * 60,     // seconds
        fileSize:       Math.round(c.recDuration * 60 * 200000), // ~200KB/s
        status:         "completed",
        recordingStart: new Date(`${c.date}T${c.startTime}:00.000+05:30`),
        recordingEnd:   new Date(`${c.date}T${c.endTime}:00.000+05:30`),
        isPublished:    true,
      });
      recs++;
    }

    console.log(`   ✅ ${c.roomNumber} | ${c.date} ${c.startTime}-${c.endTime} | ${c.title}`);
  }

  const total = await ScheduledClass.countDocuments();
  const totalRec = await Recording.countDocuments();
  console.log(`\n── Done: ${created} new classes, ${recs} new recordings`);
  console.log(`   Total in DB: ${total} classes, ${totalRec} recordings`);
  await mongoose.disconnect();
}

main().catch(e => { console.error("❌", e.message); process.exit(1); });
