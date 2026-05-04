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
      ref: "ScheduledClass",
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
    mergedVideoUrl: String,
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
