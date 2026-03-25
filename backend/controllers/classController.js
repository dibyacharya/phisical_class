const ScheduledClass = require("../models/ScheduledClass");
const Recording = require("../models/Recording");
const Attendance = require("../models/Attendance");
const Course = require("../models/Course");
const User = require("../models/User");
const crypto = require("crypto");

// GET /api/classes
exports.getAll = async (req, res) => {
  try {
    const { status, date } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (date) {
      const d = new Date(date);
      filter.date = {
        $gte: new Date(d.setHours(0, 0, 0, 0)),
        $lte: new Date(d.setHours(23, 59, 59, 999)),
      };
    }
    const classes = await ScheduledClass.find(filter)
      .sort({ date: -1, startTime: -1 })
      .populate("course", "courseName courseCode")
      .populate("teacher", "name email employeeId")
      .populate("createdBy", "name email");
    res.json(classes);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// POST /api/classes
exports.create = async (req, res) => {
  try {
    const { title, course, teacher, roomNumber, date, startTime, endTime } = req.body;
    if (!title || !course || !teacher || !roomNumber || !date || !startTime || !endTime) {
      return res.status(400).json({ error: "All fields are required" });
    }

    // Populate string fields from refs for backward compat (heartbeat etc.)
    const courseDoc = await Course.findById(course);
    const teacherDoc = await User.findById(teacher);

    const cls = await ScheduledClass.create({
      title,
      course,
      teacher,
      courseName: courseDoc?.courseName || "",
      courseCode: courseDoc?.courseCode || "",
      teacherName: teacherDoc?.name || "",
      roomNumber,
      date: new Date(date),
      startTime,
      endTime,
      createdBy: req.user._id,
    });

    // Auto-create attendance session with QR secret
    await Attendance.create({
      scheduledClass: cls._id,
      qrSecret: crypto.randomBytes(32).toString("hex"),
      attendees: [],
    });

    const populated = await ScheduledClass.findById(cls._id)
      .populate("course", "courseName courseCode")
      .populate("teacher", "name email");
    res.status(201).json(populated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// PUT /api/classes/:id
exports.update = async (req, res) => {
  try {
    const cls = await ScheduledClass.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!cls) return res.status(404).json({ error: "Class not found" });
    res.json(cls);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// DELETE /api/classes/:id
exports.remove = async (req, res) => {
  try {
    await ScheduledClass.findByIdAndDelete(req.params.id);
    await Recording.deleteMany({ scheduledClass: req.params.id });
    await Attendance.deleteMany({ scheduledClass: req.params.id });
    res.json({ message: "Deleted" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// GET /api/classes/:id
exports.getOne = async (req, res) => {
  try {
    const cls = await ScheduledClass.findById(req.params.id)
      .populate("course", "courseName courseCode")
      .populate("teacher", "name email")
      .populate("createdBy", "name email");
    if (!cls) return res.status(404).json({ error: "Class not found" });
    res.json(cls);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// GET /api/classes/dashboard
exports.dashboard = async (req, res) => {
  try {
    const totalClasses = await ScheduledClass.countDocuments();
    const totalRecordings = await Recording.countDocuments({ status: "completed" });

    const attendances = await Attendance.find();
    let totalScans = 0;
    attendances.forEach((a) => (totalScans += a.attendees.length));

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const todayClasses = await ScheduledClass.countDocuments({
      date: { $gte: today, $lt: tomorrow },
    });

    res.json({
      totalClasses,
      totalRecordings,
      totalAttendanceScans: totalScans,
      todayClasses,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
