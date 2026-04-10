import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import {
  Building2, ChevronRight, Settings, BarChart2, Heart, Video,
  Wifi, WifiOff, CircleDot, Camera, Mic, Monitor, HardDrive,
  Cpu, Battery, AlertTriangle, CheckCircle, XCircle, Signal,
  Clock, Download, Play, RefreshCw, Calendar, BookOpen, User,
  ChevronLeft, ChevronRight as ChevronRightIcon, Home, X,
  ExternalLink, CalendarDays,
} from "lucide-react";
import api from "../services/api";

// ── helpers ───────────────────────────────────────────────────────────────────
const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "–";
const fmtTime = (t) => t || "–";
const fmtDuration = (sec) => {
  if (!sec) return "–";
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${s}s` : `${s}s`;
};
const fmtSize = (bytes) => {
  if (!bytes) return "–";
  if (bytes > 1e9) return (bytes / 1e9).toFixed(1) + " GB";
  return (bytes / 1e6).toFixed(1) + " MB";
};
const fmtUptime = (sec) => {
  if (!sec) return "–";
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
};
const todayStr = () => new Date().toISOString().split("T")[0];
const addDays = (dateStr, n) => {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + n);
  return d.toISOString().split("T")[0];
};
const displayDate = (dateStr) =>
  new Date(dateStr).toLocaleDateString("en-IN", { weekday: "short", day: "2-digit", month: "short", year: "numeric" });

const SPACE_TYPE_LABELS = { room: "Room", conference_hall: "Conference Hall", auditorium: "Auditorium" };
const SPACE_TYPE_ICONS  = { room: "🚪", conference_hall: "🤝", auditorium: "🎭" };

const STATUS_COLOR = (s) => ({
  completed:  "bg-green-100 text-green-700",
  recording:  "bg-red-100 text-red-600",
  uploading:  "bg-yellow-100 text-yellow-700",
  failed:     "bg-red-50 text-red-400",
  scheduled:  "bg-blue-50 text-blue-600",
  live:       "bg-red-100 text-red-600",
  cancelled:  "bg-gray-100 text-gray-400",
}[s] || "bg-gray-100 text-gray-500");

const GANTT_COLORS = [
  "bg-blue-500", "bg-purple-500", "bg-green-500", "bg-orange-500",
  "bg-pink-500", "bg-teal-500", "bg-indigo-500", "bg-cyan-500",
];

// ── Sub-components ─────────────────────────────────────────────────────────────
function UsageBar({ value, warn = 75, danger = 90 }) {
  if (value == null) return <span className="text-sm text-gray-400">–</span>;
  const color = value >= danger ? "bg-red-500" : value >= warn ? "bg-yellow-400" : "bg-green-500";
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 bg-gray-100 rounded-full h-2">
        <div className={`${color} h-2 rounded-full`} style={{ width: `${Math.min(value, 100)}%` }} />
      </div>
      <span className="text-sm font-medium w-10 text-right">{value}%</span>
    </div>
  );
}

function HardwareRow({ ok, Icon, label, detail, error }) {
  return (
    <div className="flex items-start gap-3 py-3 border-b last:border-0">
      <div className={`p-2 rounded-lg ${ok === true ? "bg-green-100" : ok === false ? "bg-red-100" : "bg-gray-100"}`}>
        <Icon size={16} className={ok === true ? "text-green-600" : ok === false ? "text-red-500" : "text-gray-400"} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-700">{label}</span>
          {ok === true && <CheckCircle size={14} className="text-green-500" />}
          {ok === false && <XCircle size={14} className="text-red-500" />}
          {ok == null && <span className="text-xs text-gray-400">Unknown</span>}
        </div>
        {detail && <p className="text-xs text-gray-500 mt-0.5 truncate">{detail}</p>}
        {error && <p className="text-xs text-red-500 mt-0.5">{error}</p>}
      </div>
    </div>
  );
}

// ── Video Popup Modal ─────────────────────────────────────────────────────────
function VideoModal({ row, onClose }) {
  const API_BASE = import.meta.env.VITE_API_BASE_URL?.replace("/api", "") || "http://localhost:4000";
  const videoSrc = row.videoUrl ? `${API_BASE}${row.videoUrl}` : null;
  const videoRef = useRef(null);

  // Close on Escape
  useEffect(() => {
    const handler = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-2xl w-full max-w-3xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <div className="min-w-0">
            <h3 className="font-semibold text-gray-800 truncate">{row.courseName || "Class Recording"}</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              {row.courseCode && `${row.courseCode} · `}
              {fmtDate(row.date)} · {fmtTime(row.startTime)} – {fmtTime(row.endTime)}
            </p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100 text-gray-500 transition shrink-0 ml-3">
            <X size={20} />
          </button>
        </div>

        {/* Video */}
        <div className="bg-black">
          {videoSrc ? (
            <video
              ref={videoRef}
              src={videoSrc}
              controls
              autoPlay
              className="w-full max-h-[55vh] object-contain"
            />
          ) : (
            <div className="flex flex-col items-center justify-center h-48 text-gray-500">
              <Video size={48} className="mb-3 opacity-30" />
              <p className="text-sm">No video available for this class</p>
            </div>
          )}
        </div>

        {/* Details grid */}
        <div className="p-5 grid grid-cols-2 md:grid-cols-3 gap-4">
          {[
            ["Faculty ID",    row.facultyId    || "–"],
            ["Faculty Name",  row.facultyName  || "–"],
            ["Course Name",   row.courseName   || "–"],
            ["Course Code",   row.courseCode   || "–"],
            ["Status",        row.status       || "–"],
            ["Duration",      fmtDuration(row.duration)],
            ["File Size",     fmtSize(row.fileSize)],
            ["Date",          fmtDate(row.date)],
            ["Time",          `${fmtTime(row.startTime)} – ${fmtTime(row.endTime)}`],
          ].map(([k, v]) => (
            <div key={k}>
              <p className="text-xs text-gray-500 mb-0.5">{k}</p>
              <p className="text-sm font-medium text-gray-800 truncate">{v}</p>
            </div>
          ))}
        </div>

        {/* Download link */}
        {videoSrc && (
          <div className="px-5 pb-5">
            <a href={videoSrc} download target="_blank" rel="noreferrer"
              className="flex items-center gap-2 text-sm text-blue-600 hover:underline">
              <ExternalLink size={14} /> Open / Download Recording
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Tab 1: Configuration ──────────────────────────────────────────────────────
function TabConfig({ detail }) {
  const { room, device } = detail;
  const isOnline = device?.isOnline;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      {/* Space info */}
      <div className="bg-white rounded-2xl border p-6">
        <h3 className="font-semibold text-gray-800 mb-4 flex items-center gap-2">
          <Building2 size={18} /> Space Details
        </h3>
        <dl className="space-y-3">
          {[
            ["Campus",        room.campus],
            ["Block",         room.block],
            ["Floor",         room.floor || "–"],
            ["Space ID",      room.roomNumber],
            ["Space Name",    room.roomName || "–"],
            ["Space Type",    `${SPACE_TYPE_ICONS[room.spaceType] || ""} ${SPACE_TYPE_LABELS[room.spaceType] || room.spaceType || "–"}`],
            ["Capacity",      room.capacity ? `${room.capacity} seats` : "–"],
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between items-center text-sm border-b pb-3 last:border-0 last:pb-0">
              <span className="text-gray-500">{k}</span>
              <span className="font-medium text-gray-800">{v}</span>
            </div>
          ))}
        </dl>
      </div>

      {/* Device info */}
      <div className="bg-white rounded-2xl border p-6">
        <h3 className="font-semibold text-gray-800 mb-4 flex items-center gap-2">
          <Monitor size={18} /> Recording Device
          {device && (
            <span className={`ml-auto text-xs px-2 py-0.5 rounded-full border ${
              isOnline
                ? "bg-green-50 text-green-700 border-green-200"
                : "bg-gray-50 text-gray-500 border-gray-200"
            }`}>
              {isOnline ? "Online" : "Offline"}
            </span>
          )}
        </h3>
        {device ? (
          <dl className="space-y-3">
            {[
              ["Name",           device.name],
              ["Device ID",      device.deviceId],
              ["Type",           device.deviceType],
              ["Model",          device.deviceModel || "–"],
              ["OS",             device.osVersion   || "–"],
              ["IP Address",     device.ipAddress   || "–"],
              ["Last Heartbeat", device.lastHeartbeat ? new Date(device.lastHeartbeat).toLocaleString("en-IN") : "–"],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between items-center text-sm border-b pb-3 last:border-0 last:pb-0">
                <span className="text-gray-500">{k}</span>
                <span className="font-medium text-gray-800 text-right max-w-[60%] truncate">{v}</span>
              </div>
            ))}
          </dl>
        ) : (
          <div className="text-center py-8 text-gray-400">
            <Monitor size={40} className="mx-auto mb-2 opacity-30" />
            <p className="text-sm">No device registered for this space</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Tab 2: Health Card ────────────────────────────────────────────────────────
function TabHealth({ detail }) {
  const { device } = detail;
  if (!device) {
    return (
      <div className="text-center py-20 text-gray-400">
        <Heart size={48} className="mx-auto mb-3 opacity-30" />
        <p>No device registered for this space</p>
      </div>
    );
  }
  const h = device.health || {};
  const isOnline = device.isOnline;

  return (
    <div className="space-y-6">
      {/* Status banner */}
      <div className={`rounded-2xl p-4 flex items-center gap-4 ${
        isOnline ? "bg-green-50 border border-green-200" : "bg-gray-100 border border-gray-200"
      }`}>
        <div className={`p-3 rounded-xl ${isOnline ? "bg-green-200" : "bg-gray-300"}`}>
          {isOnline
            ? <Wifi size={24} className="text-green-700" />
            : <WifiOff size={24} className="text-gray-500" />}
        </div>
        <div>
          <p className="font-semibold text-gray-800">{isOnline ? "Device Online" : "Device Offline"}</p>
          <p className="text-sm text-gray-500">
            Last heartbeat: {device.lastHeartbeat ? new Date(device.lastHeartbeat).toLocaleString("en-IN") : "–"}
            {h.serviceUptime != null && ` · Uptime: ${fmtUptime(h.serviceUptime)}`}
          </p>
        </div>
        {device.isRecording && (
          <span className="ml-auto flex items-center gap-2 text-red-600 bg-red-100 px-4 py-2 rounded-xl font-medium animate-pulse">
            <CircleDot size={16} /> Recording
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Hardware */}
        <div className="bg-white rounded-2xl border p-6">
          <h3 className="font-semibold text-gray-800 mb-2 flex items-center gap-2">
            <Camera size={18} /> Hardware Status
          </h3>
          <HardwareRow ok={h.camera?.ok ?? null} Icon={Camera} label="Camera"
            detail={h.camera?.name} error={h.camera?.error} />
          <HardwareRow ok={h.mic?.ok ?? null} Icon={Mic} label="Microphone"
            detail={h.mic?.name} error={h.mic?.error} />
          <HardwareRow ok={h.screen?.ok ?? null} Icon={Monitor} label="Display / Screen"
            detail={h.screen?.resolution} error={h.screen?.error} />
        </div>

        {/* Network */}
        <div className="bg-white rounded-2xl border p-6">
          <h3 className="font-semibold text-gray-800 mb-4 flex items-center gap-2">
            <Signal size={18} /> Network
          </h3>
          <dl className="space-y-3">
            {[
              ["SSID",        h.network?.ssid || "–"],
              ["WiFi Signal", h.network?.wifiSignal != null
                ? `${h.network.wifiSignal}${device.deviceType === "android" ? " dBm" : "%"}`
                : "–"],
              ["Latency",     h.network?.latencyMs != null ? `${h.network.latencyMs} ms` : "–"],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between text-sm border-b pb-3 last:border-0 last:pb-0">
                <span className="text-gray-500">{k}</span>
                <span className={`font-medium ${
                  k === "Latency" && h.network?.latencyMs > 1000 ? "text-red-600" : "text-gray-800"
                }`}>{v}</span>
              </div>
            ))}
          </dl>
        </div>

        {/* Resources */}
        <div className="bg-white rounded-2xl border p-6">
          <h3 className="font-semibold text-gray-800 mb-4 flex items-center gap-2">
            <Cpu size={18} /> System Resources
          </h3>
          <div className="space-y-4">
            {h.cpu?.usagePercent != null && (
              <div>
                <div className="flex justify-between text-sm mb-1.5">
                  <span className="text-gray-500 flex items-center gap-1"><Cpu size={12} /> CPU</span>
                </div>
                <UsageBar value={h.cpu.usagePercent} />
              </div>
            )}
            {h.ram?.usedPercent != null && (
              <div>
                <div className="flex justify-between text-sm mb-1.5">
                  <span className="text-gray-500">RAM</span>
                  <span className="text-xs text-gray-400">{h.ram.freeGB} GB free of {h.ram.totalGB} GB</span>
                </div>
                <UsageBar value={h.ram.usedPercent} />
              </div>
            )}
            {h.disk?.usedPercent != null && (
              <div>
                <div className="flex justify-between text-sm mb-1.5">
                  <span className="text-gray-500 flex items-center gap-1"><HardDrive size={12} /> Disk</span>
                  <span className="text-xs text-gray-400">{h.disk.freeGB} GB free</span>
                </div>
                <UsageBar value={h.disk.usedPercent} />
              </div>
            )}
            {h.battery?.level != null && (
              <div className="flex items-center gap-2 text-sm pt-1">
                <Battery size={14} className="text-gray-400" />
                <span className="text-gray-600">Battery: <strong>{h.battery.level}%</strong></span>
                {h.battery.charging && <span className="text-xs text-green-600">(Charging)</span>}
              </div>
            )}
          </div>
        </div>

        {/* Recording quality */}
        <div className="bg-white rounded-2xl border p-6">
          <h3 className="font-semibold text-gray-800 mb-4 flex items-center gap-2">
            <Video size={18} /> Recording Quality
          </h3>
          <dl className="space-y-3">
            {[
              ["Frame Drops",    h.recording?.frameDrop ?? "–"],
              ["Error Count",    h.recording?.errorCount ?? "–"],
              ["Last Error",     h.recording?.lastError || "None"],
              ["Health Updated", h.updatedAt ? new Date(h.updatedAt).toLocaleString("en-IN") : "Never"],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between text-sm border-b pb-3 last:border-0 last:pb-0">
                <span className="text-gray-500">{k}</span>
                <span className={`font-medium max-w-[60%] text-right truncate ${
                  (k === "Last Error" && v !== "None") || (k === "Error Count" && v > 0)
                    ? "text-red-600" : "text-gray-800"
                }`}>{String(v)}</span>
              </div>
            ))}
          </dl>
        </div>
      </div>

      {/* Alerts */}
      {(h.alerts || []).length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-6">
          <h3 className="font-semibold text-amber-800 mb-4 flex items-center gap-2">
            <AlertTriangle size={18} /> Active Alerts
          </h3>
          <div className="space-y-2">
            {h.alerts.map((a, i) => (
              <div key={i} className="flex items-start gap-3 bg-white rounded-xl p-3 border border-amber-100">
                <AlertTriangle size={14} className="text-amber-500 shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <span className="text-xs font-semibold text-amber-700 uppercase">[{a.type}]</span>
                  <span className="text-sm text-gray-700 ml-2">{a.message}</span>
                </div>
                <span className="text-xs text-gray-400 shrink-0">
                  {a.time ? new Date(a.time).toLocaleTimeString("en-IN") : ""}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Tab 3: Utilization ────────────────────────────────────────────────────────
function TabUtilization({ roomId }) {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [range, setRange]     = useState("30");
  const [selected, setSelected] = useState(null); // row for video modal

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const from = new Date(Date.now() - parseInt(range) * 24 * 60 * 60 * 1000)
        .toISOString().split("T")[0];
      const { data: d } = await api.get(`/rooms/${roomId}/utilization?from=${from}`);
      setData(d);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [roomId, range]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const downloadCSV = () => {
    if (!data?.rows?.length) return;
    const header = ["Sl.No", "Date", "Start", "End", "Faculty ID", "Faculty Name", "Course Code", "Course Name", "Status", "Has Video", "Duration", "File Size"];
    const rows = data.rows.map((r) => [
      r.slNo, fmtDate(r.date), r.startTime, r.endTime,
      r.facultyId, r.facultyName, r.courseCode, r.courseName,
      r.status, r.hasVideo ? "Yes" : "No", fmtDuration(r.duration), fmtSize(r.fileSize),
    ]);
    const csv = [header, ...rows].map((row) => row.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url  = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `utilization-${roomId}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      {/* Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div className="flex gap-2">
          {[["7","7 Days"],["30","30 Days"],["90","3 Months"],["365","1 Year"]].map(([val, label]) => (
            <button key={val} onClick={() => setRange(val)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                range === val ? "bg-blue-600 text-white" : "bg-white border text-gray-600 hover:bg-gray-50"
              }`}>
              {label}
            </button>
          ))}
        </div>
        <button onClick={downloadCSV}
          className="flex items-center gap-2 px-4 py-2 border rounded-xl text-sm text-gray-600 hover:bg-gray-50 transition">
          <Download size={15} /> Download CSV
        </button>
      </div>

      {loading ? (
        <div className="text-center py-16 text-gray-400">Loading...</div>
      ) : !data ? null : (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            {[
              { label: "Total Classes",   value: data.summary.totalClasses,    icon: Calendar,  color: "blue"   },
              { label: "Total Hours",     value: `${data.summary.totalHours}h`, icon: Clock,    color: "purple" },
              { label: "Recordings",      value: data.summary.totalRecordings, icon: Video,     color: "green"  },
              { label: "Unique Courses",  value: data.summary.uniqueCourses,   icon: BookOpen,  color: "orange" },
            ].map(({ label, value, icon: Icon, color }) => (
              <div key={label} className="bg-white rounded-xl border p-4">
                <div className={`bg-${color}-100 w-9 h-9 rounded-lg flex items-center justify-center mb-3`}>
                  <Icon size={18} className={`text-${color}-600`} />
                </div>
                <p className="text-2xl font-bold text-gray-800">{value}</p>
                <p className="text-xs text-gray-500 mt-0.5">{label}</p>
              </div>
            ))}
          </div>

          {/* Utilization table */}
          <div className="bg-white rounded-2xl border overflow-hidden">
            <div className="px-5 py-4 border-b flex items-center justify-between">
              <h3 className="font-semibold text-gray-800">
                Class Records ({data.rows.length})
              </h3>
              <span className="text-xs text-gray-400">Click a row to view recording</span>
            </div>

            {data.rows.length === 0 ? (
              <div className="p-12 text-center text-gray-400">
                <Calendar size={40} className="mx-auto mb-3 opacity-30" />
                <p>No classes in this period</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b">
                      {["Sl.No", "Video", "Faculty ID", "Faculty Name", "Course Name", "Date", "Time", "Status"].map((h) => (
                        <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {data.rows.map((row) => (
                      <tr
                        key={row.classId}
                        onClick={() => setSelected(row)}
                        className="hover:bg-blue-50 cursor-pointer transition"
                      >
                        <td className="px-4 py-3 text-gray-500 font-mono text-xs">{row.slNo}</td>
                        <td className="px-4 py-3">
                          {row.hasVideo ? (
                            <span className="inline-flex items-center gap-1 text-blue-600 font-medium text-xs">
                              <Play size={12} /> Play
                            </span>
                          ) : (
                            <span className="text-gray-300 text-xs">–</span>
                          )}
                        </td>
                        <td className="px-4 py-3 font-medium text-gray-700 whitespace-nowrap">{row.facultyId}</td>
                        <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{row.facultyName}</td>
                        <td className="px-4 py-3 text-gray-700 max-w-[180px] truncate">{row.courseName}</td>
                        <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{fmtDate(row.date)}</td>
                        <td className="px-4 py-3 text-gray-500 whitespace-nowrap font-mono text-xs">
                          {fmtTime(row.startTime)} – {fmtTime(row.endTime)}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${STATUS_COLOR(row.status)}`}>
                            {row.status || "–"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {/* Video Popup */}
      {selected && <VideoModal row={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

// ── Tab 4: Scheduling ─────────────────────────────────────────────────────────
const HOUR_LABELS = Array.from({ length: 10 }, (_, i) => {
  const h = i + 8;
  return `${String(h).padStart(2, "0")}:00`;
}); // 08:00 … 17:00  (10 labels = 10 gridlines)

function TabScheduling({ roomId }) {
  const [date, setDate]       = useState(todayStr);
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [tooltip, setTooltip] = useState(null); // { cls, x, y }

  const fetchSchedule = useCallback(async (d) => {
    setLoading(true);
    try {
      const { data: res } = await api.get(`/rooms/${roomId}/schedule?date=${d}`);
      setData(res);
    } catch { setData(null); }
    finally { setLoading(false); }
  }, [roomId]);

  useEffect(() => { fetchSchedule(date); }, [fetchSchedule, date]);

  const goDay = (n) => {
    const next = addDays(date, n);
    setDate(next);
  };

  const isToday = date === todayStr();

  return (
    <div>
      {/* Date navigation */}
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => goDay(-1)}
          className="p-2 rounded-lg border hover:bg-gray-50 transition text-gray-600">
          <ChevronLeft size={18} />
        </button>

        <div className="flex items-center gap-2 bg-white border rounded-xl px-4 py-2 flex-1 max-w-xs">
          <CalendarDays size={16} className="text-gray-400 shrink-0" />
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="flex-1 text-sm font-medium text-gray-700 outline-none bg-transparent"
          />
        </div>

        <button onClick={() => goDay(1)}
          className="p-2 rounded-lg border hover:bg-gray-50 transition text-gray-600">
          <ChevronRightIcon size={18} />
        </button>

        {!isToday && (
          <button onClick={() => setDate(todayStr())}
            className="px-3 py-2 text-xs font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg transition">
            Today
          </button>
        )}

        <span className="text-sm text-gray-500 hidden md:block">{displayDate(date)}</span>
      </div>

      {loading ? (
        <div className="text-center py-16 text-gray-400">Loading schedule...</div>
      ) : !data ? (
        <div className="text-center py-16 text-gray-400">Could not load schedule</div>
      ) : (
        <>
          {/* Summary */}
          <div className="flex items-center gap-3 mb-4">
            <span className="text-sm font-medium text-gray-700">
              {data.totalClasses} class{data.totalClasses !== 1 ? "es" : ""} scheduled
            </span>
            {data.totalClasses === 0 && (
              <span className="text-xs text-gray-400">– No classes on this day</span>
            )}
          </div>

          {/* Gantt Chart */}
          <div className="bg-white rounded-2xl border overflow-hidden mb-6">
            <div className="px-5 py-4 border-b">
              <h3 className="font-semibold text-gray-800 flex items-center gap-2">
                <Clock size={16} /> Hourly Timeline — 8:00 AM to 6:00 PM
              </h3>
            </div>

            <div className="p-5 overflow-x-auto">
              {/* Hour header */}
              <div className="relative mb-2" style={{ minWidth: "600px" }}>
                <div className="flex">
                  {HOUR_LABELS.map((label) => (
                    <div key={label} className="flex-1 text-xs text-gray-400 font-mono">
                      {label}
                    </div>
                  ))}
                  <div className="text-xs text-gray-400 font-mono">18:00</div>
                </div>
              </div>

              {/* Grid + Gantt blocks */}
              <div className="relative h-16 bg-gray-50 rounded-xl border overflow-hidden" style={{ minWidth: "600px" }}>
                {/* Vertical hour grid lines */}
                {HOUR_LABELS.map((_, i) => (
                  <div
                    key={i}
                    className="absolute top-0 bottom-0 border-l border-gray-200"
                    style={{ left: `${(i / 10) * 100}%` }}
                  />
                ))}
                {/* Rightmost line */}
                <div className="absolute top-0 bottom-0 right-0 border-l border-gray-200" />

                {/* Class blocks */}
                {data.gantt.length === 0 ? (
                  <div className="absolute inset-0 flex items-center justify-center text-xs text-gray-400">
                    No classes scheduled
                  </div>
                ) : (
                  data.gantt.map((cls, idx) => (
                    <div
                      key={cls._id}
                      className={`absolute top-2 bottom-2 ${GANTT_COLORS[idx % GANTT_COLORS.length]} rounded-lg opacity-90 hover:opacity-100 cursor-pointer flex items-center px-2 overflow-hidden`}
                      style={{ left: `${cls.leftPct}%`, width: `${cls.widthPct}%` }}
                      onMouseEnter={(e) => setTooltip({ cls, x: e.clientX, y: e.clientY })}
                      onMouseLeave={() => setTooltip(null)}
                    >
                      <span className="text-white text-[10px] font-medium truncate whitespace-nowrap">
                        {cls.startTime}–{cls.endTime} {cls.courseName || cls.title || ""}
                      </span>
                    </div>
                  ))
                )}
              </div>

              {/* Occupied / free legend */}
              <div className="mt-3 flex items-center gap-4 text-xs text-gray-500">
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded bg-blue-500 inline-block" /> Class block
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded bg-gray-200 inline-block" /> Free slot
                </span>
              </div>
            </div>
          </div>

          {/* Hourly slot cards */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
            {data.slots.map((slot) => (
              <div
                key={slot.hour}
                className={`rounded-xl border p-3 ${
                  slot.occupied ? "bg-blue-50 border-blue-200" : "bg-gray-50 border-gray-100"
                }`}
              >
                <p className={`text-xs font-semibold mb-1 ${slot.occupied ? "text-blue-700" : "text-gray-400"}`}>
                  {slot.label}
                </p>
                {slot.occupied ? (
                  slot.classes.map((c) => (
                    <p key={c._id} className="text-[10px] text-blue-600 truncate">
                      {c.courseName || c.title || "Class"}
                    </p>
                  ))
                ) : (
                  <p className="text-[10px] text-gray-400">Free</p>
                )}
              </div>
            ))}
          </div>

          {/* Class list for the day */}
          {data.totalClasses > 0 && (
            <div className="bg-white rounded-2xl border overflow-hidden">
              <div className="px-5 py-4 border-b">
                <h3 className="font-semibold text-gray-800">
                  Classes on {displayDate(date)}
                </h3>
              </div>
              <div className="divide-y">
                {data.gantt.map((cls, idx) => (
                  <div key={cls._id} className="px-5 py-4 flex items-center gap-4">
                    <div className={`w-1.5 self-stretch rounded-full ${GANTT_COLORS[idx % GANTT_COLORS.length]}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800 truncate">
                        {cls.courseName || cls.title || "Untitled Class"}
                      </p>
                      <p className="text-xs text-gray-500 mt-0.5 flex flex-wrap gap-x-3">
                        {cls.courseCode && <span>{cls.courseCode}</span>}
                        {cls.facultyName && (
                          <span className="flex items-center gap-1">
                            <User size={10} /> {cls.facultyName}
                          </span>
                        )}
                        {cls.facultyId && <span>ID: {cls.facultyId}</span>}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-medium text-gray-700 font-mono">
                        {cls.startTime} – {cls.endTime}
                      </p>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${STATUS_COLOR(cls.status)}`}>
                        {cls.status || "–"}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* Hover tooltip */}
      {tooltip && (
        <div
          className="fixed z-50 bg-gray-900 text-white text-xs rounded-xl px-3 py-2 pointer-events-none shadow-xl"
          style={{ top: tooltip.y + 12, left: tooltip.x + 8, maxWidth: 220 }}
        >
          <p className="font-semibold">{tooltip.cls.courseName || tooltip.cls.title}</p>
          {tooltip.cls.courseCode && <p className="text-gray-300">{tooltip.cls.courseCode}</p>}
          <p className="text-gray-300">{tooltip.cls.startTime} – {tooltip.cls.endTime}</p>
          {tooltip.cls.facultyName && <p className="text-gray-300">👤 {tooltip.cls.facultyName}</p>}
          <span className={`inline-block mt-1 text-[9px] px-1.5 py-0.5 rounded-full font-medium ${STATUS_COLOR(tooltip.cls.status)}`}>
            {tooltip.cls.status}
          </span>
        </div>
      )}
    </div>
  );
}

// ── Main RoomDetail ───────────────────────────────────────────────────────────
const TABS = [
  { id: "config",      label: "Configuration", icon: Settings    },
  { id: "health",      label: "Health Card",   icon: Heart       },
  { id: "utilization", label: "Utilization",   icon: BarChart2   },
  { id: "scheduling",  label: "Scheduling",    icon: CalendarDays },
];

export default function RoomDetail() {
  const { id }    = useParams();
  const navigate  = useNavigate();
  const [tab, setTab]       = useState("config");
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchDetail = useCallback(async () => {
    try {
      const { data } = await api.get(`/rooms/${id}/detail`);
      setDetail(data);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [id]);

  useEffect(() => { fetchDetail(); }, [fetchDetail]);

  if (loading) return <div className="text-center py-20 text-gray-400">Loading...</div>;
  if (!detail)  return <div className="text-center py-20 text-gray-400">Space not found</div>;

  const { room } = detail;
  const spaceIcon  = SPACE_TYPE_ICONS[room.spaceType]  || "🏢";
  const spaceLabel = SPACE_TYPE_LABELS[room.spaceType] || "Space";

  return (
    <div>
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-gray-500 mb-4 flex-wrap">
        <Link to="/facility" className="flex items-center gap-1 hover:text-blue-600 transition">
          <Home size={14} /> Facility
        </Link>
        <ChevronRight size={14} />
        <span>{room.campus}</span>
        <ChevronRight size={14} />
        <span>{room.block}</span>
        <ChevronRight size={14} />
        <span className="text-gray-800 font-medium">{room.roomNumber}</span>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between mb-6 gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
            <span>{spaceIcon}</span>
            {room.roomName || room.roomNumber}
          </h2>
          <p className="text-gray-500 text-sm mt-1">
            {spaceLabel} · {room.campus} · {room.block}
            {room.floor ? ` · ${room.floor}` : ""}
            {room.capacity ? ` · ${room.capacity} seats` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={fetchDetail}
            className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition"
            title="Refresh">
            <RefreshCw size={16} />
          </button>
          <button onClick={() => navigate("/facility")}
            className="flex items-center gap-2 px-4 py-2 border rounded-xl text-sm text-gray-600 hover:bg-gray-50 transition">
            <ChevronLeft size={16} /> Back
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-gray-100 p-1 rounded-xl w-fit flex-wrap">
        {TABS.map(({ id: tid, label, icon: Icon }) => (
          <button
            key={tid}
            onClick={() => setTab(tid)}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition ${
              tab === tid
                ? "bg-white text-blue-600 shadow-sm"
                : "text-gray-600 hover:text-gray-800"
            }`}
          >
            <Icon size={15} /> {label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === "config"      && <TabConfig      detail={detail} />}
      {tab === "health"      && <TabHealth      detail={detail} />}
      {tab === "utilization" && <TabUtilization roomId={id} />}
      {tab === "scheduling"  && <TabScheduling  roomId={id} />}
    </div>
  );
}
