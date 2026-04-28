const jwt = require("jsonwebtoken");
const User = require("../models/User");
const Batch = require("../models/Batch");
const Course = require("../models/Course");

const generateToken = (user) =>
  jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET, {
    expiresIn: "7d",
  });

exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ error: "Email and password required" });

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) return res.status(401).json({ error: "Invalid credentials" });

    const valid = await user.comparePassword(password);
    if (!valid) return res.status(401).json({ error: "Invalid credentials" });

    res.json({
      token: generateToken(user),
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        rollNumber: user.rollNumber,
        employeeId: user.employeeId,
        batch: user.batch,
        courses: user.courses,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.me = async (req, res) => {
  // v3.6.1 — also include passwordPlaintext for self-view in admin portal.
  // The `auth` middleware loads req.user without the plaintext field
  // (it's `select: false`); refetch with the field explicitly opted in.
  try {
    const fresh = await User.findById(req.user.id || req.user._id)
      .select("-password +passwordPlaintext")
      .populate("batch", "name");
    res.json({ user: fresh || req.user });
  } catch (err) {
    res.json({ user: req.user });
  }
};

// v3.6.0 — change own password (any authenticated user).
//
// Requires the user's CURRENT password to confirm identity (defends
// against session hijack scenarios where someone with a stolen token
// could otherwise lock the real owner out by changing the password).
//
// Admin-resetting another user's password uses a separate endpoint
// in the user controller (no current-password check).
exports.changeMyPassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: "currentPassword and newPassword required" });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ error: "New password must be at least 6 characters" });
    }
    const user = await User.findById(req.user.id || req.user._id);
    if (!user) return res.status(404).json({ error: "User not found" });

    const valid = await user.comparePassword(currentPassword);
    if (!valid) return res.status(401).json({ error: "Current password is incorrect" });

    user.password = newPassword; // pre-save hook re-hashes
    user.passwordPlaintext = newPassword; // v3.6.1 — keep visible copy in sync
    await user.save();
    res.json({ ok: true, message: "Password changed successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.seed = async (_req, res) => {
  try {
    const existing = await User.countDocuments();
    if (existing > 0)
      return res.json({ message: "Already seeded", count: existing });

    // 1. Create batch
    const batch = await Batch.create({ name: "CSE 2021-25 Batch A", description: "Computer Science Engineering" });

    // 2. Create teachers first
    const teacher1 = await User.create({ name: "Dr. Sharma", email: "teacher@kiit.ac.in", password: "teacher123", role: "teacher", employeeId: "EMP001" });
    const teacher2 = await User.create({ name: "Prof. Mishra", email: "mishra@kiit.ac.in", password: "teacher123", role: "teacher", employeeId: "EMP002" });

    // 3. Create courses in batch with teachers
    const course1 = await Course.create({ courseName: "Data Structures", courseCode: "CS2001", batch: batch._id, teacher: teacher1._id });
    const course2 = await Course.create({ courseName: "Operating Systems", courseCode: "CS3001", batch: batch._id, teacher: teacher2._id });
    const course3 = await Course.create({ courseName: "Database Management", courseCode: "CS3002", batch: batch._id, teacher: teacher1._id });

    // 4. Assign courses to teachers
    teacher1.courses = [course1._id, course3._id];
    await teacher1.save();
    teacher2.courses = [course2._id];
    await teacher2.save();

    // 5. Create admin
    await User.create({ name: "Admin User", email: "admin@kiit.ac.in", password: "admin123", role: "admin" });

    // 6. Create students with batch + courses
    const allCourseIds = [course1._id, course2._id, course3._id];
    const studentsData = [
      { name: "Rahul Kumar", email: "rahul@kiit.ac.in", rollNumber: "21CS001" },
      { name: "Priya Singh", email: "priya@kiit.ac.in", rollNumber: "21CS002" },
      { name: "Amit Patel", email: "amit@kiit.ac.in", rollNumber: "21CS003" },
      { name: "Sneha Das", email: "sneha@kiit.ac.in", rollNumber: "21CS004" },
    ];

    for (const s of studentsData) {
      await User.create({ ...s, password: "student123", role: "student", batch: batch._id, courses: allCourseIds });
    }

    // 7. Create super admin (D&R AI Solutions master account)
    await User.create({
      name: "D&R AI Solutions",
      email: "superadmin@lecturelens.in",
      password: "SuperAdmin@2026",
      role: "superadmin",
    });

    res.json({ message: "Seed complete — 1 batch, 3 courses, 2 teachers, 4 students, 1 admin, 1 superadmin" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
