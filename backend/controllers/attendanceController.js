const crypto = require("crypto");
const QRCode = require("qrcode");
const Attendance = require("../models/Attendance");
const ScheduledClass = require("../models/ScheduledClass");

// POST /api/attendance/generate-qr/:classId — admin generates QR for a class
exports.generateQr = async (req, res) => {
  try {
    const { classId } = req.params;

    let attendance = await Attendance.findOne({ scheduledClass: classId });
    if (!attendance) {
      attendance = await Attendance.create({
        scheduledClass: classId,
        qrSecret: crypto.randomBytes(32).toString("hex"),
        attendees: [],
      });
    }

    // Create HMAC-signed token (same concept as main system)
    const payload = JSON.stringify({
      c: classId,
      t: Math.floor(Date.now() / 1000),
      n: crypto.randomBytes(8).toString("hex"),
    });
    const signature = crypto
      .createHmac("sha256", attendance.qrSecret)
      .update(payload)
      .digest("base64url");
    const token = Buffer.from(payload).toString("base64url") + "." + signature;

    // QR data points to student portal
    const studentPortalUrl = process.env.STUDENT_PORTAL_URL || "http://localhost:5175";
    const qrData = `${studentPortalUrl}/attend?token=${token}`;

    const qrImageDataUrl = await QRCode.toDataURL(qrData, {
      width: 300,
      margin: 2,
      color: { dark: "#000000", light: "#FFFFFF" },
    });

    res.json({
      qrCode: qrImageDataUrl,
      qrData,
      token,
      expiresIn: 45,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// POST /api/attendance/verify — student scans QR and verifies
exports.verify = async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: "Token required" });

    let classId, tokenTime;

    // Try APK format first: JSON string like {"mid":"xxx","ts":123,"sig":"abcd1234"}
    try {
      const parsed = JSON.parse(token);
      if (parsed.mid && parsed.ts && parsed.sig) {
        classId = parsed.mid;
        tokenTime = parsed.ts;

        const attendance = await Attendance.findOne({ scheduledClass: classId });
        if (!attendance) {
          return res.status(404).json({ error: "Attendance session not found" });
        }

        // Verify APK HMAC: HMAC-SHA256("<meetingId>:<timestamp>", secret) → first 8 hex chars
        const expectedFull = crypto
          .createHmac("sha256", attendance.qrSecret)
          .update(`${classId}:${tokenTime}`)
          .digest("hex");
        const expectedSig = expectedFull.substring(0, 8);

        if (expectedSig !== parsed.sig) {
          return res.status(400).json({ error: "Invalid QR code" });
        }

        // Check expiry (45 seconds)
        const now = Math.floor(Date.now() / 1000);
        if (now - tokenTime > 45) {
          return res.status(400).json({ error: "QR code expired. Ask teacher to show a new one." });
        }

        // Fall through to mark attendance below
        req._attendance = attendance;
        req._classId = classId;
      }
    } catch {
      // Not JSON — try base64url format from admin portal
    }

    if (!req._attendance) {
      // Admin portal format: base64url(payload).signature
      const [payloadB64, signature] = token.split(".");
      if (!payloadB64 || !signature) {
        return res.status(400).json({ error: "Invalid token format" });
      }

      const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString());
      classId = payload.c;
      tokenTime = payload.t;

      // Check expiry (45 seconds)
      const now = Math.floor(Date.now() / 1000);
      if (now - tokenTime > 45) {
        return res.status(400).json({ error: "QR code expired. Ask teacher to show a new one." });
      }

      const attendance = await Attendance.findOne({ scheduledClass: classId });
      if (!attendance) {
        return res.status(404).json({ error: "Attendance session not found" });
      }

      // Verify HMAC signature
      const expectedSig = crypto
        .createHmac("sha256", attendance.qrSecret)
        .update(Buffer.from(payloadB64, "base64url").toString())
        .digest("base64url");

      if (expectedSig !== signature) {
        return res.status(400).json({ error: "Invalid QR code" });
      }

      req._attendance = attendance;
      req._classId = classId;
    }

    const attendance = req._attendance;
    classId = req._classId;

    // Check if already marked
    const alreadyMarked = attendance.attendees.some(
      (a) => a.student.toString() === req.user._id.toString()
    );
    if (alreadyMarked) {
      return res.json({ message: "Attendance already marked", alreadyMarked: true });
    }

    // Mark attendance
    attendance.attendees.push({
      student: req.user._id,
      name: req.user.name,
      rollNumber: req.user.rollNumber || "",
      scannedAt: new Date(),
      verified: true,
    });
    await attendance.save();

    const cls = await ScheduledClass.findById(classId);

    res.json({
      message: "Attendance marked successfully!",
      alreadyMarked: false,
      className: cls?.title || "Class",
      courseName: cls?.courseName || "",
      scannedAt: new Date(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// GET /api/attendance/:classId — get attendance for a class
exports.getByClass = async (req, res) => {
  try {
    const attendance = await Attendance.findOne({
      scheduledClass: req.params.classId,
    }).populate("attendees.student", "name email rollNumber");

    if (!attendance) {
      return res.json({ attendees: [], scheduledClass: req.params.classId });
    }
    res.json(attendance);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// GET /api/attendance/my — student gets their attendance history
exports.getMyAttendance = async (req, res) => {
  try {
    const attendances = await Attendance.find({
      "attendees.student": req.user._id,
    }).populate("scheduledClass", "title courseName courseCode date startTime endTime roomNumber");

    const result = attendances.map((a) => {
      const myEntry = a.attendees.find(
        (att) => att.student.toString() === req.user._id.toString()
      );
      return {
        classId: a.scheduledClass?._id,
        title: a.scheduledClass?.title,
        courseName: a.scheduledClass?.courseName,
        courseCode: a.scheduledClass?.courseCode,
        date: a.scheduledClass?.date,
        startTime: a.scheduledClass?.startTime,
        endTime: a.scheduledClass?.endTime,
        roomNumber: a.scheduledClass?.roomNumber,
        scannedAt: myEntry?.scannedAt,
      };
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
