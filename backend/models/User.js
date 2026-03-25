const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true },
    password: { type: String, required: true },
    role: { type: String, enum: ["admin", "student", "teacher"], required: true },
    rollNumber: { type: String }, // for students
    employeeId: { type: String }, // for teachers
    batch: { type: mongoose.Schema.Types.ObjectId, ref: "LCS_Batch" }, // for students
    courses: [{ type: mongoose.Schema.Types.ObjectId, ref: "LCS_Course" }], // auto-filled for students, manual for teachers
  },
  { timestamps: true }
);

userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  this.password = await bcrypt.hash(this.password, 10);
  next();
});

userSchema.methods.comparePassword = function (candidate) {
  return bcrypt.compare(candidate, this.password);
};

module.exports = mongoose.model("LCS_User", userSchema);
