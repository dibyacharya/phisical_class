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

// GET /api/courses/:id/attendance — attendance for a course (role-aware)
exports.courseAttendance = async (req, res) => {
  try {
    const classes = await ScheduledClass.find({ course: req.params.id });
    const classIds = classes.map((c) => c._id);

    const attendances = await Attendance.find({ scheduledClass: { $in: classIds } })
      .populate({
        path: "scheduledClass",
        populate: { path: "course", select: "courseName courseCode" },
      })
      .populate("attendees.student", "name email rollNumber");

    const isTeacher = req.user.role === "teacher" || req.user.role === "admin";

    if (isTeacher) {
      // Teacher/Admin: show ALL students' attendance per class
      const classRecords = [];
      for (const att of attendances) {
        classRecords.push({
          classId: att.scheduledClass?._id,
          classTitle: att.scheduledClass?.title,
          courseCode: att.scheduledClass?.course?.courseCode,
          courseName: att.scheduledClass?.course?.courseName,
          date: att.scheduledClass?.date,
          startTime: att.scheduledClass?.startTime,
          roomNumber: att.scheduledClass?.roomNumber,
          totalPresent: att.attendees.length,
          attendees: att.attendees.map((a) => ({
            name: a.student?.name || a.name,
            email: a.student?.email || "",
            rollNumber: a.student?.rollNumber || a.rollNumber || "-",
            scannedAt: a.scannedAt,
            verified: a.verified,
          })),
        });
      }

      const totalStudents = classRecords.reduce((sum, c) => sum + c.totalPresent, 0);
      res.json({
        totalClasses: classes.length,
        attended: totalStudents,
        isTeacherView: true,
        records: classRecords.sort((a, b) => new Date(b.date) - new Date(a.date)),
      });
    } else {
      // Student: show only their own attendance
      const result = [];
      for (const att of attendances) {
        const myEntry = att.attendees.find((a) => {
          const studentId = a.student?._id?.toString() || a.student?.toString();
          return studentId === req.user._id.toString();
        });
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
        isTeacherView: false,
        records: result.sort((a, b) => new Date(b.date) - new Date(a.date)),
      });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
