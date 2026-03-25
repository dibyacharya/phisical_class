const mongoose = require("mongoose");

const recordingSchema = new mongoose.Schema(
  {
    scheduledClass: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "LCS_ScheduledClass",
      required: true,
    },
    title: { type: String, required: true },
    videoUrl: { type: String, default: "" },
    thumbnailUrl: { type: String, default: "" },
    duration: { type: Number, default: 0 }, // seconds
    fileSize: { type: Number, default: 0 }, // bytes
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

module.exports = mongoose.model("LCS_Recording", recordingSchema);
