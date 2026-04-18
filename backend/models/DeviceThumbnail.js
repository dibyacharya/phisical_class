const mongoose = require("mongoose");

/**
 * Recording thumbnails/screenshots from Smart TV devices.
 *
 * Devices upload a JPEG screenshot every 5 min during recording.
 * Stored as base64 in MongoDB (each ~20-40KB compressed).
 * Admin portal displays these to verify recording quality remotely.
 *
 * TTL: auto-delete after 3 days (we only need recent screenshots).
 */
const deviceThumbnailSchema = new mongoose.Schema({
  deviceId: { type: String, required: true, index: true },
  recordingId: { type: String },
  imageData: { type: String, required: true },  // base64 JPEG
  imageSize: { type: Number },                  // bytes
  audioLevel: { type: Number },                 // dB RMS level at capture time
  timestamp: { type: Date, default: Date.now },
}, {
  timestamps: false,
  collection: "lcs_devicethumbnails",
});

// Index for recent thumbnails query
deviceThumbnailSchema.index({ deviceId: 1, timestamp: -1 });

// TTL: auto-delete after 3 days
deviceThumbnailSchema.index({ timestamp: 1 }, { expireAfterSeconds: 3 * 24 * 60 * 60 });

module.exports = mongoose.model("LCS_DeviceThumbnail", deviceThumbnailSchema);
