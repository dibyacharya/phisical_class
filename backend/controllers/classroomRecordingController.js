const crypto = require("crypto");
const path = require("path");
const fs = require("fs");
const ClassroomDevice = require("../models/ClassroomDevice");
const Recording = require("../models/Recording");
const ScheduledClass = require("../models/ScheduledClass");
const Attendance = require("../models/Attendance");

// ============ DEVICE ENDPOINTS ============

// POST /api/classroom-recording/devices/register
exports.registerDevice = async (req, res) => {
  try {
    const {
      name, roomId, roomName, building, floor, roomNumber,
      ipAddress, deviceType, deviceModel, osVersion, macAddress,
    } = req.body;

    // Check if device with same macAddress or same room already exists
    let device = null;
    if (macAddress) {
      device = await ClassroomDevice.findOne({ macAddress });
    }

    if (device) {
      // Re-register: update info
      device.name = name || device.name;
      device.roomId = roomId || device.roomId;
      device.roomName = roomName || device.roomName;
      device.roomNumber = roomNumber || roomId || device.roomNumber;
      device.building = building || device.building;
      device.floor = floor || device.floor;
      device.ipAddress = ipAddress || device.ipAddress;
      device.deviceType = deviceType || device.deviceType;
      device.deviceModel = deviceModel || device.deviceModel;
      device.osVersion = osVersion || device.osVersion;
      device.isActive = true;
      await device.save();
    } else {
      device = await ClassroomDevice.create({
        name: name || `Smart TV - ${roomName || roomId}`,
        roomId,
        roomName: roomName || `Room ${roomId}`,
        roomNumber: roomNumber || roomId,
        building,
        floor,
        ipAddress,
        deviceType: deviceType || "android",
        deviceModel,
        osVersion,
        macAddress,
      });
    }

    res.json({
      message: "Device registered",
      setupConfig: {
        deviceId: device.deviceId,
        authToken: device.authToken,
        apiUrl: `${req.protocol}://${req.get("host")}/api`,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// POST /api/classroom-recording/devices/:deviceId/heartbeat
exports.heartbeat = async (req, res) => {
  try {
    const device = req.device;
    device.lastHeartbeat = new Date();
    device.isOnline = true;
    if (req.body.ipAddress) device.ipAddress = req.body.ipAddress;
    await device.save();

    // Get today's schedule for this device's room
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const roomNumber = device.roomNumber || device.roomId;

    const classes = await ScheduledClass.find({
      roomNumber,
      date: { $gte: today, $lt: tomorrow },
      status: { $ne: "cancelled" },
    }).sort({ startTime: 1 });

    // Check which classes already have recordings
    const classIds = classes.map((c) => c._id);
    const existingRecordings = await Recording.find({
      scheduledClass: { $in: classIds },
      status: { $in: ["completed", "recording", "uploading"] },
    });
    const recordedClassIds = new Set(
      existingRecordings.map((r) => r.scheduledClass.toString())
    );

    // Format schedule for APK
    const schedule = classes.map((cls) => {
      // Build ISO date from cls.date + cls.startTime / cls.endTime
      // Times are stored as IST (local), convert to UTC by using +05:30 offset
      const dateStr = cls.date.toISOString().split("T")[0];
      const startISO = new Date(`${dateStr}T${cls.startTime}:00.000+05:30`).toISOString();
      const endISO = new Date(`${dateStr}T${cls.endTime}:00.000+05:30`).toISOString();

      return {
        meetingId: cls._id.toString(),
        title: cls.title,
        courseName: cls.courseName,
        courseCode: cls.courseCode,
        teacherName: cls.teacher,
        start: startISO,
        end: endISO,
        alreadyRecorded: recordedClassIds.has(cls._id.toString()),
        courseId: null,
        semesterId: null,
        teacherId: null,
      };
    });

    // Check for active session
    let activeSession = null;
    if (device.isRecording && device.currentMeetingId) {
      const rec = await Recording.findOne({
        scheduledClass: device.currentMeetingId,
        status: "recording",
      });
      if (rec) {
        activeSession = {
          recordingId: rec._id.toString(),
          meetingId: device.currentMeetingId,
          activeSource: "android",
          segmentCount: 0,
        };
      }
    }

    res.json({
      schedule,
      serverTime: new Date().toISOString(),
      forceStop: false,
      activeSession,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// GET /api/classroom-recording/devices
exports.getDevices = async (_req, res) => {
  try {
    const devices = await ClassroomDevice.find({ isActive: true }).sort({
      createdAt: -1,
    });
    // Mark offline if no heartbeat in 5 min
    const now = Date.now();
    for (const d of devices) {
      if (d.lastHeartbeat && now - d.lastHeartbeat.getTime() > 5 * 60 * 1000) {
        d.isOnline = false;
      }
    }
    res.json(devices);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// DELETE /api/classroom-recording/devices/:id
exports.deleteDevice = async (req, res) => {
  try {
    await ClassroomDevice.findByIdAndDelete(req.params.id);
    res.json({ message: "Deleted" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// POST /api/classroom-recording/devices/:deviceId/force-start
exports.forceStart = async (req, res) => {
  try {
    const device = await ClassroomDevice.findOne({ deviceId: req.params.deviceId });
    if (!device) return res.status(404).json({ error: "Device not found" });
    device.isRecording = true;
    await device.save();
    res.json({ message: "Force start sent" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// POST /api/classroom-recording/devices/:deviceId/force-stop
exports.forceStop = async (req, res) => {
  try {
    const device = await ClassroomDevice.findOne({ deviceId: req.params.deviceId });
    if (!device) return res.status(404).json({ error: "Device not found" });
    device.isRecording = false;
    device.currentMeetingId = null;
    await device.save();
    res.json({ message: "Force stop sent" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ============ RECORDING SESSION ENDPOINTS ============

// POST /api/classroom-recording/recordings/session
exports.findOrCreateSession = async (req, res) => {
  try {
    const { meetingId, deviceId, source } = req.body;
    if (!meetingId) {
      return res.status(400).json({ error: "meetingId required" });
    }

    // Check if recording already exists for this meeting
    let recording = await Recording.findOne({ scheduledClass: meetingId });

    // Generate HMAC secret for QR
    const hmacSecret = crypto.randomBytes(32).toString("hex");

    if (recording && recording.status !== "failed") {
      // Update to recording status if not already
      if (recording.status !== "recording") {
        recording.status = "recording";
        recording.recordingStart = new Date();
        await recording.save();
      }

      // Update attendance session with this hmac secret
      await Attendance.findOneAndUpdate(
        { scheduledClass: meetingId },
        { qrSecret: hmacSecret },
        { upsert: true, setDefaultsOnInsert: true }
      );

      // Mark device as recording
      if (deviceId) {
        await ClassroomDevice.findOneAndUpdate(
          { deviceId },
          { isRecording: true, currentMeetingId: meetingId }
        );
      }

      return res.json({
        recordingId: recording._id.toString(),
        isNew: false,
        hmacSecret,
      });
    }

    // Create new recording
    const cls = await ScheduledClass.findById(meetingId);
    recording = await Recording.create({
      scheduledClass: meetingId,
      title: cls ? `Recording - ${cls.title}` : `Recording - ${meetingId}`,
      status: "recording",
      recordingStart: new Date(),
      isPublished: false,
      videoUrl: "",
      duration: 0,
      fileSize: 0,
    });

    // Update class status
    if (cls) {
      cls.status = "live";
      await cls.save();
    }

    // Create/update attendance session
    await Attendance.findOneAndUpdate(
      { scheduledClass: meetingId },
      {
        scheduledClass: meetingId,
        qrSecret: hmacSecret,
        $setOnInsert: { attendees: [] },
      },
      { upsert: true, new: true }
    );

    // Mark device as recording
    if (deviceId) {
      await ClassroomDevice.findOneAndUpdate(
        { deviceId },
        { isRecording: true, currentMeetingId: meetingId }
      );
    }

    res.json({
      recordingId: recording._id.toString(),
      isNew: true,
      hmacSecret,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// POST /api/classroom-recording/recordings/:recordingId/segment-upload
exports.segmentUpload = async (req, res) => {
  try {
    const { recordingId } = req.params;
    const recording = await Recording.findById(recordingId);
    if (!recording) {
      return res.status(404).json({ error: "Recording not found" });
    }

    // Handle file upload - store locally in uploads/
    const uploadsDir = path.join(__dirname, "..", "uploads");
    if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

    let fileSize = 0;
    let savedFilePath = "";

    if (req.files && req.files.video) {
      const videoFile = req.files.video;
      savedFilePath = path.join(uploadsDir, `${recordingId}_${Date.now()}.mp4`);
      await videoFile.mv(savedFilePath);
      fileSize = videoFile.size;
    } else if (req.file) {
      savedFilePath = req.file.path;
      fileSize = req.file.size;
    }

    // Update recording
    const duration = parseInt(req.body.duration) || 0;
    recording.status = "completed";
    recording.recordingEnd = new Date();
    recording.fileSize = (recording.fileSize || 0) + fileSize;
    recording.duration = (recording.duration || 0) + duration;
    recording.isPublished = true;
    if (savedFilePath) {
      recording.videoUrl = `/uploads/${path.basename(savedFilePath)}`;
    }
    await recording.save();

    // Update class status
    await ScheduledClass.findByIdAndUpdate(recording.scheduledClass, {
      status: "completed",
    });

    // Mark device as not recording
    const deviceId = req.headers["x-device-id"];
    if (deviceId) {
      await ClassroomDevice.findOneAndUpdate(
        { deviceId },
        { isRecording: false, currentMeetingId: null }
      );
    }

    res.json({ message: "Segment uploaded", recordingId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// POST /api/classroom-recording/recordings/:recordingId/active-source
exports.updateActiveSource = async (req, res) => {
  try {
    const { recordingId } = req.params;
    const { source } = req.body;
    // Just acknowledge — we track via device model
    res.json({ message: "Active source updated", source, recordingId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// POST /api/classroom-recording/recordings/:recordingId/merge
exports.triggerMerge = async (req, res) => {
  try {
    const { recordingId } = req.params;
    const recording = await Recording.findById(recordingId);
    if (!recording) {
      return res.status(404).json({ error: "Recording not found" });
    }
    // For demo, just mark as completed
    if (recording.status !== "completed") {
      recording.status = "completed";
      recording.isPublished = true;
      await recording.save();
    }
    res.json({ message: "Merge triggered", recordingId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ============ DASHBOARD ============

// GET /api/classroom-recording/dashboard
exports.dashboard = async (_req, res) => {
  try {
    const totalDevices = await ClassroomDevice.countDocuments({ isActive: true });
    const onlineDevices = await ClassroomDevice.countDocuments({
      isActive: true,
      lastHeartbeat: { $gte: new Date(Date.now() - 5 * 60 * 1000) },
    });
    const recordingDevices = await ClassroomDevice.countDocuments({
      isActive: true,
      isRecording: true,
    });
    const totalRecordings = await Recording.countDocuments();
    const completedRecordings = await Recording.countDocuments({ status: "completed" });

    res.json({
      totalDevices,
      onlineDevices,
      recordingDevices,
      totalRecordings,
      completedRecordings,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
