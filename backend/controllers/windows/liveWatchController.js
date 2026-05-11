/**
 * Live-watch endpoints for Windows devices (v2.1.0).
 *
 * Device side (windowsDeviceAuth):
 *   POST /api/windows/live-watch/ingress
 *     Body: { recordingId, classId? }
 *     → backend creates an RTMP ingress in LiveKit, stores it in a row of
 *       windows_live_ingresses, and returns the {url, streamKey, roomName}.
 *       Device pushes its composite stream to that URL/key via ffmpeg.
 *
 *   DELETE /api/windows/live-watch/ingress/:ingressId
 *     → tears down the ingress on LiveKit + marks the row endedAt.
 *
 * Admin side (auth + adminOnly):
 *   GET /api/windows/live-watch/viewer-token?deviceId=&recordingId=
 *     → returns { token, wsUrl, roomName } so the admin portal can render
 *       a LiveKit React subscriber that watches the live composite.
 *
 *   GET /api/windows/live-watch/active
 *     → list active ingress sessions (state != "ended"), for an "ongoing
 *       live classes" panel in the admin portal.
 */
const livekit = require("../../services/livekitService");
const WindowsLiveIngress = require("../../models/windows/WindowsLiveIngress");
const WindowsLicense = require("../../models/windows/WindowsLicense");

/** Issue an ingress for a device that is starting a class with live-watch on. */
exports.createIngress = async (req, res) => {
  try {
    if (!livekit.isConfigured()) {
      return res.status(503).json({
        error: "LiveKit not configured on backend (LIVEKIT_API_KEY missing)",
      });
    }

    const { recordingId, classId } = req.body || {};
    const device = req.device;
    if (!device) return res.status(401).json({ error: "device auth required" });
    if (!recordingId) return res.status(400).json({ error: "recordingId required" });

    // License gate: only tiers with liveWatchEnabled=true may publish.
    // Stock pro licenses already have this on; this check is belt-and-suspenders.
    if (device.licenseKey) {
      const lic = await WindowsLicense.findOne({ licenseKey: device.licenseKey }).lean();
      if (!lic?.features?.liveWatchEnabled) {
        return res.status(403).json({
          error: "live-watch not enabled on this device's license",
        });
      }
    }

    const ingress = await livekit.createWindowsLiveWatchIngress({
      recordingId,
      deviceId: device.deviceId,
      // WindowsDevice schema field is `name`, not `deviceName`.
      deviceName: device.name || "Windows Recorder",
    });

    // Persist so admin can list active sessions + so we can tear down on
    // ingress timeout even if device never calls DELETE explicitly.
    const row = await WindowsLiveIngress.create({
      recordingId: String(recordingId),
      classId: classId ? String(classId) : null,
      deviceId: device.deviceId,
      ingressId: ingress.ingressId,
      streamKey: ingress.streamKey,
      url: ingress.url,
      roomName: ingress.roomName,
      state: "ready",
    });

    return res.status(201).json({
      id: row._id,
      ingressId: ingress.ingressId,
      url: ingress.url,
      streamKey: ingress.streamKey,
      roomName: ingress.roomName,
      expiresInSeconds: 6 * 60 * 60, // soft hint
    });
  } catch (err) {
    console.error("[live-watch] createIngress error:", err);
    return res
      .status(500)
      .json({ error: "internal error", detail: err.message });
  }
};

exports.deleteIngress = async (req, res) => {
  try {
    const { ingressId } = req.params;
    const device = req.device;
    if (!ingressId) return res.status(400).json({ error: "ingressId required" });

    // Only the owning device (or admin via a different endpoint) may tear down.
    const row = await WindowsLiveIngress.findOne({ ingressId });
    if (!row) return res.status(404).json({ error: "not found" });
    if (device && row.deviceId !== device.deviceId) {
      return res.status(403).json({ error: "ingress belongs to a different device" });
    }

    await livekit.deleteWindowsLiveWatchIngress(ingressId);
    row.state = "ended";
    row.endedAt = new Date();
    await row.save();

    return res.json({ ok: true, ingressId });
  } catch (err) {
    console.error("[live-watch] deleteIngress error:", err);
    return res
      .status(500)
      .json({ error: "internal error", detail: err.message });
  }
};

/** Admin: issue a subscriber JWT so the portal's LiveKit player can join the room.
 *
 * Two call modes supported (admin UI uses #1, internal tools may use #2):
 *   1. ?deviceId=...                   → server resolves the latest non-ended
 *                                         ingress for that device and issues
 *                                         a viewer token for its room.
 *   2. ?deviceId=...&recordingId=...   → strict match on the (device,
 *                                         recording) pair.
 *
 * Mode #1 is the normal admin-portal flow because the heartbeat health
 * snapshot only carries `currentClassId` (not the device's internal
 * recordingId), so the admin client cannot construct mode #2 directly.
 */
exports.viewerToken = async (req, res) => {
  try {
    if (!livekit.isConfigured()) {
      return res
        .status(503)
        .json({ error: "LiveKit not configured on backend" });
    }
    const { deviceId, recordingId } = req.query;
    if (!deviceId) {
      return res
        .status(400)
        .json({ error: "deviceId query param required" });
    }
    // Find the ingress row. recordingId optional — if missing, take the
    // most recently created non-ended row for the device.
    const filter = { deviceId, state: { $ne: "ended" } };
    if (recordingId) filter.recordingId = String(recordingId);
    const row = await WindowsLiveIngress.findOne(filter)
      .sort({ createdAt: -1 })
      .lean();
    if (!row) return res.status(404).json({ error: "no active live-watch ingress for that device" });

    // Use whichever recordingId we ended up with (query param or row's).
    const resolvedRecordingId = recordingId || row.recordingId;
    const token = await livekit.generateWindowsAdminWatchToken({
      recordingId: resolvedRecordingId,
      adminUserId: req.user?._id?.toString() || "anon",
      adminName: req.user?.name || "Admin",
    });

    return res.json({
      token,
      wsUrl: livekit.LIVEKIT_WS_URL,
      roomName: row.roomName,
      ingressId: row.ingressId,
    });
  } catch (err) {
    console.error("[live-watch] viewerToken error:", err);
    return res
      .status(500)
      .json({ error: "internal error", detail: err.message });
  }
};

/** Admin: list currently-active live-watch sessions across the fleet. */
exports.listActive = async (req, res) => {
  try {
    const rows = await WindowsLiveIngress.find({ state: { $ne: "ended" } })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();
    return res.json({
      count: rows.length,
      sessions: rows.map((r) => ({
        id: r._id,
        deviceId: r.deviceId,
        recordingId: r.recordingId,
        classId: r.classId,
        roomName: r.roomName,
        ingressId: r.ingressId,
        state: r.state,
        startedAt: r.createdAt,
      })),
    });
  } catch (err) {
    console.error("[live-watch] listActive error:", err);
    return res
      .status(500)
      .json({ error: "internal error", detail: err.message });
  }
};
