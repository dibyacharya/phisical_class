const mongoose = require("mongoose");

const scheduledClassSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    course: { type: mongoose.Schema.Types.ObjectId, ref: "LCS_Course", required: true },
    teacher: { type: mongoose.Schema.Types.ObjectId, ref: "LCS_User", required: true },
    // Keep string fields for backward compat (populated from course on create)
    courseName: { type: String },
    courseCode: { type: String },
    teacherName: { type: String },
    roomNumber: { type: String, required: true },
    date: { type: Date, required: true },
    startTime: { type: String, required: true },
    endTime: { type: String, required: true },
    status: {
      type: String,
      enum: ["scheduled", "live", "completed", "cancelled"],
      default: "scheduled",
    },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "LCS_User" },
  },
  { timestamps: true }
);

// Heartbeat + room schedule queries filter by roomNumber + date every 2 min per device
scheduledClassSchema.index({ roomNumber: 1, date: -1 });

// Course-based lookups (teacher schedule, course recordings)
scheduledClassSchema.index({ course: 1, date: -1 });

module.exports = mongoose.model("LCS_ScheduledClass", scheduledClassSchema);
