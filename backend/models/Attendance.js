const mongoose = require("mongoose");

const attendeeSchema = new mongoose.Schema({
  student: { type: mongoose.Schema.Types.ObjectId, ref: "LCS_User", required: true },
  name: { type: String },
  rollNumber: { type: String },
  scannedAt: { type: Date, default: Date.now },
  verified: { type: Boolean, default: true },
});

const attendanceSchema = new mongoose.Schema(
  {
    scheduledClass: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "LCS_ScheduledClass",
      required: true,
    },
    qrSecret: { type: String, required: true },
    attendees: [attendeeSchema],
  },
  { timestamps: true }
);

// One attendance record per class
attendanceSchema.index({ scheduledClass: 1 }, { unique: true });

module.exports = mongoose.model("LCS_Attendance", attendanceSchema);
