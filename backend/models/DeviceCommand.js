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
      "check_update",    // Force immediate OTA update check (skips 2-min heartbeat wait)
      "test_chime",      // Play the recording-start chime so admin can verify audio path (params.kind = start|stop|alert)
      "test_mic",        // Record short PCM sample, return peak/RMS dB + mic label (params.durationMs default 3000)
      "toggle_gl_compositor", // Flip GL compositor feature flag on device (params.enabled = true|false|null for toggle)
      "toggle_software_encoder", // Flip prefs.forceSoftwareEncoder (params.enabled = true|false|null to toggle). Takes effect on NEXT recording.
      "toggle_pip",      // v3.1.11: Flip prefs.disablePip (params.disabled = true|false|null to toggle). Diagnostic kill-switch — when disabled=true, device records screen-only, no camera overlay + no UVC init. Use when the PiP subsystem is crashing the recording service at startRealTimeRecording.
      "toggle_uvc",      // v3.1.12: Flip prefs.useUvcForPip (params.enabled = true|false|null to toggle). When false, PiP uses Camera2 instead of the libuvc native driver. Use on TVs where libuvc SIGSEGV-crashes the recording service.
      "clear_ota_lock",  // v3.1.23: force-reset isUpdating flag + OTA cooldown. Fixes the stuck-OTA state when a crash mid-download leaves isUpdating=true persisted in EncryptedSharedPreferences.
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
