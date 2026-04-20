import { useState, useEffect, useCallback } from "react";
import api from "../services/api";
import {
  LineChart, Line, AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  Cell, PieChart, Pie,
} from "recharts";
import {
  Activity, AlertTriangle, Cpu, HardDrive, Wifi, Thermometer,
  Monitor, ArrowLeft, RefreshCw, ChevronDown, ChevronUp,
  CheckCircle2, XCircle, Clock, Upload, MemoryStick,
  Download, FileSpreadsheet, FileText,
} from "lucide-react";

const COLORS = {
  green: "#22c55e", yellow: "#eab308", red: "#ef4444",
  blue: "#3b82f6", purple: "#8b5cf6", orange: "#f97316",
  cyan: "#06b6d4", pink: "#ec4899", slate: "#64748b",
};

const AUTO_REFRESH_MS = 60000; // 1 min

export default function Analytics() {
  const [view, setView] = useState("fleet"); // fleet | device
  const [selectedDevice, setSelectedDevice] = useState(null);
  const [days, setDays] = useState(7);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefresh, setLastRefresh] = useState(null);

  // Data
  const [overview, setOverview] = useState(null);
  const [trends, setTrends] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [dailySummary, setDailySummary] = useState([]);
  const [peakHours, setPeakHours] = useState([]);
  const [deviceRanking, setDeviceRanking] = useState([]);
  const [deviceHistory, setDeviceHistory] = useState([]);
  const [showExportMenu, setShowExportMenu] = useState(false);

  // ── Export utilities ─────────────────────────────────────────────
  const downloadCSV = (filename, headers, rows) => {
    const escape = (v) => {
      if (v == null) return "";
      const s = String(v);
      return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = [headers.join(","), ...rows.map(r => r.map(escape).join(","))].join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  };

  const exportDailySummaryCSV = () => {
    const headers = ["Date", "Devices", "Recording Hours", "Avg CPU %", "Max CPU %", "Avg RAM %", "Avg Temp (C)", "WiFi (dBm)", "Frame Drops", "Errors", "Upload Success", "Upload Failed", "Total Snapshots"];
    const rows = dailySummary.map(d => [
      new Date(d.date).toLocaleDateString("en-IN"), d.deviceCount, d.estimatedRecordingHours,
      d.avgCpuUsage, d.maxCpuUsage, d.avgRamUsage, d.avgCpuTemp, d.avgWifiSignal,
      d.totalFrameDrops, d.totalErrors, d.uploadSuccess, d.uploadFail, d.totalSnapshots,
    ]);
    downloadCSV(`LectureLens_DailySummary_${days}days.csv`, headers, rows);
  };

  const exportDeviceRankingCSV = () => {
    const headers = ["Device Name", "Room", "Avg CPU %", "Avg RAM %", "Avg Disk %", "Avg Temp (C)", "WiFi (dBm)", "Latency (ms)", "Frame Drops", "Errors", "Rec Hours", "Upload Success", "Upload Failed", "Upload %", "Snapshots"];
    const rows = deviceRanking.map(d => [
      d.deviceName, d.roomNumber, d.avgCpuUsage, d.avgRamUsage, d.avgDiskUsage,
      d.avgCpuTemp, d.avgWifiSignal, d.avgLatency, d.totalFrameDrops, d.totalErrors,
      d.estimatedRecordingHours, d.uploadSuccess, d.uploadFail, d.uploadSuccessRate, d.snapshotCount,
    ]);
    downloadCSV(`LectureLens_DeviceRanking_${days}days.csv`, headers, rows);
  };

  const exportAlertsCSV = () => {
    const headers = ["Severity", "Type", "Device", "Room", "Message", "Since"];
    const rows = alerts.map(a => [
      a.severity, a.type, a.deviceName, a.roomNumber || "", a.message, a.since ? new Date(a.since).toLocaleString("en-IN") : "",
    ]);
    downloadCSV(`LectureLens_Alerts_${new Date().toISOString().split("T")[0]}.csv`, headers, rows);
  };

  const exportAllCSV = () => {
    exportDailySummaryCSV();
    setTimeout(() => exportDeviceRankingCSV(), 300);
    setTimeout(() => exportAlertsCSV(), 600);
  };

  const exportPDFReport = () => {
    const now = new Date();
    const dateRange = days === 1 ? "Last 24 Hours" : `Last ${days} Days`;
    const fmtDate = (d) => new Date(d).toLocaleDateString("en-IN", { weekday: "short", month: "short", day: "numeric" });
    const statusColor = (v, thresholds) => {
      if (v == null) return "#6b7280";
      const [warnT, critT, invert] = thresholds;
      if (invert) return v < critT ? "#ef4444" : v < warnT ? "#eab308" : "#22c55e";
      return v > critT ? "#ef4444" : v > warnT ? "#eab308" : "#22c55e";
    };

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>LectureLens Fleet Health Report - ${dateRange}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #1f2937; background: #fff; padding: 32px; max-width: 1100px; margin: 0 auto; }
  @media print { body { padding: 16px; } .no-print { display: none !important; } @page { margin: 12mm; size: A4 landscape; } }
  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px; border-bottom: 3px solid #ea580c; padding-bottom: 16px; }
  .header h1 { font-size: 26px; color: #ea580c; }
  .header .meta { text-align: right; font-size: 12px; color: #6b7280; }
  .header .meta strong { color: #1f2937; }
  .section { margin-bottom: 28px; }
  .section h2 { font-size: 17px; font-weight: 700; color: #334155; margin-bottom: 10px; padding-bottom: 6px; border-bottom: 1px solid #e2e8f0; }
  .overview-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 10px; margin-bottom: 20px; }
  .stat-box { padding: 12px; border-radius: 8px; text-align: center; }
  .stat-box .label { font-size: 10px; text-transform: uppercase; font-weight: 600; letter-spacing: 0.5px; }
  .stat-box .value { font-size: 28px; font-weight: 700; margin-top: 2px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th { background: #f1f5f9; color: #475569; font-weight: 600; text-align: left; padding: 8px 10px; border-bottom: 2px solid #e2e8f0; }
  td { padding: 7px 10px; border-bottom: 1px solid #f1f5f9; }
  tr:hover { background: #fafafa; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; }
  .badge-green { background: #dcfce7; color: #166534; }
  .badge-yellow { background: #fef9c3; color: #854d0e; }
  .badge-red { background: #fee2e2; color: #991b1b; }
  .badge-slate { background: #f1f5f9; color: #475569; }
  .alert-row { display: flex; align-items: center; gap: 10px; padding: 8px 0; border-bottom: 1px solid #f1f5f9; }
  .alert-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
  .alert-msg { font-size: 13px; }
  .alert-meta { font-size: 11px; color: #9ca3af; }
  .summary-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin-bottom: 16px; }
  .summary-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
  .summary-item { text-align: center; }
  .summary-item .label { font-size: 11px; color: #6b7280; }
  .summary-item .value { font-size: 20px; font-weight: 700; }
  .footer { margin-top: 32px; padding-top: 12px; border-top: 1px solid #e2e8f0; font-size: 11px; color: #9ca3af; display: flex; justify-content: space-between; }
  .print-btn { position: fixed; bottom: 24px; right: 24px; background: #ea580c; color: #fff; border: none; padding: 12px 24px; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer; box-shadow: 0 4px 12px rgba(0,0,0,0.15); z-index: 1000; }
  .print-btn:hover { background: #c2410c; }
</style>
</head>
<body>
<button class="print-btn no-print" onclick="window.print()">Save as PDF / Print</button>

<div class="header">
  <div>
    <h1>LectureLens Fleet Health Report</h1>
    <p style="color:#6b7280;margin-top:4px">Classroom Recording System - ${overview?.total || 0} Device(s) Monitored</p>
  </div>
  <div class="meta">
    <p><strong>Report Period:</strong> ${dateRange}</p>
    <p><strong>Generated:</strong> ${now.toLocaleString("en-IN", { dateStyle: "full", timeStyle: "short" })}</p>
    <p><strong>Powered by:</strong> D&R AI Solutions Pvt Ltd</p>
  </div>
</div>

<!-- Fleet Overview -->
<div class="section">
  <h2>Fleet Overview</h2>
  <div class="overview-grid">
    <div class="stat-box" style="background:#f1f5f9"><div class="label" style="color:#475569">Total</div><div class="value" style="color:#334155">${overview?.total ?? 0}</div></div>
    <div class="stat-box" style="background:#dcfce7"><div class="label" style="color:#166534">Online</div><div class="value" style="color:#166534">${overview?.online ?? 0}</div></div>
    <div class="stat-box" style="background:#fee2e2"><div class="label" style="color:#991b1b">Offline</div><div class="value" style="color:#991b1b">${overview?.offline ?? 0}</div></div>
    <div class="stat-box" style="background:#dbeafe"><div class="label" style="color:#1e40af">Recording</div><div class="value" style="color:#1e40af">${overview?.recording ?? 0}</div></div>
    <div class="stat-box" style="background:#dcfce7"><div class="label" style="color:#166534">Healthy</div><div class="value" style="color:#166534">${overview?.healthy ?? 0}</div></div>
    <div class="stat-box" style="background:#fef9c3"><div class="label" style="color:#854d0e">Warning</div><div class="value" style="color:#854d0e">${overview?.warning ?? 0}</div></div>
    <div class="stat-box" style="background:#fee2e2"><div class="label" style="color:#991b1b">Critical</div><div class="value" style="color:#991b1b">${overview?.critical ?? 0}</div></div>
  </div>
</div>

${alerts.length > 0 ? `
<!-- Active Alerts -->
<div class="section">
  <h2>Active Alerts (${alerts.length})</h2>
  ${alerts.map(a => `
    <div class="alert-row">
      <div class="alert-dot" style="background:${a.severity === "critical" ? "#ef4444" : "#eab308"}"></div>
      <div style="flex:1">
        <div class="alert-msg">${a.message}</div>
        <div class="alert-meta">${a.deviceName} &middot; Room ${a.roomNumber || "—"} &middot; ${a.type}${a.since ? ` &middot; Since ${new Date(a.since).toLocaleString("en-IN")}` : ""}</div>
      </div>
      <span class="badge ${a.severity === "critical" ? "badge-red" : "badge-yellow"}">${a.severity}</span>
    </div>
  `).join("")}
</div>
` : `<div class="section"><h2>Active Alerts</h2><p style="color:#22c55e;font-weight:600">All devices are healthy. No active alerts.</p></div>`}

<!-- Daily Summary -->
${dailySummary.length > 0 ? `
<div class="section">
  <h2>Daily Performance Summary</h2>
  <table>
    <thead>
      <tr><th>Date</th><th style="text-align:right">Devices</th><th style="text-align:right">Rec Hours</th><th style="text-align:right">Avg CPU</th><th style="text-align:right">Max CPU</th><th style="text-align:right">Avg RAM</th><th style="text-align:right">Temp</th><th style="text-align:right">WiFi</th><th style="text-align:right">Drops</th><th style="text-align:right">Errors</th><th style="text-align:right">Uploads OK</th><th style="text-align:right">Uploads Fail</th></tr>
    </thead>
    <tbody>
      ${dailySummary.map(d => `
        <tr>
          <td><strong>${fmtDate(d.date)}</strong></td>
          <td style="text-align:right">${d.deviceCount}</td>
          <td style="text-align:right">${d.estimatedRecordingHours}h</td>
          <td style="text-align:right"><span class="badge" style="background:${statusColor(d.avgCpuUsage, [60, 80])}22;color:${statusColor(d.avgCpuUsage, [60, 80])}">${d.avgCpuUsage ?? "—"}%</span></td>
          <td style="text-align:right"><span class="badge" style="background:${statusColor(d.maxCpuUsage, [60, 80])}22;color:${statusColor(d.maxCpuUsage, [60, 80])}">${d.maxCpuUsage ?? "—"}%</span></td>
          <td style="text-align:right"><span class="badge" style="background:${statusColor(d.avgRamUsage, [75, 90])}22;color:${statusColor(d.avgRamUsage, [75, 90])}">${d.avgRamUsage ?? "—"}%</span></td>
          <td style="text-align:right">${d.avgCpuTemp ?? "—"}&deg;C</td>
          <td style="text-align:right">${d.avgWifiSignal ?? "—"} dBm</td>
          <td style="text-align:right;color:${d.totalFrameDrops > 20 ? "#ef4444" : d.totalFrameDrops > 5 ? "#eab308" : "#22c55e"}">${d.totalFrameDrops ?? 0}</td>
          <td style="text-align:right;color:${d.totalErrors > 20 ? "#ef4444" : d.totalErrors > 5 ? "#eab308" : "#22c55e"}">${d.totalErrors ?? 0}</td>
          <td style="text-align:right;color:#22c55e">${d.uploadSuccess ?? 0}</td>
          <td style="text-align:right;color:${d.uploadFail > 0 ? "#ef4444" : "#22c55e"}">${d.uploadFail ?? 0}</td>
        </tr>
      `).join("")}
    </tbody>
  </table>
</div>
` : ""}

<!-- Device Ranking -->
${deviceRanking.length > 0 ? `
<div class="section">
  <h2>Device Performance Ranking</h2>
  <table>
    <thead>
      <tr><th>Device</th><th>Room</th><th style="text-align:right">Avg CPU</th><th style="text-align:right">Avg RAM</th><th style="text-align:right">Temp</th><th style="text-align:right">WiFi</th><th style="text-align:right">Latency</th><th style="text-align:right">Drops</th><th style="text-align:right">Errors</th><th style="text-align:right">Rec Hrs</th><th style="text-align:right">Upload %</th></tr>
    </thead>
    <tbody>
      ${deviceRanking.map(d => `
        <tr>
          <td><strong>${d.deviceName || d.deviceId?.slice(0, 12) || "—"}</strong></td>
          <td>${d.roomNumber || "—"}</td>
          <td style="text-align:right"><span class="badge" style="background:${statusColor(d.avgCpuUsage, [60, 80])}22;color:${statusColor(d.avgCpuUsage, [60, 80])}">${d.avgCpuUsage ?? "—"}%</span></td>
          <td style="text-align:right"><span class="badge" style="background:${statusColor(d.avgRamUsage, [75, 90])}22;color:${statusColor(d.avgRamUsage, [75, 90])}">${d.avgRamUsage ?? "—"}%</span></td>
          <td style="text-align:right">${d.avgCpuTemp ?? "—"}&deg;C</td>
          <td style="text-align:right">${d.avgWifiSignal ?? "—"} dBm</td>
          <td style="text-align:right">${d.avgLatency ?? "—"} ms</td>
          <td style="text-align:right;color:${d.totalFrameDrops > 20 ? "#ef4444" : "#475569"}">${d.totalFrameDrops ?? 0}</td>
          <td style="text-align:right;color:${d.totalErrors > 20 ? "#ef4444" : "#475569"}">${d.totalErrors ?? 0}</td>
          <td style="text-align:right">${d.estimatedRecordingHours ?? "—"}h</td>
          <td style="text-align:right"><span class="badge ${(d.uploadSuccessRate ?? 0) >= 95 ? "badge-green" : (d.uploadSuccessRate ?? 0) >= 80 ? "badge-yellow" : "badge-red"}">${d.uploadSuccessRate ?? "—"}%</span></td>
        </tr>
      `).join("")}
    </tbody>
  </table>
</div>
` : ""}

<!-- Peak Hours -->
${peakHours.length > 0 ? `
<div class="section">
  <h2>Peak Hours Analysis (IST)</h2>
  <p style="font-size:12px;color:#6b7280;margin-bottom:8px">Hourly averages aggregated across all devices and days. Helps identify high-load periods.</p>
  <table>
    <thead>
      <tr><th>Hour (IST)</th><th style="text-align:right">Avg CPU</th><th style="text-align:right">Avg RAM</th><th style="text-align:right">WiFi</th><th style="text-align:right">Temp</th><th style="text-align:right">Frame Drops</th><th style="text-align:right">Errors</th><th style="text-align:right">Recording Samples</th><th style="text-align:right">Active Devices</th></tr>
    </thead>
    <tbody>
      ${peakHours.map(h => {
        const istHour = ((h.hour + 5) % 24);
        const label = istHour.toString().padStart(2, "0") + ":30";
        return `<tr>
          <td><strong>${label}</strong></td>
          <td style="text-align:right">${h.avgCpuUsage ?? "—"}%</td>
          <td style="text-align:right">${h.avgRamUsage ?? "—"}%</td>
          <td style="text-align:right">${h.avgWifiSignal ?? "—"} dBm</td>
          <td style="text-align:right">${h.avgCpuTemp ?? "—"}&deg;C</td>
          <td style="text-align:right">${h.totalFrameDrops ?? 0}</td>
          <td style="text-align:right">${h.totalErrors ?? 0}</td>
          <td style="text-align:right">${h.recordingSnapshots ?? 0}</td>
          <td style="text-align:right">${h.deviceCount ?? 0}</td>
        </tr>`;
      }).join("")}
    </tbody>
  </table>
</div>
` : ""}

<!-- Key Metrics Summary -->
<div class="section">
  <h2>Key Metrics Summary</h2>
  <div class="summary-box">
    <div class="summary-grid">
      <div class="summary-item">
        <div class="label">Total Recording Hours</div>
        <div class="value" style="color:#2563eb">${dailySummary.reduce((s, d) => s + (d.estimatedRecordingHours || 0), 0)}h</div>
      </div>
      <div class="summary-item">
        <div class="label">Avg CPU Usage</div>
        <div class="value" style="color:${statusColor(dailySummary.length ? Math.round(dailySummary.reduce((s, d) => s + (d.avgCpuUsage || 0), 0) / dailySummary.length) : null, [60, 80])}">${dailySummary.length ? Math.round(dailySummary.reduce((s, d) => s + (d.avgCpuUsage || 0), 0) / dailySummary.length) : "—"}%</div>
      </div>
      <div class="summary-item">
        <div class="label">Total Frame Drops</div>
        <div class="value" style="color:${dailySummary.reduce((s, d) => s + (d.totalFrameDrops || 0), 0) > 50 ? "#ef4444" : "#22c55e"}">${dailySummary.reduce((s, d) => s + (d.totalFrameDrops || 0), 0)}</div>
      </div>
      <div class="summary-item">
        <div class="label">Total Errors</div>
        <div class="value" style="color:${dailySummary.reduce((s, d) => s + (d.totalErrors || 0), 0) > 50 ? "#ef4444" : "#22c55e"}">${dailySummary.reduce((s, d) => s + (d.totalErrors || 0), 0)}</div>
      </div>
    </div>
  </div>
</div>

<div class="footer">
  <span>LectureLens - Classroom Recording System by D&R AI Solutions Pvt Ltd</span>
  <span>Report generated on ${now.toLocaleString("en-IN")} | Period: ${dateRange}</span>
</div>

</body></html>`;

    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank");
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  };

  // ── Fetch fleet data ─────────────────────────────────────────────
  const fetchFleetData = useCallback(async (showLoader = true) => {
    if (showLoader) setLoading(true);
    else setRefreshing(true);
    try {
      const [ovRes, trRes, alRes, dsRes, phRes, drRes] = await Promise.all([
        api.get("/analytics/fleet-overview"),
        api.get(`/analytics/trends?days=${days}`),
        api.get("/analytics/alerts"),
        api.get(`/analytics/daily-summary?days=${days}`),
        api.get(`/analytics/peak-hours?days=${days}`),
        api.get(`/analytics/device-ranking?days=${days}`),
      ]);
      setOverview(ovRes.data);
      setTrends(trRes.data?.trends || ovRes.data?.trends || []);
      setAlerts(alRes.data?.alerts || []);
      setDailySummary(dsRes.data?.dailyData || []);
      setPeakHours(phRes.data?.hours || []);
      setDeviceRanking(drRes.data?.devices || []);
      setLastRefresh(new Date());
    } catch (err) {
      console.error("Analytics fetch error:", err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [days]);

  // ── Fetch device-specific data ───────────────────────────────────
  const fetchDeviceData = useCallback(async (deviceId) => {
    setLoading(true);
    try {
      const res = await api.get(`/analytics/device/${deviceId}/history?days=${days}`);
      setDeviceHistory(res.data?.history || []);
      setSelectedDevice(res.data);
    } catch (err) {
      console.error("Device history fetch error:", err);
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    if (view === "fleet") fetchFleetData();
  }, [view, days, fetchFleetData]);

  // Auto-refresh
  useEffect(() => {
    if (view !== "fleet") return;
    const interval = setInterval(() => fetchFleetData(false), AUTO_REFRESH_MS);
    return () => clearInterval(interval);
  }, [view, fetchFleetData]);

  const openDevice = (deviceId) => {
    setView("device");
    fetchDeviceData(deviceId);
  };

  const backToFleet = () => {
    setView("fleet");
    setSelectedDevice(null);
    setDeviceHistory([]);
  };

  // ════════════════════════════════════════════════════════════════
  // RENDER
  // ════════════════════════════════════════════════════════════════

  if (loading && !overview) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="animate-spin text-blue-500" size={32} />
        <span className="ml-3 text-slate-500">Loading analytics...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          {view === "device" && (
            <button onClick={backToFleet} className="p-2 hover:bg-slate-100 rounded-lg">
              <ArrowLeft size={20} />
            </button>
          )}
          <div>
            <h1 className="text-2xl font-bold text-slate-800">
              {view === "fleet" ? "Fleet Health Analytics" : `Device: ${selectedDevice?.deviceName || selectedDevice?.deviceId}`}
            </h1>
            <p className="text-slate-500 text-sm">
              {view === "fleet"
                ? `${overview?.total || 0} devices monitored`
                : `Room: ${selectedDevice?.roomNumber || "—"}`}
              {lastRefresh && ` · Updated ${lastRefresh.toLocaleTimeString()}`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={days}
            onChange={(e) => setDays(parseInt(e.target.value))}
            className="px-3 py-2 border rounded-lg text-sm"
          >
            <option value={1}>Last 24h</option>
            <option value={3}>Last 3 days</option>
            <option value={7}>Last 7 days</option>
            <option value={14}>Last 14 days</option>
            <option value={30}>Last 30 days</option>
          </select>
          {/* Export dropdown */}
          {view === "fleet" && (
            <div className="relative">
              <button
                onClick={() => setShowExportMenu(!showExportMenu)}
                className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700"
              >
                <Download size={16} /> Export
              </button>
              {showExportMenu && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowExportMenu(false)} />
                  <div className="absolute right-0 mt-2 w-64 bg-white rounded-xl shadow-xl border z-50 py-2">
                    <button
                      onClick={() => { exportPDFReport(); setShowExportMenu(false); }}
                      className="w-full px-4 py-3 text-left hover:bg-slate-50 flex items-center gap-3"
                    >
                      <FileText size={18} className="text-red-500" />
                      <div>
                        <p className="font-medium text-sm text-slate-800">Full Report (PDF)</p>
                        <p className="text-xs text-slate-400">Printable report with all data</p>
                      </div>
                    </button>
                    <button
                      onClick={() => { exportAllCSV(); setShowExportMenu(false); }}
                      className="w-full px-4 py-3 text-left hover:bg-slate-50 flex items-center gap-3"
                    >
                      <FileSpreadsheet size={18} className="text-green-600" />
                      <div>
                        <p className="font-medium text-sm text-slate-800">All Data (CSV)</p>
                        <p className="text-xs text-slate-400">3 CSV files — summary, devices, alerts</p>
                      </div>
                    </button>
                    <div className="border-t my-1" />
                    <button
                      onClick={() => { exportDailySummaryCSV(); setShowExportMenu(false); }}
                      className="w-full px-4 py-2.5 text-left hover:bg-slate-50 flex items-center gap-3 text-sm text-slate-600"
                    >
                      <FileSpreadsheet size={15} className="text-slate-400" />
                      Daily Summary (CSV)
                    </button>
                    <button
                      onClick={() => { exportDeviceRankingCSV(); setShowExportMenu(false); }}
                      className="w-full px-4 py-2.5 text-left hover:bg-slate-50 flex items-center gap-3 text-sm text-slate-600"
                    >
                      <FileSpreadsheet size={15} className="text-slate-400" />
                      Device Ranking (CSV)
                    </button>
                    <button
                      onClick={() => { exportAlertsCSV(); setShowExportMenu(false); }}
                      className="w-full px-4 py-2.5 text-left hover:bg-slate-50 flex items-center gap-3 text-sm text-slate-600"
                    >
                      <FileSpreadsheet size={15} className="text-slate-400" />
                      Active Alerts (CSV)
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
          <button
            onClick={() => view === "fleet" ? fetchFleetData(false) : fetchDeviceData(selectedDevice?.deviceId)}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            disabled={refreshing}
          >
            <RefreshCw size={16} className={refreshing ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>
      </div>

      {view === "fleet" ? <FleetView /> : <DeviceView />}
    </div>
  );

  // ════════════════════════════════════════════════════════════════
  // FLEET VIEW
  // ════════════════════════════════════════════════════════════════
  function FleetView() {
    return (
      <div className="space-y-6">
        {/* Overview Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
          <StatCard label="Total" value={overview?.total} icon={Monitor} color="slate" />
          <StatCard label="Online" value={overview?.online} icon={CheckCircle2} color="green" />
          <StatCard label="Offline" value={overview?.offline} icon={XCircle} color="red" />
          <StatCard label="Recording" value={overview?.recording} icon={Activity} color="blue" />
          <StatCard label="Healthy" value={overview?.healthy} icon={CheckCircle2} color="green" />
          <StatCard label="Warning" value={overview?.warning} icon={AlertTriangle} color="yellow" />
          <StatCard label="Critical" value={overview?.critical} icon={XCircle} color="red" />
        </div>

        {/* Alerts */}
        {alerts.length > 0 && <AlertsPanel alerts={alerts} onDeviceClick={openDevice} />}

        {/* Trend Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <ChartCard title="CPU Usage (%)" icon={Cpu}>
            <ResponsiveContainer width="100%" height={250}>
              <AreaChart data={trends}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="timestamp" tickFormatter={formatTime} tick={{ fontSize: 11 }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
                <Tooltip labelFormatter={formatTooltipTime} />
                <Area type="monotone" dataKey="avgCpuUsage" name="Avg CPU" stroke={COLORS.blue} fill={COLORS.blue} fillOpacity={0.15} />
              </AreaChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="RAM Usage (%)" icon={MemoryStick}>
            <ResponsiveContainer width="100%" height={250}>
              <AreaChart data={trends}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="timestamp" tickFormatter={formatTime} tick={{ fontSize: 11 }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
                <Tooltip labelFormatter={formatTooltipTime} />
                <Area type="monotone" dataKey="avgRamUsage" name="Avg RAM" stroke={COLORS.purple} fill={COLORS.purple} fillOpacity={0.15} />
              </AreaChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="WiFi Signal (dBm)" icon={Wifi}>
            <ResponsiveContainer width="100%" height={250}>
              <LineChart data={trends}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="timestamp" tickFormatter={formatTime} tick={{ fontSize: 11 }} />
                <YAxis domain={[-100, -20]} tick={{ fontSize: 11 }} />
                <Tooltip labelFormatter={formatTooltipTime} />
                <Line type="monotone" dataKey="avgWifiSignal" name="Avg Signal" stroke={COLORS.cyan} dot={false} strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="CPU Temperature (\u00b0C)" icon={Thermometer}>
            <ResponsiveContainer width="100%" height={250}>
              <AreaChart data={trends}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="timestamp" tickFormatter={formatTime} tick={{ fontSize: 11 }} />
                <YAxis domain={[20, 90]} tick={{ fontSize: 11 }} />
                <Tooltip labelFormatter={formatTooltipTime} />
                <Area type="monotone" dataKey="avgCpuTemp" name="Avg Temp" stroke={COLORS.orange} fill={COLORS.orange} fillOpacity={0.15} />
              </AreaChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="Frame Drops / Hour" icon={AlertTriangle}>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={trends}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="timestamp" tickFormatter={formatTime} tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip labelFormatter={formatTooltipTime} />
                <Bar dataKey="totalFrameDrops" name="Frame Drops" fill={COLORS.red} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="Network Latency (ms)" icon={Wifi}>
            <ResponsiveContainer width="100%" height={250}>
              <LineChart data={trends}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="timestamp" tickFormatter={formatTime} tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip labelFormatter={formatTooltipTime} />
                <Line type="monotone" dataKey="avgLatency" name="Avg Latency" stroke={COLORS.pink} dot={false} strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>

        {/* Daily Summary Table */}
        {dailySummary.length > 0 && <DailySummaryTable data={dailySummary} />}

        {/* Peak Hours */}
        {peakHours.length > 0 && (
          <ChartCard title="Peak Hours Analysis (IST)" icon={Clock}>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={peakHours.map(h => ({ ...h, hourLabel: `${((h.hour + 5) % 24).toString().padStart(2, "0")}:30` }))}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="hourLabel" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend />
                <Bar dataKey="avgCpuUsage" name="CPU %" fill={COLORS.blue} radius={[4, 4, 0, 0]} />
                <Bar dataKey="totalFrameDrops" name="Frame Drops" fill={COLORS.red} radius={[4, 4, 0, 0]} />
                <Bar dataKey="recordingSnapshots" name="Recording Samples" fill={COLORS.green} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        )}

        {/* Device Ranking Table */}
        <DeviceRankingTable devices={deviceRanking} onDeviceClick={openDevice} />
      </div>
    );
  }

  // ════════════════════════════════════════════════════════════════
  // DEVICE VIEW
  // ════════════════════════════════════════════════════════════════
  function DeviceView() {
    if (!selectedDevice || deviceHistory.length === 0) {
      return (
        <div className="text-center py-16 text-slate-500">
          {loading ? (
            <RefreshCw className="animate-spin mx-auto mb-3" size={32} />
          ) : (
            <>
              <Monitor className="mx-auto mb-3 text-slate-300" size={48} />
              <p>No health data available for this device in the last {days} days.</p>
              <p className="text-sm mt-1">Data collection starts once the device sends its first heartbeat.</p>
            </>
          )}
        </div>
      );
    }

    return (
      <div className="space-y-6">
        {/* Device Info */}
        <div className="bg-white rounded-xl border p-6 flex flex-wrap gap-6">
          <InfoChip label="Device" value={selectedDevice.deviceName} />
          <InfoChip label="Room" value={selectedDevice.roomNumber} />
          <InfoChip label="Data Points" value={selectedDevice.dataPoints} />
          <InfoChip label="Period" value={`${days} days`} />
        </div>

        {/* Device Trend Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <ChartCard title="CPU Usage & Max (%)" icon={Cpu}>
            <ResponsiveContainer width="100%" height={250}>
              <AreaChart data={deviceHistory}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="timestamp" tickFormatter={formatTime} tick={{ fontSize: 11 }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
                <Tooltip labelFormatter={formatTooltipTime} />
                <Legend />
                <Area type="monotone" dataKey="avgCpuUsage" name="Avg" stroke={COLORS.blue} fill={COLORS.blue} fillOpacity={0.1} />
                <Area type="monotone" dataKey="maxCpuUsage" name="Max" stroke={COLORS.red} fill={COLORS.red} fillOpacity={0.05} />
              </AreaChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="RAM Usage & Max (%)" icon={MemoryStick}>
            <ResponsiveContainer width="100%" height={250}>
              <AreaChart data={deviceHistory}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="timestamp" tickFormatter={formatTime} tick={{ fontSize: 11 }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
                <Tooltip labelFormatter={formatTooltipTime} />
                <Legend />
                <Area type="monotone" dataKey="avgRamUsage" name="Avg" stroke={COLORS.purple} fill={COLORS.purple} fillOpacity={0.1} />
                <Area type="monotone" dataKey="maxRamUsage" name="Max" stroke={COLORS.red} fill={COLORS.red} fillOpacity={0.05} />
              </AreaChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="WiFi Signal (dBm)" icon={Wifi}>
            <ResponsiveContainer width="100%" height={250}>
              <AreaChart data={deviceHistory}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="timestamp" tickFormatter={formatTime} tick={{ fontSize: 11 }} />
                <YAxis domain={[-100, -20]} tick={{ fontSize: 11 }} />
                <Tooltip labelFormatter={formatTooltipTime} />
                <Legend />
                <Line type="monotone" dataKey="avgWifiSignal" name="Avg" stroke={COLORS.cyan} dot={false} />
                <Area type="monotone" dataKey="minWifiSignal" name="Min (Worst)" stroke={COLORS.red} fill={COLORS.red} fillOpacity={0.05} />
              </AreaChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="Temperature & Latency" icon={Thermometer}>
            <ResponsiveContainer width="100%" height={250}>
              <LineChart data={deviceHistory}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="timestamp" tickFormatter={formatTime} tick={{ fontSize: 11 }} />
                <YAxis yAxisId="temp" domain={[20, 90]} tick={{ fontSize: 11 }} />
                <YAxis yAxisId="latency" orientation="right" tick={{ fontSize: 11 }} />
                <Tooltip labelFormatter={formatTooltipTime} />
                <Legend />
                <Line yAxisId="temp" type="monotone" dataKey="avgCpuTemp" name="Temp (\u00b0C)" stroke={COLORS.orange} dot={false} />
                <Line yAxisId="temp" type="monotone" dataKey="maxCpuTemp" name="Max Temp" stroke={COLORS.red} dot={false} strokeDasharray="5 5" />
                <Line yAxisId="latency" type="monotone" dataKey="avgLatency" name="Latency (ms)" stroke={COLORS.pink} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="Frame Drops & Errors" icon={AlertTriangle}>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={deviceHistory}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="timestamp" tickFormatter={formatTime} tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip labelFormatter={formatTooltipTime} />
                <Legend />
                <Bar dataKey="totalFrameDrops" name="Frame Drops" fill={COLORS.yellow} radius={[4, 4, 0, 0]} />
                <Bar dataKey="totalErrors" name="Errors" fill={COLORS.red} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="Uploads" icon={Upload}>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={deviceHistory}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="timestamp" tickFormatter={formatTime} tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip labelFormatter={formatTooltipTime} />
                <Legend />
                <Bar dataKey="uploadSuccess" name="Success" fill={COLORS.green} stackId="upload" radius={[4, 4, 0, 0]} />
                <Bar dataKey="uploadFail" name="Failed" fill={COLORS.red} stackId="upload" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>

        {/* Disk Usage Trend */}
        <ChartCard title="Disk Usage (%)" icon={HardDrive}>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={deviceHistory}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="timestamp" tickFormatter={formatTime} tick={{ fontSize: 11 }} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
              <Tooltip labelFormatter={formatTooltipTime} />
              <Area type="monotone" dataKey="avgDiskUsage" name="Disk %" stroke={COLORS.slate} fill={COLORS.slate} fillOpacity={0.15} />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>
    );
  }
}

// ════════════════════════════════════════════════════════════════════
// SUB-COMPONENTS
// ════════════════════════════════════════════════════════════════════

function StatCard({ label, value, icon: Icon, color }) {
  const colorMap = {
    green: "bg-green-50 text-green-700 border-green-200",
    red: "bg-red-50 text-red-700 border-red-200",
    yellow: "bg-yellow-50 text-yellow-700 border-yellow-200",
    blue: "bg-blue-50 text-blue-700 border-blue-200",
    slate: "bg-slate-50 text-slate-700 border-slate-200",
  };
  return (
    <div className={`rounded-xl border p-4 ${colorMap[color] || colorMap.slate}`}>
      <div className="flex items-center gap-2 mb-1">
        <Icon size={16} />
        <span className="text-xs font-medium uppercase">{label}</span>
      </div>
      <div className="text-2xl font-bold">{value ?? "—"}</div>
    </div>
  );
}

function ChartCard({ title, icon: Icon, children }) {
  return (
    <div className="bg-white rounded-xl border p-5">
      <div className="flex items-center gap-2 mb-4">
        {Icon && <Icon size={18} className="text-slate-500" />}
        <h3 className="font-semibold text-slate-700">{title}</h3>
      </div>
      {children}
    </div>
  );
}

function InfoChip({ label, value }) {
  return (
    <div>
      <span className="text-xs text-slate-500 uppercase">{label}</span>
      <p className="font-semibold text-slate-800">{value || "—"}</p>
    </div>
  );
}

function AlertsPanel({ alerts, onDeviceClick }) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? alerts : alerts.slice(0, 5);

  return (
    <div className="bg-white rounded-xl border">
      <div className="px-5 py-4 border-b flex items-center justify-between">
        <div className="flex items-center gap-2">
          <AlertTriangle size={18} className="text-red-500" />
          <h3 className="font-semibold text-slate-700">Active Alerts ({alerts.length})</h3>
        </div>
        {alerts.length > 5 && (
          <button onClick={() => setExpanded(!expanded)} className="text-sm text-blue-600 flex items-center gap-1">
            {expanded ? <><ChevronUp size={14} /> Less</> : <><ChevronDown size={14} /> Show all</>}
          </button>
        )}
      </div>
      <div className="divide-y">
        {shown.map((a, i) => (
          <div key={i} className="px-5 py-3 flex items-center gap-4 hover:bg-slate-50">
            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${a.severity === "critical" ? "bg-red-500" : "bg-yellow-500"}`} />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-slate-700 truncate">{a.message}</p>
              <p className="text-xs text-slate-400">{a.deviceName} · {a.roomNumber || "—"} · {a.type}</p>
            </div>
            <button
              onClick={() => onDeviceClick(a.deviceId)}
              className="text-xs text-blue-600 hover:underline flex-shrink-0"
            >
              View
            </button>
          </div>
        ))}
        {alerts.length === 0 && (
          <div className="px-5 py-8 text-center text-slate-400">
            <CheckCircle2 className="mx-auto mb-2" size={32} />
            All devices healthy
          </div>
        )}
      </div>
    </div>
  );
}

function DailySummaryTable({ data }) {
  return (
    <div className="bg-white rounded-xl border overflow-hidden">
      <div className="px-5 py-4 border-b">
        <h3 className="font-semibold text-slate-700">Daily Summary</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-4 py-3 text-left font-medium">Date</th>
              <th className="px-4 py-3 text-right font-medium">Devices</th>
              <th className="px-4 py-3 text-right font-medium">Rec Hours</th>
              <th className="px-4 py-3 text-right font-medium">Avg CPU</th>
              <th className="px-4 py-3 text-right font-medium">Max CPU</th>
              <th className="px-4 py-3 text-right font-medium">Avg RAM</th>
              <th className="px-4 py-3 text-right font-medium">Avg Temp</th>
              <th className="px-4 py-3 text-right font-medium">WiFi (dBm)</th>
              <th className="px-4 py-3 text-right font-medium">Frame Drops</th>
              <th className="px-4 py-3 text-right font-medium">Errors</th>
              <th className="px-4 py-3 text-right font-medium">Uploads</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {data.map((d, i) => (
              <tr key={i} className="hover:bg-slate-50">
                <td className="px-4 py-3 font-medium">{new Date(d.date).toLocaleDateString("en-IN", { weekday: "short", month: "short", day: "numeric" })}</td>
                <td className="px-4 py-3 text-right">{d.deviceCount}</td>
                <td className="px-4 py-3 text-right">{d.estimatedRecordingHours}h</td>
                <td className="px-4 py-3 text-right">{cpuBadge(d.avgCpuUsage)}</td>
                <td className="px-4 py-3 text-right">{cpuBadge(d.maxCpuUsage)}</td>
                <td className="px-4 py-3 text-right">{ramBadge(d.avgRamUsage)}</td>
                <td className="px-4 py-3 text-right">{tempBadge(d.avgCpuTemp)}</td>
                <td className="px-4 py-3 text-right">{wifiBadge(d.avgWifiSignal)}</td>
                <td className="px-4 py-3 text-right">{errorBadge(d.totalFrameDrops)}</td>
                <td className="px-4 py-3 text-right">{errorBadge(d.totalErrors)}</td>
                <td className="px-4 py-3 text-right text-slate-600">{(d.uploadSuccess || 0) + (d.uploadFail || 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DeviceRankingTable({ devices, onDeviceClick }) {
  const [sortKey, setSortKey] = useState("totalErrors");
  const [sortDir, setSortDir] = useState("desc");

  const sorted = [...devices].sort((a, b) => {
    const av = a[sortKey] ?? 0, bv = b[sortKey] ?? 0;
    return sortDir === "desc" ? bv - av : av - bv;
  });

  const toggleSort = (key) => {
    if (sortKey === key) setSortDir(d => d === "desc" ? "asc" : "desc");
    else { setSortKey(key); setSortDir("desc"); }
  };

  const SortHeader = ({ label, k }) => (
    <th
      className="px-4 py-3 text-right font-medium cursor-pointer hover:text-blue-600"
      onClick={() => toggleSort(k)}
    >
      {label} {sortKey === k && (sortDir === "desc" ? "\u2193" : "\u2191")}
    </th>
  );

  return (
    <div className="bg-white rounded-xl border overflow-hidden">
      <div className="px-5 py-4 border-b">
        <h3 className="font-semibold text-slate-700">Device Performance Ranking</h3>
        <p className="text-xs text-slate-400 mt-1">Click column headers to sort. Click device name to drill down.</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-4 py-3 text-left font-medium">Device</th>
              <th className="px-4 py-3 text-left font-medium">Room</th>
              <SortHeader label="Avg CPU" k="avgCpuUsage" />
              <SortHeader label="Avg RAM" k="avgRamUsage" />
              <SortHeader label="Avg Temp" k="avgCpuTemp" />
              <SortHeader label="WiFi" k="avgWifiSignal" />
              <SortHeader label="Latency" k="avgLatency" />
              <SortHeader label="Drops" k="totalFrameDrops" />
              <SortHeader label="Errors" k="totalErrors" />
              <SortHeader label="Rec Hrs" k="estimatedRecordingHours" />
              <SortHeader label="Upload %" k="uploadSuccessRate" />
            </tr>
          </thead>
          <tbody className="divide-y">
            {sorted.map((d, i) => (
              <tr key={i} className="hover:bg-slate-50">
                <td className="px-4 py-3">
                  <button onClick={() => onDeviceClick(d.deviceId)} className="text-blue-600 hover:underline font-medium">
                    {d.deviceName || d.deviceId?.slice(0, 12)}
                  </button>
                </td>
                <td className="px-4 py-3 text-slate-600">{d.roomNumber || "—"}</td>
                <td className="px-4 py-3 text-right">{cpuBadge(d.avgCpuUsage)}</td>
                <td className="px-4 py-3 text-right">{ramBadge(d.avgRamUsage)}</td>
                <td className="px-4 py-3 text-right">{tempBadge(d.avgCpuTemp)}</td>
                <td className="px-4 py-3 text-right">{wifiBadge(d.avgWifiSignal)}</td>
                <td className="px-4 py-3 text-right">{d.avgLatency != null ? `${d.avgLatency}ms` : "—"}</td>
                <td className="px-4 py-3 text-right">{errorBadge(d.totalFrameDrops)}</td>
                <td className="px-4 py-3 text-right">{errorBadge(d.totalErrors)}</td>
                <td className="px-4 py-3 text-right text-slate-600">{d.estimatedRecordingHours ?? "—"}h</td>
                <td className="px-4 py-3 text-right">{uploadBadge(d.uploadSuccessRate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════════════

function formatTime(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2, "0")}:00`;
}

function formatTooltipTime(ts) {
  if (!ts) return "";
  return new Date(ts).toLocaleString("en-IN", {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

function badge(text, color) {
  const map = {
    green: "bg-green-100 text-green-700",
    yellow: "bg-yellow-100 text-yellow-700",
    red: "bg-red-100 text-red-700",
    slate: "bg-slate-100 text-slate-600",
  };
  return <span className={`px-2 py-0.5 rounded text-xs font-medium ${map[color] || map.slate}`}>{text}</span>;
}

function cpuBadge(v) {
  if (v == null) return "—";
  const color = v > 80 ? "red" : v > 60 ? "yellow" : "green";
  return badge(`${v}%`, color);
}

function ramBadge(v) {
  if (v == null) return "—";
  const color = v > 90 ? "red" : v > 75 ? "yellow" : "green";
  return badge(`${v}%`, color);
}

function tempBadge(v) {
  if (v == null) return "—";
  const color = v > 75 ? "red" : v > 60 ? "yellow" : "green";
  return badge(`${v}\u00b0C`, color);
}

function wifiBadge(v) {
  if (v == null) return "—";
  const color = v < -85 ? "red" : v < -70 ? "yellow" : "green";
  return badge(`${v}`, color);
}

function errorBadge(v) {
  if (v == null || v === 0) return badge("0", "green");
  const color = v > 20 ? "red" : v > 5 ? "yellow" : "slate";
  return badge(v, color);
}

function uploadBadge(v) {
  if (v == null) return "—";
  const color = v < 80 ? "red" : v < 95 ? "yellow" : "green";
  return badge(`${v}%`, color);
}
