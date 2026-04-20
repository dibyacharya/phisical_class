/**
 * cleanTrialData.js — Wipe transactional data for fresh 7-day production trial
 *
 * PRESERVES (structure + access):
 *   - lcs_users             (admin + teachers + students for login)
 *   - lcs_rooms             (physical KIIT classrooms)
 *   - lcs_classroomdevices  (registered Android APKs — don't force re-setup)
 *   - lcs_batches           (academic structure)
 *   - lcs_courses           (course catalog)
 *   - lcs_licenses          (license keys for device registration)
 *
 * WIPES (seeded test data + any transactional leftover):
 *   - lcs_scheduledclasses  (22 seeded demo classes)
 *   - lcs_recordings        (19 seeded demo recordings)
 *   - lcs_attendances       (demo QR scans)
 *
 * Run:
 *   MONGODB_URI="mongodb+srv://..." node scripts/cleanTrialData.js
 */
require("dotenv").config();
const mongoose = require("mongoose");

const MONGO_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/lecture_capture";

// Collections to wipe
const WIPE_COLLECTIONS = [
  "lcs_scheduledclasses",
  "lcs_recordings",
  "lcs_attendances",
];

// Collections to preserve (listed for audit — script never touches these)
const KEEP_COLLECTIONS = [
  "lcs_users",
  "lcs_rooms",
  "lcs_classroomdevices",
  "lcs_batches",
  "lcs_courses",
  "lcs_licenses",
];

async function main() {
  console.log("──────────────────────────────────────────────────────");
  console.log("  LectureLens — Trial Data Cleanup");
  console.log("──────────────────────────────────────────────────────");
  console.log(`  Target DB: ${MONGO_URI.replace(/:[^:@]+@/, ":***@")}`);
  console.log("──────────────────────────────────────────────────────");

  await mongoose.connect(MONGO_URI);
  const db = mongoose.connection.db;

  // Snapshot: counts BEFORE
  console.log("\n  📊 Current document counts:");
  const before = {};
  for (const c of [...WIPE_COLLECTIONS, ...KEEP_COLLECTIONS]) {
    try {
      before[c] = await db.collection(c).countDocuments();
    } catch {
      before[c] = 0;
    }
    const tag = WIPE_COLLECTIONS.includes(c) ? "WIPE " : "KEEP ";
    console.log(`    ${tag}  ${c.padEnd(26)}  ${before[c]}`);
  }

  // Wipe
  console.log("\n  🧹 Wiping transactional collections...");
  const results = {};
  for (const c of WIPE_COLLECTIONS) {
    try {
      const r = await db.collection(c).deleteMany({});
      results[c] = r.deletedCount;
      console.log(`    ✓  ${c.padEnd(26)}  deleted ${r.deletedCount}`);
    } catch (e) {
      console.log(`    ✗  ${c.padEnd(26)}  ERROR: ${e.message}`);
      results[c] = -1;
    }
  }

  // Verify: counts AFTER
  console.log("\n  📊 Post-cleanup counts:");
  for (const c of [...WIPE_COLLECTIONS, ...KEEP_COLLECTIONS]) {
    let n = 0;
    try {
      n = await db.collection(c).countDocuments();
    } catch {}
    const tag = WIPE_COLLECTIONS.includes(c) ? "WIPED" : "KEPT ";
    const delta = before[c] - n;
    const note = delta > 0 ? ` (-${delta})` : "";
    console.log(`    ${tag}  ${c.padEnd(26)}  ${n}${note}`);
  }

  console.log("\n──────────────────────────────────────────────────────");
  console.log("  ✅ Cleanup complete — DB is ready for 7-day trial");
  console.log("──────────────────────────────────────────────────────");

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("❌ Cleanup failed:", err);
  process.exit(1);
});
