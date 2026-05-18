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
    // Device's per-installation auth token. Used by windowsDeviceAuth
    // middleware to validate that incoming heartbeats / commands actually
    // come from a registered device, not an attacker spoofing deviceId.
    //
    // `select: false` (2026-05-15): keeps this field out of admin-portal
    // list/detail responses by default — admins shouldn't see device
    // credentials in their browser network tab. Middleware that needs to
    // verify auth explicitly uses `.select("+authToken")` to fetch it.
    authToken: {
      type: String,
      required: true,
      default: () => crypto.randomBytes(32).toString("hex"),
      select: false,
    },

    name: { type: String, required: true },
    // Location hierarchy — same fields as the Android TV setup wizard so
    // admin portal grouping/listing is identical across platforms.
    campus: { type: String, default: "", index: true },
    block: { type: String, default: "", index: true },
    floor: { type: String, default: "", index: true },
    roomNumber: { type: String, required: true, index: true },
    spaceCode: { type: String, index: true },
    // (2026-05-15 audit: removed `facilityId: { type: ObjectId, ref: "Facility" }`
    // — the Facility model doesn't exist in the codebase and the field had no
    // readers/writers. Dead schema field with a broken populate target. If a
    // facility-grouping feature lands in the future, add a real model + this
    // field together.)

    // Hardware
    hardwareModel: String,        // e.g. "Intel NUC 13 Pro NUC13ANHi5"
    cpuModel: String,             // e.g. "Intel Core i5-13500T"
    osVersion: String,            // e.g. "Windows 11 IoT Enterprise LTSC 2024"
    macAddress: String,
    hardwareFingerprint: String,  // For license binding

    // Hardware inventory — captured by installer's hardware-detect.ps1 at first run.
    // Updated again on every heartbeat if the Mini PC sends a refreshed snapshot
    // (e.g., a new USB camera was plugged in).
    detectedHardware: {
      cameras:       [String],
      microphones:   [String],
      displays: [
        {
          name:        String,
          width:       Number,
          height:      Number,
          refreshRate: Number,
        },
      ],
      monitorCount:  Number,
      cpuModel:      String,
      cpuCores:      Number,
      cpuLogical:    Number,
      gpu:           String,
      ramGB:         Number,
      diskGB:        Number,
      diskFreeGB:    Number,
      hostname:      String,
      hardwareModel: String,
      osCaption:     String,
      osBuild:       String,
      detectedAt:    Date,
    },

    // App version (Windows MSIX)
    appVersionCode: { type: Number, default: 0 },
    appVersionName: { type: String, default: "" },

    // Network
    ipAddress: String,

    // License binding
    licenseKey: { type: String, index: true },
    licenseTier: { type: String, enum: ["professional"], default: "professional" },
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
    // Same LCS_ prefix gotcha as WindowsRecording.scheduledClass — see comment there.
    currentClassId: { type: mongoose.Schema.Types.ObjectId, ref: "LCS_ScheduledClass" },

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
        // v2.3.14 — level-probe classification: "good" | "low" | "none" | "unknown"
        status: String,
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
