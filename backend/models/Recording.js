const mongoose = require("mongoose");

const recordingSchema = new mongoose.Schema(
  {
    scheduledClass: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "LCS_ScheduledClass",
      required: true,
    },
    title: { type: String, required: true },
    videoUrl: { type: String, default: "" },         // Final merged video URL (set after merge)
    thumbnailUrl: { type: String, default: "" },
    duration: { type: Number, default: 0 },          // total seconds
    fileSize: { type: Number, default: 0 },          // total bytes
    // Multi-segment support: each 5-min segment is stored here, videoUrl is set on merge
    segments: [{
      segmentIndex: { type: Number },
      videoUrl: { type: String },
      fileSize: { type: Number, default: 0 },
      duration: { type: Number, default: 0 },
      startTime: { type: Date },
      endTime: { type: Date },
      uploadedAt: { type: Date, default: Date.now },
    }],
    status: {
      type: String,
      enum: ["recording", "uploading", "completed", "failed"],
      default: "recording",
    },
    recordingStart: { type: Date },
    recordingEnd: { type: Date },
    isPublished: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// Session lookup and room-based recording queries
recordingSchema.index({ scheduledClass: 1 });

module.exports = mongoose.model("LCS_Recording", recordingSchema);
