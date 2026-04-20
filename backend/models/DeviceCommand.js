const mongoose = require("mongoose");

/**
 * Remote commands queue for Smart TV devices.
 *
 * Admin sends command → stored in DB → device picks up on next heartbeat →
 * device executes and reports result → command marked "completed"/"failed".
 *
 * Commands are one-shot: each is consumed once by the device.
 */
const deviceCommandSchema = new mongoose.Schema({
  deviceId: { type: String, required: true, index: true },
  command: {
    type: String,
    required: true,
    enum: [
      "reboot",          // Reboot the Android TV device
      "restart_app",     // Force-stop and restart the recorder app
      "clear_storage",   // Delete old recordings to free disk space
      "pull_logs",       // Upload last N lines of logcat to backend
      "capture_screenshot", // Capture and upload a screenshot of current display
      "force_start",     // Force start recording (regardless of schedule)
      "force_stop",      // Force stop recording
      "update_config",   // Update device config (e.g., video bitrate, fps)
      "play_sound",      // Play notification sound at max volume (for testing)
    ],
  },
  params: { type: mongoose.Schema.Types.Mixed }, // command-specific parameters
  status: {
    type: String,
    enum: ["pending", "acknowledged", "completed", "failed"],
    default: "pending",
  },
  result: { type: String },       // result message from device
  issuedBy: { type: String },     // admin user who issued the command
  issuedAt: { type: Date, default: Date.now },
  acknowledgedAt: { type: Date },
  completedAt: { type: Date },
}, {
  timestamps: true,
  collection: "lcs_devicecommands",
});

// Index for device polling: get pending commands for a device
deviceCommandSchema.index({ deviceId: 1, status: 1 });

// TTL: auto-delete completed/failed commands after 7 days
deviceCommandSchema.index({ completedAt: 1 }, { expireAfterSeconds: 7 * 24 * 60 * 60, partialFilterExpression: { status: { $in: ["completed", "failed"] } } });

// Safety net: auto-delete stale pending/acknowledged commands after 24 hours
// (device went offline permanently, or command was never picked up)
deviceCommandSchema.index({ issuedAt: 1 }, { expireAfterSeconds: 24 * 60 * 60, partialFilterExpression: { status: { $in: ["pending", "acknowledged"] } } });

module.exports = mongoose.model("LCS_DeviceCommand", deviceCommandSchema);
