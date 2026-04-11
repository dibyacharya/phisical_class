/**
 * seedUsers.js — Seed demo users + batches + courses into production Atlas
 * Run: MONGODB_URI="..." node scripts/seedUsers.js
 *
 * IDs are fixed so seedClasses.js teacher/course references match.
 */
require("dotenv").config();
const mongoose = require("mongoose");
const bcrypt   = require("bcryptjs");

const MONGO_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/lecture_capture";

// ─── Schemas (inline, no circular deps) ──────────────────────────────────────
const User = mongoose.model("LCS_User", new mongoose.Schema({
  _id:        mongoose.Schema.Types.ObjectId,
  name:       String,
  email:      { type: String, unique: true, lowercase: true },
  password:   String,
  role:       { type: String, enum: ["admin", "student", "teacher"] },
  rollNumber: String,
  employeeId: String,
  batch:      mongoose.Schema.Types.ObjectId,
  courses:    [mongoose.Schema.Types.ObjectId],
}, { timestamps: true, collection: "lcs_users" }));

const Batch = mongoose.model("LCS_Batch", new mongoose.Schema({
  _id:         mongoose.Schema.Types.ObjectId,
  name:        String,
  description: String,
  isActive:    { type: Boolean, default: true },
}, { timestamps: true, collection: "lcs_batches" }));

const Course = mongoose.model("LCS_Course", new mongoose.Schema({
  _id:        mongoose.Schema.Types.ObjectId,
  courseName: String,
  courseCode: String,
  teacher:    mongoose.Schema.Types.ObjectId,
  batch:      mongoose.Schema.Types.ObjectId,
}, { timestamps: true, collection: "lcs_courses" }));

// ─── Fixed IDs (matching seedClasses.js references) ──────────────────────────
const ADMIN_ID   = new mongoose.Types.ObjectId("69c39ced1d64ebb05987a2f6");
const TEACHER_ID = new mongoose.Types.ObjectId("69c39f6a1d64ebb05987a4a3");
const TEACHER2_ID = new mongoose.Types.ObjectId("69c39f7a1d64ebb05987a4b1");
const STUDENT1_ID = new mongoose.Types.ObjectId("69c39fa01d64ebb05987a4d2");
const STUDENT2_ID = new mongoose.Types.ObjectId("69c39fb01d64ebb05987a4e0");
const BATCH_ID    = new mongoose.Types.ObjectId("69c39f0a1d64ebb05987a460");
const COURSE_MATH = new mongoose.Types.ObjectId("69c39f1c1d64ebb05987a471");
const COURSE_ODIA = new mongoose.Types.ObjectId("69c39f2c1d64ebb05987a47f");

async function upsertUser({ _id, name, email, password, role, rollNumber, employeeId, batch, courses }) {
  const existing = await User.findOne({ email });
  if (existing) {
    console.log(`   skip (exists): ${email}`);
    return existing;
  }
  const hash = await bcrypt.hash(password, 10);
  const u = new User({ _id, name, email, password: hash, role, rollNumber, employeeId, batch, courses });
  await u.save();
  console.log(`   ✅ Created ${role}: ${email}`);
  return u;
}

async function upsertBatch({ _id, name, description }) {
  const existing = await Batch.findOne({ name });
  if (existing) { console.log(`   skip (exists): Batch ${name}`); return existing; }
  const b = new Batch({ _id, name, description, isActive: true });
  await b.save();
  console.log(`   ✅ Batch: ${name}`);
  return b;
}

async function upsertCourse({ _id, courseName, courseCode, teacher, batch }) {
  const existing = await Course.findOne({ courseCode, batch });
  if (existing) { console.log(`   skip (exists): Course ${courseName}`); return existing; }
  const c = new Course({ _id, courseName, courseCode, teacher, batch });
  await c.save();
  console.log(`   ✅ Course: ${courseName} (${courseCode})`);
  return c;
}

async function main() {
  await mongoose.connect(MONGO_URI);
  console.log("✅  Connected to MongoDB:", mongoose.connection.db.databaseName);

  // ── Batch ─────────────────────────────────────────────────────────────────
  console.log("\n── Batches");
  const batch = await upsertBatch({
    _id: BATCH_ID,
    name: "B.Tech CSE 2024",
    description: "Computer Science Engineering — Batch 2024",
  });

  // ── Courses ───────────────────────────────────────────────────────────────
  console.log("\n── Courses");
  await upsertCourse({ _id: COURSE_MATH, courseName: "Mathematics I", courseCode: "m1", teacher: TEACHER_ID, batch: batch._id });
  await upsertCourse({ _id: COURSE_ODIA, courseName: "Odia Language",  courseCode: "o1", teacher: TEACHER_ID, batch: batch._id });

  // ── Users ─────────────────────────────────────────────────────────────────
  console.log("\n── Users");

  // Admin
  await upsertUser({ _id: ADMIN_ID, name: "Admin", email: "admin@kiit.ac.in",    password: "admin123",   role: "admin" });

  // Teachers
  await upsertUser({ _id: TEACHER_ID,  name: "Rishitosh Kumar", email: "rishi@gmail.com",      password: "123456",     role: "teacher", employeeId: "TCH001", courses: [COURSE_MATH, COURSE_ODIA] });
  await upsertUser({ _id: TEACHER2_ID, name: "Dr. Sharma",      email: "teacher@kiit.ac.in",   password: "teacher123", role: "teacher", employeeId: "TCH002", courses: [] });

  // Students
  await upsertUser({ _id: STUDENT1_ID, name: "Rahul Singh",     email: "rahul@kiit.ac.in",     password: "student123", role: "student", rollNumber: "21CS001", batch: BATCH_ID, courses: [COURSE_MATH, COURSE_ODIA] });
  await upsertUser({ _id: STUDENT2_ID, name: "Dibyakanta",      email: "dibyacharya@gmail.com",password: "student123", role: "student", rollNumber: "21CS002", batch: BATCH_ID, courses: [COURSE_MATH, COURSE_ODIA] });

  const total = await User.countDocuments();
  console.log(`\n── Done. Total users in DB: ${total}`);
  await mongoose.disconnect();
}

main().catch(e => { console.error("❌", e.message); process.exit(1); });
