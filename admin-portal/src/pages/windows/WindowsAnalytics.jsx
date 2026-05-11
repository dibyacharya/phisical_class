import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import {
  Activity, AlertTriangle, Cpu, HardDrive, Wifi, MemoryStick,
  Monitor, RefreshCw, CheckCircle2, XCircle, Clock, Radio,
  ChevronRight, Video, Layers,
} from "lucide-react";
import { winDevices, winRecordings, winLiveWatch } from "../../services/windowsApi";

const AUTO_REFRESH_MS = 60_000;

/**
 * Fleet-level analytics for the Windows pipeline. Distinct from the
 * Android Analytics page because the Windows data model differs
 * (DiskGovernor, LiveWatch, etc. are Windows-only concepts).
 *
 * What this page shows:
 *   - Overall fleet KPI strip (online %, recording right now, live-watch
 *     sessions, total recordings this week, total storage used).
 *   - Per-device health table sortable by CPU / disk / heartbeat age.
 *   - Recent recordings table (last 20).
 *   - Active live-watch sessions list with click-through to viewer.
 */
export default function WindowsAnalytics() {
  const [devices, setDevices] = useState([]);
  const [recordings, setRecordings] = useState([]);
  const [liveActive, setLiveActive] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefresh, setLastRefresh] = useState(null);
  const [sortKey, setSortKey] = useState("heartbeat");

  const fetchAll = useCallback(async () => {
    setRefreshing(true);
    try {
      const [d, r, l] = await Promise.all([
        winDevices.list().catch(() => ({ devices: [] })),
        winRecordings.list({ limit: 20 }).catch(() => []),
        winLiveWatch.active().catch(() => ({ sessions: [] })),
      ]);
      setDevices(d.devices || []);
      setRecordings(Array.isArray(r) ? r : r.recordings || []);
      setLiveActive(l.sessions || []);
      setLastRefresh(new Date());
    } catch (err) {
      console.error("WindowsAnalytics fetchAll:", err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
    const t = setInterval(fetchAll, AUTO_REFRESH_MS);
    return () => clearInterval(t);
  }, [fetchAll]);

  // ── Derived KPIs ──────────────────────────────────────
  const now = Date.now();
  const online = devices.filter(
    (d) => d.lastHeartbeat && now - new Date(d.lastHeartbeat).getTime() < 5 * 60_000
  );
  const recordingNow = devices.filter((d) => d.health?.recording?.isRecording);
  const diskWarn = devices.filter((d) => {
    const s = d.health?.diskGovernor?.state;
    return s === "Warn" || s === "Cleanup" || s === "HardStop";
  });
  const totalFreeBytes = devices.reduce(
    (sum, d) => sum + (d.health?.diskGovernor?.freeBytes || 0),
    0
  );
  const recordingsThisWeek = recordings.filter((r) => {
    const t = new Date(r.recordingStart || r.createdAt).getTime();
    return now - t < 7 * 24 * 60 * 60 * 1000;
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="animate-spin text-blue-500" size={32} />
        <span className="ml-3 text-slate-500">Loading Windows analytics...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Windows Fleet Analytics</h1>
          <p className="text-sm text-slate-500">
            {lastRefresh && `Updated ${lastRefresh.toLocaleTimeString()}`} ·
            Auto-refresh every 60s
          </p>
        </div>
        <button
          onClick={fetchAll}
          disabled={refreshing}
          className="p-2 hover:bg-slate-100 rounded-lg disabled:opacity-50"
        >
          <RefreshCw size={18} className={refreshing ? "animate-spin" : ""} />
        </button>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        <Kpi
          icon={Monitor}
          label="Total devices"
          value={devices.length}
        />
        <Kpi
          icon={CheckCircle2}
          label="Online"
          value={`${online.length}/${devices.length}`}
          color={online.length === devices.length && devices.length > 0 ? "green" : "yellow"}
        />
        <Kpi
          icon={Video}
          label="Recording now"
          value={recordingNow.length}
          color={recordingNow.length > 0 ? "blue" : "slate"}
        />
        <Kpi
          icon={Radio}
          label="Live sessions"
          value={liveActive.length}
          color={liveActive.length > 0 ? "red" : "slate"}
        />
        <Kpi
          icon={HardDrive}
          label="Disk warnings"
          value={diskWarn.length}
          color={diskWarn.length > 0 ? "yellow" : "green"}
        />
        <Kpi
          icon={Layers}
          label="Recordings (7d)"
          value={recordingsThisWeek.length}
        />
      </div>

      {/* Per-device health table */}
      <Card title="Device health overview" icon={Activity}>
        <div className="flex gap-2 mb-3 text-xs">
          <span className="text-slate-500">Sort by:</span>
          {[
            { id: "heartbeat", label: "Heartbeat" },
            { id: "cpu", label: "CPU" },
            { id: "disk", label: "Disk free" },
            { id: "room", label: "Room" },
          ].map((opt) => (
            <button
              key={opt.id}
              onClick={() => setSortKey(opt.id)}
              className={`px-2 py-1 rounded ${
                sortKey === opt.id
                  ? "bg-blue-100 text-blue-700"
                  : "text-slate-500 hover:bg-slate-100"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <DeviceHealthTable devices={sortDevices(devices, sortKey)} />
      </Card>

      {/* Active live-watch sessions */}
      {liveActive.length > 0 && (
        <Card title={`Active live-watch sessions (${liveActive.length})`} icon={Radio}>
          <div className="space-y-2">
            {liveActive.map((s) => (
              <div
                key={s.id}
                className="flex items-center justify-between border border-red-200 bg-red-50 rounded-lg p-3 text-sm"
              >
                <div>
                  <div className="font-medium text-red-800 flex items-center gap-2">
                    <Radio size={14} className="animate-pulse" />
                    {s.roomName}
                  </div>
                  <div className="text-xs text-red-700 mt-0.5">
                    Device: {s.deviceId.substring(0, 18)}... · State: {s.state}
                  </div>
                </div>
                <Link
                  to={`/windows/devices/${s.deviceId}/remote`}
                  className="text-xs px-3 py-1.5 bg-white border border-red-300 rounded text-red-700 hover:bg-red-100"
                >
                  Open device
                </Link>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Recent recordings */}
      <Card title="Recent recordings (last 20)" icon={Video}>
        <RecentRecordingsTable recordings={recordings.slice(0, 20)} />
      </Card>
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────

function sortDevices(devices, key) {
  const copy = [...devices];
  if (key === "heartbeat") {
    copy.sort((a, b) => {
      const ta = a.lastHeartbeat ? new Date(a.lastHeartbeat).getTime() : 0;
      const tb = b.lastHeartbeat ? new Date(b.lastHeartbeat).getTime() : 0;
      return tb - ta;
    });
  } else if (key === "cpu") {
    copy.sort((a, b) => (b.health?.cpu?.usagePercent || 0) - (a.health?.cpu?.usagePercent || 0));
  } else if (key === "disk") {
    copy.sort((a, b) => (a.health?.disk?.freeGB || 0) - (b.health?.disk?.freeGB || 0));
  } else if (key === "room") {
    copy.sort((a, b) => String(a.roomNumber || "").localeCompare(String(b.roomNumber || "")));
  }
  return copy;
}

function Kpi({ icon: Icon, label, value, color }) {
  const colors = {
    green: "border-green-300 bg-green-50 text-green-700",
    yellow: "border-yellow-300 bg-yellow-50 text-yellow-700",
    blue: "border-blue-300 bg-blue-50 text-blue-700",
    red: "border-red-300 bg-red-50 text-red-700",
    slate: "border-slate-200 bg-slate-50 text-slate-700",
  };
  const cls = colors[color] || "border-slate-200 bg-white text-slate-700";
  return (
    <div className={`border rounded-lg p-3 ${cls}`}>
      <div className="flex items-center justify-between text-[11px] uppercase tracking-wide">
        <span className="opacity-70">{label}</span>
        {Icon && <Icon size={14} />}
      </div>
      <div className="text-2xl font-bold mt-1">{value}</div>
    </div>
  );
}

function Card({ title, icon: Icon, children }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-3 text-slate-700 font-medium text-sm">
        {Icon && <Icon size={16} />}
        {title}
      </div>
      {children}
    </div>
  );
}

function DeviceHealthTable({ devices }) {
  if (devices.length === 0) {
    return <div className="text-sm text-slate-500">No devices registered.</div>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase text-slate-500 border-b border-slate-200">
            <th className="py-2 pr-3">Room</th>
            <th className="py-2 pr-3">Name</th>
            <th className="py-2 pr-3">Online</th>
            <th className="py-2 pr-3">Version</th>
            <th className="py-2 pr-3">CPU</th>
            <th className="py-2 pr-3">RAM</th>
            <th className="py-2 pr-3">Disk Free</th>
            <th className="py-2 pr-3">Disk State</th>
            <th className="py-2 pr-3">Live</th>
            <th className="py-2 pr-3">Recording</th>
            <th className="py-2 pr-3">Action</th>
          </tr>
        </thead>
        <tbody>
          {devices.map((d) => {
            const h = d.health || {};
            const online = d.lastHeartbeat && Date.now() - new Date(d.lastHeartbeat).getTime() < 5 * 60_000;
            const diskState = h.diskGovernor?.state;
            const liveState = h.liveWatch?.state;
            return (
              <tr key={d.deviceId} className="border-b border-slate-100 hover:bg-slate-50">
                <td className="py-2 pr-3 font-medium">{d.roomNumber}</td>
                <td className="py-2 pr-3">{d.name}</td>
                <td className="py-2 pr-3">
                  <span className={`inline-block w-2 h-2 rounded-full ${online ? "bg-green-500" : "bg-red-500"}`} />
                </td>
                <td className="py-2 pr-3 text-xs">{d.appVersionName || "?"}</td>
                <td className="py-2 pr-3">{h.cpu?.usagePercent ?? "?"}%</td>
                <td className="py-2 pr-3">{h.ram?.freeGB?.toFixed(1) ?? "?"} GB</td>
                <td className="py-2 pr-3">{h.disk?.freeGB?.toFixed(1) ?? "?"} GB</td>
                <td className="py-2 pr-3">
                  {diskState && diskState !== "Normal" ? (
                    <span
                      className={`text-[10px] px-2 py-0.5 rounded-full ${
                        diskState === "HardStop"
                          ? "bg-red-100 text-red-700"
                          : "bg-yellow-100 text-yellow-700"
                      }`}
                    >
                      {diskState}
                    </span>
                  ) : (
                    <span className="text-xs text-slate-400">—</span>
                  )}
                </td>
                <td className="py-2 pr-3">
                  {liveState && liveState !== "Idle" ? (
                    <span
                      className={`text-[10px] px-2 py-0.5 rounded-full ${
                        liveState === "Connected"
                          ? "bg-red-100 text-red-700"
                          : "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {liveState}
                    </span>
                  ) : (
                    <span className="text-xs text-slate-400">—</span>
                  )}
                </td>
                <td className="py-2 pr-3">
                  {h.recording?.isRecording ? (
                    <span className="text-blue-600 text-xs">●</span>
                  ) : (
                    <span className="text-xs text-slate-400">—</span>
                  )}
                </td>
                <td className="py-2 pr-3">
                  <Link
                    to={`/windows/devices/${d.deviceId}/remote`}
                    className="text-blue-600 hover:underline text-xs flex items-center gap-1"
                  >
                    Manage <ChevronRight size={12} />
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function RecentRecordingsTable({ recordings }) {
  if (recordings.length === 0) {
    return <div className="text-sm text-slate-500">No recordings yet.</div>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase text-slate-500 border-b border-slate-200">
            <th className="py-2 pr-3">Started</th>
            <th className="py-2 pr-3">Class / Room</th>
            <th className="py-2 pr-3">Duration</th>
            <th className="py-2 pr-3">Size</th>
            <th className="py-2 pr-3">Status</th>
            <th className="py-2 pr-3">Playback</th>
          </tr>
        </thead>
        <tbody>
          {recordings.map((r) => {
            const dur = r.duration
              ? `${Math.floor(r.duration / 60)}:${String(r.duration % 60).padStart(2, "0")}`
              : "—";
            const sizeMB = r.mergedFileSize ? (r.mergedFileSize / 1024 / 1024).toFixed(1) : "?";
            const status = r.status || r.mergeStatus || "?";
            return (
              <tr key={r._id} className="border-b border-slate-100 hover:bg-slate-50">
                <td className="py-2 pr-3 text-xs">
                  {r.recordingStart ? new Date(r.recordingStart).toLocaleString() : "?"}
                </td>
                <td className="py-2 pr-3">
                  {r.scheduledClass?.title || "Untitled"} · Room {r.scheduledClass?.roomNumber || r.roomNumber || "?"}
                </td>
                <td className="py-2 pr-3 font-mono text-xs">{dur}</td>
                <td className="py-2 pr-3 text-xs">{sizeMB} MB</td>
                <td className="py-2 pr-3">
                  <span
                    className={`text-[10px] px-2 py-0.5 rounded-full ${
                      status === "completed"
                        ? "bg-green-100 text-green-700"
                        : status === "failed"
                        ? "bg-red-100 text-red-700"
                        : "bg-yellow-100 text-yellow-700"
                    }`}
                  >
                    {status}
                  </span>
                </td>
                <td className="py-2 pr-3">
                  {r.mergedVideoUrl ? (
                    <a
                      href={r.mergedVideoUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:underline text-xs"
                    >
                      Open
                    </a>
                  ) : (
                    <span className="text-xs text-slate-400">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
