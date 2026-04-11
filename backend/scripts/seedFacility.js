/**
 * seedFacility.js
 * Fixes DB mismatches and seeds realistic Facility data for demo.
 *
 * Run: node scripts/seedFacility.js
 */
require("dotenv").config();
const mongoose = require("mongoose");
const crypto = require("crypto");

const MONGO_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/lecture_capture";

// ── Inline schemas (avoid import issues) ─────────────────────────────────────
const Room = mongoose.model("LCS_Room", new mongoose.Schema({
  campus: String, block: String, floor: String,
  roomNumber: String, roomName: String,
  spaceType: { type: String, default: "room" },
  capacity: { type: Number, default: 0 },
  isActive: { type: Boolean, default: true },
}, { timestamps: true, collection: "lcs_rooms" }));

const Device = mongoose.model("LCS_ClassroomDevice", new mongoose.Schema({
  deviceId:    { type: String, default: () => "dev_" + crypto.randomBytes(8).toString("hex") },
  name:        String,
  roomId:      String,
  roomName:    String,
  roomNumber:  String,
  building:    String,   // campus/building from device
  floor:       String,
  campus:      String,   // explicit campus field (new devices)
  block:       String,   // explicit block field (new devices)
  ipAddress:   String,
  deviceType:  { type: String, default: "android" },
  deviceModel: String,
  osVersion:   String,
  macAddress:  String,
  authToken:   { type: String, default: () => crypto.randomBytes(32).toString("hex") },
  isOnline:    { type: Boolean, default: false },
  lastHeartbeat: Date,
  isRecording: { type: Boolean, default: false },
  isActive:    { type: Boolean, default: true },
  health:      mongoose.Schema.Types.Mixed,
}, { timestamps: true, collection: "lcs_classroomdevices" }));

// ── Sample data ───────────────────────────────────────────────────────────────
const CAMPUS = "KIIT Campus";

const ROOMS_SEED = [
  // Block 14 (existing → update/fix)
  { campus: CAMPUS, block: "Block 14", floor: "Ground Floor", roomNumber: "G-101", roomName: "Lecture Hall A", spaceType: "room",            capacity: 80  },
  { campus: CAMPUS, block: "Block 14", floor: "Ground Floor", roomNumber: "G-102", roomName: "Lecture Hall B", spaceType: "room",            capacity: 80  },
  { campus: CAMPUS, block: "Block 14", floor: "1st Floor",    roomNumber: "101",   roomName: "Smart Class Room 1", spaceType: "room",         capacity: 60  },
  { campus: CAMPUS, block: "Block 14", floor: "1st Floor",    roomNumber: "102",   roomName: "Smart Class Room 2", spaceType: "room",         capacity: 60  },
  { campus: CAMPUS, block: "Block 14", floor: "2nd Floor",    roomNumber: "202",   roomName: "Smart Class Room 3", spaceType: "room",         capacity: 60  },
  // Block 15
  { campus: CAMPUS, block: "Block 15", floor: "Ground Floor", roomNumber: "CF-01", roomName: "Main Conference Hall", spaceType: "conference_hall", capacity: 120 },
  { campus: CAMPUS, block: "Block 15", floor: "1st Floor",    roomNumber: "201",   roomName: "Research Lab",         spaceType: "room",            capacity: 40  },
  // Tech Block
  { campus: CAMPUS, block: "Tech Block", floor: "Ground Floor", roomNumber: "AUD-1", roomName: "Central Auditorium",  spaceType: "auditorium",  capacity: 500 },
  { campus: CAMPUS, block: "Tech Block", floor: "1st Floor",    roomNumber: "T-101", roomName: "Innovation Lab",       spaceType: "room",        capacity: 50  },
];

