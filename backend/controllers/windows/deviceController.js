const WindowsDevice = require("../../models/windows/WindowsDevice");
const WindowsDeviceCommand = require("../../models/windows/WindowsDeviceCommand");
const WindowsLicense = require("../../models/windows/WindowsLicense");
const ScheduledClass = require("../../models/ScheduledClass");
const WindowsRecording = require("../../models/windows/WindowsRecording");
const WindowsAppVersion = require("../../models/windows/WindowsAppVersion");

/**
 * POST /api/windows/devices/register
 * Public endpoint — installer calls on first run to register the PC.
 * Returns deviceId + authToken which the client stores locally.
 */
exports.register = async (req, res) => {
  try {
    const {
      name, roomNumber,
      campus, block, floor, spaceCode,
      hardwareModel, cpuModel, osVersion, macAddress, hardwareFingerprint,
      detectedHardware,
    } = req.body;

    if (!name || !roomNumber) {
      return res.status(400).json({ error: "name and roomNumber are required" });
    }

    // If a device with this fingerprint already exists, return its credentials
    // (and refresh its location info — operator may have moved the Mini PC).
    if (hardwareFingerprint) {
      const existing = await WindowsDevice.findOne({ hardwareFingerprint });
      if (existing) {
        existing.name = name;
        existing.roomNumber = roomNumber;
        if (campus !== undefined)    existing.campus    = campus;
        if (block !== undefined)     existing.block     = block;
        if (floor !== undefined)     existing.floor     = floor;
        if (spaceCode !== undefined) existing.spaceCode = spaceCode;
        if (detectedHardware && Object.keys(detectedHardware).length > 0) {
          existing.detectedHardware = detectedHardware;
        }
        await existing.save();
        return res.json({
          deviceId: existing.deviceId,
          authToken: existing.authToken,
          message: "Existing device — returning credentials",
        });
      }
    }

    const device = await WindowsDevice.create({
      name,
      roomNumber,
      campus: campus || "",
      block: block || "",
      floor: floor || "",
      spaceCode: spaceCode || "",
      hardwareModel,
      cpuModel,
      osVersion,
      macAddress,
      hardwareFingerprint,
      detectedHardware: detectedHardware || undefined,
    });

    res.status(201).json({
      deviceId: device.deviceId,
      authToken: device.authToken,
      message: "Device registered — store these credentials in appsettings.json",
    });
  } catch (err) {
    console.error("[Windows/register] Error:", err);
    res.status(500).json({ error: err.message });
  }
};

/**
 * POST /api/windows/devices/:deviceId/heartbeat
 * Auth: windowsDeviceAuth middleware
 * Body: { appVersionCode, appVersionName, ipAddress, isRecording, currentClassId, license, health }
 * Response: { schedule, commands, license, appUpdate, serverTime }
 */
