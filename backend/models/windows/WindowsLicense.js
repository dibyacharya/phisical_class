const mongoose = require("mongoose");
const crypto = require("crypto");

/**
 * Windows Edition license. Per-device, per-year subscription.
 * Tier determines feature flags returned to the device on heartbeat.
 */
const windowsLicenseSchema = new mongoose.Schema(
  {
    licenseKey: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },

    tier: {
      type: String,
      enum: ["professional"],
      required: true,
      default: "professional",
    },

    customerName: { type: String, required: true },
    customerEmail: String,
    customerOrg: String,

    issuedAt: { type: Date, default: Date.now },
    activatedAt: Date,
    expiresAt: { type: Date, required: true },

    // Device binding (one license = one device)
    boundDevice: { type: mongoose.Schema.Types.ObjectId, ref: "WindowsDevice" },
    boundDeviceId: String,
    boundAt: Date,
    hardwareFingerprint: String,

    // Feature gates (per tier)
    features: {
      maxRecordingHoursPerDay: Number, // null = unlimited
      maxResolution: { type: String, enum: ["720p", "1080p", "4k"] },
      liveWatchEnabled: { type: Boolean, default: false },
      multiCameraEnabled: { type: Boolean, default: false },
      fourKEnabled: { type: Boolean, default: false },
      customOverlayEnabled: { type: Boolean, default: false },
      cloudUploadEnabled: { type: Boolean, default: true },
      apiAccessEnabled: { type: Boolean, default: false },
      maxConcurrentLiveViewers: { type: Number, default: 0 },
      cloudStorageGB: { type: Number, default: 100 },
    },

    status: {
      type: String,
      enum: ["issued", "active", "expired", "revoked", "suspended"],
      default: "issued",
      index: true,
    },

    lastValidatedAt: Date,

    // Audit
    notes: String,
    issuedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    revokedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    revokedAt: Date,
    revokeReason: String,

    // For volume / billing tracking
    pricePerYearINR: Number,
    pricePerYearUSD: Number,
  },
  {
    timestamps: true,
    collection: "windows_licenses",
  }
);

// Static helper to generate a new license key in WIN-XXXX-XXXX-XXXX-XXXX format
windowsLicenseSchema.statics.generateKey = function () {
  // base32 alphabet without ambiguous chars (no I, O, 0, 1)
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.randomBytes(16);
  const groups = [];
  for (let g = 0; g < 4; g++) {
    let group = "";
    for (let i = 0; i < 4; i++) {
      group += alphabet[bytes[g * 4 + i] % alphabet.length];
    }
    groups.push(group);
  }
  return `WIN-${groups.join("-")}`;
};

// Static helper to apply tier-default features.
// Only one tier (professional) is offered today: 1080p + live-watch + cloud upload.
// Other tiers were dropped to simplify the catalogue; reintroduce here when needed.
windowsLicenseSchema.statics.featuresForTier = function (_tier) {
  return {
    maxRecordingHoursPerDay: 12,
    maxResolution: "1080p",
    liveWatchEnabled: true,
    multiCameraEnabled: false,
    fourKEnabled: false,
    customOverlayEnabled: false,
    cloudUploadEnabled: true,
    apiAccessEnabled: true,
    maxConcurrentLiveViewers: 5,
    cloudStorageGB: 500,
  };
};

module.exports = mongoose.model("WindowsLicense", windowsLicenseSchema);
