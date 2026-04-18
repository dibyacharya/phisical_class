const mongoose = require("mongoose");

/**
 * Remote logcat captures from Smart TV devices.
 *
 * When admin requests "pull_logs", device uploads last 500 lines of logcat.
 * Useful for debugging issues without physically visiting the TV.
 *
 * TTL: auto-delete after 7 days.
 */
const deviceLogSchema = new mongoose.Schema({
  deviceId: { type: String, required: true, index: true },
  deviceName: { type: String },
  logText: { type: String, required: true },   // raw logcat text
  lineCount: { type: Number },
  trigger: { type: String, enum: ["manual", "crash", "error"], default: "manual" },
  timestamp: { type: Date, default: Date.now },
}, {
  timestamps: false,
  collection: "lcs_devicelogs",
});

deviceLogSchema.index({ deviceId: 1, timestamp: -1 });

// TTL: auto-delete after 7 days
deviceLogSchema.index({ timestamp: 1 }, { expireAfterSeconds: 7 * 24 * 60 * 60 });

module.exports = mongoose.model("LCS_DeviceLog", deviceLogSchema);
