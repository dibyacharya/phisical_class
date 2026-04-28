import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { usePersistedState } from "../hooks/usePersistedState";
import {
  Building2, ChevronRight, Settings, BarChart2, Heart, Video,
  Wifi, WifiOff, CircleDot, Camera, Mic, Monitor, HardDrive,
  Cpu, Battery, AlertTriangle, CheckCircle, XCircle, Signal,
  Clock, Download, Play, RefreshCw, Calendar, BookOpen, User,
  ChevronLeft, ChevronRight as ChevronRightIcon, Home, X,
  ExternalLink, CalendarDays, Zap, Thermometer, Activity,
  BatteryCharging, BatteryFull, BatteryLow, BatteryMedium,
  Radio, ShieldCheck, ShieldAlert, Timer, TrendingUp,
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
  const API_BASE = import.meta.env.VITE_API_BASE_URL?.replace("/api", "") || "http://localhost:5020";
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

// ── WiFi Signal Bars ──────────────────────────────────────────────────────────
function WifiSignalBars({ dBm }) {
  if (dBm == null) return <span className="text-gray-400 text-sm">–</span>;
  const strength = dBm >= -50 ? 4 : dBm >= -65 ? 3 : dBm >= -75 ? 2 : dBm >= -85 ? 1 : 0;
  const labels   = ["Very Weak","Weak","Fair","Good","Excellent"];
  const colors   = ["text-red-500","text-orange-500","text-yellow-500","text-blue-500","text-emerald-500"];
  const bgColors = ["bg-red-400","bg-orange-400","bg-yellow-400","bg-blue-500","bg-emerald-500"];
  return (
    <div className="flex items-end gap-0.5">
      {[1,2,3,4].map(i => (
        <div key={i} className={`rounded-sm transition-all ${i <= strength ? bgColors[strength] : "bg-gray-200"}`}
          style={{ width: 5, height: 4 + i * 4 }} />
      ))}
      <span className={`ml-2 text-xs font-semibold ${colors[strength]}`}>{labels[strength]} ({dBm} dBm)</span>
    </div>
  );
}

// ── Battery Visual ────────────────────────────────────────────────────────────
function BatteryVisual({ level, charging }) {
  const color = charging ? "bg-emerald-400" : level >= 50 ? "bg-emerald-500" : level >= 20 ? "bg-yellow-400" : "bg-red-500";
  const textColor = charging ? "text-emerald-600" : level >= 50 ? "text-emerald-600" : level >= 20 ? "text-yellow-600" : "text-red-600";
  return (
    <div className="flex items-center gap-3">
      <BatteryCharging size={18} className={charging ? "text-emerald-500" : "text-gray-400"} />
      <div className="flex-1 bg-gray-100 rounded-full h-3 overflow-hidden">
        <div className={`${color} h-3 rounded-full transition-all`} style={{ width: `${Math.min(level,100)}%` }} />
      </div>
      <span className={`text-sm font-black w-12 text-right ${textColor}`}>{level}%</span>
      {charging && <span className="text-xs text-emerald-600 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full font-semibold">⚡ Charging</span>}
    </div>
  );
}

// ── Radial Gauge ──────────────────────────────────────────────────────────────
function RadialGauge({ value, label, warn = 75, danger = 90 }) {
  if (value == null) return null;
  const size  = 80;
  const r     = 32;
  const circ  = 2 * Math.PI * r;
  const fill  = (Math.min(value, 100) / 100) * circ;
  const color = value >= danger ? "#ef4444" : value >= warn ? "#f59e0b" : "#10b981";
  return (
    <div className="flex flex-col items-center gap-1 min-w-[80px]">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90" style={{ position:"absolute", top:0, left:0 }}>
          <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#e5e7eb" strokeWidth={7} />
          <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={7}
            strokeDasharray={`${fill} ${circ - fill}`} strokeLinecap="round" />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <p className="text-base font-black leading-none" style={{ color }}>{value}%</p>
        </div>
      </div>
      <p className="text-xs text-gray-500 font-semibold">{label}</p>
    </div>
  );
}

// ── Tab 2: Health Card ────────────────────────────────────────────────────────
function TabHealth({ detail, onRefresh }) {
  const { device } = detail;
  const [tick, setTick] = useState(30);

  useEffect(() => {
    const iv = setInterval(() => {
      setTick(t => {
        if (t <= 1) { onRefresh?.(); return 30; }
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(iv);
  }, [onRefresh]);

  if (!device) {
    return (
      <div className="text-center py-20 text-gray-400">
        <Heart size={48} className="mx-auto mb-3 opacity-30" />
        <p>No device registered for this space</p>
      </div>
    );
  }

  const h          = device.health || {};
  const isOnline   = device.isOnline;
  const isRec      = device.isRecording;
  const alertCount = (h.alerts || []).length;
  const wifiDbm    = h.network?.wifiSignal;

  return (
    <div className="space-y-5">

      {/* ── Hero Banner ───────────────────────────────────────────────────── */}
      <div className={`relative overflow-hidden rounded-3xl p-6
        ${isRec ? "bg-gradient-to-r from-red-600 via-rose-600 to-orange-600"
        : isOnline ? "bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-700"
        : "bg-gradient-to-r from-gray-600 to-gray-700"}`}>
        <div className="absolute inset-0 opacity-10"
          style={{ backgroundImage:"radial-gradient(circle, white 1px, transparent 1px)", backgroundSize:"20px 20px" }} />
        <div className="relative flex items-center gap-5 flex-wrap">
          {/* Orb */}
          <div className="relative shrink-0">
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center bg-white/20 backdrop-blur-sm border border-white/30">
              {isRec ? <CircleDot size={32} className="text-white animate-pulse" />
                     : isOnline ? <Wifi size={32} className="text-white" />
                                : <WifiOff size={32} className="text-white/60" />}
            </div>
            {isOnline && !isRec && (
              <span className="absolute -top-1 -right-1 w-4 h-4 bg-emerald-400 border-2 border-white rounded-full animate-pulse" />
            )}
          </div>
          {/* Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h2 className="text-2xl font-black text-white">
                {isRec ? "🔴 Live Recording" : isOnline ? "Device Online" : "Device Offline"}
              </h2>
              {alertCount > 0 && (
                <span className="flex items-center gap-1 text-xs bg-amber-400 text-amber-900 px-2.5 py-1 rounded-full font-bold">
                  <AlertTriangle size={11} /> {alertCount} alert{alertCount > 1 ? "s" : ""}
                </span>
              )}
            </div>
            <p className="text-white/70 text-sm mt-0.5">{device.deviceModel || device.name} · {device.deviceType?.toUpperCase()}</p>
            <div className="flex items-center gap-4 mt-2 flex-wrap">
              <span className="flex items-center gap-1.5 text-white/80 text-xs">
                <Clock size={11} /> Last beat: {device.lastHeartbeat ? new Date(device.lastHeartbeat).toLocaleTimeString("en-IN") : "–"}
              </span>
              {h.serviceUptime != null && (
                <span className="flex items-center gap-1.5 text-white/80 text-xs">
                  <Timer size={11} /> Uptime: {fmtUptime(h.serviceUptime)}
                </span>
              )}
              {device.ipAddress && (
                <span className="flex items-center gap-1.5 text-white/80 text-xs">
                  <Signal size={11} /> {device.ipAddress}
                </span>
              )}
            </div>
          </div>
          {/* Countdown */}
          <div className="flex flex-col items-center gap-1 shrink-0">
            <div className="relative w-12 h-12">
              <svg className="w-12 h-12 -rotate-90" viewBox="0 0 48 48">
                <circle cx="24" cy="24" r="20" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="3" />
                <circle cx="24" cy="24" r="20" fill="none" stroke="rgba(255,255,255,0.8)" strokeWidth="3"
                  strokeDasharray={`${(tick/30)*125.7} 125.7`} strokeLinecap="round" />
              </svg>
              <span className="absolute inset-0 flex items-center justify-center text-white font-bold text-xs">{tick}s</span>
            </div>
            <span className="text-white/60 text-[10px]">Auto refresh</span>
          </div>
        </div>
        {h.updatedAt && (
          <div className="relative mt-4 pt-3 border-t border-white/20 flex items-center justify-between text-white/60 text-xs">
            <span>Health updated: {new Date(h.updatedAt).toLocaleString("en-IN")}</span>
            <span className="flex items-center gap-1"><Activity size={10} /> Live</span>
          </div>
        )}
      </div>

      {/* ── Quick Stat Cards ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {/* Battery */}
        <div className={`rounded-2xl p-4 border-2 ${
          h.battery?.level == null ? "bg-gray-50 border-gray-200"
          : h.battery.charging     ? "bg-emerald-50 border-emerald-200"
          : h.battery.level <= 20  ? "bg-red-50 border-red-200"
          :                          "bg-gray-50 border-gray-200"}`}>
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Battery</p>
          {h.battery?.level != null ? (
            <>
              <p className={`text-3xl font-black ${h.battery.level <= 20 ? "text-red-600" : h.battery.charging ? "text-emerald-600" : "text-gray-800"}`}>
                {h.battery.level}%
              </p>
              <p className="text-xs text-gray-500 mt-1">{h.battery.charging ? "⚡ Charging" : "🔋 On battery"}</p>
            </>
          ) : <p className="text-2xl font-black text-gray-300 mt-1">–</p>}
        </div>
        {/* WiFi */}
        <div className={`rounded-2xl p-4 border-2 ${
          wifiDbm == null ? "bg-gray-50 border-gray-200"
          : wifiDbm >= -50 ? "bg-emerald-50 border-emerald-200"
          : wifiDbm >= -65 ? "bg-blue-50 border-blue-200"
          : wifiDbm >= -75 ? "bg-yellow-50 border-yellow-200"
          : "bg-red-50 border-red-200"}`}>
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">WiFi Signal</p>
          {wifiDbm != null ? (
            <>
              <p className={`text-3xl font-black ${wifiDbm >= -50 ? "text-emerald-700" : wifiDbm >= -65 ? "text-blue-700" : wifiDbm >= -75 ? "text-yellow-600" : "text-red-600"}`}>{wifiDbm}</p>
              <p className="text-xs text-gray-500 mt-1">dBm · {wifiDbm >= -50 ? "Excellent" : wifiDbm >= -65 ? "Good" : wifiDbm >= -75 ? "Fair" : "Weak"}</p>
            </>
          ) : <p className="text-2xl font-black text-gray-300 mt-1">–</p>}
        </div>
        {/* RAM */}
        <div className={`rounded-2xl p-4 border-2 ${
          h.ram?.usedPercent == null ? "bg-gray-50 border-gray-200"
          : h.ram.usedPercent >= 90  ? "bg-red-50 border-red-200"
          : h.ram.usedPercent >= 75  ? "bg-yellow-50 border-yellow-200"
          :                            "bg-blue-50 border-blue-200"}`}>
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">RAM</p>
          {h.ram?.usedPercent != null ? (
            <>
              <p className={`text-3xl font-black ${h.ram.usedPercent >= 90 ? "text-red-600" : h.ram.usedPercent >= 75 ? "text-yellow-600" : "text-blue-700"}`}>{h.ram.usedPercent}%</p>
              <p className="text-xs text-gray-500 mt-1">{h.ram.freeGB} GB free</p>
            </>
          ) : <p className="text-2xl font-black text-gray-300 mt-1">–</p>}
        </div>
        {/* Disk */}
        <div className={`rounded-2xl p-4 border-2 ${
          h.disk?.usedPercent == null ? "bg-gray-50 border-gray-200"
          : h.disk.usedPercent >= 90  ? "bg-red-50 border-red-200"
          : h.disk.usedPercent >= 75  ? "bg-yellow-50 border-yellow-200"
          :                             "bg-teal-50 border-teal-200"}`}>
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Disk</p>
          {h.disk?.usedPercent != null ? (
            <>
              <p className={`text-3xl font-black ${h.disk.usedPercent >= 90 ? "text-red-600" : h.disk.usedPercent >= 75 ? "text-yellow-600" : "text-teal-700"}`}>{h.disk.usedPercent}%</p>
              <p className="text-xs text-gray-500 mt-1">{h.disk.freeGB} GB free</p>
            </>
          ) : <p className="text-2xl font-black text-gray-300 mt-1">–</p>}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">

        {/* ── Hardware ─────────────────────────────────────────────────────── */}
        <div className="bg-white rounded-2xl border shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b bg-gradient-to-r from-slate-50 to-gray-50 flex items-center justify-between">
            <h3 className="font-bold text-gray-800 flex items-center gap-2"><Camera size={17} className="text-blue-600" /> Hardware Status</h3>
            {[h.camera?.ok, h.mic?.ok, h.screen?.ok].every(v => v === true) && (
              <span className="text-xs bg-emerald-100 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded-full font-semibold">All OK ✓</span>
            )}
          </div>
          <div className="p-4 space-y-2">
            {[
              { ok: h.camera?.ok,  Icon: Camera,  label: "Camera",         detail: h.camera?.name,       error: h.camera?.error  },
              { ok: h.mic?.ok,     Icon: Mic,     label: "Microphone",     detail: h.mic?.name,          error: h.mic?.error     },
              { ok: h.screen?.ok,  Icon: Monitor, label: "Display/Screen", detail: h.screen?.resolution, error: h.screen?.error  },
            ].map(({ ok, Icon, label, detail, error }) => (
              <div key={label} className={`flex items-center gap-3 p-3 rounded-xl border
                ${ok === true ? "bg-emerald-50 border-emerald-100" : ok === false ? "bg-red-50 border-red-100" : "bg-gray-50 border-gray-100"}`}>
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0
                  ${ok === true ? "bg-emerald-100" : ok === false ? "bg-red-100" : "bg-gray-100"}`}>
                  <Icon size={17} className={ok === true ? "text-emerald-600" : ok === false ? "text-red-500" : "text-gray-400"} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm text-gray-800">{label}</span>
                    {ok === true  && <CheckCircle size={13} className="text-emerald-500" />}
                    {ok === false && <XCircle     size={13} className="text-red-500" />}
                    {ok == null   && <span className="text-[10px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded-full">Unknown</span>}
                  </div>
                  {detail && <p className="text-xs text-gray-500 mt-0.5 truncate">{detail}</p>}
                  {error  && <p className="text-xs text-red-500 mt-0.5">{error}</p>}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Network ──────────────────────────────────────────────────────── */}
        <div className="bg-white rounded-2xl border shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b bg-gradient-to-r from-slate-50 to-gray-50">
            <h3 className="font-bold text-gray-800 flex items-center gap-2"><Signal size={17} className="text-cyan-600" /> Network</h3>
          </div>
          <div className="p-5 space-y-5">
            <div>
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">WiFi Network</p>
              <div className="flex items-center gap-2">
                <Wifi size={15} className="text-cyan-500" />
                <span className="font-semibold text-gray-800 text-sm">
                  {h.network?.ssid && h.network.ssid !== "<unknown ssid>" ? h.network.ssid : "Hidden / Unknown"}
                </span>
              </div>
            </div>
            <div>
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Signal Strength</p>
              <WifiSignalBars dBm={h.network?.wifiSignal} />
            </div>
            <div>
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Latency to Server</p>
              {h.network?.latencyMs != null ? (
                <div className="flex items-center gap-3">
                  <span className={`text-2xl font-black ${h.network.latencyMs > 1000 ? "text-red-600" : h.network.latencyMs > 300 ? "text-yellow-600" : "text-emerald-600"}`}>
                    {h.network.latencyMs}
                  </span>
                  <div>
                    <p className="text-xs text-gray-400">ms</p>
                    <p className={`text-xs font-bold ${h.network.latencyMs > 1000 ? "text-red-500" : h.network.latencyMs > 300 ? "text-yellow-500" : "text-emerald-500"}`}>
                      {h.network.latencyMs > 1000 ? "High ⚠️" : h.network.latencyMs > 300 ? "Fair" : "Good ✓"}
                    </p>
                  </div>
                </div>
              ) : <span className="text-sm text-gray-400">Not yet measured</span>}
            </div>
          </div>
        </div>

        {/* ── System Resources ─────────────────────────────────────────────── */}
        <div className="bg-white rounded-2xl border shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b bg-gradient-to-r from-slate-50 to-gray-50">
            <h3 className="font-bold text-gray-800 flex items-center gap-2"><Activity size={17} className="text-violet-600" /> System Resources</h3>
          </div>
          <div className="p-5 space-y-5">
            {(h.cpu?.usagePercent != null || h.ram?.usedPercent != null || h.disk?.usedPercent != null) ? (
              <>
                <div className="flex justify-around py-2">
                  {h.cpu?.usagePercent  != null && <RadialGauge value={h.cpu.usagePercent}  label="CPU"  danger={90} />}
                  {h.ram?.usedPercent   != null && <RadialGauge value={h.ram.usedPercent}   label="RAM"  />}
                  {h.disk?.usedPercent  != null && <RadialGauge value={h.disk.usedPercent}  label="Disk" warn={80} />}
                </div>
                <div className="space-y-3">
                  {h.ram?.usedPercent != null && (
                    <div>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="font-semibold text-gray-600">RAM</span>
                        <span className="text-gray-400">{h.ram.freeGB} GB free of {h.ram.totalGB} GB</span>
                      </div>
                      <UsageBar value={h.ram.usedPercent} />
                    </div>
                  )}
                  {h.disk?.usedPercent != null && (
                    <div>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="font-semibold text-gray-600">Disk</span>
                        <span className="text-gray-400">{h.disk.freeGB} GB free of {h.disk.totalGB} GB</span>
                      </div>
                      <UsageBar value={h.disk.usedPercent} warn={80} danger={90} />
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="text-center py-8 text-gray-400">
                <Cpu size={32} className="mx-auto mb-2 opacity-20" />
                <p className="text-sm">Waiting for resource data...</p>
              </div>
            )}
            {h.battery?.level != null && (
              <div className="pt-3 border-t">
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Battery</p>
                <BatteryVisual level={h.battery.level} charging={h.battery.charging} />
              </div>
            )}
          </div>
        </div>

        {/* ── Recording Quality ─────────────────────────────────────────────── */}
        <div className="bg-white rounded-2xl border shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b bg-gradient-to-r from-slate-50 to-gray-50">
            <h3 className="font-bold text-gray-800 flex items-center gap-2"><Video size={17} className="text-rose-600" /> Recording Quality</h3>
          </div>
          <div className="p-5 space-y-3">
            <div className={`flex items-center justify-between p-3 rounded-xl border ${(h.recording?.frameDrop ?? 0) > 0 ? "bg-yellow-50 border-yellow-200" : "bg-emerald-50 border-emerald-200"}`}>
              <span className="text-sm font-semibold text-gray-700 flex items-center gap-2"><TrendingUp size={14} /> Frame Drops</span>
              <span className={`text-xl font-black ${(h.recording?.frameDrop ?? 0) > 0 ? "text-yellow-600" : "text-emerald-600"}`}>{h.recording?.frameDrop ?? 0}</span>
            </div>
            <div className={`flex items-center justify-between p-3 rounded-xl border ${(h.recording?.errorCount ?? 0) > 0 ? "bg-red-50 border-red-200" : "bg-emerald-50 border-emerald-200"}`}>
              <span className="text-sm font-semibold text-gray-700 flex items-center gap-2"><Zap size={14} /> Error Count</span>
              <span className={`text-xl font-black ${(h.recording?.errorCount ?? 0) > 0 ? "text-red-600" : "text-emerald-600"}`}>{h.recording?.errorCount ?? 0}</span>
            </div>
            {h.recording?.lastError && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-3">
                <p className="text-xs font-bold text-red-500 uppercase mb-1">Last Error</p>
                <p className="text-sm text-red-700">{h.recording.lastError}</p>
              </div>
            )}
            {h.serviceUptime != null && (
              <div className="flex items-center justify-between p-3 bg-blue-50 border border-blue-200 rounded-xl">
                <span className="text-sm font-semibold text-blue-700 flex items-center gap-2"><Timer size={14} /> Service Uptime</span>
                <span className="font-bold text-blue-800">{fmtUptime(h.serviceUptime)}</span>
              </div>
            )}
            {(h.recording?.frameDrop ?? 0) === 0 && (h.recording?.errorCount ?? 0) === 0 && !h.recording?.lastError && (
              <div className="flex items-center gap-2 text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3">
                <CheckCircle size={16} className="text-emerald-500" />
                <span className="text-sm font-semibold">Recording quality excellent ✓</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Alerts ───────────────────────────────────────────────────────────── */}
      {alertCount > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl overflow-hidden">
          <div className="px-5 py-4 border-b border-amber-200 bg-amber-100/50 flex items-center gap-2">
            <AlertTriangle size={18} className="text-amber-600" />
            <h3 className="font-bold text-amber-800">{alertCount} Active Alert{alertCount > 1 ? "s" : ""}</h3>
          </div>
          <div className="p-4 space-y-2">
            {h.alerts.map((a, i) => (
              <div key={i} className="flex items-start gap-3 bg-white rounded-xl p-3 border border-amber-100">
                <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center shrink-0">
                  <AlertTriangle size={14} className="text-amber-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <span className="text-[10px] font-black text-amber-600 uppercase bg-amber-100 px-1.5 py-0.5 rounded">{a.type}</span>
                  <p className="text-sm text-gray-700 mt-1">{a.message}</p>
                </div>
                <span className="text-xs text-gray-400 shrink-0 mt-1">{a.time ? new Date(a.time).toLocaleTimeString("en-IN") : ""}</span>
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

// ── Tab 5: Recordings ─────────────────────────────────────────────────────────
function RecordingCard({ row, API_BASE, onClick }) {
  const hasVideo = !!(row.videoUrl);
  return (
    <div
      onClick={onClick}
      className="bg-white rounded-2xl border overflow-hidden hover:shadow-lg transition-shadow group cursor-pointer"
    >
      {/* Thumbnail */}
      <div className="relative bg-gradient-to-br from-gray-800 to-gray-900 h-44 flex items-center justify-center select-none">
        <Video size={44} className="text-gray-600 opacity-25" />
        {hasVideo && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-14 h-14 rounded-full bg-white/10 backdrop-blur-sm border border-white/20
                            flex items-center justify-center
                            group-hover:bg-white/25 group-hover:scale-110 transition-all duration-200">
              <Play size={22} className="text-white ml-1" fill="white" />
            </div>
          </div>
        )}
        {/* Status pill — top right */}
        <span className={`absolute top-3 right-3 text-[10px] px-2 py-0.5 rounded-full font-semibold shadow ${STATUS_COLOR(row.status)}`}>
          {row.status || "–"}
        </span>
        {/* Published — top left */}
        {row.isPublished && (
          <span className="absolute top-3 left-3 text-[10px] px-2 py-0.5 rounded-full font-semibold bg-emerald-100 text-emerald-700">
            Published
          </span>
        )}
        {/* Duration — bottom right */}
        {row.duration > 0 && (
          <span className="absolute bottom-3 right-3 text-xs bg-black/60 text-white px-2 py-0.5 rounded-md font-mono tracking-wide">
            {fmtDuration(row.duration)}
          </span>
        )}
        {/* No video overlay */}
        {!hasVideo && (
          <span className="absolute bottom-3 left-3 text-[10px] px-2 py-0.5 rounded-md bg-black/40 text-gray-400">
            No video
          </span>
        )}
      </div>

      {/* Body */}
      <div className="p-4">
        <p className="font-semibold text-gray-800 text-sm truncate leading-snug">
          {row.courseName !== "–" ? row.courseName : row.title}
        </p>
        {row.courseCode && (
          <span className="inline-block mt-1 text-[10px] bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full font-medium">
            {row.courseCode}
          </span>
        )}

        <div className="mt-3 space-y-1.5 text-xs text-gray-500">
          <div className="flex items-center gap-1.5">
            <Calendar size={11} className="shrink-0 text-gray-400" />
            <span>{fmtDate(row.date)}</span>
            <span className="text-gray-300 mx-0.5">·</span>
            <Clock size={11} className="shrink-0 text-gray-400" />
            <span className="font-mono">{row.startTime || "–"} – {row.endTime || "–"}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <User size={11} className="shrink-0 text-gray-400" />
            <span className="truncate">{row.teacherName}</span>
            {row.facultyId && row.facultyId !== "–" && (
              <span className="text-gray-300">({row.facultyId})</span>
            )}
          </div>
          {row.fileSize > 0 && (
            <div className="flex items-center gap-1.5">
              <HardDrive size={11} className="shrink-0 text-gray-400" />
              <span>{fmtSize(row.fileSize)}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function TabRecordings({ roomId }) {
  const API_BASE = import.meta.env.VITE_API_BASE_URL?.replace("/api", "") || "http://localhost:5020";

  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  // v3.5.7 — persist history filters across reload.
  const [filters, setFilters] = usePersistedState({ from: "", to: "", courseCode: "", status: "" }, "lcs_roomdetail_history_filters");
  const [applied, setApplied] = useState({});
  const [modal,   setModal]   = useState(null);

  const fetchRecs = useCallback(async (f = {}) => {
    setLoading(true);
    try {
      const p = new URLSearchParams();
      if (f.from)       p.set("from",       f.from);
      if (f.to)         p.set("to",         f.to);
      if (f.courseCode) p.set("courseCode", f.courseCode);
      if (f.status)     p.set("status",     f.status);
      const { data: res } = await api.get(`/rooms/${roomId}/recordings?${p}`);
      setData(res);
    } catch { setData({ rows: [], courses: [], total: 0 }); }
    finally { setLoading(false); }
  }, [roomId]);

  useEffect(() => { fetchRecs(); }, [fetchRecs]);

  const applyFilters = () => { setApplied({ ...filters }); fetchRecs(filters); };
  const clearFilters = () => {
    const empty = { from: "", to: "", courseCode: "", status: "" };
    setFilters(empty); setApplied({}); fetchRecs(empty);
  };
  const hasFilters = Object.values(filters).some(Boolean);

  const totalDuration = data?.rows.reduce((s, r) => s + (r.duration || 0), 0) || 0;
  const completedCount = data?.rows.filter(r => r.status === "completed").length || 0;
  const uniqueCourses  = new Set(data?.rows.map(r => r.courseCode).filter(Boolean)).size;

  // Adapt row for VideoModal (expects .status = class status, .videoUrl etc.)
  const toModalRow = (row) => ({
    ...row,
    status:      row.classStatus,   // class status for the details grid
    facultyName: row.teacherName,
  });

  return (
    <div>
      {/* ── Filter Bar ────────────────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border p-4 mb-5">
        <div className="flex flex-wrap gap-3 items-end">

          {/* From */}
          <div className="flex flex-col gap-1 min-w-[130px]">
            <label className="text-xs text-gray-500 font-medium">From Date</label>
            <input type="date" value={filters.from}
              onChange={e => setFilters(f => ({ ...f, from: e.target.value }))}
              className="border rounded-xl px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-200"
            />
          </div>

          {/* To */}
          <div className="flex flex-col gap-1 min-w-[130px]">
            <label className="text-xs text-gray-500 font-medium">To Date</label>
            <input type="date" value={filters.to}
              onChange={e => setFilters(f => ({ ...f, to: e.target.value }))}
              className="border rounded-xl px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-200"
            />
          </div>

          {/* Course */}
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500 font-medium">Course</label>
            <select value={filters.courseCode}
              onChange={e => setFilters(f => ({ ...f, courseCode: e.target.value }))}
              className="border rounded-xl px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-200 min-w-[180px]"
            >
              <option value="">All Courses</option>
              {data?.courses.map(c => (
                <option key={c.courseCode} value={c.courseCode}>
                  {c.courseName} ({c.courseCode})
                </option>
              ))}
            </select>
          </div>

          {/* Status */}
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500 font-medium">Status</label>
            <select value={filters.status}
              onChange={e => setFilters(f => ({ ...f, status: e.target.value }))}
              className="border rounded-xl px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-200"
            >
              <option value="">All Status</option>
              <option value="completed">✅ Completed</option>
              <option value="recording">🔴 Recording</option>
              <option value="uploading">⬆️ Uploading</option>
              <option value="failed">❌ Failed</option>
            </select>
          </div>

          {/* Action buttons */}
          <div className="flex gap-2 items-center">
            <button onClick={applyFilters}
              className="px-5 py-2 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 transition shadow-sm">
              Apply
            </button>
            {hasFilters && (
              <button onClick={clearFilters}
                className="px-4 py-2 border text-gray-600 rounded-xl text-sm font-medium hover:bg-gray-50 transition">
                Clear
              </button>
            )}
          </div>

          <button onClick={() => fetchRecs(applied)}
            className="ml-auto p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-xl transition"
            title="Refresh">
            <RefreshCw size={16} />
          </button>
        </div>

        {/* Active filter chips */}
        {hasFilters && (
          <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t">
            {filters.from && (
              <span className="text-xs bg-blue-50 text-blue-700 px-2.5 py-1 rounded-full font-medium">
                From: {filters.from}
              </span>
            )}
            {filters.to && (
              <span className="text-xs bg-blue-50 text-blue-700 px-2.5 py-1 rounded-full font-medium">
                To: {filters.to}
              </span>
            )}
            {filters.courseCode && (
              <span className="text-xs bg-purple-50 text-purple-700 px-2.5 py-1 rounded-full font-medium">
                Course: {filters.courseCode}
              </span>
            )}
            {filters.status && (
              <span className="text-xs bg-green-50 text-green-700 px-2.5 py-1 rounded-full font-medium capitalize">
                Status: {filters.status}
              </span>
            )}
          </div>
        )}
      </div>

      {/* ── Summary Stats ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
        {[
          { label: "Total Recordings", value: data?.total ?? "–", Icon: Video,        bg: "bg-blue-50",   ic: "text-blue-600"   },
          { label: "Total Duration",   value: fmtDuration(totalDuration),  Icon: Clock,        bg: "bg-purple-50", ic: "text-purple-600" },
          { label: "Completed",        value: completedCount,               Icon: CheckCircle,  bg: "bg-green-50",  ic: "text-green-600"  },
          { label: "Courses Recorded", value: uniqueCourses,                Icon: BookOpen,     bg: "bg-orange-50", ic: "text-orange-600" },
        ].map(({ label, value, Icon, bg, ic }) => (
          <div key={label} className="bg-white rounded-2xl border p-4">
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center mb-3 ${bg}`}>
              <Icon size={18} className={ic} />
            </div>
            <p className="text-2xl font-bold text-gray-800">{value}</p>
            <p className="text-xs text-gray-500 mt-1">{label}</p>
          </div>
        ))}
      </div>

      {/* ── Content ───────────────────────────────────────────────────────── */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 text-gray-400 gap-3">
          <RefreshCw size={28} className="animate-spin opacity-40" />
          <p className="text-sm">Loading recordings…</p>
        </div>
      ) : data?.rows.length === 0 ? (
        <div className="bg-white rounded-2xl border text-center py-20">
          <Video size={52} className="mx-auto mb-4 text-gray-200" />
          <p className="text-gray-600 font-medium">No recordings found</p>
          <p className="text-sm text-gray-400 mt-1">
            {hasFilters
              ? "Try clearing the filters to see all recordings"
              : "This room has no recordings yet"}
          </p>
          {hasFilters && (
            <button onClick={clearFilters}
              className="mt-4 px-4 py-2 text-sm text-blue-600 border border-blue-200 rounded-xl hover:bg-blue-50 transition">
              Clear filters
            </button>
          )}
        </div>
      ) : (
        <>
          <p className="text-xs text-gray-400 mb-3">
            Showing {data.rows.length} recording{data.rows.length !== 1 ? "s" : ""}
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
            {data.rows.map((row) => (
              <RecordingCard
                key={row.recordingId}
                row={row}
                API_BASE={API_BASE}
                onClick={() => setModal(row)}
              />
            ))}
          </div>
        </>
      )}

      {/* ── Video Modal ───────────────────────────────────────────────────── */}
      {modal && (
        <VideoModal
          row={toModalRow(modal)}
          onClose={() => setModal(null)}
        />
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
  { id: "recordings",  label: "Recordings",    icon: Video       },
];

export default function RoomDetail() {
  const { id }    = useParams();
  const navigate  = useNavigate();
  // v3.5.7 — persist active tab across reload. Per-page (not per-room)
  // because admins typically want to stay in the same workflow tab as
  // they hop between rooms (e.g. always look at "history" first).
  const [tab, setTab] = usePersistedState("config", "lcs_roomdetail_tab");
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
      {tab === "health"      && <TabHealth      detail={detail} onRefresh={fetchDetail} />}
      {tab === "utilization" && <TabUtilization roomId={id} />}
      {tab === "scheduling"  && <TabScheduling  roomId={id} />}
      {tab === "recordings"  && <TabRecordings  roomId={id} />}
    </div>
  );
}
