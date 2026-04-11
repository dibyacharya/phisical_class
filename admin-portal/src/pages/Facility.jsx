import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  Building2, Wifi, CircleDot, AlertTriangle,
  ChevronDown, ChevronRight, RefreshCw, Activity,
  Camera, CameraOff, Play, X, Maximize2, ChevronLeft,
  ChevronRight as ChevronRightIcon, LayoutGrid, List,
  Pause, FastForward, ExternalLink, Volume2,
} from "lucide-react";
import api from "../services/api";

const MEDIA_BASE = (import.meta.env.VITE_API_BASE_URL || "http://localhost:4000/api").replace("/api", "");

// ── Space type config ──────────────────────────────────────────────────────────
const SPACE_TYPES = [
  { value: "room",            label: "Classroom",       icon: "🚪",
    gradient: "from-blue-500 to-indigo-600",    camBg: "from-blue-950 to-indigo-900",
    ring: "ring-blue-200",   badge: "bg-blue-100 text-blue-700", accent: "#6366f1" },
  { value: "conference_hall", label: "Conference Hall", icon: "🤝",
    gradient: "from-purple-500 to-violet-600",  camBg: "from-purple-950 to-violet-900",
    ring: "ring-purple-200", badge: "bg-purple-100 text-purple-700", accent: "#8b5cf6" },
  { value: "auditorium",      label: "Auditorium",      icon: "🎭",
    gradient: "from-orange-500 to-amber-600",   camBg: "from-orange-950 to-amber-900",
    ring: "ring-orange-200", badge: "bg-orange-100 text-orange-700", accent: "#f59e0b" },
];
const spaceTypeMeta = (t) => SPACE_TYPES.find((s) => s.value === t) || SPACE_TYPES[0];

// ── Mini progress bar ──────────────────────────────────────────────────────────
function MiniBar({ value, warn = 75, danger = 90 }) {
  if (value == null) return null;
  const color = value >= danger ? "bg-red-500" : value >= warn ? "bg-amber-400" : "bg-emerald-500";
  return (
    <div className="flex-1 bg-gray-200 rounded-full h-1.5 overflow-hidden">
      <div className={`${color} h-1.5 rounded-full transition-all`} style={{ width: `${Math.min(value, 100)}%` }} />
    </div>
  );
}

// ── Camera Preview Area ────────────────────────────────────────────────────────
function CameraPreview({ space, compact }) {
  const dev = space.device;
  const h   = dev?.health || {};
  const isRecording = dev?.isRecording;
  const isOnline    = dev?.isOnline;
  const meta        = spaceTypeMeta(space.spaceType);
  const height      = compact ? "h-20" : "h-28";

  if (!dev) return (
    <div className={`${height} bg-gradient-to-br from-gray-100 to-gray-200 flex flex-col items-center justify-center gap-1`}>
      <CameraOff size={compact ? 14 : 20} className="text-gray-400" />
      {!compact && <span className="text-[9px] text-gray-400 font-medium">No Device</span>}
    </div>
  );

  if (isRecording) return (
    <div className={`${height} relative bg-gradient-to-br ${meta.camBg} flex flex-col items-center justify-center overflow-hidden`}>
      {/* Scanlines effect */}
      <div className="absolute inset-0 opacity-10"
        style={{ backgroundImage: "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(255,255,255,0.15) 2px, rgba(255,255,255,0.15) 3px)" }} />
      {/* Pulsing red frame */}
      <div className="absolute inset-0 border-2 border-red-500 animate-pulse rounded-t-2xl pointer-events-none" />
      {/* Center camera icon */}
      <Camera size={compact ? 14 : 22} className="text-white/70 mb-1" />
      {/* REC badge */}
      <div className="flex items-center gap-1 bg-red-600/90 backdrop-blur-sm px-2 py-0.5 rounded-full">
        <span className="w-1.5 h-1.5 bg-white rounded-full animate-ping" />
        <span className="text-[9px] font-black text-white tracking-wider">● REC</span>
      </div>
      {/* Frame drop indicator */}
      {h.recording?.frameDrop > 0 && !compact && (
        <span className="absolute top-1.5 right-1.5 text-[8px] text-amber-300 bg-black/40 px-1.5 py-0.5 rounded">
          {h.recording.frameDrop} drops
        </span>
      )}
      {/* Play hint */}
      {!compact && (
        <div className="absolute bottom-1.5 inset-x-0 flex justify-center">
          <span className="text-[8px] text-white/50 bg-black/30 px-2 py-0.5 rounded-full">
            ▶ Click to play recording
          </span>
        </div>
      )}
    </div>
  );

  if (isOnline) return (
    <div className={`${height} relative bg-gradient-to-br from-slate-800 to-slate-900 flex flex-col items-center justify-center overflow-hidden`}>
      <div className="absolute inset-0 opacity-5"
        style={{ backgroundImage: "repeating-linear-gradient(0deg, transparent, transparent 3px, rgba(255,255,255,0.2) 3px, rgba(255,255,255,0.2) 4px)" }} />
      {/* Subtle green pulse ring */}
      <div className="absolute top-2 right-2 flex items-center gap-1">
        <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse" />
        {!compact && <span className="text-[8px] text-emerald-400">LIVE</span>}
      </div>
      <Camera size={compact ? 14 : 20} className="text-emerald-400/60 mb-1" />
      {!compact && <span className="text-[9px] text-slate-400">Standby</span>}
      {h.network?.ssid && !compact && (
        <span className="absolute bottom-1.5 text-[8px] text-slate-500">📶 {h.network.ssid}</span>
      )}
    </div>
  );

  return (
    <div className={`${height} bg-gradient-to-br from-slate-900 to-gray-900 flex flex-col items-center justify-center gap-1`}>
      <CameraOff size={compact ? 12 : 18} className="text-slate-600" />
      {!compact && <span className="text-[9px] text-slate-600 font-medium">Offline</span>}
    </div>
  );
}

