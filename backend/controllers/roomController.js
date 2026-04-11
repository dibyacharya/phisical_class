const Room = require("../models/Room");
const ClassroomDevice = require("../models/ClassroomDevice");
const ScheduledClass = require("../models/ScheduledClass");
const Recording = require("../models/Recording");

// Helper: clean error handler — avoids leaking raw Mongoose internals
const handleErr = (err, res) => {
  if (err.name === "CastError") return res.status(400).json({ error: "Invalid ID format" });
  res.status(500).json({ error: err.message });
};

// GET /api/rooms
exports.getRooms = async (_req, res) => {
  try {
    const rooms = await Room.find({ isActive: true }).sort({ campus: 1, block: 1, roomNumber: 1 });
    res.json(rooms);
  } catch (err) {
    handleErr(err, res);
  }
};

// GET /api/rooms/hierarchy
exports.getHierarchy = async (_req, res) => {
  try {
    const rooms = await Room.find({ isActive: true }).sort({ campus: 1, block: 1, roomNumber: 1 });

    const devices = await ClassroomDevice.find({ isActive: true });
    const devicesByRoom = {};
    const now = Date.now();
    for (const d of devices) {
      const rn = d.roomNumber || d.roomId;
      if (!rn) continue;
      // isOnline: stored flag OR heartbeat within last 5 min. Always boolean (never undefined)
      const heartbeatFresh = d.lastHeartbeat
        ? now - new Date(d.lastHeartbeat).getTime() < 5 * 60 * 1000
        : false;
      const isOnline = d.isOnline === true || heartbeatFresh;
      devicesByRoom[rn] = { deviceId: d.deviceId, isOnline, isRecording: d.isRecording, health: d.health };
    }

    const hierarchy = {};
    for (const room of rooms) {
      if (!hierarchy[room.campus]) hierarchy[room.campus] = {};
      if (!hierarchy[room.campus][room.block]) hierarchy[room.campus][room.block] = [];
      hierarchy[room.campus][room.block].push({ ...room.toObject(), device: devicesByRoom[room.roomNumber] || null });
    }

    const result = Object.entries(hierarchy).map(([campus, blocks]) => ({
      campus,
      blocks: Object.entries(blocks).map(([block, rooms]) => ({
        block,
        rooms,
        totalRooms: rooms.length,
        onlineDevices: rooms.filter((r) => r.device?.isOnline).length,
        recordingNow: rooms.filter((r) => r.device?.isRecording).length,
      })),
      totalRooms: Object.values(blocks).flat().length,
    }));

    res.json(result);
  } catch (err) {
    handleErr(err, res);
  }
};

// POST /api/rooms
exports.createRoom = async (req, res) => {
  try {
    const { campus, block, floor, roomNumber, roomName, spaceType, capacity } = req.body;
    const room = await Room.create({ campus, block, floor, roomNumber, roomName, spaceType, capacity });
    res.status(201).json(room);
  } catch (err) {
    if (err.code === 11000) return res.status(400).json({ error: "Space already exists in this campus/block" });
    handleErr(err, res);
  }
};

// PUT /api/rooms/:id
exports.updateRoom = async (req, res) => {
  try {
    const room = await Room.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!room) return res.status(404).json({ error: "Space not found" });
    res.json(room);
  } catch (err) {
    handleErr(err, res);
  }
};

// DELETE /api/rooms/:id
exports.deleteRoom = async (req, res) => {
  try {
    await Room.findByIdAndUpdate(req.params.id, { isActive: false });
    res.json({ message: "Deleted" });
  } catch (err) {
    handleErr(err, res);
  }
};

// GET /api/rooms/:id/detail
exports.getRoomDetail = async (req, res) => {
  try {
    const room = await Room.findById(req.params.id);
    if (!room) return res.status(404).json({ error: "Space not found" });

    const device = await ClassroomDevice.findOne({
      $or: [{ roomNumber: room.roomNumber }, { roomId: room.roomNumber }],
      isActive: true,
    });

    const now = Date.now();
    const heartbeatFresh = device?.lastHeartbeat
      ? now - new Date(device.lastHeartbeat).getTime() < 5 * 60 * 1000
      : false;
    const isOnline = device?.isOnline === true || heartbeatFresh;
    res.json({ room, device: device ? { ...device.toObject(), isOnline } : null });
  } catch (err) {
    handleErr(err, res);
  }
};

