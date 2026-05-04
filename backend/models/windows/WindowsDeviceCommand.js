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
      enum: [
        "start_recording",
        "stop_recording",
        "restart_obs",
        "restart_service",
        "restart_pc",
        "pull_logs",
        "capture_screenshot",
        "update_config",
        "validate_license",
        "clear_recordings",
        "start_live_watch",
        "stop_live_watch",
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
