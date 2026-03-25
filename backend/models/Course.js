const mongoose = require("mongoose");

const courseSchema = new mongoose.Schema(
  {
    courseName: { type: String, required: true },
    courseCode: { type: String, required: true },
    batch: { type: mongoose.Schema.Types.ObjectId, ref: "LCS_Batch", required: true },
    teacher: { type: mongoose.Schema.Types.ObjectId, ref: "LCS_User" },
  },
  { timestamps: true }
);

courseSchema.index({ courseCode: 1, batch: 1 }, { unique: true });

module.exports = mongoose.model("LCS_Course", courseSchema);
