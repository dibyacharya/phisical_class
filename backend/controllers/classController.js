const ScheduledClass = require("../models/ScheduledClass");
const Recording = require("../models/Recording");
const Attendance = require("../models/Attendance");
const Course = require("../models/Course");
const User = require("../models/User");
const crypto = require("crypto");
const Room = require("../models/Room");
const mongoose = require("mongoose");

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

// POST /api/classes/bulk-validate
exports.bulkValidate = async (req, res) => {
  try {
    const { rows } = req.body;
    if (!Array.isArray(rows) || rows.length === 0)
      return res.status(400).json({ error: "No rows provided" });

    const allRooms = await Room.find({ isActive: true }).lean();
    const roomByNumber = {};
    for (const r of allRooms) roomByNumber[r.roomNumber] = r;

    const roomNumbers = [...new Set(rows.map(r => r.roomNumber).filter(Boolean))];
    const dates = [...new Set(rows.map(r => r.date).filter(Boolean))];
    let existingClasses = [];
    if (roomNumbers.length && dates.length) {
      const dateObjs = dates.map(d => new Date(d)).filter(d => !isNaN(d.getTime()));
      if (dateObjs.length) {
        const minD = new Date(Math.min(...dateObjs.map(d => d.getTime())));
        const maxD = new Date(Math.max(...dateObjs.map(d => d.getTime())));
        minD.setHours(0,0,0,0); maxD.setHours(23,59,59,999);
        existingClasses = await ScheduledClass.find({
          roomNumber: { $in: roomNumbers },
          date: { $gte: minD, $lte: maxD },
        }).lean();
      }
    }

    const batchBookings = [];
    const results = [];
    const timeRx = /^([01]\d|2[0-3]):([0-5]\d)$/;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = row.rowNum || i + 1;
      const issues = [];
      let status = "valid";

      if (!row.title?.trim())      issues.push("Missing: title");
      if (!row.date?.trim())       issues.push("Missing: date");
      if (!row.startTime?.trim())  issues.push("Missing: startTime");
      if (!row.endTime?.trim())    issues.push("Missing: endTime");
      if (!row.roomNumber?.trim()) issues.push("Missing: roomNumber");

      let parsedDate = null;
      if (row.date) {
        parsedDate = new Date(row.date + "T00:00:00.000+05:30");
        if (isNaN(parsedDate.getTime())) { issues.push(`Invalid date "${row.date}" — use YYYY-MM-DD`); parsedDate = null; }
      }

      let startMin = null, endMin = null;
      if (row.startTime) {
        if (!timeRx.test(row.startTime)) issues.push(`Invalid startTime "${row.startTime}" — use HH:MM`);
        else { const [h,m] = row.startTime.split(":").map(Number); startMin = h*60+m; }
      }
      if (row.endTime) {
        if (!timeRx.test(row.endTime)) issues.push(`Invalid endTime "${row.endTime}" — use HH:MM`);
        else { const [h,m] = row.endTime.split(":").map(Number); endMin = h*60+m; }
      }
      if (startMin !== null && endMin !== null && startMin >= endMin) {
        issues.push("startTime must be before endTime"); startMin = null; endMin = null;
      }

      let roomDoc = null;
      if (row.roomNumber?.trim()) {
        roomDoc = roomByNumber[row.roomNumber.trim()];
        if (!roomDoc) issues.push(`Room "${row.roomNumber}" not found. Available: ${Object.keys(roomByNumber).join(", ")}`);
      }

      if (issues.length === 0 && parsedDate && startMin !== null && endMin !== null && roomDoc) {
        const dayStr = row.date;
        const conflictDB = existingClasses.filter(cls => {
          if (cls.roomNumber !== row.roomNumber.trim()) return false;
          const cls_date = new Date(cls.date).toISOString().split("T")[0];
          if (cls_date !== dayStr) return false;
          const [sh,sm] = cls.startTime.split(":").map(Number);
          const [eh,em] = cls.endTime.split(":").map(Number);
          return startMin < (eh*60+em) && endMin > (sh*60+sm);
        });
        if (conflictDB.length) {
          issues.push(`Conflict with existing: ${conflictDB.map(c => `"${c.title}" (${c.startTime}–${c.endTime})`).join(", ")}`);
          status = "conflict";
        }
        const conflictBatch = batchBookings.find(b =>
          b.roomNumber === row.roomNumber.trim() && b.date === dayStr &&
          startMin < b.endMin && endMin > b.startMin
        );
        if (conflictBatch) {
          issues.push(`Conflicts with row #${conflictBatch.rowNum} in this upload ("${conflictBatch.title}")`);
          status = "conflict";
        }
      }

      if (issues.length > 0 && status === "valid") status = "error";
      results.push({ rowNum, data: row, status, issues, roomName: roomDoc?.roomName || null, roomBlock: roomDoc?.block || null, roomCampus: roomDoc?.campus || null });

      if (status === "valid" && startMin !== null && endMin !== null) {
        batchBookings.push({ rowNum, title: row.title?.trim(), roomNumber: row.roomNumber.trim(), date: row.date, startMin, endMin });
      }
    }

    res.json({
      summary: {
        total: results.length,
        valid: results.filter(r => r.status === "valid").length,
        conflicts: results.filter(r => r.status === "conflict").length,
        errors: results.filter(r => r.status === "error").length,
      },
      rows: results,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
};

// POST /api/classes/bulk-create
exports.bulkCreate = async (req, res) => {
  try {
    const { rows } = req.body;
    if (!Array.isArray(rows) || rows.length === 0)
      return res.status(400).json({ error: "No rows provided" });

    const allCourses = await Course.find().lean();
    const allUsers   = await User.find().lean();
    const fallbackCourse = allCourses[0];
    const fallbackUser   = allUsers[0];

    const created = [], failed = [];
    for (const row of rows) {
      try {
        const courseDoc = allCourses.find(c =>
          c.courseCode?.toLowerCase() === row.courseCode?.toLowerCase() ||
          c.courseName?.toLowerCase() === row.courseName?.toLowerCase()
        ) || fallbackCourse;

        const teacherDoc = allUsers.find(u =>
          u.name?.toLowerCase() === row.teacherName?.toLowerCase()
        ) || fallbackUser;

        if (!courseDoc || !teacherDoc) throw new Error("No course or teacher found in DB");

        const cls = await ScheduledClass.create({
          title:      row.title.trim(),
          course:     courseDoc._id,
          teacher:    teacherDoc._id,
          courseName: row.courseName?.trim()  || courseDoc.courseName || "",
          courseCode: row.courseCode?.trim()  || courseDoc.courseCode || "",
          teacherName:row.teacherName?.trim() || teacherDoc.name     || "",
          roomNumber: row.roomNumber.trim(),
          date:       new Date(row.date + "T00:00:00.000+05:30"),
          startTime:  row.startTime,
          endTime:    row.endTime,
          status:     "scheduled",
          createdBy:  req.user._id,
        });

        await Attendance.create({
          scheduledClass: cls._id,
          qrSecret: crypto.randomBytes(32).toString("hex"),
          attendees: [],
        });

        created.push({ rowNum: row.rowNum, title: row.title });
      } catch (err) {
        failed.push({ rowNum: row.rowNum, title: row.title, error: err.message });
      }
    }
    res.json({ created: created.length, failed: failed.length, details: { created, failed } });
  } catch (err) { res.status(500).json({ error: err.message }); }
};
