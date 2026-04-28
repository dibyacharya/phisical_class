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
    // v3.3.32 — videoPipeline is now ONE of: "livekit" (recording
    // active via WebRTC) or "none" (idle, or LiveKit start failed —
    // see lastError for cause). "gl_compositor" / "legacy_direct"
    // labels were leftover from v2.x's MediaCodec + GL paths, removed
    // from the recording flow in v3.3.26 and stripped from the
    // heartbeat in v3.3.32.
    videoPipeline: { type: String },           // "livekit" | "none"
    // Legacy GL compositor fields kept for back-compat with pre-v3.3.32
    // heartbeats already persisted in this collection. New heartbeats
    // do not populate them. Will be removed in a future migration.
    glCompositorEnabled: { type: Boolean },
    glCameraPiP: { type: Boolean },
    lastGlInitError: { type: String },
    // v3.0.1: UVC direct-USB camera driver lifecycle state. Surfaces
    // which stage the USB camera init reached so we can tell from the
    // portal whether the library never attached, got USB permission
    // denied, opened but no surface, etc. — all without needing on-device
    // log upload which is blocked on some OEM ROMs.
    uvcState: { type: String },                // e.g. "PREVIEW_ACTIVE" / "ATTACHED_vid1ff7_pid0f32"
    uvcUsing: { type: Boolean },               // true = UVC path is active
    uvcLastError: { type: String },
    // v3.1.5: frame-arrival counters. uvcFrameCount increments every time a
    // raw YUV frame arrives from the USB device; uvcMsSinceLastFrame is the
    // time since the most recent one. Together these disambiguate "USB
    // stream dead but library says PREVIEW_ACTIVE" from "USB stream fine but
    // render pipeline broken". See UsbCameraDriver.kt for the diagnostic
    // matrix. Device sends as Number; store as Number here.
    uvcFrameCount: { type: Number },
    uvcMsSinceLastFrame: { type: Number },
    // v3.1.6: once case (b) "frames=0 but PREVIEW_ACTIVE" was confirmed the
    // Apr 23 test, the next diagnostic layer is "what sizes does this camera
    // actually advertise to UVC?" and "which one did we pick for openCamera()?".
    // supportedSizes is a short comma-separated list like "640x480@30/t4,
    // 1280x720@30/t4" (t is UVC format type); selectedSize is the single
    // tuple we chose. These make it obvious when the library's no-arg
    // default resolved to a format the camera doesn't actually stream.
    uvcSupportedSizes: { type: String },
    uvcSelectedSize: { type: String },
    // v3.1.8 zero-touch recovery diagnostics. projectionActive is the single
    // field that tells an admin "is this device actually able to record RIGHT
    // NOW?" — the difference between "heartbeat green, schedule green, but
    // recording never starts" and "everything is fine." accessibilityEnabled
    // + isDeviceOwner together reveal whether the next power-cycle will
    // self-heal or whether a human has to visit the room.
    projectionActive: { type: Boolean },
    accessibilityEnabled: { type: Boolean },
    isDeviceOwner: { type: Boolean },
    // v3.1.11 PiP kill-switch state. When true, admin has disabled the
    // camera overlay via `toggle_pip` remote command — recordings are
    // screen-only on this device. Surfaces so the portal can show a
    // clear "PiP off (diagnostic mode)" badge instead of looking like
    // the device is silently broken.
    pipDisabled: { type: Boolean },
    // v3.1.12 — UVC driver preference. True means PiP tries libuvc native
    // driver first (preferred for 55TR3DK-style TVs where Camera2 HAL
    // silently drops USB frames). False means Camera2 only. Useful
    // diagnostic switch for TVs where libuvc crashes the service.
    useUvcForPip: { type: Boolean },
    // v3.1.18 — stack trace from the most recent process-level crash (as
    // captured by Thread.setDefaultUncaughtExceptionHandler in the prior
    // process). Delivered exactly once per crash in the first heartbeat
    // after a new process boots. Gives admin a direct "why did the
    // service die" answer without having to SSH/ADB into the TV.
    lastCrashReport: { type: String },
    // v3.2.0 — LiveKit pipeline status. When useLiveKitPipeline=true on
    // the device AND backend has LIVEKIT_ENABLED=true, the next recording
    // bypasses MediaCodec/segments and publishes via WebRTC instead. The
    // connection state mirrors LiveKit Room.State ("DISCONNECTED",
    // "CONNECTING", "CONNECTED", "RECONNECTING") and lets the admin
    // portal show "TV connected to room" without a separate channel.
    livekitEnabled: { type: Boolean },
    livekitConnectionState: { type: String },
    // v3.3.31 — verified outcome of the USB-mic → WebRTC AudioRecord
    // binding loop in LiveKitPipeline.bindUsbMicToLiveKit. true =
    // AudioRecord.routedDevice matches the USB mic after the verify
    // loop. false (with hardware.hasUsbMic=true) = HAL ignored every
    // bind path and the recording will be silent. Lets the admin
    // portal warn BEFORE recording finishes that audio won't be
    // captured. Without this declaration, Mongoose strict mode
    // strips the field on save and the heartbeat field is invisible.
    usbMicBoundOk: { type: Boolean },
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
