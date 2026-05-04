const mongoose = require("mongoose");
const crypto = require("crypto");

/**
 * Windows Mini PC fleet member.
 * Completely separate from lcs_classroomdevices (Android TVs) — both can coexist
 * in the same DB, both can serve the same room. Class scheduling is platform-agnostic.
 */
const windowsDeviceSchema = new mongoose.Schema(
  {
    deviceId: {
      type: String,
      required: true,
      unique: true,
      index: true,
      default: () => `win_${crypto.randomBytes(8).toString("hex")}`,
    },
    authToken: {
      type: String,
      required: true,
      default: () => crypto.randomBytes(32).toString("hex"),
    },

    name: { type: String, required: true },
    roomNumber: { type: String, required: true, index: true },
    spaceCode: { type: String },
    facilityId: { type: mongoose.Schema.Types.ObjectId, ref: "Facility" },

    // Hardware
    hardwareModel: String,        // e.g. "Intel NUC 13 Pro NUC13ANHi5"
    cpuModel: String,             // e.g. "Intel Core i5-13500T"
    osVersion: String,            // e.g. "Windows 11 IoT Enterprise LTSC 2024"
    macAddress: String,
    hardwareFingerprint: String,  // For license binding

    // App version (Windows MSIX)
    appVersionCode: { type: Number, default: 0 },
    appVersionName: { type: String, default: "" },

    // Network
    ipAddress: String,

    // License binding
    licenseKey: { type: String, index: true },
    licenseTier: { type: String, enum: ["starter", "professional", "enterprise"] },
    licenseExpiresAt: Date,
    licenseStatus: {
      type: String,
      enum: ["unlicensed", "active", "expired", "grace", "suspended", "revoked"],
      default: "unlicensed",
    },

    // Heartbeat / state
    lastHeartbeat: Date,
    isOnline: { type: Boolean, default: false },
    isRecording: { type: Boolean, default: false },
    currentClassId: { type: mongoose.Schema.Types.ObjectId, ref: "ScheduledClass" },

    // Health snapshot (latest from heartbeat)
    health: {
      cpu: {
        usagePercent: Number,
        temperature: Number,
        peak60s: Number,
        peak5min: Number,
      },
      ram: {
        freeGB: Number,
        totalGB: Number,
        usedPercent: Number,
      },
      disk: {
        freeGB: Number,
        totalGB: Number,
        usedPercent: Number,
      },
      network: {
        ipAddress: String,
        macAddress: String,
        interfaceType: String,
        linkSpeedMbps: Number,
        latencyMs: Number,
      },
      camera: {
        ok: Boolean,
        name: String,
        error: String,
        detectedVia: String,
      },
      mic: {
        ok: Boolean,
        name: String,
        error: String,
        audioLevelDbfs: Number,
      },
      screen: {
        ok: Boolean,
        resolution: String,
      },
      recording: {
        isRecording: Boolean,
        currentClassId: String,
        chunksWritten: Number,
        chunksUploaded: Number,
        chunksPending: Number,
        frameDrops: Number,
        lastError: String,
      },
      serviceUptimeSeconds: Number,
      updatedAt: Date,
    },

    // Recent alerts (latest 30, capped)
    alerts: [
      {
        type: String,
        message: String,
        time: Date,
      },
    ],

    isActive: { type: Boolean, default: true },
  },
  {
    timestamps: true,
    collection: "windows_devices",
  }
);

// Cap alerts array at 30 most recent
windowsDeviceSchema.pre("save", function () {
  if (this.alerts && this.alerts.length > 30) {
    this.alerts = this.alerts.slice(-30);
  }
});

module.exports = mongoose.model("WindowsDevice", windowsDeviceSchema);
