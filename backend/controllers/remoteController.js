const DeviceCommand = require("../models/DeviceCommand");
const DeviceThumbnail = require("../models/DeviceThumbnail");
const DeviceLog = require("../models/DeviceLog");

/**
 * Remote Management Controller
 *
 * Admin-facing endpoints to send commands, view thumbnails, and read logs.
 * Device-facing endpoints to receive commands, upload thumbnails/logs.
 */

// ════════════════════════════════════════════════════════════════════
// ADMIN ENDPOINTS (require auth + adminOnly)
// ════════════════════════════════════════════════════════════════════

// POST /api/remote/command — Send a command to a device
exports.sendCommand = async (req, res) => {
  try {
    const { deviceId, command, params } = req.body;
    if (!deviceId || !command) {
      return res.status(400).json({ error: "deviceId and command are required" });
    }

    const cmd = await DeviceCommand.create({
      deviceId,
      command,
      params: params || {},
      issuedBy: req.user?.name || req.user?.email || "admin",
    });

    console.log(`[Remote] Command sent: ${command} → ${deviceId} by ${cmd.issuedBy}`);
    res.status(201).json({ message: "Command queued", command: cmd });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// GET /api/remote/commands/:deviceId — Get command history for a device
exports.getCommands = async (req, res) => {
  try {
    const { deviceId } = req.params;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const commands = await DeviceCommand.find({ deviceId })
      .sort({ issuedAt: -1 })
      .limit(limit)
      .lean();
    res.json(commands);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// GET /api/remote/thumbnails/:deviceId — Get recent thumbnails for a device
exports.getThumbnails = async (req, res) => {
  try {
    const { deviceId } = req.params;
    const limit = Math.min(parseInt(req.query.limit) || 12, 50);
    const thumbnails = await DeviceThumbnail.find({ deviceId })
      .sort({ timestamp: -1 })
      .limit(limit)
      .lean();
    res.json(thumbnails);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// GET /api/remote/thumbnails/:deviceId/latest — Get latest thumbnail only
exports.getLatestThumbnail = async (req, res) => {
  try {
    const { deviceId } = req.params;
    const thumb = await DeviceThumbnail.findOne({ deviceId })
      .sort({ timestamp: -1 })
      .lean();
    if (!thumb) return res.status(404).json({ error: "No thumbnails available" });
    res.json(thumb);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// GET /api/remote/logs/:deviceId — Get recent logs for a device
exports.getLogs = async (req, res) => {
  try {
    const { deviceId } = req.params;
    const limit = Math.min(parseInt(req.query.limit) || 10, 50);
    const logs = await DeviceLog.find({ deviceId })
      .sort({ timestamp: -1 })
      .limit(limit)
      .lean();
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ════════════════════════════════════════════════════════════════════
// DEVICE ENDPOINTS (require deviceAuth)
// ════════════════════════════════════════════════════════════════════

// GET /api/remote/device/:deviceId/pending-commands — Device polls for pending commands
exports.getPendingCommands = async (req, res) => {
  try {
    const { deviceId } = req.params;
    const commands = await DeviceCommand.find({
      deviceId,
      status: "pending",
    }).sort({ issuedAt: 1 }).lean();

    // Mark as acknowledged
    if (commands.length > 0) {
      const ids = commands.map(c => c._id);
      await DeviceCommand.updateMany(
        { _id: { $in: ids } },
        { status: "acknowledged", acknowledgedAt: new Date() }
      );
    }

    res.json(commands);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// POST /api/remote/device/:deviceId/command-result — Device reports command execution result
exports.reportCommandResult = async (req, res) => {
  try {
    const { commandId, status, result } = req.body;
    if (!commandId) return res.status(400).json({ error: "commandId required" });

    await DeviceCommand.findByIdAndUpdate(commandId, {
      status: status === "failed" ? "failed" : "completed",
      result: result || "",
      completedAt: new Date(),
    });

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// POST /api/remote/device/:deviceId/thumbnail — Device uploads a recording screenshot
exports.uploadThumbnail = async (req, res) => {
  try {
    const { deviceId } = req.params;
    const { imageData, recordingId, audioLevel } = req.body;

    if (!imageData) return res.status(400).json({ error: "imageData (base64) required" });

    // Estimate size (base64 is ~33% larger than binary)
    const imageSize = Math.round(imageData.length * 0.75);

    await DeviceThumbnail.create({
      deviceId,
      recordingId,
      imageData,
      imageSize,
      audioLevel: audioLevel != null ? parseFloat(audioLevel) : null,
    });

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// POST /api/remote/device/:deviceId/logs — Device uploads logcat
exports.uploadLogs = async (req, res) => {
  try {
    const { deviceId } = req.params;
    const device = req.device;
    const { logText, trigger, lineCount } = req.body;

    if (!logText) return res.status(400).json({ error: "logText required" });

    await DeviceLog.create({
      deviceId,
      deviceName: device?.name || deviceId,
      logText: logText.substring(0, 500000), // cap at 500KB
      lineCount: lineCount || logText.split("\n").length,
      trigger: trigger || "manual",
    });

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