// ── Video Modal ───────────────────────────────────────────────────────────────
function VideoModal({ space, onClose, onViewDetail }) {
  const [videos, setVideos]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [current, setCurrent] = useState(0);
  const videoRef = useRef(null);
  const meta = spaceTypeMeta(space.spaceType);

  useEffect(() => {
    if (!space._id) return;
    api.get(`/rooms/${space._id}/utilization`)
      .then(({ data }) => setVideos(data.rows.filter(r => r.hasVideo && r.videoUrl)))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [space._id]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const dev = space.device;
  const h   = dev?.health || {};
  const vid = videos[current];
  const videoSrc = vid ? `${MEDIA_BASE}${vid.videoUrl}` : null;

  const fmtDate = (d) => d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "–";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-gray-900 rounded-2xl overflow-hidden shadow-2xl w-full max-w-3xl border border-white/10 z-10">

        {/* Header */}
        <div className={`bg-gradient-to-r ${meta.gradient} px-5 py-3 flex items-center justify-between`}>
          <div className="flex items-center gap-3">
            <span className="text-2xl">{meta.icon}</span>
            <div>
              <p className="font-bold text-white text-base leading-tight">{space.roomName || space.roomNumber}</p>
              <p className="text-xs text-white/70">{space.campus} · {space.block} · Room {space.roomNumber}</p>
            </div>
            {dev?.isRecording && (
              <span className="flex items-center gap-1 bg-red-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-full animate-pulse ml-2">
                <span className="w-1.5 h-1.5 bg-white rounded-full" /> LIVE · REC
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onViewDetail}
              className="flex items-center gap-1.5 text-xs bg-white/15 hover:bg-white/25 text-white px-3 py-1.5 rounded-lg transition">
              <ExternalLink size={12} /> Full Details
            </button>
            <button onClick={onClose} className="text-white/70 hover:text-white hover:bg-white/10 p-1.5 rounded-lg transition">
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="flex flex-col md:flex-row">
          {/* Video player */}
          <div className="flex-1 bg-black">
            {loading ? (
              <div className="flex flex-col items-center justify-center h-56 gap-3 text-gray-500">
                <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                <span className="text-sm">Loading recordings...</span>
              </div>
            ) : videoSrc ? (
              <div className="relative">
                <video
                  ref={videoRef}
                  src={videoSrc}
                  controls
                  autoPlay
                  className="w-full max-h-72 bg-black object-contain"
                  style={{ aspectRatio: "16/9" }}
                />
                <div className="absolute top-2 left-2 flex items-center gap-1 bg-black/60 backdrop-blur-sm text-white text-[10px] px-2 py-1 rounded-lg">
                  <Volume2 size={10} /> Audio On
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-56 gap-3 text-gray-500">
                <Camera size={40} className="text-gray-600" />
                <p className="text-sm font-medium text-gray-400">No recordings available</p>
                <p className="text-xs text-gray-600">Recordings will appear here after classes</p>
              </div>
            )}

            {/* Video navigation */}
            {videos.length > 1 && (
              <div className="flex items-center justify-between px-4 py-2 bg-gray-800 border-t border-white/5">
                <button onClick={() => setCurrent(c => Math.max(0, c - 1))} disabled={current === 0}
                  className="p-1 text-gray-400 hover:text-white disabled:opacity-30 transition">
                  <ChevronLeft size={16} />
                </button>
                <span className="text-xs text-gray-400">
                  Recording {current + 1} of {videos.length}
                </span>
                <button onClick={() => setCurrent(c => Math.min(videos.length - 1, c + 1))} disabled={current === videos.length - 1}
                  className="p-1 text-gray-400 hover:text-white disabled:opacity-30 transition">
                  <ChevronRightIcon size={16} />
                </button>
              </div>
            )}
          </div>

          {/* Info panel */}
          <div className="w-full md:w-52 bg-gray-800/80 p-4 space-y-4 shrink-0 border-t md:border-t-0 md:border-l border-white/10">
            {/* Current video info */}
            {vid && (
              <div>
                <p className="text-[10px] text-gray-500 uppercase tracking-widest mb-2">Recording Info</p>
                <p className="text-sm font-semibold text-white leading-snug mb-1">{vid.courseName}</p>
                <p className="text-xs text-gray-400">{fmtDate(vid.date)}</p>
                <p className="text-xs text-gray-400">{vid.startTime} – {vid.endTime}</p>
                <p className="text-xs text-gray-400 mt-1">👤 {vid.facultyName}</p>
                {vid.duration > 0 && (
                  <p className="text-xs text-gray-500 mt-1">⏱ {Math.round(vid.duration / 60)} min</p>
                )}
              </div>
            )}

            {/* Device health */}
            <div>
              <p className="text-[10px] text-gray-500 uppercase tracking-widest mb-2">Device Health</p>
              {[
                { label: "Camera", ok: h.camera?.ok },
                { label: "Mic",    ok: h.mic?.ok    },
                { label: "Screen", ok: h.screen?.ok },
              ].map(({ label, ok }) => (
                <div key={label} className="flex items-center justify-between py-0.5">
                  <span className="text-xs text-gray-400">{label}</span>
                  <span className={`text-[10px] font-semibold ${ok === true ? "text-emerald-400" : ok === false ? "text-red-400" : "text-gray-500"}`}>
                    {ok === true ? "✓ OK" : ok === false ? "✗ ERR" : "–"}
                  </span>
                </div>
              ))}
              {h.cpu?.usagePercent != null && (
                <div className="mt-2 space-y-1">
                  {[
                    { l: "CPU",  v: h.cpu?.usagePercent  },
                    { l: "RAM",  v: h.ram?.usedPercent   },
                    { l: "Disk", v: h.disk?.usedPercent  },
                  ].map(({ l, v }) => v != null && (
                    <div key={l} className="flex items-center gap-2">
                      <span className="text-[9px] text-gray-500 w-6">{l}</span>
                      <div className="flex-1 bg-gray-700 rounded-full h-1">
                        <div className={`h-1 rounded-full ${v >= 90 ? "bg-red-500" : v >= 75 ? "bg-amber-400" : "bg-emerald-500"}`}
                          style={{ width: `${Math.min(v, 100)}%` }} />
                      </div>
                      <span className="text-[9px] text-gray-500">{v}%</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Network */}
            {h.network?.latencyMs != null && (
              <div>
                <p className="text-[10px] text-gray-500 uppercase tracking-widest mb-1">Network</p>
                <p className="text-xs text-gray-400">{h.network.ssid || "–"}</p>
                <p className="text-xs text-gray-400">📶 {h.network.wifiSignal} dBm · {h.network.latencyMs}ms</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Space Card ────────────────────────────────────────────────────────────────
function SpaceCard({ space, onPlay, onNavigate, compact }) {
  const dev         = space.device;
  const h           = dev?.health || {};
  const meta        = spaceTypeMeta(space.spaceType);
  const isOnline    = dev?.isOnline;
  const isRecording = dev?.isRecording;
  const hasAlert    = (h.alerts?.length > 0) ||
    h.camera?.ok === false || h.mic?.ok === false || (h.disk?.usedPercent ?? 0) >= 90;

  const borderColor = isRecording ? "border-red-400"
    : isOnline       ? "border-emerald-300"
    : dev            ? "border-gray-200"
    :                  "border-gray-100";

  if (compact) return (
    <div onClick={() => onPlay(space)}
      className={`relative bg-white rounded-xl border ${borderColor} border-l-[3px]
        cursor-pointer transition-all hover:shadow-md hover:-translate-y-0.5
        ${isRecording ? "shadow-red-100 shadow-sm" : ""} overflow-hidden flex gap-2 p-2.5`}>
      {/* Mini camera preview */}
      <div className="w-14 h-14 rounded-lg overflow-hidden shrink-0">
        <CameraPreview space={space} compact />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between">
          <p className="font-bold text-gray-800 text-xs truncate">{space.roomNumber}</p>
          {isRecording ? (
            <span className="text-[8px] font-bold text-red-600 bg-red-50 px-1 py-0.5 rounded shrink-0 ml-1">REC</span>
          ) : isOnline ? (
            <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full mt-0.5 shrink-0 ml-1" />
          ) : null}
        </div>
        <p className="text-[9px] text-gray-400 truncate">{space.roomName}</p>
        {dev && (h.cpu?.usagePercent != null) && (
          <div className="flex items-center gap-1 mt-1">
            <span className="text-[8px] text-gray-400">CPU</span>
            <MiniBar value={h.cpu.usagePercent} />
            <span className="text-[8px] text-gray-500">{h.cpu.usagePercent}%</span>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div
      onClick={() => onPlay(space)}
      className={`relative bg-white rounded-2xl border ${borderColor} border-l-[4px]
        cursor-pointer transition-all duration-200 hover:shadow-xl hover:-translate-y-1
        ${isRecording ? "shadow-red-100 shadow-md ring-1 ring-red-200" : "shadow-sm"} overflow-hidden group`}
    >
      {/* Recording glow */}
      {isRecording && (
        <div className="absolute inset-0 bg-gradient-to-br from-red-500/8 to-transparent pointer-events-none rounded-2xl" />
      )}

      {/* Camera preview */}
      <div className="rounded-t-2xl overflow-hidden relative">
        <CameraPreview space={space} compact={false} />
        {/* Overlay play button on hover for recording rooms */}
        {dev && (
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-all flex items-center justify-center">
            <div className="w-9 h-9 bg-white/0 group-hover:bg-white/20 rounded-full flex items-center justify-center transition-all opacity-0 group-hover:opacity-100">
              <Play size={16} className="text-white ml-0.5" fill="white" />
            </div>
          </div>
        )}
      </div>

      <div className="p-3">
        {/* Status badges row */}
        <div className="flex items-center justify-between mb-2">
          <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${meta.gradient} flex items-center justify-center text-sm shadow-sm`}>
            {meta.icon}
          </div>
          <div className="flex flex-col items-end gap-1">
            {!dev ? (
              <span className="text-[9px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded-full">No device</span>
            ) : isRecording ? (
              <span className="flex items-center gap-1 text-[9px] font-bold bg-red-500 text-white px-2 py-0.5 rounded-full animate-pulse">
                <span className="w-1 h-1 bg-white rounded-full animate-ping inline-block" /> LIVE·REC
              </span>
            ) : isOnline ? (
              <span className="flex items-center gap-1 text-[9px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 px-1.5 py-0.5 rounded-full">
                <span className="w-1 h-1 bg-emerald-500 rounded-full" /> Online
              </span>
            ) : (
              <span className="text-[9px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded-full">Offline</span>
            )}
            {hasAlert && (
              <span className="flex items-center gap-0.5 text-[9px] bg-amber-50 text-amber-600 border border-amber-200 px-1.5 py-0.5 rounded-full">
                <AlertTriangle size={7} /> Alert
              </span>
            )}
          </div>
        </div>

        {/* Room name */}
        <p className="font-black text-gray-800 text-sm leading-tight">{space.roomNumber}</p>
        {space.roomName && <p className="text-[10px] text-gray-500 truncate mt-0.5">{space.roomName}</p>}
        {space.floor    && <p className="text-[9px] text-gray-400 mt-0.5">{space.floor}</p>}

        {/* Space type badge */}
        <span className={`inline-block text-[9px] font-semibold px-2 py-0.5 rounded-full mt-1.5 ${meta.badge}`}>
          {meta.label}
        </span>

        {/* Hardware chips */}
        {dev && (
          <div className="flex gap-1 mt-2 flex-wrap">
            {[
              { emoji: "📷", ok: h.camera?.ok },
              { emoji: "🎤", ok: h.mic?.ok    },
              { emoji: "🖥",  ok: h.screen?.ok },
            ].map(({ emoji, ok }, i) => (
              <span key={i} className={`text-[8px] px-1.5 py-0.5 rounded font-medium
                ${ok === true ? "bg-emerald-100 text-emerald-700"
                : ok === false ? "bg-red-100 text-red-600"
                :                "bg-gray-100 text-gray-400"}`}>
                {emoji} {ok === true ? "✓" : ok === false ? "✗" : "–"}
              </span>
            ))}
          </div>
        )}

        {/* Resource bars */}
        {dev && (h.cpu?.usagePercent != null || h.ram?.usedPercent != null) && (
          <div className="mt-2 space-y-1">
            {h.cpu?.usagePercent  != null && (
              <div className="flex items-center gap-1.5">
                <span className="text-[8px] text-gray-400 w-6">CPU</span>
                <MiniBar value={h.cpu.usagePercent} />
                <span className="text-[8px] text-gray-500 w-5 text-right">{h.cpu.usagePercent}%</span>
              </div>
            )}
            {h.ram?.usedPercent  != null && (
              <div className="flex items-center gap-1.5">
                <span className="text-[8px] text-gray-400 w-6">RAM</span>
                <MiniBar value={h.ram.usedPercent} />
                <span className="text-[8px] text-gray-500 w-5 text-right">{h.ram.usedPercent}%</span>
              </div>
            )}
            {h.disk?.usedPercent != null && (
              <div className="flex items-center gap-1.5">
                <span className="text-[8px] text-gray-400 w-6">Disk</span>
                <MiniBar value={h.disk.usedPercent} warn={80} danger={90} />
                <span className="text-[8px] text-gray-500 w-5 text-right">{h.disk.usedPercent}%</span>
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-50">
          {h.network?.latencyMs != null ? (
            <span className={`text-[8px] ${h.network.latencyMs > 200 ? "text-amber-500" : "text-emerald-600"}`}>
              📶 {h.network.latencyMs}ms
            </span>
          ) : <span />}
          {space.capacity > 0 && (
            <span className="text-[8px] text-gray-400">💺 {space.capacity}</span>
          )}
        </div>

        {/* Navigate button */}
        <button
          onClick={(e) => { e.stopPropagation(); onNavigate(space); }}
          className="mt-2 w-full text-[9px] text-gray-400 hover:text-blue-600 hover:bg-blue-50
            py-1 rounded-lg border border-transparent hover:border-blue-200 transition text-center">
          View Full Details →
        </button>
      </div>
    </div>
  );
}

// ── Block Section ─────────────────────────────────────────────────────────────
function BlockSection({ blockData, onPlay, onNavigate, compact }) {
  const [open, setOpen] = useState(true);
  const alertCount = blockData.rooms.filter(r =>
    r.device?.health && (
      r.device.health.camera?.ok === false ||
      r.device.health.mic?.ok   === false ||
      (r.device.health.disk?.usedPercent ?? 0) >= 90 ||
      (r.device.health.alerts?.length ?? 0) > 0
    )
  ).length;

  const gridCols = compact
    ? "grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8"
    : "grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6";

  return (
    <div className="mb-5">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-3 px-4 py-3 bg-gradient-to-r from-slate-50 to-gray-50
          border border-gray-200 rounded-xl hover:from-blue-50 hover:to-indigo-50 hover:border-blue-200
          transition-all text-left group"
      >
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {open
            ? <ChevronDown size={15} className="text-gray-400 group-hover:text-blue-500 shrink-0" />
            : <ChevronRight size={15} className="text-gray-400 group-hover:text-blue-500 shrink-0" />}
          <span className="font-bold text-gray-700 group-hover:text-blue-700">{blockData.block}</span>
          <span className="text-xs text-gray-400">{blockData.totalRooms} space{blockData.totalRooms !== 1 ? "s" : ""}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {blockData.onlineDevices > 0 && (
            <span className="flex items-center gap-1 text-[11px] bg-emerald-100 text-emerald-700 border border-emerald-200 px-2.5 py-0.5 rounded-full font-medium">
              <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full" /> {blockData.onlineDevices} online
            </span>
          )}
          {blockData.recordingNow > 0 && (
            <span className="flex items-center gap-1 text-[11px] bg-red-100 text-red-700 border border-red-200 px-2.5 py-0.5 rounded-full font-medium animate-pulse">
              <CircleDot size={10} /> {blockData.recordingNow} rec
            </span>
          )}
          {alertCount > 0 && (
            <span className="flex items-center gap-1 text-[11px] bg-amber-100 text-amber-700 border border-amber-200 px-2.5 py-0.5 rounded-full font-medium">
              <AlertTriangle size={10} /> {alertCount} alert{alertCount > 1 ? "s" : ""}
            </span>
          )}
        </div>
      </button>

      {open && (
        <div className={`mt-3 grid ${gridCols} gap-3 pl-1`}>
          {blockData.rooms.map((space) => (
            <SpaceCard
              key={space._id}
              space={space}
              onPlay={onPlay}
              onNavigate={onNavigate}
              compact={compact}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Campus Section ────────────────────────────────────────────────────────────
const CAMPUS_GRADIENTS = [
  { from: "from-slate-800 to-slate-700",   accent: "bg-slate-600"  },
  { from: "from-indigo-900 to-indigo-800", accent: "bg-indigo-700" },
  { from: "from-blue-900 to-blue-800",     accent: "bg-blue-700"   },
  { from: "from-violet-900 to-violet-800", accent: "bg-violet-700" },
];

function CampusSection({ campusData, idx, onPlay, onNavigate, compact }) {
  const [open, setOpen] = useState(true);
  const grad       = CAMPUS_GRADIENTS[idx % CAMPUS_GRADIENTS.length];
  const onlineTotal = campusData.blocks.reduce((s, b) => s + b.onlineDevices, 0);
  const recTotal    = campusData.blocks.reduce((s, b) => s + b.recordingNow,  0);
  const alertTotal  = campusData.blocks.reduce((s, b) => s + b.rooms.filter(r =>
    r.device?.health && (
      r.device.health.camera?.ok === false ||
      r.device.health.mic?.ok   === false ||
      (r.device.health.disk?.usedPercent ?? 0) >= 90 ||
      (r.device.health.alerts?.length ?? 0) > 0
    )
  ).length, 0);

  return (
    <div className="mb-8 rounded-2xl overflow-hidden border border-gray-200 shadow-sm">
      <button
        onClick={() => setOpen(!open)}
        className={`w-full bg-gradient-to-r ${grad.from} text-white px-6 py-5 flex items-center gap-4 hover:brightness-110 transition text-left`}
      >
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div className="w-10 h-10 bg-white/10 backdrop-blur rounded-xl flex items-center justify-center border border-white/20">
            <Building2 size={20} className="text-white" />
          </div>
          <div>
            <p className="text-xs text-white/50 font-medium uppercase tracking-widest">Campus</p>
            <p className="text-xl font-black leading-tight">{campusData.campus}</p>
          </div>
          <span className="text-sm text-white/40 ml-2">
            {campusData.blocks.length} block{campusData.blocks.length !== 1 ? "s" : ""} · {campusData.totalRooms} space{campusData.totalRooms !== 1 ? "s" : ""}
          </span>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {onlineTotal > 0 && (
            <div className="flex items-center gap-2 bg-white/10 border border-white/20 px-3 py-1.5 rounded-xl">
              <span className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse" />
              <span className="text-sm font-semibold">{onlineTotal}</span>
              <span className="text-xs text-white/60">online</span>
            </div>
          )}
          {recTotal > 0 && (
            <div className="flex items-center gap-2 bg-red-500/80 border border-red-400/50 px-3 py-1.5 rounded-xl animate-pulse">
              <CircleDot size={14} />
              <span className="text-sm font-semibold">{recTotal}</span>
              <span className="text-xs text-white/80">recording</span>
            </div>
          )}
          {alertTotal > 0 && (
            <div className="flex items-center gap-2 bg-amber-500/80 border border-amber-400/50 px-3 py-1.5 rounded-xl">
              <AlertTriangle size={14} />
              <span className="text-sm font-semibold">{alertTotal}</span>
              <span className="text-xs text-white/80">alert{alertTotal > 1 ? "s" : ""}</span>
            </div>
          )}
          {open ? <ChevronDown size={20} className="text-white/40 ml-1" />
                : <ChevronRight size={20} className="text-white/40 ml-1" />}
        </div>
      </button>

      {open && (
        <div className="bg-gray-50/80 px-5 py-5">
          {campusData.blocks.map((block) => (
            <BlockSection
              key={block.block}
              blockData={block}
              onPlay={onPlay}
              onNavigate={onNavigate}
              compact={compact}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Stat Card ─────────────────────────────────────────────────────────────────
function StatCard({ label, value, sub, icon: Icon, gradient, pulse }) {
  return (
    <div className={`relative bg-gradient-to-br ${gradient} rounded-2xl p-5 overflow-hidden shadow-lg`}>
      <div className="absolute -top-2 -right-2 opacity-15">
        <Icon size={64} />
      </div>
      <p className="text-[10px] font-bold text-white/60 uppercase tracking-widest mb-2">{label}</p>
      <p className={`text-4xl font-black text-white leading-none mb-1 ${pulse ? "animate-pulse" : ""}`}>{value}</p>
      {sub && <p className="text-[11px] text-white/55">{sub}</p>}
    </div>
  );
}

// ── Main Facility Page ────────────────────────────────────────────────────────
export default function Facility() {
  const navigate = useNavigate();
  const mainRef  = useRef(null);

  const [hierarchy,   setHierarchy]   = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [lastSync,    setLastSync]    = useState(null);
  const [refreshing,  setRefreshing]  = useState(false);
  const [modalSpace,  setModalSpace]  = useState(null);
  const [compact,     setCompact]     = useState(false);
  const [autoScroll,  setAutoScroll]  = useState(false);
  const autoScrollRef = useRef(null);

  const fetchHierarchy = useCallback(async (showRefresh = false) => {
    if (showRefresh) setRefreshing(true);
    try {
      const { data } = await api.get("/rooms/hierarchy");
      setHierarchy(data);
      setLastSync(new Date());
    } catch { /* ignore */ }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => {
    fetchHierarchy();
    const iv = setInterval(fetchHierarchy, 30000);
    return () => clearInterval(iv);
  }, [fetchHierarchy]);

  // ── Auto-scroll ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (autoScroll) {
      const main = document.querySelector("main");
      if (!main) return;
      autoScrollRef.current = setInterval(() => {
        if (main.scrollTop + main.clientHeight >= main.scrollHeight - 10) {
          main.scrollTop = 0; // loop back to top
        } else {
          main.scrollTop += 1.5;
        }
      }, 30);
    } else {
      clearInterval(autoScrollRef.current);
    }
    return () => clearInterval(autoScrollRef.current);
  }, [autoScroll]);

  // ── Stats ──────────────────────────────────────────────────────────────────
  const allRooms    = hierarchy.flatMap(c => c.blocks.flatMap(b => b.rooms));
  const totalSpaces = allRooms.length;
  const totalOnline = allRooms.filter(r => r.device?.isOnline).length;
  const totalRec    = allRooms.filter(r => r.device?.isRecording).length;
  const totalAlerts = allRooms.filter(r =>
    r.device?.health && (
      r.device.health.camera?.ok === false ||
      r.device.health.mic?.ok   === false ||
      (r.device.health.disk?.usedPercent ?? 0) >= 90 ||
      (r.device.health.alerts?.length ?? 0) > 0
    )
  ).length;

  const syncLabel = lastSync
    ? `Updated ${lastSync.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`
    : "Loading...";

  const handlePlay     = (space) => setModalSpace(space);
  const handleNavigate = (space) => navigate(`/facility/room/${space._id}`);

  return (
    <div ref={mainRef}>
      {/* ── Video Modal ──────────────────────────────────────────────────── */}
      {modalSpace && (
        <VideoModal
          space={modalSpace}
          onClose={() => setModalSpace(null)}
          onViewDetail={() => { setModalSpace(null); navigate(`/facility/room/${modalSpace._id}`); }}
        />
      )}

      {/* ── Header ───────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <p className="text-[10px] text-gray-400 uppercase tracking-widest font-bold mb-1">ICT Operations</p>
          <h2 className="text-2xl font-black text-gray-900">Facility Overview</h2>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Sync badge */}
          <div className="flex items-center gap-2 text-xs text-gray-400 bg-gray-50 border rounded-xl px-3 py-2">
            <Activity size={12} className={refreshing ? "animate-pulse text-blue-500" : "text-gray-400"} />
            {syncLabel}
          </div>

          {/* Compact / Full toggle */}
          <button
            onClick={() => setCompact(c => !c)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm border transition
              ${compact ? "bg-indigo-600 border-indigo-600 text-white" : "bg-white border-gray-200 text-gray-600 hover:bg-indigo-50 hover:border-indigo-300 hover:text-indigo-700"}`}>
            {compact ? <LayoutGrid size={14} /> : <List size={14} />}
            {compact ? "Compact" : "Full View"}
          </button>

          {/* Auto-scroll toggle */}
          <button
            onClick={() => setAutoScroll(a => !a)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm border transition
              ${autoScroll ? "bg-emerald-600 border-emerald-600 text-white animate-pulse" : "bg-white border-gray-200 text-gray-600 hover:bg-emerald-50 hover:border-emerald-300 hover:text-emerald-700"}`}>
            {autoScroll ? <Pause size={14} /> : <FastForward size={14} />}
            {autoScroll ? "Stop Scroll" : "Auto Scroll"}
          </button>

          {/* Refresh */}
          <button
            onClick={() => fetchHierarchy(true)}
            disabled={refreshing}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-xl text-sm text-gray-600
              hover:bg-blue-50 hover:border-blue-300 hover:text-blue-700 transition disabled:opacity-50"
          >
            <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>
      </div>

      {/* ── Stat cards ───────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <StatCard label="Campuses"    value={hierarchy.length}
          sub={`${hierarchy.reduce((s, c) => s + c.blocks.length, 0)} blocks`}
          icon={Building2} gradient="from-slate-800 to-slate-600" />
        <StatCard label="Total Spaces" value={totalSpaces}
          sub={`${totalOnline} devices active`}
          icon={Wifi}      gradient="from-blue-600 to-indigo-600" />
        <StatCard label="Online Now"  value={totalOnline}
          sub={totalSpaces > 0 ? `${Math.round(totalOnline / totalSpaces * 100)}% uptime` : "–"}
          icon={Activity}  gradient="from-emerald-600 to-teal-600" />
        <StatCard label="Recording"   value={totalRec}
          sub={totalAlerts > 0 ? `⚠ ${totalAlerts} alert${totalAlerts > 1 ? "s" : ""}` : "All clear"}
          icon={CircleDot} gradient={totalRec > 0 ? "from-red-600 to-rose-700" : "from-gray-500 to-gray-400"}
          pulse={totalRec > 0} />
      </div>

      {/* ── Legend + live indicator ───────────────────────────────────────── */}
      <div className="flex items-center gap-3 mb-6 flex-wrap">
        <span className="text-[11px] text-gray-400 font-semibold">Space types:</span>
        {SPACE_TYPES.map((t) => (
          <span key={t.value} className={`text-[11px] px-3 py-1 rounded-full font-semibold ${t.badge}`}>
            {t.icon} {t.label}
          </span>
        ))}
        {totalRec > 0 && (
          <span className="ml-auto flex items-center gap-1.5 text-xs text-red-600 bg-red-50 border border-red-200 px-3 py-1 rounded-full animate-pulse font-bold">
            <CircleDot size={10} /> {totalRec} live recording{totalRec > 1 ? "s" : ""} in progress
          </span>
        )}
        <span className="text-[10px] text-gray-400 italic">
          Click any space card to preview recording
        </span>
      </div>

      {/* ── Content ──────────────────────────────────────────────────────── */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-24 text-gray-400">
          <div className="w-10 h-10 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mb-4" />
          <p className="text-sm">Loading facility data...</p>
        </div>
      ) : hierarchy.length === 0 ? (
        <div className="text-center py-24 bg-gradient-to-br from-slate-50 to-blue-50 rounded-3xl border border-blue-100">
          <div className="text-6xl mb-4">🏫</div>
          <p className="text-xl font-bold text-gray-700 mb-2">No spaces registered yet</p>
          <p className="text-gray-400 text-sm max-w-md mx-auto">
            Spaces appear automatically when a classroom recording device is installed and registered.
          </p>
          <div className="mt-8 flex items-center justify-center gap-3 text-sm text-gray-500 flex-wrap">
            {["📱 Install recorder app", "📋 Enter campus / room details", "✅ Space appears automatically"].map((s, i, arr) => (
              <>
                <div key={s} className="flex items-center gap-2 bg-white border rounded-xl px-4 py-2 shadow-sm">{s}</div>
                {i < arr.length - 1 && <span key={`arr-${i}`} className="text-gray-300">→</span>}
              </>
            ))}
          </div>
        </div>
      ) : (
        hierarchy.map((campus, idx) => (
          <CampusSection
            key={campus.campus}
            campusData={campus}
            idx={idx}
            onPlay={handlePlay}
            onNavigate={handleNavigate}
            compact={compact}
          />
        ))
      )}
    </div>
  );
}
