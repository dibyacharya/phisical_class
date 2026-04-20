const HealthSnapshot = require("../models/HealthSnapshot");
const ClassroomDevice = require("../models/ClassroomDevice");

/**
 * Analytics Controller — 7-day health analytics for fleet monitoring.
 *
 * Designed for 100+ classroom devices sending health every 2 min.
 * All aggregation pipelines use indexed fields (deviceId, timestamp).
 */

// ────────────────────────────────────────────────────────────────────
// GET /api/analytics/fleet-overview
// Current status of all devices — green/yellow/red health scores
// ────────────────────────────────────────────────────────────────────
exports.fleetOverview = async (_req, res) => {
  try {
    const now = Date.now();
    const fiveMinAgo = new Date(now - 5 * 60 * 1000);
    const devices = await ClassroomDevice.find({ isActive: true }).lean();

    let online = 0, offline = 0, recording = 0, healthy = 0, warning = 0, critical = 0;
    const deviceSummaries = [];

    for (const d of devices) {
      const isOnline = d.lastHeartbeat && new Date(d.lastHeartbeat) > fiveMinAgo;
      if (isOnline) online++; else offline++;
      if (d.isRecording) recording++;

      // Health score: 0-100
      const score = computeHealthScore(d.health, isOnline);
      if (score >= 80) healthy++;
      else if (score >= 50) warning++;
      else critical++;

      // Pull the most interesting health-beacon fields up to top level so the
      // Fleet Dashboard can render them without drilling into .health every
      // time. These mirror what Android reports in recent versions (v2.3+).
      const rec = d.health?.recording || {};
      deviceSummaries.push({
        deviceId: d.deviceId,
        name: d.name,
        roomNumber: d.roomNumber,
        roomName: d.roomName,
        isOnline,
        isRecording: d.isRecording,
        healthScore: score,
        status: score >= 80 ? "healthy" : score >= 50 ? "warning" : "critical",
        lastHeartbeat: d.lastHeartbeat,
        // Device capability / pipeline info (new in Phase 3 fleet view)
        appVersionName: d.appVersionName,
        appVersionCode: d.appVersionCode,
        deviceModel: d.deviceModel,
        micLabel: rec.micLabel,
        videoPipeline: rec.videoPipeline,
        glCompositorEnabled: rec.glCompositorEnabled,
        glCameraPiP: rec.glCameraPiP,
        lastRecordingError: rec.lastError,
        recordingErrorCount: rec.errorCount,
        health: d.health || {},
      });
    }

    // Sort: critical first, then warning, then healthy
    deviceSummaries.sort((a, b) => a.healthScore - b.healthScore);

    res.json({
      total: devices.length,
      online,
      offline,
      recording,
      healthy,
      warning,
      critical,
      devices: deviceSummaries,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ────────────────────────────────────────────────────────────────────
// GET /api/analytics/trends?days=7
// Fleet-wide hourly averages over N days — for trend charts
// ────────────────────────────────────────────────────────────────────
exports.fleetTrends = async (req, res) => {
  try {
    const days = Math.min(parseInt(req.query.days) || 7, 30);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const pipeline = [
      { $match: { timestamp: { $gte: since } } },
      {
        $group: {
          _id: {
            year: { $year: "$timestamp" },
            month: { $month: "$timestamp" },
            day: { $dayOfMonth: "$timestamp" },
            hour: { $hour: "$timestamp" },
          },
          // Resource averages
          avgCpuUsage: { $avg: "$cpu.usagePercent" },
          avgRamUsage: { $avg: "$ram.usedPercent" },
          avgDiskUsage: { $avg: "$disk.usedPercent" },
          avgWifiSignal: { $avg: "$network.wifiSignal" },
          avgLatency: { $avg: "$network.latencyMs" },
          avgBatteryLevel: { $avg: "$battery.level" },
          // Recording quality
          totalFrameDrops: { $sum: "$recording.frameDrops" },
          totalErrors: { $sum: "$recording.errorCount" },
          recordingDevices: {
            $sum: { $cond: ["$recording.isRecording", 1, 0] },
          },
          // Upload health
          totalUploadSuccess: { $sum: "$upload.successCount" },
          totalUploadFail: { $sum: "$upload.failCount" },
          // Temperature
          avgCpuTemp: { $avg: "$cpu.temperature" },
          // Count
          snapshotCount: { $sum: 1 },
          uniqueDevices: { $addToSet: "$deviceId" },
        },
      },
      {
        $project: {
          _id: 0,
          timestamp: {
            $dateFromParts: {
              year: "$_id.year",
              month: "$_id.month",
              day: "$_id.day",
              hour: "$_id.hour",
            },
          },
          avgCpuUsage: { $round: ["$avgCpuUsage", 1] },
          avgRamUsage: { $round: ["$avgRamUsage", 1] },
          avgDiskUsage: { $round: ["$avgDiskUsage", 1] },
          avgWifiSignal: { $round: ["$avgWifiSignal", 0] },
          avgLatency: { $round: ["$avgLatency", 0] },
          avgBatteryLevel: { $round: ["$avgBatteryLevel", 0] },
          avgCpuTemp: { $round: ["$avgCpuTemp", 1] },
          totalFrameDrops: 1,
          totalErrors: 1,
          recordingDevices: 1,
          totalUploadSuccess: 1,
          totalUploadFail: 1,
          snapshotCount: 1,
          deviceCount: { $size: "$uniqueDevices" },
        },
      },
      { $sort: { timestamp: 1 } },
    ];

    const trends = await HealthSnapshot.aggregate(pipeline);
    res.json({ days, dataPoints: trends.length, trends });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ────────────────────────────────────────────────────────────────────
// GET /api/analytics/device/:deviceId/history?days=7
// Per-device hourly averages — for device drill-down charts
// ────────────────────────────────────────────────────────────────────
exports.deviceHistory = async (req, res) => {
  try {
    const { deviceId } = req.params;
    const days = Math.min(parseInt(req.query.days) || 7, 30);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const pipeline = [
      { $match: { deviceId, timestamp: { $gte: since } } },
      {
        $group: {
          _id: {
            year: { $year: "$timestamp" },
            month: { $month: "$timestamp" },
            day: { $dayOfMonth: "$timestamp" },
            hour: { $hour: "$timestamp" },
          },
          avgCpuUsage: { $avg: "$cpu.usagePercent" },
          maxCpuUsage: { $max: "$cpu.usagePercent" },
          avgRamUsage: { $avg: "$ram.usedPercent" },
          maxRamUsage: { $max: "$ram.usedPercent" },
          avgDiskUsage: { $avg: "$disk.usedPercent" },
          avgWifiSignal: { $avg: "$network.wifiSignal" },
          minWifiSignal: { $min: "$network.wifiSignal" },
          avgLatency: { $avg: "$network.latencyMs" },
          maxLatency: { $max: "$network.latencyMs" },
          avgCpuTemp: { $avg: "$cpu.temperature" },
          maxCpuTemp: { $max: "$cpu.temperature" },
          avgBatteryLevel: { $avg: "$battery.level" },
          totalFrameDrops: { $sum: "$recording.frameDrops" },
          totalErrors: { $sum: "$recording.errorCount" },
          wasRecording: { $max: { $cond: ["$recording.isRecording", 1, 0] } },
          uploadSuccess: { $sum: "$upload.successCount" },
          uploadFail: { $sum: "$upload.failCount" },
          snapshotCount: { $sum: 1 },
        },
      },
      {
        $project: {
          _id: 0,
          timestamp: {
            $dateFromParts: {
              year: "$_id.year",
              month: "$_id.month",
              day: "$_id.day",
              hour: "$_id.hour",
            },
          },
          avgCpuUsage: { $round: ["$avgCpuUsage", 1] },
          maxCpuUsage: { $round: ["$maxCpuUsage", 1] },
          avgRamUsage: { $round: ["$avgRamUsage", 1] },
          maxRamUsage: { $round: ["$maxRamUsage", 1] },
          avgDiskUsage: { $round: ["$avgDiskUsage", 1] },
          avgWifiSignal: { $round: ["$avgWifiSignal", 0] },
          minWifiSignal: 1,
          avgLatency: { $round: ["$avgLatency", 0] },
          maxLatency: 1,
          avgCpuTemp: { $round: ["$avgCpuTemp", 1] },
          maxCpuTemp: { $round: ["$maxCpuTemp", 1] },
          avgBatteryLevel: { $round: ["$avgBatteryLevel", 0] },
          totalFrameDrops: 1,
          totalErrors: 1,
          wasRecording: 1,
          uploadSuccess: 1,
          uploadFail: 1,
          snapshotCount: 1,
        },
      },
      { $sort: { timestamp: 1 } },
    ];

    const history = await HealthSnapshot.aggregate(pipeline);

    // Also get device info
    const device = await ClassroomDevice.findOne({ deviceId }).lean();

    res.json({
      deviceId,
      deviceName: device?.name,
      roomNumber: device?.roomNumber,
      days,
      dataPoints: history.length,
      history,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ────────────────────────────────────────────────────────────────────
// GET /api/analytics/alerts
// Active alerts across fleet — sorted by severity
// ────────────────────────────────────────────────────────────────────
exports.activeAlerts = async (_req, res) => {
  try {
    const now = Date.now();
    const oneHourAgo = new Date(now - 60 * 60 * 1000);
    const fiveMinAgo = new Date(now - 5 * 60 * 1000);
    const devices = await ClassroomDevice.find({ isActive: true }).lean();

    const alerts = [];

    for (const d of devices) {
      const isOnline = d.lastHeartbeat && new Date(d.lastHeartbeat) > fiveMinAgo;
      const h = d.health || {};

      // Offline device
      if (!isOnline && d.lastHeartbeat) {
        const downMinutes = Math.round((now - new Date(d.lastHeartbeat).getTime()) / 60000);
        alerts.push({
          deviceId: d.deviceId,
          deviceName: d.name,
          roomNumber: d.roomNumber,
          severity: "critical",
          type: "offline",
          message: `Device offline for ${downMinutes} min`,
          since: d.lastHeartbeat,
        });
      }

      if (!isOnline) continue; // skip further checks for offline devices

      // Camera down
      if (h.camera && h.camera.ok === false) {
        alerts.push({
          deviceId: d.deviceId, deviceName: d.name, roomNumber: d.roomNumber,
          severity: "critical", type: "camera",
          message: `Camera offline: ${h.camera.error || "unknown"}`,
          since: h.updatedAt,
        });
      }

      // Mic down
      if (h.mic && h.mic.ok === false) {
        alerts.push({
          deviceId: d.deviceId, deviceName: d.name, roomNumber: d.roomNumber,
          severity: "critical", type: "mic",
          message: `Microphone offline: ${h.mic.error || "unknown"}`,
          since: h.updatedAt,
        });
      }

      // Disk almost full (>90%)
      if (h.disk && h.disk.usedPercent > 90) {
        alerts.push({
          deviceId: d.deviceId, deviceName: d.name, roomNumber: d.roomNumber,
          severity: h.disk.usedPercent > 95 ? "critical" : "warning",
          type: "disk",
          message: `Disk ${h.disk.usedPercent}% used (${h.disk.freeGB?.toFixed(1)} GB free)`,
          since: h.updatedAt,
        });
      }

      // RAM high (>85%)
      if (h.ram && h.ram.usedPercent > 85) {
        alerts.push({
          deviceId: d.deviceId, deviceName: d.name, roomNumber: d.roomNumber,
          severity: h.ram.usedPercent > 95 ? "critical" : "warning",
          type: "ram",
          message: `RAM ${h.ram.usedPercent}% used`,
          since: h.updatedAt,
        });
      }

      // Weak WiFi (<-75 dBm)
      if (h.network && h.network.wifiSignal && h.network.wifiSignal < -75) {
        alerts.push({
          deviceId: d.deviceId, deviceName: d.name, roomNumber: d.roomNumber,
          severity: h.network.wifiSignal < -85 ? "critical" : "warning",
          type: "network",
          message: `Weak WiFi: ${h.network.wifiSignal} dBm (${h.network.ssid || "unknown"})`,
          since: h.updatedAt,
        });
      }

      // High latency (>3000ms)
      if (h.network && h.network.latencyMs > 3000) {
        alerts.push({
          deviceId: d.deviceId, deviceName: d.name, roomNumber: d.roomNumber,
          severity: "warning",
          type: "latency",
          message: `High latency: ${h.network.latencyMs}ms`,
          since: h.updatedAt,
        });
      }

      // Recording errors
      if (h.recording && h.recording.errorCount > 0) {
        alerts.push({
          deviceId: d.deviceId, deviceName: d.name, roomNumber: d.roomNumber,
          severity: h.recording.errorCount > 5 ? "critical" : "warning",
          type: "recording",
          message: `${h.recording.errorCount} recording error(s): ${h.recording.lastError || ""}`,
          since: h.updatedAt,
        });
      }

      // Frame drops
      if (h.recording && h.recording.frameDrop > 10) {
        alerts.push({
          deviceId: d.deviceId, deviceName: d.name, roomNumber: d.roomNumber,
          severity: h.recording.frameDrop > 50 ? "critical" : "warning",
          type: "frameDrops",
          message: `${h.recording.frameDrop} frame drops detected`,
          since: h.updatedAt,
        });
      }
    }

    // Sort: critical first
    const severityOrder = { critical: 0, warning: 1, info: 2 };
    alerts.sort((a, b) => (severityOrder[a.severity] || 9) - (severityOrder[b.severity] || 9));

    res.json({ total: alerts.length, alerts });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ────────────────────────────────────────────────────────────────────
// GET /api/analytics/peak-hours?days=7
// Hour-of-day performance heatmap — find which hours have most issues
// ────────────────────────────────────────────────────────────────────
exports.peakHours = async (req, res) => {
  try {
    const days = Math.min(parseInt(req.query.days) || 7, 30);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const pipeline = [
      { $match: { timestamp: { $gte: since } } },
      {
        $group: {
          _id: { hour: { $hour: "$timestamp" } },
          avgCpuUsage: { $avg: "$cpu.usagePercent" },
          avgRamUsage: { $avg: "$ram.usedPercent" },
          avgWifiSignal: { $avg: "$network.wifiSignal" },
          avgLatency: { $avg: "$network.latencyMs" },
          avgCpuTemp: { $avg: "$cpu.temperature" },
          totalFrameDrops: { $sum: "$recording.frameDrops" },
          totalErrors: { $sum: "$recording.errorCount" },
          recordingSnapshots: {
            $sum: { $cond: ["$recording.isRecording", 1, 0] },
          },
          totalSnapshots: { $sum: 1 },
          uniqueDevices: { $addToSet: "$deviceId" },
        },
      },
      {
        $project: {
          _id: 0,
          hour: "$_id.hour",
          avgCpuUsage: { $round: ["$avgCpuUsage", 1] },
          avgRamUsage: { $round: ["$avgRamUsage", 1] },
          avgWifiSignal: { $round: ["$avgWifiSignal", 0] },
          avgLatency: { $round: ["$avgLatency", 0] },
          avgCpuTemp: { $round: ["$avgCpuTemp", 1] },
          totalFrameDrops: 1,
          totalErrors: 1,
          recordingSnapshots: 1,
          totalSnapshots: 1,
          deviceCount: { $size: "$uniqueDevices" },
        },
      },
      { $sort: { hour: 1 } },
    ];

    const hours = await HealthSnapshot.aggregate(pipeline);
    res.json({ days, hours });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ────────────────────────────────────────────────────────────────────
// GET /api/analytics/device-ranking?days=7
// Rank devices by reliability — worst-performing first
// ────────────────────────────────────────────────────────────────────
exports.deviceRanking = async (req, res) => {
  try {
    const days = Math.min(parseInt(req.query.days) || 7, 30);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const pipeline = [
      { $match: { timestamp: { $gte: since } } },
      {
        $group: {
          _id: "$deviceId",
          deviceName: { $last: "$deviceName" },
          roomNumber: { $last: "$roomNumber" },
          avgCpuUsage: { $avg: "$cpu.usagePercent" },
          avgRamUsage: { $avg: "$ram.usedPercent" },
          avgDiskUsage: { $avg: "$disk.usedPercent" },
          avgWifiSignal: { $avg: "$network.wifiSignal" },
          avgLatency: { $avg: "$network.latencyMs" },
          avgCpuTemp: { $avg: "$cpu.temperature" },
          totalFrameDrops: { $sum: "$recording.frameDrops" },
          totalErrors: { $sum: "$recording.errorCount" },
          uploadSuccess: { $sum: "$upload.successCount" },
          uploadFail: { $sum: "$upload.failCount" },
          snapshotCount: { $sum: 1 },
          recordingHours: {
            $sum: { $cond: ["$recording.isRecording", 1, 0] },
          },
        },
      },
      {
        $addFields: {
          // Recording hours (each snapshot ≈ 2 min)
          estimatedRecordingHours: { $round: [{ $divide: ["$recordingHours", 30] }, 1] },
          // Upload success rate
          uploadSuccessRate: {
            $cond: [
              { $gt: [{ $add: ["$uploadSuccess", "$uploadFail"] }, 0] },
              { $round: [{ $multiply: [{ $divide: ["$uploadSuccess", { $add: ["$uploadSuccess", "$uploadFail"] }] }, 100] }, 1] },
              100,
            ],
          },
        },
      },
      {
        $project: {
          _id: 0,
          deviceId: "$_id",
          deviceName: 1,
          roomNumber: 1,
          avgCpuUsage: { $round: ["$avgCpuUsage", 1] },
          avgRamUsage: { $round: ["$avgRamUsage", 1] },
          avgDiskUsage: { $round: ["$avgDiskUsage", 1] },
          avgWifiSignal: { $round: ["$avgWifiSignal", 0] },
          avgLatency: { $round: ["$avgLatency", 0] },
          avgCpuTemp: { $round: ["$avgCpuTemp", 1] },
          totalFrameDrops: 1,
          totalErrors: 1,
          estimatedRecordingHours: 1,
          uploadSuccessRate: 1,
          snapshotCount: 1,
        },
      },
      // Sort by most errors/issues first
      { $sort: { totalErrors: -1, totalFrameDrops: -1 } },
    ];

    const rankings = await HealthSnapshot.aggregate(pipeline);
    res.json({ days, devices: rankings });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ────────────────────────────────────────────────────────────────────
// GET /api/analytics/daily-summary?days=7
// Daily aggregated stats — for summary cards and daily comparison
// ────────────────────────────────────────────────────────────────────
exports.dailySummary = async (req, res) => {
  try {
    const days = Math.min(parseInt(req.query.days) || 7, 30);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const pipeline = [
      { $match: { timestamp: { $gte: since } } },
      {
        $group: {
          _id: {
            year: { $year: "$timestamp" },
            month: { $month: "$timestamp" },
            day: { $dayOfMonth: "$timestamp" },
          },
          avgCpuUsage: { $avg: "$cpu.usagePercent" },
          maxCpuUsage: { $max: "$cpu.usagePercent" },
          avgRamUsage: { $avg: "$ram.usedPercent" },
          maxRamUsage: { $max: "$ram.usedPercent" },
          avgWifiSignal: { $avg: "$network.wifiSignal" },
          avgLatency: { $avg: "$network.latencyMs" },
          avgCpuTemp: { $avg: "$cpu.temperature" },
          maxCpuTemp: { $max: "$cpu.temperature" },
          totalFrameDrops: { $sum: "$recording.frameDrops" },
          totalErrors: { $sum: "$recording.errorCount" },
          uploadSuccess: { $sum: "$upload.successCount" },
          uploadFail: { $sum: "$upload.failCount" },
          uniqueDevices: { $addToSet: "$deviceId" },
          recordingSnapshots: {
            $sum: { $cond: ["$recording.isRecording", 1, 0] },
          },
          totalSnapshots: { $sum: 1 },
        },
      },
      {
        $project: {
          _id: 0,
          date: {
            $dateFromParts: {
              year: "$_id.year",
              month: "$_id.month",
              day: "$_id.day",
            },
          },
          avgCpuUsage: { $round: ["$avgCpuUsage", 1] },
          maxCpuUsage: { $round: ["$maxCpuUsage", 1] },
          avgRamUsage: { $round: ["$avgRamUsage", 1] },
          maxRamUsage: { $round: ["$maxRamUsage", 1] },
          avgWifiSignal: { $round: ["$avgWifiSignal", 0] },
          avgLatency: { $round: ["$avgLatency", 0] },
          avgCpuTemp: { $round: ["$avgCpuTemp", 1] },
          maxCpuTemp: { $round: ["$maxCpuTemp", 1] },
          totalFrameDrops: 1,
          totalErrors: 1,
          uploadSuccess: 1,
          uploadFail: 1,
          deviceCount: { $size: "$uniqueDevices" },
          estimatedRecordingHours: { $round: [{ $divide: ["$recordingSnapshots", 30] }, 1] },
          totalSnapshots: 1,
        },
      },
      { $sort: { date: 1 } },
    ];

    const dailyData = await HealthSnapshot.aggregate(pipeline);
    res.json({ days, dailyData });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ════════════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════════════

/**
 * Compute 0-100 health score from current device health snapshot.
 *
 * Scoring:
 * - Camera OK:     +15
 * - Mic OK:        +15
 * - Screen OK:     +10
 * - Disk < 80%:    +15 (scaled)
 * - RAM < 80%:     +15 (scaled)
 * - WiFi > -70dBm: +15 (scaled)
 * - No errors:     +10
 * - Online:        +5
 */
function computeHealthScore(health, isOnline) {
  if (!health) return isOnline ? 30 : 0;
  let score = 0;

  // Online bonus
  if (isOnline) score += 5;

  // Camera
  if (health.camera?.ok === true) score += 15;
  else if (health.camera?.ok === null || health.camera?.ok === undefined) score += 7; // unknown

  // Mic
  if (health.mic?.ok === true) score += 15;
  else if (health.mic?.ok === null || health.mic?.ok === undefined) score += 7;

  // Screen
  if (health.screen?.ok === true) score += 10;
  else if (health.screen?.ok === null || health.screen?.ok === undefined) score += 5;

  // Disk (lower used% = better score)
  if (health.disk?.usedPercent != null) {
    const diskScore = Math.max(0, 15 - (health.disk.usedPercent / 100) * 15);
    score += Math.round(diskScore);
  } else score += 7;

  // RAM (lower used% = better score)
  if (health.ram?.usedPercent != null) {
    const ramScore = Math.max(0, 15 - (health.ram.usedPercent / 100) * 15);
    score += Math.round(ramScore);
  } else score += 7;

  // WiFi signal (-30 = excellent, -90 = terrible)
  if (health.network?.wifiSignal != null) {
    const signal = health.network.wifiSignal;
    const wifiScore = Math.max(0, Math.min(15, ((signal + 90) / 60) * 15));
    score += Math.round(wifiScore);
  } else score += 7;

  // Recording errors
  if (health.recording?.errorCount === 0 || !health.recording?.errorCount) {
    score += 10;
  } else if (health.recording.errorCount < 5) {
    score += 5;
  }

  return Math.min(100, Math.max(0, score));
}