// GET /api/rooms/:id/utilization?from=&to=
// Returns: summary + table rows (Sl.No, videoUrl, facultyId, facultyName, courseName, date, time)
exports.getUtilization = async (req, res) => {
  try {
    const room = await Room.findById(req.params.id);
    if (!room) return res.status(404).json({ error: "Space not found" });

    const from = req.query.from ? new Date(req.query.from) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const to = req.query.to ? new Date(req.query.to) : new Date();
    to.setHours(23, 59, 59, 999);

    // Populate teacher to get employeeId (Faculty ID)
    const classes = await ScheduledClass.find({
      roomNumber: room.roomNumber,
      date: { $gte: from, $lte: to },
    })
      .populate("teacher", "name employeeId")
      .sort({ date: -1, startTime: 1 });

    // Map recordings to classes
    const classIds = classes.map((c) => c._id);
    const recordings = await Recording.find({ scheduledClass: { $in: classIds } });
    const recordingMap = {};
    for (const r of recordings) {
      recordingMap[r.scheduledClass.toString()] = r;
    }

    // Calculate total usage
    let totalMinutes = 0;
    const byDay = {};
    for (const cls of classes) {
      const [sh, sm] = cls.startTime.split(":").map(Number);
      const [eh, em] = cls.endTime.split(":").map(Number);
      const mins = (eh * 60 + em) - (sh * 60 + sm);
      totalMinutes += mins;
      const day = cls.date.toISOString().split("T")[0];
      if (!byDay[day]) byDay[day] = { classes: 0, minutes: 0 };
      byDay[day].classes++;
      byDay[day].minutes += mins;
    }

    const uniqueCourses = [...new Set(classes.map((c) => c.courseName).filter(Boolean))];

    // Table rows for Utilization tab
    const rows = classes.map((cls, idx) => {
      const rec = recordingMap[cls._id.toString()];
      return {
        slNo: idx + 1,
        classId: cls._id,
        date: cls.date,
        startTime: cls.startTime,
        endTime: cls.endTime,
        courseName: cls.courseName || "–",
        courseCode: cls.courseCode || "",
        facultyId: cls.teacher?.employeeId || "–",
        facultyName: cls.teacherName || cls.teacher?.name || "–",
        status: cls.status,
        hasVideo: !!(rec?.videoUrl),
        videoUrl: rec?.videoUrl || null,
        recordingStatus: rec?.status || null,
        recordingId: rec?._id || null,
        duration: rec?.duration || 0,
        fileSize: rec?.fileSize || 0,
      };
    });

    res.json({
      summary: {
        totalClasses: classes.length,
        totalHours: +(totalMinutes / 60).toFixed(1),
        totalRecordings: recordings.length,
        uniqueCourses: uniqueCourses.length,
        dateRange: { from, to },
      },
      rows,
      byDay: Object.entries(byDay)
        .map(([date, data]) => ({ date, ...data }))
        .sort((a, b) => a.date.localeCompare(b.date)),
    });
  } catch (err) {
    handleErr(err, res);
  }
};

// GET /api/rooms/:id/schedule?date=YYYY-MM-DD
// Returns hourly engagement for a specific date (8am – 6pm)
exports.getSchedule = async (req, res) => {
  try {
    const room = await Room.findById(req.params.id);
    if (!room) return res.status(404).json({ error: "Space not found" });

    const dateStr = req.query.date || new Date().toISOString().split("T")[0];
    const from = new Date(`${dateStr}T00:00:00.000+05:30`);
    const to = new Date(`${dateStr}T23:59:59.999+05:30`);

    const classes = await ScheduledClass.find({
      roomNumber: room.roomNumber,
      date: { $gte: from, $lte: to },
    })
      .populate("teacher", "name employeeId")
      .sort({ startTime: 1 });

    // Build hourly slots 8:00 to 18:00
    const slots = [];
    for (let h = 8; h < 18; h++) {
      const slotStart = h * 60;      // in minutes from midnight
      const slotEnd = (h + 1) * 60;

      const inSlot = classes.filter((cls) => {
        const [sh, sm] = cls.startTime.split(":").map(Number);
        const [eh, em] = cls.endTime.split(":").map(Number);
        const cStart = sh * 60 + sm;
        const cEnd = eh * 60 + em;
        return cStart < slotEnd && cEnd > slotStart; // overlaps
      });

      slots.push({
        hour: h,
        label: `${String(h).padStart(2, "0")}:00`,
        occupied: inSlot.length > 0,
        classes: inSlot.map((cls) => ({
          _id: cls._id,
          title: cls.title,
          courseName: cls.courseName,
          courseCode: cls.courseCode,
          facultyName: cls.teacherName || cls.teacher?.name,
          facultyId: cls.teacher?.employeeId,
          startTime: cls.startTime,
          endTime: cls.endTime,
          status: cls.status,
        })),
      });
    }

    // For Gantt-style rendering, also return exact class positions
    const gantt = classes.map((cls) => {
      const [sh, sm] = cls.startTime.split(":").map(Number);
      const [eh, em] = cls.endTime.split(":").map(Number);
      const dayStartMin = 8 * 60;  // 8am
      const dayEndMin = 18 * 60;   // 6pm
      const totalDayMin = dayEndMin - dayStartMin;
      const startMin = sh * 60 + sm;
      const endMin = eh * 60 + em;
      return {
        _id: cls._id,
        title: cls.title,
        courseName: cls.courseName,
        courseCode: cls.courseCode,
        facultyName: cls.teacherName || cls.teacher?.name,
        facultyId: cls.teacher?.employeeId,
        startTime: cls.startTime,
        endTime: cls.endTime,
        status: cls.status,
        leftPct: +((Math.max(startMin - dayStartMin, 0) / totalDayMin) * 100).toFixed(2),
        widthPct: +((Math.min(endMin, dayEndMin) - Math.max(startMin, dayStartMin)) / totalDayMin * 100).toFixed(2),
      };
    });

    res.json({ date: dateStr, slots, gantt, totalClasses: classes.length });
  } catch (err) {
    handleErr(err, res);
  }
};

// GET /api/rooms/:id/recordings
exports.getRoomRecordings = async (req, res) => {
  try {
    const room = await Room.findById(req.params.id);
    if (!room) return res.status(404).json({ error: "Space not found" });

    const classes = await ScheduledClass.find({ roomNumber: room.roomNumber });
    const classIds = classes.map((c) => c._id);

    const recordings = await Recording.find({ scheduledClass: { $in: classIds } })
      .populate("scheduledClass", "title courseCode courseName teacherName date startTime endTime")
      .sort({ createdAt: -1 });

    res.json(recordings);
  } catch (err) {
    handleErr(err, res);
  }
};
