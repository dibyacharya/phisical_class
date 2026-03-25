const Recording = require("../models/Recording");

// GET /api/recordings
exports.getAll = async (req, res) => {
  try {
    const { status } = req.query;
    const filter = {};
    if (status) filter.status = status;

    const recordings = await Recording.find(filter)
      .sort({ createdAt: -1 })
      .populate({
        path: "scheduledClass",
        select: "title courseName courseCode teacherName roomNumber date startTime endTime course teacher",
        populate: [
          { path: "course", select: "courseName courseCode" },
          { path: "teacher", select: "name" },
        ],
      });
    res.json(recordings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// GET /api/recordings/:id
exports.getOne = async (req, res) => {
  try {
    const rec = await Recording.findById(req.params.id).populate("scheduledClass");
    if (!rec) return res.status(404).json({ error: "Recording not found" });
    res.json(rec);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// PUT /api/recordings/:id/toggle-publish
exports.togglePublish = async (req, res) => {
  try {
    const rec = await Recording.findById(req.params.id);
    if (!rec) return res.status(404).json({ error: "Recording not found" });
    rec.isPublished = !rec.isPublished;
    await rec.save();
    res.json(rec);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// DELETE /api/recordings/:id
exports.remove = async (req, res) => {
  try {
    await Recording.findByIdAndDelete(req.params.id);
    res.json({ message: "Deleted" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
