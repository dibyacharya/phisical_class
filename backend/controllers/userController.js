const User = require("../models/User");
const Course = require("../models/Course");

// GET /api/users
exports.listUsers = async (req, res) => {
  try {
    const { role } = req.query;
    const filter = {};
    if (role) filter.role = role;

    const users = await User.find(filter)
      .select("-password")
      .populate("batch", "name")
      .sort({ role: 1, name: 1 });
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// POST /api/users
exports.createUser = async (req, res) => {
  try {
    const { name, email, password, role, rollNumber, employeeId, batch } = req.body;

    if (!name || !email || !password || !role) {
      return res.status(400).json({ error: "Name, email, password, and role are required" });
    }

    if (role === "student" && !rollNumber) {
      return res.status(400).json({ error: "Roll number is required for students" });
    }

    if (role === "teacher" && !employeeId) {
      return res.status(400).json({ error: "Employee ID is required for teachers" });
    }

    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) {
      return res.status(400).json({ error: "Email already exists" });
    }

    // For students: auto-assign all courses from their batch
    let studentCourses = [];
    if (role === "student" && batch) {
      const courses = await Course.find({ batch });
      studentCourses = courses.map((c) => c._id);
    }

    const user = await User.create({
      name,
      email,
      password,
      // v3.6.1 — store the plain-text alongside the hash so admin can
      // view the password later (system-owner-requested feature). The
      // pre-save hook hashes `password`; `passwordPlaintext` stays raw.
      passwordPlaintext: password,
      role,
      rollNumber: role === "student" ? rollNumber : undefined,
      employeeId: role === "teacher" ? employeeId : undefined,
      batch: role === "student" ? batch : undefined,
      courses: role === "student" ? studentCourses : [],
    });

    res.status(201).json({
      _id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      rollNumber: user.rollNumber,
      employeeId: user.employeeId,
      batch: user.batch,
      courses: user.courses,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// DELETE /api/users/:id
exports.deleteUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: "User not found" });

    if (user._id.toString() === req.user._id.toString()) {
      return res.status(400).json({ error: "Cannot delete yourself" });
    }

    await User.findByIdAndDelete(req.params.id);
    res.json({ message: "User deleted" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// GET /api/users/teachers
exports.listTeachers = async (_req, res) => {
  try {
    const teachers = await User.find({ role: "teacher" })
      .select("name email employeeId")
      .sort({ name: 1 });
    res.json(teachers);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// v3.6.0 — GET /api/users/:id
//
// Returns a single user's full profile (excluding the password hash).
// Used by the admin portal's UserDetailModal to show LMS login id and
// role-specific fields. Admin-only (because student/teacher data is
// PII-adjacent).
//
// v3.6.1 — also returns passwordPlaintext (admin-side visibility, see
// User model comment for the security tradeoff). Field is `select: false`
// by default so we explicitly opt in via .select("+passwordPlaintext").
exports.getUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id)
      .select("-password +passwordPlaintext")
      .populate("batch", "name")
      .populate("courses", "courseName courseCode");
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// v3.6.0 — PATCH /api/users/:id/password
//
// Admin-only. Resets ANY user's password without requiring the user's
// current password (admin-override use case: user forgot password,
// admin sets a new one out of band). Different from the self-service
// /api/auth/me/password which DOES require currentPassword.
//
// The new password is set; the User model's pre-save hook re-hashes
// it with bcrypt before persisting.
exports.resetUserPassword = async (req, res) => {
  try {
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ error: "newPassword must be at least 6 characters" });
    }
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: "User not found" });

    // Defence: prevent admin (non-superadmin) from changing a superadmin's
    // password via this endpoint. Superadmins must use self-service.
    if (user.role === "superadmin" && req.user.role !== "superadmin") {
      return res.status(403).json({ error: "Only a superadmin can reset another superadmin's password" });
    }

    user.password = newPassword;
    user.passwordPlaintext = newPassword; // v3.6.1 — admin-set, visible
    await user.save();
    res.json({ ok: true, message: `Password reset for ${user.email}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
