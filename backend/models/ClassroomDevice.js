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
    // Phase 1-3 telemetry — sent by v2.3+ Android. Declared here so
    // Mongoose doesn't strip them on save (otherwise fleet-overview /
    // Diagnostics panel show "None" for a healthy device).
    isRecording: { type: Boolean },
    segmentIndex: { type: Number },
    audioLevelDb: { type: Number },
    micLabel: { type: String },
    chimeEngineOk: { type: Boolean },
    ttsEngineOk: { type: Boolean },
    videoPipeline: { type: String },           // "gl_compositor" | "legacy_direct"
    glCompositorEnabled: { type: Boolean },
    glCameraPiP: { type: Boolean },
    lastGlInitError: { type: String },
  },
  serviceUptime: { type: Number },  // seconds
  alerts: [{
    type: { type: String, enum: ["camera", "mic", "screen", "disk", "network", "recording", "other"] },
    message: { type: String },
    time: { type: Date, default: Date.now },
  }],
  // v2.6.0+: three-lens hardware inventory from on-device UsbHardwareInspector.
  // Declared so Mongoose doesn't strip the nested fields on save (otherwise
  // the Hardware Inventory panel in admin portal shows empty for healthy
  // devices). Leaving all values Mixed because we serialise dynamic lists
  // — strict typing would force a schema change every time Android adds a
  // new hardware lens.
  hardware: {
    hasUsbCamera: { type: Boolean },
    hasUsbMic: { type: Boolean },
    hasUsableCamera: { type: Boolean },
    cameraDetectedVia: { type: String },    // "camera2_external" | "camera2_internal" | "usb_only" | "none"
    cameras: { type: mongoose.Schema.Types.Mixed },
    audioInputs: { type: mongoose.Schema.Types.Mixed },
    usbDevices: { type: mongoose.Schema.Types.Mixed },
  },
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
    spaceCode: { type: String, uppercase: true, trim: true },  // auto-generated e.g. C25-BA-F3-R101
    roomId: { type: String },
    roomName: { type: String },
    roomNumber: { type: String },
    floor: { type: String },
    ipAddress: { type: String },
    deviceType: { type: String, enum: ["pc", "android"], default: "android" },
    deviceModel: { type: String },
    osVersion: { type: String },
    macAddress: { type: String },
    appVersionName: { type: String },
    appVersionCode: { type: Number },
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
