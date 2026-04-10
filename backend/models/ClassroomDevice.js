const mongoose = require("mongoose");
const crypto = require("crypto");

const healthSchema = new mongoose.Schema({
  camera: {
    ok: { type: Boolean, default: null },
    name: { type: String },
    error: { type: String },
  },
  mic: {
    ok: { type: Boolean, default: null },
    name: { type: String },
    error: { type: String },
  },
  screen: {
    ok: { type: Boolean, default: null },
    resolution: { type: String },
    error: { type: String },
  },
  disk: {
    freeGB: { type: Number },
    totalGB: { type: Number },
    usedPercent: { type: Number },
  },
  cpu: {
    usagePercent: { type: Number },
  },
  ram: {
    freeGB: { type: Number },
    totalGB: { type: Number },
    usedPercent: { type: Number },
  },
  network: {
    wifiSignal: { type: Number },   // dBm (Android) or percent (Windows)
    latencyMs: { type: Number },
    ssid: { type: String },
  },
  battery: {
    level: { type: Number },        // 0-100, Android only
    charging: { type: Boolean },
  },
  recording: {
    frameDrop: { type: Number, default: 0 },
    lastError: { type: String },
    errorCount: { type: Number, default: 0 },
  },
  serviceUptime: { type: Number },  // seconds
  alerts: [{
    type: { type: String, enum: ["camera", "mic", "screen", "disk", "network", "recording", "other"] },
    message: { type: String },
    time: { type: Date, default: Date.now },
  }],
  updatedAt: { type: Date },
}, { _id: false });

const classroomDeviceSchema = new mongoose.Schema(
  {
    deviceId: {
      type: String,
      unique: true,
      default: () => "dev_" + crypto.randomBytes(8).toString("hex"),
    },
    name: { type: String, required: true },
    roomId: { type: String },
    roomName: { type: String },
    roomNumber: { type: String },
    building: { type: String },
    floor: { type: String },
    ipAddress: { type: String },
    deviceType: { type: String, enum: ["pc", "android"], default: "android" },
    deviceModel: { type: String },
    osVersion: { type: String },
    macAddress: { type: String },
    authToken: {
      type: String,
      default: () => crypto.randomBytes(32).toString("hex"),
    },
    isOnline: { type: Boolean, default: false },
    lastHeartbeat: { type: Date },
    isRecording: { type: Boolean, default: false },
    currentMeetingId: { type: String },
    isActive: { type: Boolean, default: true },
    health: { type: healthSchema, default: () => ({}) },
  },
  { timestamps: true }
);

module.exports = mongoose.model("LCS_ClassroomDevice", classroomDeviceSchema);
