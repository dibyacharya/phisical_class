const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true },
    password: { type: String, required: true },
    // v3.6.1 — plain-text password stored alongside the bcrypt hash.
    //
    // SECURITY TRADEOFF: storing plaintext breaks zero-knowledge auth —
    // anyone who reads the database (admin, DB ops, attacker after a
    // breach) sees the actual password. Conventional best-practice is
    // "store only the hash, offer reset on forgot".
    //
    // The owner of THIS LMS system explicitly requested admin password
    // visibility for staff/student credential management:
    // "admin chahe ta apna ya sabhi ka password dekh sakta he".
    //
    // Practical mitigations:
    //   - `select: false` keeps it out of routine queries — only
    //     explicit `.select("+passwordPlaintext")` returns it.
    //   - Endpoints that include it (auth.me, users.getUser) are
    //     admin-only or self-serve.
    //   - listUsers does NOT include it; only single-user GET does.
    //   - Login response does NOT include it.
    //
    // To switch back to zero-knowledge mode later: set this field to null
    // on every user (`db.users.updateMany({}, { $set: { passwordPlaintext: null } })`)
    // and remove the writes in the controllers — the hash continues to
    // authenticate as before.
    passwordPlaintext: { type: String, default: null, select: false },
    role: { type: String, enum: ["superadmin", "admin", "student", "teacher"], required: true },
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
