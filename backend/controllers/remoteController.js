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

/**
 * Authorization guard: ensure authenticated device matches URL deviceId.
 * Prevents device-A from accessing device-B's commands/data.
 */
function enforceDeviceOwnership(req, res) {
  if (req.device && req.device.deviceId !== req.params.deviceId) {
    res.status(403).json({ error: "Device ID mismatch — cannot access another device's data" });
    return false;
  }
  return true;
}

// GET /api/remote/device/:deviceId/pending-commands — Device polls for pending commands
exports.getPendingCommands = async (req, res) => {
  try {
    if (!enforceDeviceOwnership(req, res)) return;

    const { deviceId } = req.params;
    const commands = await DeviceCommand.find({
      deviceId,
      status: "pending",
    }).sort({ issuedAt: 1 }).lean();

    res.json(commands);

    // Mark as acknowledged AFTER response is sent (fire-and-forget)
    if (commands.length > 0) {
      const ids = commands.map(c => c._id);
      DeviceCommand.updateMany(
        { _id: { $in: ids } },
        { status: "acknowledged", acknowledgedAt: new Date() }
      ).catch(err => console.error("[Remote] Command ack failed:", err.message));
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// POST /api/remote/device/:deviceId/command-result — Device reports command execution result
exports.reportCommandResult = async (req, res) => {
  try {
    if (!enforceDeviceOwnership(req, res)) return;

    const { commandId, status, result } = req.body;
    console.log(`[Remote] Command result received: cmdId=${commandId} status=${status} result=${(result || "").substring(0, 100)} device=${req.params.deviceId}`);

    if (!commandId) return res.status(400).json({ error: "commandId required" });

    // Validate ObjectId format before querying
    if (!commandId.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({ error: "Invalid commandId format" });
    }

    // Verify the command belongs to this device
    const cmd = await DeviceCommand.findById(commandId);
    if (!cmd) {
      console.warn(`[Remote] Command not found: ${commandId}`);
      return res.status(404).json({ error: "Command not found" });
    }
    if (cmd.deviceId !== req.params.deviceId) {
      return res.status(403).json({ error: "Command does not belong to this device" });
    }

    cmd.status = status === "failed" ? "failed" : "completed";
    cmd.result = result || "";
    cmd.completedAt = new Date();
    await cmd.save();

    console.log(`[Remote] Command ${cmd.command} (${commandId}) → ${cmd.status}`);
    res.json({ ok: true });
  } catch (err) {
    console.error(`[Remote] Command result error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
};

// POST /api/remote/device/:deviceId/thumbnail — Device uploads a recording screenshot
exports.uploadThumbnail = async (req, res) => {
  try {
    if (!enforceDeviceOwnership(req, res)) return;

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
    if (!enforceDeviceOwnership(req, res)) return;

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
