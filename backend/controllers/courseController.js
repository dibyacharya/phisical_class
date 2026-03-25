const Course = require("../models/Course");
const Recording = require("../models/Recording");
const ScheduledClass = require("../models/ScheduledClass");
const Attendance = require("../models/Attendance");

// GET /api/courses/my — student/teacher ke enrolled courses
exports.myCourses = async (req, res) => {
  try {
    const courses = await Course.find({ _id: { $in: req.user.courses || [] } })
      .populate("teacher", "name email employeeId")
      .populate("batch", "name")
      .sort({ courseCode: 1 });
    res.json(courses);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// GET /api/courses/:id/recordings — published recordings for a course
exports.courseRecordings = async (req, res) => {
  try {
    const classes = await ScheduledClass.find({ course: req.params.id });
    const classIds = classes.map((c) => c._id);

    const recordings = await Recording.find({
      scheduledClass: { $in: classIds },
      isPublished: true,
    })
      .populate({
        path: "scheduledClass",
        populate: [
          { path: "course", select: "courseName courseCode" },
          { path: "teacher", select: "name" },
        ],
      })
      .sort({ createdAt: -1 });

    res.json(recordings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// GET /api/courses/:id/classes — scheduled classes for a course
exports.courseClasses = async (req, res) => {
  try {
    const classes = await ScheduledClass.find({ course: req.params.id })
      .populate("course", "courseName courseCode")
      .populate("teacher", "name")
      .sort({ date: -1 });
    res.json(classes);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// GET /api/courses/:id/attendance — student's attendance for a course
exports.courseAttendance = async (req, res) => {
  try {
    const classes = await ScheduledClass.find({ course: req.params.id });
    const classIds = classes.map((c) => c._id);

    const attendances = await Attendance.find({ scheduledClass: { $in: classIds } })
      .populate({
        path: "scheduledClass",
        populate: { path: "course", select: "courseName courseCode" },
      });

    // Filter to only show this student's attendance entries
    const result = [];
    for (const att of attendances) {
      const myEntry = att.attendees.find(
        (a) => a.student?.toString() === req.user._id.toString()
      );
      if (myEntry) {
        result.push({
          classTitle: att.scheduledClass?.title,
          courseCode: att.scheduledClass?.course?.courseCode,
          courseName: att.scheduledClass?.course?.courseName,
          date: att.scheduledClass?.date,
          startTime: att.scheduledClass?.startTime,
          roomNumber: att.scheduledClass?.roomNumber,
          scannedAt: myEntry.scannedAt,
          verified: myEntry.verified,
        });
      }
    }

    res.json({
      totalClasses: classes.length,
      attended: result.length,
      records: result.sort((a, b) => new Date(b.date) - new Date(a.date)),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
