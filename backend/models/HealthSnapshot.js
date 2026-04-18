const mongoose = require("mongoose");

/**
 * Time-series health snapshots for 7-day analytics.
 *
 * Every heartbeat (2 min interval) stores a snapshot.
 * 100 devices × 30/hr × 24hr × 30 days ≈ 2.16M docs/month — well within MongoDB limits.
 *
 * TTL index auto-deletes records after 30 days.
 * Compound index on (deviceId, timestamp) enables fast per-device time-range queries.
 */
const healthSnapshotSchema = new mongoose.Schema({
  deviceId: { type: String, required: true, index: true },
  deviceName: { type: String },
  roomNumber: { type: String },

  // ── Hardware Metrics ──────────────────────────────────────────────
  cpu: {
    usagePercent: { type: Number },    // 0-100 (read from /proc/stat)
    temperature: { type: Number },     // °C (read from thermal zone)
  },
  ram: {
    freeGB: { type: Number },
    totalGB: { type: Number },
    usedPercent: { type: Number },     // 0-100
  },
  disk: {
    freeGB: { type: Number },
    totalGB: { type: Number },
    usedPercent: { type: Number },     // 0-100
  },

  // ── Network ───────────────────────────────────────────────────────
  network: {
    wifiSignal: { type: Number },      // dBm (typically -30 to -90)
    ssid: { type: String },
    latencyMs: { type: Number },       // heartbeat round-trip
  },

  // ── Battery ───────────────────────────────────────────────────────
  battery: {
    level: { type: Number },           // 0-100
    charging: { type: Boolean },
  },

  // ── Peripherals ───────────────────────────────────────────────────
  camera: {
    ok: { type: Boolean },
    error: { type: String },
  },
  mic: {
    ok: { type: Boolean },
    error: { type: String },
  },
  screen: {
    ok: { type: Boolean },
    resolution: { type: String },
  },

  // ── Recording Metrics ─────────────────────────────────────────────
  recording: {
    isRecording: { type: Boolean, default: false },
    frameDrops: { type: Number, default: 0 },
    errorCount: { type: Number, default: 0 },
    lastError: { type: String },
    segmentIndex: { type: Number },
    encoderFps: { type: Number },       // actual frames/sec being encoded
    actualBitrate: { type: Number },    // actual bitrate in bps
  },

  // ── Upload Metrics ────────────────────────────────────────────────
  upload: {
    successCount: { type: Number, default: 0 },
    failCount: { type: Number, default: 0 },
    pendingCount: { type: Number, default: 0 },
    lastUploadMs: { type: Number },     // duration of last upload
  },

  // ── Service ───────────────────────────────────────────────────────
  serviceUptime: { type: Number },      // seconds since service start
  appVersionCode: { type: Number },
  appVersionName: { type: String },

  timestamp: { type: Date, default: Date.now },  // indexed via schema.index() below
}, {
  timestamps: false,  // we use our own timestamp field
  collection: "lcs_healthsnapshots",
});

// Compound index for efficient per-device time-range queries
healthSnapshotSchema.index({ deviceId: 1, timestamp: -1 });

// TTL index — auto-delete snapshots older than 30 days
healthSnapshotSchema.index({ timestamp: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

// Index for fleet-wide queries by time range
healthSnapshotSchema.index({ timestamp: -1 });

module.exports = mongoose.model("LCS_HealthSnapshot", healthSnapshotSchema);