// Devices — each linked to a room by roomNumber
const DEVICES_SEED = [
  {
    roomNumber: "202",
    name:        "Smart TV - Room 202",
    roomName:    "Smart Class Room 3",
    building:    CAMPUS,
    block:       "Block 14",
    floor:       "2nd Floor",
    deviceModel: "Samsung SM-T505",
    osVersion:   "Android 12",
    macAddress:  "AA:BB:CC:11:22:33",
    isOnline:    true,
    isRecording: true,
    health: {
      camera: { ok: true, name: "Lumens VC-TR1", error: null },
      mic:    { ok: false, name: "Echo Speakerphone", error: "Mic not found in DirectShow devices" },
      screen: { ok: true, resolution: "1920x1080", error: null },
      disk:   { freeGB: 23.5, totalGB: 120, usedPercent: 80 },
      cpu:    { usagePercent: 34 },
      ram:    { freeGB: 1.2, totalGB: 4, usedPercent: 70 },
      network: { wifiSignal: 72, latencyMs: 45, ssid: "KIIT-Campus-14" },
      battery: { level: null, charging: null },
      recording: { frameDrop: 12, lastError: null, errorCount: 0 },
      serviceUptime: 7320,
      alerts: [{ type: "mic", message: "Mic not found in DirectShow devices", time: new Date() }],
      updatedAt: new Date(),
    },
  },
  {
    roomNumber: "101",
    name:        "Smart TV - Room 101",
    roomName:    "Smart Class Room 1",
    building:    CAMPUS,
    block:       "Block 14",
    floor:       "1st Floor",
    deviceModel: "Samsung SM-T870",
    osVersion:   "Android 13",
    macAddress:  "AA:BB:CC:44:55:66",
    isOnline:    true,
    isRecording: false,
    health: {
      camera: { ok: true,  name: "Built-in Camera", error: null },
      mic:    { ok: true,  name: "Built-in Mic",    error: null },
      screen: { ok: true,  resolution: "1920x1080", error: null },
      disk:   { freeGB: 85, totalGB: 120, usedPercent: 29 },
      cpu:    { usagePercent: 12 },
      ram:    { freeGB: 2.8, totalGB: 4, usedPercent: 30 },
      network: { wifiSignal: 88, latencyMs: 22, ssid: "KIIT-Campus-14" },
      battery: { level: 94, charging: true },
      recording: { frameDrop: 0, lastError: null, errorCount: 0 },
      serviceUptime: 14400,
      alerts: [],
      updatedAt: new Date(),
    },
  },
  {
    roomNumber: "102",
    name:        "Smart TV - Room 102",
    roomName:    "Smart Class Room 2",
    building:    CAMPUS,
    block:       "Block 14",
    floor:       "1st Floor",
    deviceModel: "Lenovo Tab P12 Pro",
    osVersion:   "Android 13",
    macAddress:  "AA:BB:CC:77:88:99",
    isOnline:    false,
    isRecording: false,
    health: {
      camera: { ok: null },
      mic:    { ok: null },
      screen: { ok: null },
      recording: { frameDrop: 0, errorCount: 0 },
      alerts: [],
    },
  },
  {
    roomNumber: "CF-01",
    name:        "Smart TV - Conference Hall",
    roomName:    "Main Conference Hall",
    building:    CAMPUS,
    block:       "Block 15",
    floor:       "Ground Floor",
    deviceModel: "Samsung Smart TV 75\"",
    osVersion:   "Tizen 6.5",
    macAddress:  "BB:CC:DD:11:22:33",
    isOnline:    true,
    isRecording: false,
    health: {
      camera: { ok: true,  name: "4K PTZ Camera", error: null },
      mic:    { ok: true,  name: "Jabra Speak 750", error: null },
      screen: { ok: true,  resolution: "3840x2160", error: null },
      disk:   { freeGB: 180, totalGB: 256, usedPercent: 30 },
      cpu:    { usagePercent: 8 },
      ram:    { freeGB: 5.5, totalGB: 8, usedPercent: 31 },
      network: { wifiSignal: 95, latencyMs: 15, ssid: "KIIT-Campus-15" },
      battery: { level: null, charging: null },
      recording: { frameDrop: 0, lastError: null, errorCount: 0 },
      serviceUptime: 28800,
      alerts: [],
      updatedAt: new Date(),
    },
  },
  {
    roomNumber: "T-101",
    name:        "Smart TV - Innovation Lab",
    roomName:    "Innovation Lab",
    building:    CAMPUS,
    block:       "Tech Block",
    floor:       "1st Floor",
    deviceModel: "OnePlus Pad Pro",
    osVersion:   "Android 14",
    macAddress:  "CC:DD:EE:11:22:33",
    isOnline:    true,
    isRecording: false,
    health: {
      camera: { ok: true,  name: "LogiTech Brio 4K", error: null },
      mic:    { ok: true,  name: "Blue Yeti USB Mic", error: null },
      screen: { ok: true,  resolution: "2560x1440", error: null },
      disk:   { freeGB: 60, totalGB: 128, usedPercent: 53 },
      cpu:    { usagePercent: 22 },
      ram:    { freeGB: 3.5, totalGB: 8,  usedPercent: 56 },
      network: { wifiSignal: 91, latencyMs: 18, ssid: "KIIT-TechBlock" },
      battery: { level: 78, charging: false },
      recording: { frameDrop: 2, lastError: null, errorCount: 0 },
      serviceUptime: 5400,
      alerts: [],
      updatedAt: new Date(),
    },
  },
];

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  await mongoose.connect(MONGO_URI);
  console.log("✅  Connected to MongoDB:", MONGO_URI);

  // ── 1. Delete orphan devices (no roomNumber) ──────────────────────────────
  const orphanResult = await Device.deleteMany({ roomNumber: { $exists: false } });
  console.log(`🗑   Deleted ${orphanResult.deletedCount} orphan devices (no roomNumber)`);

  // ── 2. Delete old test/QA rooms & their devices ───────────────────────────
  const oldCampuses = ["Test Campus", "QA Campus", "Campus 14", "Default Campus"];
  for (const c of oldCampuses) {
    const r = await Room.deleteMany({ campus: c });
    const d = await Device.deleteMany({ building: c });
    if (r.deletedCount || d.deletedCount)
      console.log(`🗑   Cleared old campus "${c}": ${r.deletedCount} rooms, ${d.deletedCount} devices`);
  }

  // ── 3. Upsert rooms ───────────────────────────────────────────────────────
  for (const r of ROOMS_SEED) {
    await Room.findOneAndUpdate(
      { campus: r.campus, block: r.block, roomNumber: r.roomNumber },
      { $set: { ...r, isActive: true, updatedAt: new Date() }, $setOnInsert: { createdAt: new Date() } },
      { upsert: true, new: true }
    );
    console.log(`🏫  Room upserted: ${r.campus} > ${r.block} > ${r.roomNumber} (${r.roomName})`);
  }

  // ── 4. Upsert devices ─────────────────────────────────────────────────────
  for (const d of DEVICES_SEED) {
    const existing = await Device.findOne({ macAddress: d.macAddress });
    if (existing) {
      Object.assign(existing, d, { isActive: true, updatedAt: new Date() });
      await existing.save();
      console.log(`📱  Device updated:  ${d.name} (${d.macAddress})`);
    } else {
      await Device.create({ ...d, isActive: true });
      console.log(`📱  Device created:  ${d.name} (${d.macAddress})`);
    }
  }

  // ── 5. Summary ────────────────────────────────────────────────────────────
  const totalRooms   = await Room.countDocuments({ isActive: true });
  const totalDevices = await Device.countDocuments({ isActive: true });
  const online       = await Device.countDocuments({ isActive: true, isOnline: true });
  const recording    = await Device.countDocuments({ isActive: true, isRecording: true });

  console.log("\n── Final State ──────────────────────────────────────────────");
  console.log(`   Rooms (active):   ${totalRooms}`);
  console.log(`   Devices (active): ${totalDevices}`);
  console.log(`   Online devices:   ${online}`);
  console.log(`   Recording now:    ${recording}`);
  console.log("─────────────────────────────────────────────────────────────");
  console.log("✅  DB seeded successfully. Restart backend & refresh admin portal.");

  await mongoose.disconnect();
}

main().catch((e) => { console.error("❌", e.message); process.exit(1); });
