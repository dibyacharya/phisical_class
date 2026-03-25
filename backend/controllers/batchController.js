const Batch = require("../models/Batch");
const Course = require("../models/Course");
const User = require("../models/User");

// GET /api/batches
exports.getAll = async (_req, res) => {
  try {
    const batches = await Batch.find().sort({ name: 1 });
    // Add counts
    const result = [];
    for (const b of batches) {
      const courseCount = await Course.countDocuments({ batch: b._id });
      const studentCount = await User.countDocuments({ batch: b._id, role: "student" });
      result.push({ ...b.toObject(), courseCount, studentCount });
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// POST /api/batches
exports.create = async (req, res) => {
  try {
    const { name, description } = req.body;
    if (!name) return res.status(400).json({ error: "Batch name is required" });
    const batch = await Batch.create({ name, description });
    res.status(201).json(batch);
  } catch (err) {
    if (err.code === 11000) return res.status(400).json({ error: "Batch name already exists" });
    res.status(500).json({ error: err.message });
  }
};

// DELETE /api/batches/:id
exports.remove = async (req, res) => {
  try {
    const studentCount = await User.countDocuments({ batch: req.params.id });
    if (studentCount > 0) {
      return res.status(400).json({ error: `Cannot delete — ${studentCount} students assigned to this batch` });
    }
    await Course.deleteMany({ batch: req.params.id });
    await Batch.findByIdAndDelete(req.params.id);
    res.json({ message: "Batch deleted" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// GET /api/batches/:id/courses
exports.getCourses = async (req, res) => {
  try {
    const courses = await Course.find({ batch: req.params.id })
      .populate("teacher", "name email employeeId")
      .sort({ courseCode: 1 });
    res.json(courses);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// POST /api/batches/:id/courses
exports.addCourse = async (req, res) => {
  try {
    const { courseName, courseCode, teacher } = req.body;
    if (!courseName || !courseCode) {
      return res.status(400).json({ error: "Course name and code are required" });
    }
    const batch = await Batch.findById(req.params.id);
    if (!batch) return res.status(404).json({ error: "Batch not found" });

    const course = await Course.create({
      courseName,
      courseCode,
      batch: req.params.id,
      teacher: teacher || undefined,
    });

    // If teacher assigned, add course to teacher's courses
    if (teacher) {
      await User.findByIdAndUpdate(teacher, { $addToSet: { courses: course._id } });
    }

    // Auto-assign this new course to all students in this batch
    await User.updateMany(
      { batch: req.params.id, role: "student" },
      { $addToSet: { courses: course._id } }
    );

    const populated = await Course.findById(course._id).populate("teacher", "name email employeeId");
    res.status(201).json(populated);
  } catch (err) {
    if (err.code === 11000) return res.status(400).json({ error: "Course code already exists in this batch" });
    res.status(500).json({ error: err.message });
  }
};

// PUT /api/batches/courses/:courseId
exports.updateCourse = async (req, res) => {
  try {
    const { courseName, courseCode, teacher } = req.body;
    const course = await Course.findById(req.params.courseId);
    if (!course) return res.status(404).json({ error: "Course not found" });

    // If teacher changed, update old and new teacher's courses array
    if (teacher && teacher !== course.teacher?.toString()) {
      // Remove from old teacher
      if (course.teacher) {
        await User.findByIdAndUpdate(course.teacher, { $pull: { courses: course._id } });
      }
      // Add to new teacher
      await User.findByIdAndUpdate(teacher, { $addToSet: { courses: course._id } });
    }

    if (courseName) course.courseName = courseName;
    if (courseCode) course.courseCode = courseCode;
    if (teacher) course.teacher = teacher;
    await course.save();

    const populated = await Course.findById(course._id).populate("teacher", "name email employeeId");
    res.json(populated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// DELETE /api/batches/courses/:courseId
exports.removeCourse = async (req, res) => {
  try {
    const course = await Course.findById(req.params.courseId);
    if (!course) return res.status(404).json({ error: "Course not found" });

    // Remove course from all users
    await User.updateMany({}, { $pull: { courses: course._id } });
    await Course.findByIdAndDelete(req.params.courseId);

    res.json({ message: "Course deleted" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
