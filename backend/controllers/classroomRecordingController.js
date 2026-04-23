const crypto = require("crypto");
const path = require("path");
const fs = require("fs");
const mongoose = require("mongoose");
const ClassroomDevice = require("../models/ClassroomDevice");
const Recording = require("../models/Recording");
const ScheduledClass = require("../models/ScheduledClass");
const Attendance = require("../models/Attendance");
const Room = require("../models/Room");
const License = require("../models/License");
const AppVersion = require("../models/AppVersion");
const HealthSnapshot = require("../models/HealthSnapshot");
const DeviceCommand = require("../models/DeviceCommand");
const { uploadToBlob, isAzureConfigured } = require("../utils/azureBlob");

// ============ DEVICE ENDPOINTS ============

// POST /api/classroom-recording/devices/register
exports.registerDevice = async (req, res) => {
  try {
    const {
      name, roomId, roomName, floor, roomNumber,
      ipAddress, deviceType, deviceModel, osVersion, macAddress,
      campus, block, spaceType, capacity,
      spaceCode,    // auto-generated unique code e.g. C25-BA-F3-R101
      licenseKey,   // required for first-time registration
    } = req.body;

    // ── Validate required fields ─────────────────────────────────────────────
    const resolvedRoomNumber = roomNumber || roomId;
    if (!resolvedRoomNumber) return res.status(400).json({ error: "roomNumber (or roomId) is required" });
    if (!macAddress)         return res.status(400).json({ error: "macAddress is required for device registration" });

    const resolvedCampus = campus || "Default Campus";
    const resolvedBlock  = block  || "Block A";

    // ── License check ─────────────────────────────────────────────────────────
    const existingDevice = macAddress ? await ClassroomDevice.findOne({ macAddress }) : null;
    const isReRegistration = !!existingDevice; // same MAC = same device re-registering

    let license = null;
    if (!isReRegistration) {
      // First-time registration — license key REQUIRED
      if (!licenseKey) {
        return res.status(403).json({ error: "License key is required to register a new device" });
      }

      // Atomic license claim: findOneAndUpdate with isActivated=false as filter
      // prevents race condition where two devices register with same key simultaneously.
      // Only one can flip isActivated from false→true.
      const upperKey = licenseKey.trim().toUpperCase();

      // First check if key exists at all (for better error messages)
      const licCheck = await License.findOne({ key: upperKey });
      if (!licCheck || !licCheck.isActive) {
        return res.status(404).json({ error: "Invalid license key" });
      }
      if (licCheck.expiresAt && new Date() > licCheck.expiresAt) {
        return res.status(403).json({ error: "License key has expired" });
      }
      if (licCheck.isActivated && licCheck.deviceMac !== macAddress) {
        return res.status(409).json({
          error: "This license key is already activated on another device",
          activatedOn: licCheck.deviceModel || "another device",
          activatedAt: licCheck.activatedAt,
        });
      }
      if (licCheck.isActivated && licCheck.deviceMac === macAddress) {
        // Same device re-registering after wipe — allow but skip atomic claim
        license = licCheck;
      }

      // Atomically claim the license (only succeeds if still not activated)
      if (!license) {
        license = await License.findOneAndUpdate(
          { key: upperKey, isActive: true, isActivated: false },
          {
            isActivated: true,
            activatedAt: new Date(),
            deviceMac:   macAddress,
            deviceModel: deviceModel || "",
          },
          { new: true }
        );
        if (!license) {
          // Another device claimed it between our check and update
          return res.status(409).json({
            error: "This license key was just activated by another device. Please use a different key.",
          });
        }
      }
    }

    // ── 1. Register / update device ──────────────────────────────────────────
    let device = existingDevice;

    if (device) {
      device.name        = name        || device.name;
      device.spaceCode   = spaceCode   || device.spaceCode;
      device.roomId      = roomId      || device.roomId;
      device.roomName    = roomName    || device.roomName;
      device.roomNumber  = resolvedRoomNumber || device.roomNumber;
      device.floor       = floor       || device.floor;
      device.ipAddress   = ipAddress   || device.ipAddress;
      device.deviceType  = deviceType  || device.deviceType;
      device.deviceModel = deviceModel || device.deviceModel;
      device.osVersion   = osVersion   || device.osVersion;
      device.isActive    = true;
      await device.save();
    } else {
      device = await ClassroomDevice.create({
        name:        name || `Smart TV - ${roomName || resolvedRoomNumber}`,
        spaceCode:   spaceCode || null,
        roomId:      roomId,
        roomName:    roomName || `Room ${resolvedRoomNumber}`,
        roomNumber:  resolvedRoomNumber,
        floor,
        ipAddress,
        deviceType:  deviceType || "android",
        deviceModel,
        osVersion,
        macAddress,
      });

      // ── Bind device ID + room info to the already-claimed license ──────────
      if (license) {
        await License.findByIdAndUpdate(license._id, {
          deviceId:    device.deviceId,
          spaceCode:   spaceCode || null,
          roomNumber:  resolvedRoomNumber,
          campus:      resolvedCampus,
          block:       resolvedBlock,
        });
      }
    }

    // ── 2. Auto-create / update Room in facility hierarchy ───────────────────
    if (resolvedRoomNumber) {
      await Room.findOneAndUpdate(
        { campus: resolvedCampus, block: resolvedBlock, roomNumber: resolvedRoomNumber },
        {
          $setOnInsert: { createdAt: new Date() },
          $set: {
            spaceCode:  spaceCode || null,
            campus:     resolvedCampus,
            block:      resolvedBlock,
            floor:      floor     || "",
            roomNumber: resolvedRoomNumber,
            roomName:   roomName || name || `Room ${resolvedRoomNumber}`,
            spaceType:  spaceType || "room",
            capacity:   capacity  || 0,
            isActive:   true,
            updatedAt:  new Date(),
          },
        },
        { upsert: true, new: true }
      );
    }

    res.json({
      message: "Device registered",
      setupConfig: {
        deviceId:  device.deviceId,
        authToken: device.authToken,
        apiUrl:    `${req.protocol}://${req.get("host")}/api`,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// POST /api/classroom-recording/devices/:deviceId/health-report
exports.healthReport = async (req, res) => {
  try {
    const device = req.device;
    const incoming = req.body; // { camera, mic, screen, disk, cpu, ram, network, battery, recording, serviceUptime }

    // Build alerts list from any failing components (keep last 20)
    const now = new Date();
    const existingAlerts = (device.health && device.health.alerts) ? [...device.health.alerts] : [];

    const newAlerts = [];
    if (incoming.camera && incoming.camera.ok === false) {
      newAlerts.push({ type: "camera", message: incoming.camera.error || "Camera not detected", time: now });
    }
    if (incoming.mic && incoming.mic.ok === false) {
      newAlerts.push({ type: "mic", message: incoming.mic.error || "Microphone not detected", time: now });
    }
    if (incoming.screen && incoming.screen.ok === false) {
      newAlerts.push({ type: "screen", message: incoming.screen.error || "Display issue detected", time: now });
    }
    if (incoming.disk && incoming.disk.usedPercent >= 90) {
      newAlerts.push({ type: "disk", message: `Disk ${incoming.disk.usedPercent}% full (${incoming.disk.freeGB?.toFixed(1)} GB free)`, time: now });
    }
    if (incoming.network && incoming.network.latencyMs > 2000) {
      newAlerts.push({ type: "network", message: `High latency: ${incoming.network.latencyMs}ms`, time: now });
    }
    if (incoming.recording && incoming.recording.lastError) {
      newAlerts.push({ type: "recording", message: incoming.recording.lastError, time: now });
    }

    const allAlerts = [...newAlerts, ...existingAlerts].slice(0, 20);

    device.health = {
      camera: incoming.camera || device.health?.camera,
      mic: incoming.mic || device.health?.mic,
      screen: incoming.screen || device.health?.screen,
      disk: incoming.disk || device.health?.disk,
      cpu: incoming.cpu || device.health?.cpu,
      ram: incoming.ram || device.health?.ram,
      network: incoming.network || device.health?.network,
      battery: incoming.battery || device.health?.battery,
      recording: incoming.recording || device.health?.recording,
      serviceUptime: incoming.serviceUptime ?? device.health?.serviceUptime,
      alerts: allAlerts,
      updatedAt: now,
    };

    await device.save();

    // Also store time-series snapshot from full health report
    HealthSnapshot.create({
      deviceId: device.deviceId,
      deviceName: device.name,
      roomNumber: device.roomNumber,
      cpu: incoming.cpu || {},
      ram: incoming.ram || {},
      disk: incoming.disk || {},
      network: incoming.network || {},
      battery: incoming.battery || {},
      camera: incoming.camera ? { ok: incoming.camera.ok, error: incoming.camera.error } : {},
      mic: incoming.mic ? { ok: incoming.mic.ok, error: incoming.mic.error } : {},
      screen: incoming.screen ? { ok: incoming.screen.ok, resolution: incoming.screen.resolution } : {},
      recording: {
        isRecording: !!device.isRecording,
        frameDrops: incoming.recording?.frameDrop || 0,
        errorCount: incoming.recording?.errorCount || 0,
        lastError: incoming.recording?.lastError,
      },
      serviceUptime: incoming.serviceUptime,
      timestamp: new Date(),
    }).catch(err => console.error("[Analytics] Health snapshot save failed:", err.message));

    res.json({ ok: true });
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

    // Track app version reported by device — needed for OTA + "outdated" warnings
    const reportedVersionCode = parseInt(req.body.appVersionCode);
    if (!isNaN(reportedVersionCode) && reportedVersionCode > 0) {
      device.appVersionCode = reportedVersionCode;
    }
    if (req.body.appVersionName) {
      device.appVersionName = req.body.appVersionName;
    }
    if (req.body.deviceModel) {
      device.deviceModel = req.body.deviceModel;
    }

    // Accept lightweight health snapshot inline with heartbeat
    if (req.body.health) {
      const h = req.body.health;
      device.health = {
        ...(device.health || {}),
        ...h,
        updatedAt: new Date(),
      };
    }

    // Android explicitly signals recording stopped → reset flag
    if (req.body.isRecording === false && device.isRecording) {
      device.isRecording = false;
      device.currentMeetingId = null;
    }

    await device.save();

    // ── v2.6.2: auto-reconcile stuck recordings ───────────────────────
    //
    // If device reports isRecording=false but there's still a Recording
    // document in "recording"/"uploading" status for a meeting that was
    // on this device, the device's triggerMerge call must have failed
    // silently (network glitch, timeout, crash before the POST). Without
    // this reconcile, status sticks at "recording" forever and the admin
    // has to click Force Stop manually.
    //
    // We kick off the same finalise logic triggerMerge uses — mark
    // completed if segments exist, promote last-segment URL, and run the
    // async merge worker. Safe and idempotent; runs at most once per
    // heartbeat because the next one won't match the filter anymore.
    if (req.body.isRecording === false) {
      // v3.1.3: auto-complete ScheduledClass rows whose end time is >5min
      // past for this room. Handles the "Live" chip staying forever when
      // the device was force-stopped or finished without triggerMerge.
      try {
        const nowIst = new Date(Date.now() + 5.5 * 60 * 60 * 1000);  // IST
        const todayStr = nowIst.toISOString().slice(0, 10);
        const hhmm = nowIst.toISOString().slice(11, 16);  // "HH:MM"
        const tMinusFive = new Date(nowIst.getTime() - 5 * 60 * 1000)
          .toISOString().slice(11, 16);
        await ScheduledClass.updateMany(
          {
            roomNumber: device.roomNumber,
            status: "live",
            date: { $lte: new Date(todayStr + "T23:59:59Z") },
            endTime: { $lt: tMinusFive },  // lexicographic HH:MM works within the same day
          },
          { $set: { status: "completed" } }
        );
      } catch (e) {
        console.error("[Heartbeat/class-status] reconcile threw:", e.message);
      }

      // v3.1.9 — add MINIMUM AGE gate before classifying a recording as orphan.
      //
      // The pre-v3.1.9 filter was too aggressive: it matched every
      // recording in [recording, uploading] state whose recordingStart
      // was within the last 4 hours — including one that started 900 ms
      // ago. Segments upload every 5 min (SEGMENT_DURATION_MS on the
      // Android side), so for the entire first-segment window a live
      // recording has segments.length === 0. The very next heartbeat
      // (≤30 s later) would run this block, see zero segments, and
      // flip status="failed" / recordingEnd=now.
      //
      // End result: every scheduled class got killed ~30-60 s after it
      // started, long before the device had a chance to upload anything.
      // Admin looked at the portal and saw a failed recording with
      // duration=0s + no error — exactly today's "nehi ho raha he
      // recording" report for the 17:19 fvkdfm class.
      //
      // Fix: require the recording to be either
      //   (a) older than 12 min (more than 2x the segment rotation,
      //       so a live recording always has ≥1 uploaded segment by
      //       this time), OR
      //   (b) explicitly dropped by the device — currentMeetingId
      //       on the ClassroomDevice row doesn't match the recording's
      //       scheduledClass (set to null when the device stops cleanly,
      //       or points to a different meeting entirely).
      //
      // This keeps the "device crashed 3 hours ago, recording is orphan"
      // cleanup intact while leaving fresh live sessions alone.
      const MIN_ORPHAN_AGE_MS = 12 * 60 * 1000;
      const orphanWindowStart = new Date(Date.now() - 4 * 60 * 60 * 1000); // 4h outer bound
      const orphanWindowEnd   = new Date(Date.now() - MIN_ORPHAN_AGE_MS);  // 12min inner bound
      const deviceTodaysRecordings = await Recording.find({
        status: { $in: ["recording", "uploading"] },
        recordingStart: { $gte: orphanWindowStart, $lte: orphanWindowEnd },
      }).populate({ path: "scheduledClass", select: "_id roomNumber" }).lean();
      const orphaned = deviceTodaysRecordings.filter(r => {
        if (r.scheduledClass?.roomNumber !== device.roomNumber) return false;
        // Extra guard: if device is still claiming this meeting as its
        // current session, it's not orphan regardless of age. The device
        // knows better than we do whether the pipeline is alive.
        const recMeetingId = r.scheduledClass._id?.toString();
        const devMeetingId = device.currentMeetingId?.toString();
        if (recMeetingId && devMeetingId && recMeetingId === devMeetingId) return false;
        return true;
      });
      for (const orphan of orphaned) {
        try {
          // Atomic claim: only one heartbeat can flip a recording out of
          // "recording"/"uploading". Two near-simultaneous heartbeats (from
          // flaky network retries) won't both run the finalise logic.
          const hasSegments = (orphan.segments || []).length > 0;
          const updateSet = {
            status: hasSegments ? "completed" : "failed",
            isPublished: hasSegments,
            recordingEnd: orphan.recordingEnd || new Date(),
          };
          if (hasSegments && !orphan.videoUrl) {
            const last = orphan.segments[orphan.segments.length - 1];
            if (last?.videoUrl) updateSet.videoUrl = last.videoUrl;
          }
          const claimed = await Recording.findOneAndUpdate(
            { _id: orphan._id, status: { $in: ["recording", "uploading"] } },
            { $set: updateSet },
            { new: true }
          );
          if (!claimed) continue;  // another heartbeat beat us to it
          // v3.1.3: flip the paired ScheduledClass to "completed" too
          // so the Room Booking page drops the stale "Live" chip.
          //
          // v3.1.8: same correction as recordingController.js force-stop —
          // never set status="cancelled" from this reconcile path. The
          // heartbeat schedule filter excludes cancelled classes, so
          // orphan-reconciling an empty recording would silently evict
          // the class from the device's schedule forever. Admin reports
          // "my booking isn't being recorded" trace back to this exact
          // bug. Leave status alone when there are zero segments — the
          // device may yet pick the class up and retry.
          try {
            if (orphan.scheduledClass?._id && hasSegments) {
              await ScheduledClass.findByIdAndUpdate(orphan.scheduledClass._id, {
                status: "completed",
              });
            }
          } catch (_) {}
          console.log(`[Heartbeat/reconcile] Finalised orphan recording ${claimed._id} (${claimed.title}) — ${claimed.segments?.length || 0} segment(s)`);
          // Kick off merge for multi-segment orphans
          if (hasSegments && claimed.segments.length > 1) {
            setImmediate(() => {
              const { runMergeForRecording } = require("../utils/segmentMerger");
              Recording.findById(claimed._id)
                .then(fresh => fresh && runMergeForRecording(fresh))
                .catch(err => console.error(`[Merge/reconcile] ${err.message}`));
            });
          }
        } catch (err) {
          console.error(`[Heartbeat/reconcile] Failed on ${orphan._id}: ${err.message}`);
        }
      }
    }

    // ── Store time-series health snapshot for analytics ──────────────
    if (req.body.health) {
      const h = req.body.health;
      HealthSnapshot.create({
        deviceId: device.deviceId,
        deviceName: device.name,
        roomNumber: device.roomNumber,
        cpu: h.cpu || {},
        ram: h.ram || {},
        disk: h.disk || {},
        network: h.network || {},
        battery: h.battery || {},
        camera: h.camera ? { ok: h.camera.ok, error: h.camera.error } : {},
        mic: h.mic ? { ok: h.mic.ok, error: h.mic.error } : {},
        screen: h.screen ? { ok: h.screen.ok, resolution: h.screen.resolution } : {},
        recording: {
          isRecording: !!req.body.isRecording,
          frameDrops: h.recording?.frameDrop || 0,
          errorCount: h.recording?.errorCount || 0,
          lastError: h.recording?.lastError,
          segmentIndex: h.recording?.segmentIndex,
          encoderFps: h.recording?.encoderFps,
          actualBitrate: h.recording?.actualBitrate,
        },
        upload: h.upload || {},
        serviceUptime: h.serviceUptime,
        appVersionCode: parseInt(req.body.appVersionCode) || undefined,
        timestamp: new Date(),
      }).catch(err => console.error("[Analytics] Snapshot save failed:", err.message));
      // Fire-and-forget — don't slow down heartbeat response
    }

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
        teacherName: cls.teacherName || null,
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

    // ── Check for app update ────────────────────────────────────────────────
    let appUpdate = null;
    try {
      const deviceVersionCode = parseInt(req.body.appVersionCode) || 0;
      const latestApp = await AppVersion.findOne({ isActive: true })
        .select("versionCode versionName apkSize releaseNotes")
        .sort({ versionCode: -1 });

      if (latestApp && latestApp.versionCode > deviceVersionCode) {
        // Use X-Forwarded-Proto if set by reverse proxy (Railway/Vercel),
        // else fall back to req.protocol. IMPORTANT: force HTTPS — Android's
        // HttpURLConnection refuses to follow HTTP→HTTPS redirects across
        // protocols for security, so handing the device an HTTP URL here
        // causes OTA downloads to fail silently when behind a TLS-terminating
        // proxy that redirects to HTTPS.
        const proto = req.get("x-forwarded-proto") || req.protocol || "https";
        const scheme = proto === "http" ? "https" : proto;
        appUpdate = {
          versionCode: latestApp.versionCode,
          versionName: latestApp.versionName,
          apkSize: latestApp.apkSize,
          releaseNotes: latestApp.releaseNotes || "",
          downloadUrl: `${scheme}://${req.get("host")}/api/app/download`,
        };
      }
    } catch (updateErr) {
      console.error("[Heartbeat] App update check failed:", updateErr.message);
    }

    // ── Check for pending remote commands ──────────────────────────────
    let pendingCommands = [];
    let pendingCommandIds = [];
    try {
      const cmds = await DeviceCommand.find({
        deviceId: device.deviceId,
        status: "pending",
      }).sort({ issuedAt: 1 }).lean();

      if (cmds.length > 0) {
        pendingCommands = cmds.map(c => ({
          id: c._id.toString(),
          command: c.command,
          params: c.params || {},
        }));
        pendingCommandIds = cmds.map(c => c._id);
        // DON'T mark acknowledged yet — wait until response is sent.
      }
    } catch (cmdErr) {
      console.error("[Heartbeat] Command check failed:", cmdErr.message);
    }

    res.json({
      schedule,
      serverTime: new Date().toISOString(),
      forceStop: false,
      activeSession,
      appUpdate,
      commands: pendingCommands,
    });

    // Mark commands as acknowledged AFTER response is sent (best-effort, fire-and-forget).
    // If device doesn't receive response, commands stay pending and retry on next heartbeat.
    if (pendingCommandIds.length > 0) {
      DeviceCommand.updateMany(
        { _id: { $in: pendingCommandIds } },
        { status: "acknowledged", acknowledgedAt: new Date() }
      ).catch(err => console.error("[Heartbeat] Command ack update failed:", err.message));
    }
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
    // Mark offline if no heartbeat in 5 min — bulk update in DB, then return
    const now = Date.now();
    const staleIds = devices
      .filter(d => d.isOnline && d.lastHeartbeat && now - d.lastHeartbeat.getTime() > 5 * 60 * 1000)
      .map(d => d._id);
    if (staleIds.length > 0) {
      await ClassroomDevice.updateMany({ _id: { $in: staleIds } }, { isOnline: false });
      for (const d of devices) {
        if (staleIds.some(id => id.equals(d._id))) d.isOnline = false;
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
    const device = await ClassroomDevice.findByIdAndDelete(req.params.id);

    // License stays activated — one-time use only.
    // Clear deviceId reference so license list shows device was removed,
    // but keep isActivated=true so it can't be reused on another device.
    // Admin must explicitly call POST /api/licenses/:id/reset to reuse.
    if (device && device.deviceId) {
      await License.updateOne(
        { deviceId: device.deviceId },
        { deviceId: "" }
      );
    }

    res.json({ message: "Deleted" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// POST /api/classroom-recording/devices/:deviceId/force-start
// Now uses command queue — command reaches device on next heartbeat
exports.forceStart = async (req, res) => {
  try {
    const device = await ClassroomDevice.findOne({ deviceId: req.params.deviceId });
    if (!device) return res.status(404).json({ error: "Device not found" });

    // Queue a force_start command for the device
    const cmd = await DeviceCommand.create({
      deviceId: device.deviceId,
      command: "force_start",
      params: { title: req.body.title || "Force Recording" },
      issuedBy: req.user?.name || req.user?.email || "admin",
    });

    res.json({ message: "Force start command queued", commandId: cmd._id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// POST /api/classroom-recording/devices/:deviceId/force-stop
// Now uses command queue — command reaches device on next heartbeat
exports.forceStop = async (req, res) => {
  try {
    const device = await ClassroomDevice.findOne({ deviceId: req.params.deviceId });
    if (!device) return res.status(404).json({ error: "Device not found" });

    // Queue a force_stop command for the device
    const cmd = await DeviceCommand.create({
      deviceId: device.deviceId,
      command: "force_stop",
      issuedBy: req.user?.name || req.user?.email || "admin",
    });

    res.json({ message: "Force stop command queued", commandId: cmd._id });
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
    let recording = await Recording.findOne({ scheduledClass: meetingId, status: { $ne: "failed" } });

    if (recording && recording.status !== "failed") {
      // Existing session — reuse existing HMAC secret, don't rotate it
      // (rotating invalidates in-flight QR codes if device reconnects mid-class)
      if (recording.status !== "recording") {
        recording.status = "recording";
        recording.recordingStart = new Date();
        await recording.save();
      }

      // Get existing secret (or generate if attendance doesn't exist yet)
      let attendance = await Attendance.findOne({ scheduledClass: meetingId });
      let hmacSecret;
      if (attendance && attendance.qrSecret) {
        hmacSecret = attendance.qrSecret;
      } else {
        hmacSecret = crypto.randomBytes(32).toString("hex");
        await Attendance.findOneAndUpdate(
          { scheduledClass: meetingId },
          { qrSecret: hmacSecret },
          { upsert: true, setDefaultsOnInsert: true }
        );
      }

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

    // Generate HMAC secret for new session only
    const hmacSecret = crypto.randomBytes(32).toString("hex");

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
//
// v2.6.3: atomic $push + $inc so two near-simultaneous segment uploads don't
// clobber each other. Previously the controller did `findById` → in-memory
// `segments.push` → `save`, which meant two concurrent requests could each
// read the same stale segments array, push their own segment onto it, and
// save — losing the other request's segment entirely.
exports.segmentUpload = async (req, res) => {
  try {
    const { recordingId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(recordingId)) {
      return res.status(400).json({ error: "Invalid recording ID" });
    }
    // Cheap existence check — still fetches the doc but we only use it for
    // the sanity check. The actual mutation is atomic below.
    const exists = await Recording.exists({ _id: recordingId });
    if (!exists) {
      return res.status(404).json({ error: "Recording not found" });
    }

    let fileSize = 0;
    let videoUrl = "";

    if (req.files && req.files.video) {
      const videoFile = req.files.video;
      // Add random suffix to prevent filename collision if two segments upload
      // in the same millisecond (unlikely but possible with segment rotation
      // races or clock skew).
      const collisionSuffix = Math.random().toString(36).slice(2, 8);
      const blobName = `${recordingId}_${Date.now()}_${collisionSuffix}.mp4`;
      fileSize = videoFile.size;

      // Try Azure Blob first, fallback to local. Defensive try-catch: a
      // transient Azure outage must NOT crash the upload endpoint.
      if (isAzureConfigured()) {
        try {
          const azureUrl = await uploadToBlob(videoFile.data, blobName, "video/mp4");
          if (azureUrl) {
            videoUrl = azureUrl;
            console.log(`[Upload] Azure Blob: ${blobName} (${(fileSize / 1024 / 1024).toFixed(1)} MB)`);
          }
        } catch (azureErr) {
          console.warn(`[Upload] Azure failed, falling back to local: ${azureErr.message}`);
        }
      }

      // Fallback: save locally if Azure not configured or failed
      if (!videoUrl) {
        const uploadsDir = path.join(__dirname, "..", "uploads");
        if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
        const localPath = path.join(uploadsDir, blobName);
        await videoFile.mv(localPath);
        videoUrl = `/uploads/${blobName}`;
        console.log(`[Upload] Local: ${blobName} (${(fileSize / 1024 / 1024).toFixed(1)} MB)`);
      }
    } else if (req.file) {
      fileSize = req.file.size;
      videoUrl = `/uploads/${path.basename(req.file.path)}`;
    }

    // Parse segment metadata before atomic update
    const duration = parseInt(req.body.duration) || 0;
    // segmentIndex comes from the device. If missing we'd race; require it.
    const segmentIndex = parseInt(req.body.segmentIndex);
    if (isNaN(segmentIndex)) {
      return res.status(400).json({ error: "segmentIndex required" });
    }

    // Atomic append — no read-modify-write race. $push adds to segments[],
    // $inc bumps size + duration, $set bumps recordingEnd + status.
    const updated = await Recording.findByIdAndUpdate(
      recordingId,
      {
        $push: {
          segments: {
            segmentIndex,
            videoUrl,
            fileSize,
            duration,
            startTime: req.body.startTime ? new Date(req.body.startTime) : null,
            endTime: req.body.endTime ? new Date(req.body.endTime) : null,
            uploadedAt: new Date(),
          },
        },
        $inc: { fileSize, duration },
        $set: { recordingEnd: new Date() },
      },
      { new: true }
    );
    if (!updated) {
      return res.status(404).json({ error: "Recording not found (concurrent delete)" });
    }

    // Post-push bookkeeping that can't be expressed in a single atomic op:
    // promote videoUrl / flip status / publish. These are idempotent and
    // always converge to the same final state regardless of concurrent
    // segment uploads, so a second read-modify-write is safe here.
    let needsSave = false;
    if (updated.status !== "recording" && updated.status !== "uploading") {
      updated.status = "uploading";
      needsSave = true;
    } else if (updated.status === "recording") {
      // Stay as "recording" until triggerMerge — no change needed.
    }
    if (videoUrl && updated.segments.length === 1 && !updated.videoUrl) {
      updated.videoUrl = videoUrl;
      updated.isPublished = true;
      needsSave = true;
    }
    if (needsSave) await updated.save();

    // DON'T mark device as not recording here — segment uploads happen during recording.
    // Device explicitly signals recording stop via heartbeat (isRecording: false).

    res.json({ message: "Segment uploaded", recordingId, segmentIndex, storage: videoUrl.startsWith("http") ? "azure" : "local" });
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
//
// v2.6.0: on recording finalise we now actually run a lossless ffmpeg
// concat so clients get ONE MP4 instead of N segment files. The HTTP
// response still returns quickly — the merge is kicked off in the
// background after the response is sent. Clients poll mergeStatus
// (or the /video endpoint returns 202 while merging, 200 when ready).
exports.triggerMerge = async (req, res) => {
  try {
    const { recordingId } = req.params;
    const recording = await Recording.findById(recordingId);
    if (!recording) {
      return res.status(404).json({ error: "Recording not found" });
    }

    // Finalize recording: mark as completed and set videoUrl from segments
    recording.status = "completed";
    recording.isPublished = true;
    recording.recordingEnd = new Date();

    // If we have segments, set videoUrl to the latest segment (or first for single-segment)
    if (recording.segments && recording.segments.length > 0) {
      // For single segment, use it directly; merge worker below handles multi-segment
      const lastSegment = recording.segments[recording.segments.length - 1];
      if (!recording.videoUrl && lastSegment.videoUrl) {
        recording.videoUrl = lastSegment.videoUrl;
      }
    }

    await recording.save();

    // Mark device as not recording
    const deviceId = req.headers["x-device-id"];
    if (deviceId) {
      await ClassroomDevice.findOneAndUpdate(
        { deviceId },
        { isRecording: false, currentMeetingId: null }
      );
    }

    // Update class status
    await ScheduledClass.findByIdAndUpdate(recording.scheduledClass, {
      status: "completed",
    });

    res.json({
      message: "Merge triggered",
      recordingId,
      segmentCount: recording.segments?.length || 0,
      mergeStatus: (recording.segments?.length || 0) > 1 ? "queued" : "skipped",
    });

    // Kick off the actual merge AFTER the response is sent — device doesn't
    // need to wait on ffmpeg. If the server dies mid-merge, mergeStatus is
    // left as "merging" and a daily cleanup job can re-run it (or admin
    // hits POST /merge again — idempotent).
    if ((recording.segments?.length || 0) > 1) {
      setImmediate(() => {
        const { runMergeForRecording } = require("../utils/segmentMerger");
        // Reload the document to avoid version conflicts with any concurrent
        // saves (segment uploads arriving during finalise).
        Recording.findById(recordingId)
          .then(fresh => fresh && runMergeForRecording(fresh))
          .catch(err => console.error(`[Merge] async trigger failed: ${err.message}`));
      });
    }
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
