const mongoose = require("mongoose");

/**
 * Remote command queue for Windows devices. Mirrors lcs_devicecommands but
 * with Windows-specific command set.
 */
const windowsDeviceCommandSchema = new mongoose.Schema(
  {
    deviceId: { type: String, required: true, index: true },
    command: {
      type: String,
      required: true,
      // Must stay in sync with the device-side `case` arms in
      // CommandProcessor.cs (Heartbeat/CommandProcessor.cs). When the admin
      // portal queues a command, Mongoose validates against this enum BEFORE
      // creating the document — a missing value here surfaces as a 500 on
      // the issueCommand endpoint with a Mongoose ValidationError.
      //
      // v2.1.2 — added the five admin commands that the device handler had
      // been listening for but the schema rejected:
      //   restart_recorder, force_record, run_disk_cleanup,
      //   disable_live_watch, enable_live_watch.
      enum: [
        "start_recording",
        "stop_recording",
        "restart_recorder",
        "restart_obs",          // legacy alias for restart_recorder (kept for back-compat)
        "restart_service",
        "restart_pc",
        "pull_logs",
        "capture_screenshot",
        "update_config",
        "validate_license",
        "clear_recordings",
        "force_record",
        "run_disk_cleanup",
        "start_live_watch",
        "stop_live_watch",
        "disable_live_watch",
        "enable_live_watch",
      ],
    },
    params: { type: mongoose.Schema.Types.Mixed },
    status: {
      type: String,
      enum: ["pending", "acknowledged", "completed", "failed"],
      default: "pending",
    },
    result: { type: String },
    issuedBy: { type: String },
    issuedAt: { type: Date, default: Date.now },
    acknowledgedAt: Date,
    completedAt: Date,
  },
  {
    timestamps: true,
    collection: "windows_devicecommands",
  }
);

windowsDeviceCommandSchema.index({ deviceId: 1, status: 1 });
windowsDeviceCommandSchema.index(
  { completedAt: 1 },
  { expireAfterSeconds: 7 * 24 * 60 * 60, partialFilterExpression: { status: { $in: ["completed", "failed"] } } }
);
windowsDeviceCommandSchema.index(
  { issuedAt: 1 },
  { expireAfterSeconds: 24 * 60 * 60, partialFilterExpression: { status: { $in: ["pending", "acknowledged"] } } }
);

module.exports = mongoose.model("WindowsDeviceCommand", windowsDeviceCommandSchema);