exports.heartbeat = async (req, res) => {
  try {
    const device = req.device;
    const body = req.body || {};

    device.lastHeartbeat = new Date();
    device.isOnline = true;
    if (body.ipAddress) device.ipAddress = body.ipAddress;
    if (typeof body.appVersionCode === "number") device.appVersionCode = body.appVersionCode;
    if (body.appVersionName) device.appVersionName = body.appVersionName;
    if (typeof body.isRecording === "boolean") device.isRecording = body.isRecording;

    if (body.health) {
      device.health = { ...(device.health || {}), ...body.health, updatedAt: new Date() };
    }

    // Camera/mic/network alerts
    const alerts = device.alerts || [];
    if (body.health?.network?.latencyMs && body.health.network.latencyMs > 1000) {
      alerts.push({
        type: "network",
        message: `High latency: ${body.health.network.latencyMs}ms`,
        time: new Date(),
      });
    }
    if (body.health?.camera && !body.health.camera.ok) {
      alerts.push({
        type: "camera",
        message: body.health.camera.error || "Camera not detected",
        time: new Date(),
      });
    }
    device.alerts = alerts;

    try {
      await device.save();
    } catch (saveErr) {
      console.warn(`[WinHeartbeat] device.save() failed (continuing): ${saveErr.message}`);
    }

    // ── Build schedule for the relevant time window ─────────────────
    // We send the device a 48-hour window (yesterday + today + tomorrow) so
    // that timezone boundaries don't drop classes on the floor:
    //
    //   - Server runs in UTC; admin portal users schedule in IST.
    //   - A class whose date is "2026-05-06T00:00Z" has startTime "00:17"
    //     interpreted as IST -> actual fire window is 2026-05-05 18:47 UTC.
    //     A strict { $gte: todayUTC, $lt: tomorrowUTC } filter would have
    //     EXCLUDED this class on the boundary day.
    //   - The device's RecordingManager.ProcessScheduleAsync compares the
    //     full UTC start/end ISO timestamps against DateTime.UtcNow, so
    //     sending a wider window is safe — only classes whose computed
    //     start <= now < end fire recording.
    const oneDayMs = 24 * 60 * 60 * 1000;
    const windowStart = new Date(Date.now() - oneDayMs);
    windowStart.setHours(0, 0, 0, 0);
    const windowEnd = new Date(Date.now() + 2 * oneDayMs);
    windowEnd.setHours(0, 0, 0, 0);

    const classes = await ScheduledClass.find({
      roomNumber: device.roomNumber,
      date: { $gte: windowStart, $lt: windowEnd },
      status: { $ne: "cancelled" },
    }).sort({ date: 1, startTime: 1 });

    const classIds = classes.map((c) => c._id);

    // Find which classes already have Windows recordings (avoid double-record)
    const existingRecordings = await WindowsRecording.find({
      scheduledClass: { $in: classIds },
      status: { $in: ["recording", "uploading", "merging", "completed"] },
    }).select("scheduledClass");
    const recordedSet = new Set(existingRecordings.map((r) => r.scheduledClass.toString()));

    const schedule = classes.map((cls) => {
      const dateStr = cls.date.toISOString().split("T")[0];
      const startISO = new Date(`${dateStr}T${cls.startTime}:00.000+05:30`).toISOString();
      const endISO = new Date(`${dateStr}T${cls.endTime}:00.000+05:30`).toISOString();
      return {
        meetingId: cls._id.toString(),
        title: cls.title,
        courseName: cls.courseName,
        teacherName: cls.teacherName,
        start: startISO,
        end: endISO,
        alreadyRecorded: recordedSet.has(cls._id.toString()),
      };
    });

    // ── License validation ─────────────────────────────────────────
    // Stock licenses are created with status="issued" (sold but not yet bound
    // to a device). The first heartbeat from a real device with a valid
    // fingerprint activates the license: status flips to "active", boundDevice
    // gets set, recording is enabled. Subsequent heartbeats just re-validate
    // the existing "active" state.
    let licenseStatus = null;
    if (body.license?.key) {
      const lic = await WindowsLicense.findOne({ licenseKey: body.license.key });
      if (lic) {
        const notExpired = !lic.expiresAt || lic.expiresAt > new Date();
        // "issued" or "active" both count as valid as long as not expired.
        // "expired" / "revoked" / "suspended" are explicitly invalid.
        const validStatus = ["issued", "active"].includes(lic.status);
        const valid = validStatus && notExpired;

        licenseStatus = {
          valid,
          tier: lic.tier,
          expiresAt: lic.expiresAt,
          features: lic.features,
        };

        // Auto-bind on first valid heartbeat from a fingerprinted device
        if (valid && !lic.boundDeviceId && body.license.fingerprint) {
          lic.boundDevice = device._id;
          lic.boundDeviceId = device.deviceId;
          lic.boundAt = new Date();
          lic.hardwareFingerprint = body.license.fingerprint;
          lic.activatedAt = lic.activatedAt || new Date();
          // Transition issued -> active on first activation
          if (lic.status === "issued") lic.status = "active";
        }
        lic.lastValidatedAt = new Date();
        await lic.save();

        // Update device's license summary
        device.licenseKey = lic.licenseKey;
        device.licenseTier = lic.tier;
        device.licenseExpiresAt = lic.expiresAt;
        device.licenseStatus = valid ? "active" : "expired";
        await device.save().catch(() => {});
      }
    }

    // ── Pending commands for this device ──────────────────────────
    let pendingCommands = [];
    let pendingIds = [];
    try {
      const cmds = await WindowsDeviceCommand.find({
        deviceId: device.deviceId,
        status: "pending",
      })
        .sort({ issuedAt: 1 })
        .lean();

      pendingCommands = cmds.map((c) => ({
        id: c._id.toString(),
        command: c.command,
        params: c.params || {},
      }));
      pendingIds = cmds.map((c) => c._id);
    } catch (cmdErr) {
      console.error("[WinHeartbeat] Command lookup failed:", cmdErr.message);
    }

    // ── App update check — Windows .exe OTA ──────────────────────
    let appUpdate = null;
    try {
      const deviceVc = parseInt(body.appVersionCode) || 0;
      const active = await WindowsAppVersion.findOne({ isActive: true })
        .select("versionCode versionName exeSize releaseNotes sha256")
        .sort({ versionCode: -1 });
      if (active && active.versionCode > deviceVc) {
        const proto = req.get("x-forwarded-proto") || req.protocol || "https";
        const scheme = proto === "http" ? "https" : proto;
        appUpdate = {
          versionCode: active.versionCode,
          versionName: active.versionName,
          exeSize: active.exeSize,
          sha256: active.sha256,
          releaseNotes: active.releaseNotes || "",
          downloadUrl: `${scheme}://${req.get("host")}/api/windows/app/download`,
        };
      }
    } catch (updateErr) {
      console.error("[WinHeartbeat] appUpdate check failed:", updateErr.message);
    }

    res.json({
      schedule,
      commands: pendingCommands,
      license: licenseStatus,
      appUpdate,
      serverTime: new Date().toISOString(),
    });

    // Mark commands acknowledged (fire-and-forget)
    if (pendingIds.length > 0) {
      WindowsDeviceCommand.updateMany(
        { _id: { $in: pendingIds } },
        { status: "acknowledged", acknowledgedAt: new Date() }
      ).catch((err) => console.error("[WinHeartbeat] Ack update failed:", err.message));
    }
  } catch (err) {
    console.error("[Windows/heartbeat] Error:", err);
    res.status(500).json({ error: err.message });
  }
};

