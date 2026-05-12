const mongoose = require("mongoose");

/**
 * Windows recording — separate collection from lcs_recordings (Android).
 * Schema reflects hybrid architecture: chunks uploaded to Azure Blob,
 * then merged server-side into final MP4.
 */
const windowsRecordingSchema = new mongoose.Schema(
  {
    scheduledClass: {
      type: mongoose.Schema.Types.ObjectId,
      // ScheduledClass model is registered under the project-wide LCS_ prefix
      // (see models/ScheduledClass.js: mongoose.model("LCS_ScheduledClass",
      // ...)). Without the prefix, Mongoose.populate throws "Schema hasn't
      // been registered for model 'ScheduledClass'" and the recordings list
      // endpoint returns 500.
      ref: "LCS_ScheduledClass",
      required: true,
      index: true,
    },
    windowsDevice: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "WindowsDevice",
      required: true,
    },

    pipeline: { type: String, default: "windows-hybrid" },

    title: String,
    roomNumber: { type: String, index: true },

    recordingStart: { type: Date, required: true },
    recordingEnd: Date,
    duration: Number, // seconds

    // Local-first chunks (each chunk uploaded independently)
    chunks: [
      {
        seq: Number,
        filename: String,
        sizeBytes: Number,
        durationMs: Number,
        azureBlobUrl: String,
        uploadedAt: Date,
        uploadStatus: {
          type: String,
          enum: ["pending", "uploading", "uploaded", "failed"],
          default: "pending",
        },
        uploadAttempts: { type: Number, default: 0 },
      },
    ],

    // Final merged file
    //
    // v2.2.0 — Migrated from Azure Blob to Cloudflare R2:
    //   - r2ObjectKey   : the bucket-relative path the device uploaded to
    //   - r2PublicUrl   : full https URL (pub-<hash>.r2.dev/<key>) the
    //                     admin portal player streams from directly
    //   - r2Bucket      : bucket name (so future migrations to other
    //                     buckets / regions don't break old rows)
    //   - mergedVideoUrl: KEPT for back-compat with the v2.1.x Azure-era
    //                     rows. Player chooses r2PublicUrl when present,
    //                     falls back to mergedVideoUrl otherwise.
    r2ObjectKey: String,
    r2PublicUrl: String,
    r2Bucket: String,
    mergedVideoUrl: String,         // legacy Azure URL (deprecated; nullable)
    mergedFileSize: { type: Number, default: 0 },
    mergeStatus: {
      type: String,
      enum: ["pending", "merging", "ready", "failed"],
      default: "pending",
    },
    mergeError: String,
    mergedAt: Date,

    // Live-watch sessions during this recording
    liveWatchSessions: [
      {
        startedAt: Date,
        endedAt: Date,
        viewerCount: Number,
        livekitRoomName: String,
      },
    ],

    status: {
      type: String,
      enum: ["recording", "uploading", "merging", "completed", "failed"],
      default: "recording",
      index: true,
    },
    isPublished: { type: Boolean, default: false },

    // For unified Recordings page (so we can show alongside Android recordings)
    fileSize: Number, // alias to mergedFileSize for unified view
  },
  {
    timestamps: true,
    collection: "windows_recordings",
  }
);

// Auto-derive fileSize from mergedFileSize for unified queries
windowsRecordingSchema.pre("save", function () {
  if (this.mergedFileSize) this.fileSize = this.mergedFileSize;
});

module.exports = mongoose.model("WindowsRecording", windowsRecordingSchema);
