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

    // v3.1.10: align validation with the bulk-create path so single-create
    // isn't a back door for malformed bookings. Previously this endpoint
    // skipped format / overlap / course-teacher-existence checks — a bad
    // booking with `startTime="25:99"` would be accepted and the device's
    // heartbeat would format it into a NaN timestamp, silently skipping the
    // class with no error anywhere.
    const timeRx = /^([01]\d|2[0-3]):[0-5]\d$/;
    if (!timeRx.test(startTime) || !timeRx.test(endTime)) {
      return res.status(400).json({ error: "startTime/endTime must be HH:MM (24-hour)" });
    }
    if (endTime <= startTime) {
      return res.status(400).json({ error: "endTime must be after startTime" });
    }
    const parsedDate = new Date(date);
    if (isNaN(parsedDate.getTime())) {
      return res.status(400).json({ error: "date must be a valid ISO date string" });
    }

    // Verify course + teacher refs resolve before we persist a broken class.
    const [courseDoc, teacherDoc] = await Promise.all([
      Course.findById(course),
      User.findById(teacher),
    ]);
    if (!courseDoc) return res.status(400).json({ error: `Course ${course} not found` });
    if (!teacherDoc) return res.status(400).json({ error: `Teacher ${teacher} not found` });

    // v3.3.29 — Conflict prevention: a class booking is rejected if EITHER
    // the room OR the teacher is already booked for an overlapping time
    // window on the same day.
    //
    // Multiple TVs can record in parallel (each has its own LiveKit room +
    // Egress), so different rooms can run classes simultaneously. But you
    // can NEVER:
    //   1. Double-book the same room (the TV can only record one class at
    //      a time — concurrent bookings would confuse the schedule ranker
    //      AND only one would actually record).
    //   2. Double-book the same teacher (a teacher can't be physically in
    //      two rooms at once).
    //
    // Time overlap formula (standard interval intersection):
    //   existing.startTime < new.endTime  AND  existing.endTime > new.startTime
    // Status filter: only "scheduled" or "live" classes block new bookings.
    // "completed" / "cancelled" classes are historical and ignored.
    const dayStart = new Date(parsedDate); dayStart.setHours(0, 0, 0, 0);
    const dayEnd   = new Date(parsedDate); dayEnd.setHours(23, 59, 59, 999);

    // Same-room overlap.
    const roomOverlap = await ScheduledClass.findOne({
      roomNumber,
      date: { $gte: dayStart, $lte: dayEnd },
      status: { $in: ["scheduled", "live"] },
      startTime: { $lt: endTime },
      endTime: { $gt: startTime },
    });
    if (roomOverlap) {
      return res.status(409).json({
        error: `Room ${roomNumber} already booked ${roomOverlap.startTime}-${roomOverlap.endTime} on this date ('${roomOverlap.title}')`,
        conflict: { type: "room", roomNumber, conflictingClass: { id: roomOverlap._id, title: roomOverlap.title, startTime: roomOverlap.startTime, endTime: roomOverlap.endTime } },
      });
    }

    // Same-teacher overlap (teacher can't be in two places at once).
    const teacherOverlap = await ScheduledClass.findOne({
      teacher,
      date: { $gte: dayStart, $lte: dayEnd },
      status: { $in: ["scheduled", "live"] },
      startTime: { $lt: endTime },
      endTime: { $gt: startTime },
    });
    if (teacherOverlap) {
      return res.status(409).json({
        error: `${teacherDoc?.name || "Teacher"} already has a class ${teacherOverlap.startTime}-${teacherOverlap.endTime} on this date in Room ${teacherOverlap.roomNumber} ('${teacherOverlap.title}')`,
        conflict: { type: "teacher", teacherId: teacher, conflictingClass: { id: teacherOverlap._id, title: teacherOverlap.title, startTime: teacherOverlap.startTime, endTime: teacherOverlap.endTime, roomNumber: teacherOverlap.roomNumber } },
      });
    }

    const cls = await ScheduledClass.create({
      title,
      course,
      teacher,
      courseName: courseDoc?.courseName || "",
      courseCode: courseDoc?.courseCode || "",
      teacherName: teacherDoc?.name || "",
      roomNumber,
      date: parsedDate,
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
    // Whitelist updatable fields to prevent mass assignment
    const allowed = ["title", "course", "teacher", "roomNumber", "date", "startTime", "endTime", "status"];
    const updates = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }

    // v3.3.29 — apply same room/teacher conflict prevention as create.
    // If the update changes time/room/teacher/date in a way that would
    // collide with another scheduled or live class, reject.
    const existing = await ScheduledClass.findById(req.params.id);
    if (!existing) return res.status(404).json({ error: "Class not found" });

    const merged = {
      roomNumber: updates.roomNumber || existing.roomNumber,
      teacher:    updates.teacher    || existing.teacher,
      startTime:  updates.startTime  || existing.startTime,
      endTime:    updates.endTime    || existing.endTime,
      date:       updates.date ? new Date(updates.date) : existing.date,
    };

    // Only run conflict check if a time-relevant field actually changed —
    // avoids unnecessary DB hits on simple title-only edits.
    const timeChanged = ["roomNumber", "teacher", "startTime", "endTime", "date"]
      .some((k) => updates[k] !== undefined);

    if (timeChanged) {
      const timeRx = /^([01]\d|2[0-3]):[0-5]\d$/;
      if (!timeRx.test(merged.startTime) || !timeRx.test(merged.endTime)) {
        return res.status(400).json({ error: "startTime/endTime must be HH:MM (24-hour)" });
      }
      if (merged.endTime <= merged.startTime) {
        return res.status(400).json({ error: "endTime must be after startTime" });
      }

      const dayStart = new Date(merged.date); dayStart.setHours(0, 0, 0, 0);
      const dayEnd   = new Date(merged.date); dayEnd.setHours(23, 59, 59, 999);
      // Exclude this class from the overlap search.
      const baseFilter = {
        _id: { $ne: req.params.id },
        date: { $gte: dayStart, $lte: dayEnd },
        status: { $in: ["scheduled", "live"] },
        startTime: { $lt: merged.endTime },
        endTime:   { $gt: merged.startTime },
      };

      const roomOverlap = await ScheduledClass.findOne({ ...baseFilter, roomNumber: merged.roomNumber });
      if (roomOverlap) {
        return res.status(409).json({
          error: `Room ${merged.roomNumber} already booked ${roomOverlap.startTime}-${roomOverlap.endTime} on this date ('${roomOverlap.title}')`,
          conflict: { type: "room", roomNumber: merged.roomNumber },
        });
      }

      const teacherOverlap = await ScheduledClass.findOne({ ...baseFilter, teacher: merged.teacher });
      if (teacherOverlap) {
        return res.status(409).json({
          error: `Teacher already has a class ${teacherOverlap.startTime}-${teacherOverlap.endTime} on this date in Room ${teacherOverlap.roomNumber} ('${teacherOverlap.title}')`,
          conflict: { type: "teacher" },
        });
      }
    }

    const cls = await ScheduledClass.findByIdAndUpdate(req.params.id, updates, { new: true, runValidators: true });
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

    // Use aggregation instead of loading all docs into memory
    const scanAgg = await Attendance.aggregate([
      { $project: { count: { $size: { $ifNull: ["$attendees", []] } } } },
      { $group: { _id: null, total: { $sum: "$count" } } },
    ]);
    const totalScans = scanAgg[0]?.total || 0;

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
    const allUsers   = await User.find({ role: { $in: ["teacher", "admin", "superadmin"] } }).lean();

    const created = [], failed = [];
    for (const row of rows) {
      try {
        if (!row.title?.trim() || !row.roomNumber?.trim()) {
          throw new Error("title and roomNumber are required");
        }

        const courseDoc = allCourses.find(c =>
          c.courseCode?.toLowerCase() === row.courseCode?.toLowerCase() ||
          c.courseName?.toLowerCase() === row.courseName?.toLowerCase()
        );

        const teacherDoc = allUsers.find(u =>
          u.name?.toLowerCase() === row.teacherName?.toLowerCase()
        );

        if (!courseDoc) throw new Error(`Course not found: "${row.courseCode || row.courseName}"`);
        if (!teacherDoc) throw new Error(`Teacher not found: "${row.teacherName}"`);

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