/**
 * GET /api/windows/devices/blob-config
 * Device-authenticated. Returns Azure Blob credentials so the device can
 * upload chunks + merged recordings directly. Backend env owns the secret;
 * the device receives the connection string at runtime (no hardcoding in
 * the .exe). Service caches in memory + re-fetches on each service start.
 *
 * Tradeoff: every authenticated device sees the full connection string. For
 * pilot/school deployments where devices are physically secured this is OK.
 * Production hardening (v2.x): switch to short-lived SAS tokens scoped to
 * each device's recording prefix.
 */
exports.blobConfig = async (_req, res) => {
  try {
    const cs = process.env.AZURE_STORAGE_CONNECTION_STRING || "";
    if (!cs) {
      return res.status(503).json({
        error: "Azure Blob not configured on backend (AZURE_STORAGE_CONNECTION_STRING env missing)",
      });
    }
    const container = process.env.AZURE_STORAGE_CONTAINER || "lms-storage";
    const prefix = process.env.AZURE_BLOB_PREFIX || "physical-class-recordings";

    res.json({
      connectionString: cs,
      container,
      pathPrefix: prefix,
    });
  } catch (err) {
    console.error("[Windows/blobConfig] Error:", err);
    res.status(500).json({ error: err.message });
  }
};

/**
 * GET /api/windows/devices  (admin)
 */
exports.list = async (_req, res) => {
  try {
    const devices = await WindowsDevice.find({ isActive: true }).sort({ createdAt: -1 });

    // Mark offline if no heartbeat in 5 min
    const now = Date.now();
    const staleIds = devices
      .filter((d) => d.isOnline && d.lastHeartbeat && now - d.lastHeartbeat.getTime() > 5 * 60 * 1000)
      .map((d) => d._id);

    if (staleIds.length > 0) {
      try {
        await WindowsDevice.updateMany({ _id: { $in: staleIds } }, { isOnline: false });
      } catch (e) {
        console.warn(`[WinList] stale-mark failed: ${e.message}`);
      }
      for (const d of devices) {
        if (staleIds.some((id) => id.equals(d._id))) d.isOnline = false;
      }
    }

    res.json({ devices });
  } catch (err) {
    console.error("[Windows/list] Error:", err);
    res.status(500).json({ error: err.message });
  }
};

/**
 * GET /api/windows/devices/:id  (admin)
 */
exports.get = async (req, res) => {
  try {
    const device = await WindowsDevice.findOne({
      $or: [{ _id: req.params.id }, { deviceId: req.params.id }],
    });
    if (!device) return res.status(404).json({ error: "Device not found" });
    res.json(device);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/**
 * POST /api/windows/devices/:id/command  (admin)
 * Body: { command, params }
 */
exports.issueCommand = async (req, res) => {
  try {
    const { command, params } = req.body;
    if (!command) return res.status(400).json({ error: "command is required" });

    const device = await WindowsDevice.findOne({
      $or: [{ _id: req.params.id }, { deviceId: req.params.id }],
    });
    if (!device) return res.status(404).json({ error: "Device not found" });

    const cmd = await WindowsDeviceCommand.create({
      deviceId: device.deviceId,
      command,
      params: params || {},
      issuedBy: req.user?.email || "unknown",
    });

    res.status(201).json({ message: "Command queued", command: cmd });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/**
 * GET /api/windows/devices/:id/commands  (admin)
 */
exports.listCommands = async (req, res) => {
  try {
    const device = await WindowsDevice.findOne({
      $or: [{ _id: req.params.id }, { deviceId: req.params.id }],
    });
    if (!device) return res.status(404).json({ error: "Device not found" });

    const limit = Math.min(parseInt(req.query.limit || "20"), 100);
    const cmds = await WindowsDeviceCommand.find({ deviceId: device.deviceId })
      .sort({ issuedAt: -1 })
      .limit(limit);
    res.json(cmds);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/**
 * DELETE /api/windows/devices/:id  (admin)
 */
exports.deregister = async (req, res) => {
  try {
    const device = await WindowsDevice.findOneAndUpdate(
      { $or: [{ _id: req.params.id }, { deviceId: req.params.id }] },
      { isActive: false },
      { new: true }
    );
    if (!device) return res.status(404).json({ error: "Device not found" });
    res.json({ message: "Device deactivated", device });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
