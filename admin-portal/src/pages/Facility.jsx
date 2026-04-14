import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  Building2, Wifi, CircleDot, AlertTriangle,
  ChevronDown, ChevronRight, RefreshCw, Activity,
  Camera, CameraOff, Play, X, Maximize2, ChevronLeft,
  ChevronRight as ChevronRightIcon, LayoutGrid, List,
  Pause, FastForward, ExternalLink, Volume2, Plus, Layers,
} from "lucide-react";
import api from "../services/api";

const MEDIA_BASE = (import.meta.env.VITE_API_BASE_URL || "http://localhost:5020/api").replace("/api", "");

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

// ── Smart display formatters ───────────────────────────────────────────────────
// "2"  → "Block 2"      "Block 14" → "Block 14"  (unchanged)
function fmtBlock(b) {
  if (!b) return b;
  const t = b.trim();
  return /^\d+$/.test(t) ? `Block ${t}` : t;
}

// "3"  → "3rd Floor"    "1st Floor" → "1st Floor" (unchanged)
// "0"  → "Ground Floor" "g" → "Ground Floor"
function fmtFloor(f) {
  if (!f) return f;
  const t = f.trim();
  // Pure number
  if (/^\d+$/.test(t)) {
    const n = parseInt(t, 10);
    if (n === 0) return "Ground Floor";
    const sfx = n === 1 ? "st" : n === 2 ? "nd" : n === 3 ? "rd" : "th";
    return `${n}${sfx} Floor`;
  }
  // Shorthand "g" / "ground"
  if (/^g(round)?$/i.test(t)) return "Ground Floor";
  if (/^b(asement)?$/i.test(t)) return "Basement";
  // Already has "Floor" keyword → return as-is
  return t;
}

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

// ── Animated scanline + noise preview (simulates live camera feed silently) ────
function CameraPreview({ space, compact }) {
  const dev         = space.device;
  const h           = dev?.health || {};
  const isRecording = dev?.isRecording;
  const isOnline    = dev?.isOnline;
  const meta        = spaceTypeMeta(space.spaceType);
  const height      = compact ? "h-20" : "h-36";
  const tick        = useRef(0);
  const canvasRef   = useRef(null);
  const rafRef      = useRef(null);

  // Animated noise canvas — live camera feed feel (vivid version)
  useEffect(() => {
    if (compact || !canvasRef.current) return;
    if (!isOnline && !isRecording) return;
    const canvas = canvasRef.current;
    const ctx    = canvas.getContext("2d");
    let frame    = 0;

    const draw = () => {
      frame++;
      const W = canvas.width, H = canvas.height;

      // Dark base tinted towards rec-red or standby-green
      ctx.fillStyle = isRecording ? "#110808" : "#080e10";
      ctx.fillRect(0, 0, W, H);

      // Film-grain noise — denser + colour-tinted pixels
      const imgData = ctx.createImageData(W, H);
      const d       = imgData.data;
      for (let i = 0; i < d.length; i += 4) {
        if (Math.random() < 0.09) {
          const v = Math.random() * 120 + 20;          // brightness 20-140
          if (isRecording) {
            d[i]   = v;                                 // R strong
            d[i+1] = v * 0.25;                         // G dim
            d[i+2] = v * 0.25;                         // B dim
          } else {
            d[i]   = v * 0.20;                         // R dim
            d[i+1] = v * 0.85;                         // G strong
            d[i+2] = v * 0.45;                         // B medium
          }
          d[i+3] = 255;
        } else {
          d[i] = d[i+1] = d[i+2] = 0;
          d[i+3] = 255;
        }
      }
      ctx.putImageData(imgData, 0, 0);

      // Bright horizontal scanline sweep
      const scanY = ((frame * 1.8) % (H + 20)) - 10;
      const scanGrad = ctx.createLinearGradient(0, scanY - 14, 0, scanY + 14);
      scanGrad.addColorStop(0,   "transparent");
      scanGrad.addColorStop(0.3, isRecording ? "rgba(255,60,60,0.18)" : "rgba(80,230,140,0.18)");
      scanGrad.addColorStop(0.5, isRecording ? "rgba(255,80,80,0.30)" : "rgba(100,255,160,0.30)");
      scanGrad.addColorStop(0.7, isRecording ? "rgba(255,60,60,0.18)" : "rgba(80,230,140,0.18)");
      scanGrad.addColorStop(1,   "transparent");
      ctx.fillStyle = scanGrad;
      ctx.fillRect(0, scanY - 14, W, 28);

      // Second faster scanline (echo)
      const scanY2 = ((frame * 1.8 + H * 0.55) % (H + 20)) - 10;
      const scanGrad2 = ctx.createLinearGradient(0, scanY2 - 8, 0, scanY2 + 8);
      scanGrad2.addColorStop(0,   "transparent");
      scanGrad2.addColorStop(0.5, isRecording ? "rgba(255,60,60,0.10)" : "rgba(80,230,140,0.10)");
      scanGrad2.addColorStop(1,   "transparent");
      ctx.fillStyle = scanGrad2;
      ctx.fillRect(0, scanY2 - 8, W, 16);

      // Slow vertical scan bar
      const lineX = ((frame * 0.5) % (W + 20)) - 10;
      const vGrad = ctx.createLinearGradient(lineX - 6, 0, lineX + 6, 0);
      vGrad.addColorStop(0,   "transparent");
      vGrad.addColorStop(0.5, isRecording ? "rgba(255,80,80,0.10)" : "rgba(80,220,130,0.10)");
      vGrad.addColorStop(1,   "transparent");
      ctx.fillStyle = vGrad;
      ctx.fillRect(lineX - 6, 0, 12, H);

      // Occasional bright flicker pixel clusters
      if (frame % 8 === 0) {
        for (let n = 0; n < 4; n++) {
          const fx = Math.random() * W;
          const fy = Math.random() * H;
          ctx.fillStyle = isRecording ? "rgba(255,120,120,0.6)" : "rgba(100,255,160,0.6)";
          ctx.fillRect(fx, fy, 2, 2);
        }
      }

      // Dark vignette overlay (edges darker — cinematic look)
      const vig = ctx.createRadialGradient(W/2, H/2, H*0.2, W/2, H/2, H*0.85);
      vig.addColorStop(0, "transparent");
      vig.addColorStop(1, "rgba(0,0,0,0.55)");
      ctx.fillStyle = vig;
      ctx.fillRect(0, 0, W, H);

      rafRef.current = requestAnimationFrame(draw);
    };
    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, [isOnline, isRecording, compact]);

  if (!dev) return (
    <div className={`${height} bg-gradient-to-br from-gray-100 to-gray-200 flex flex-col items-center justify-center gap-1`}>
      <CameraOff size={compact ? 14 : 22} className="text-gray-400" />
      {!compact && <span className="text-[10px] text-gray-400 font-medium mt-1">No Device</span>}
    </div>
  );

  if (isRecording) return (
    <div className={`${height} relative overflow-hidden`}>
      {/* Animated canvas background */}
      <canvas ref={canvasRef} width={240} height={compact ? 80 : 144}
        className="absolute inset-0 w-full h-full object-cover" />
      {/* Red pulsing border overlay */}
      <div className="absolute inset-0 border-2 border-red-500/80 animate-pulse pointer-events-none" />
      {/* REC badge */}
      <div className="absolute top-2 left-2 flex items-center gap-1 bg-red-600 px-2 py-0.5 rounded-full shadow-lg">
        <span className="w-1.5 h-1.5 bg-white rounded-full animate-ping" />
        <span className="text-[9px] font-black text-white tracking-widest">REC</span>
      </div>
      {/* LIVE badge */}
      <div className="absolute top-2 right-2">
        <span className="text-[9px] font-bold text-green-400 bg-black/50 px-1.5 py-0.5 rounded">● LIVE</span>
      </div>
      {!compact && (
        <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/70 to-transparent py-2 px-2 flex items-center justify-center">
          <span className="text-[9px] text-white/60">Click to view latest recording</span>
        </div>
      )}
    </div>
  );

  if (isOnline) return (
    <div className={`${height} relative overflow-hidden`}>
      <canvas ref={canvasRef} width={240} height={compact ? 80 : 144}
        className="absolute inset-0 w-full h-full object-cover" />
      {/* LIVE indicator */}
      <div className="absolute top-2 right-2 flex items-center gap-1">
        <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse" />
        {!compact && <span className="text-[9px] text-emerald-300 font-semibold">LIVE</span>}
      </div>
      {/* Camera icon center */}
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
        <Camera size={compact ? 14 : 22} className="text-emerald-400/50 mb-1" />
        {!compact && <span className="text-[9px] text-slate-400">Standby</span>}
        {h.network?.ssid && h.network.ssid !== "<unknown ssid>" && !compact && (
          <span className="text-[8px] text-slate-500 mt-0.5">📶 {h.network.ssid}</span>
        )}
      </div>
      {!compact && (
        <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/60 to-transparent py-2 px-2 flex items-center justify-center">
          <span className="text-[9px] text-white/50">Click to play latest recording</span>
        </div>
      )}
    </div>
  );

  // Offline
  return (
    <div className={`${height} bg-gradient-to-br from-slate-900 to-gray-900 flex flex-col items-center justify-center gap-1`}>
      <CameraOff size={compact ? 12 : 20} className="text-slate-600" />
      {!compact && <span className="text-[9px] text-slate-600 font-medium">Offline</span>}
    </div>
  );
}

// ── Video Modal ───────────────────────────────────────────────────────────────
function VideoModal({ space, onClose, onViewDetail }) {
  const [videos,  setVideos]  = useState([]);
  const [loading, setLoading] = useState(true);
  const [current, setCurrent] = useState(0);
  const videoRef = useRef(null);
  const meta     = spaceTypeMeta(space.spaceType);
  const dev      = space.device;
  const isLive   = dev?.isRecording;

  useEffect(() => {
    if (!space._id) return;
    // fetch latest recordings for this room (sorted newest first)
    api.get(`/rooms/${space._id}/recordings`)
      .then(({ data }) => setVideos((data.rows || []).filter(r => r.videoUrl)))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [space._id]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const vid      = videos[current];
  const videoSrc = vid ? `${MEDIA_BASE}${vid.videoUrl}` : null;

  const fmtDate  = (d) => d ? new Date(d).toLocaleDateString("en-IN", { day:"2-digit", month:"short", year:"numeric" }) : "–";
  const fmtDur   = (s) => { if (!s) return "–"; const h = Math.floor(s/3600), m = Math.floor((s%3600)/60); return h ? `${h}h ${m}m` : `${m}m`; };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="absolute inset-0 bg-black/85 backdrop-blur-sm" onClick={onClose} />

      <div className="relative bg-gray-900 rounded-2xl overflow-hidden shadow-2xl w-full max-w-3xl border border-white/10 z-10">

        {/* Header */}
        <div className={`bg-gradient-to-r ${meta.gradient} px-5 py-3 flex items-center justify-between`}>
          <div className="flex items-center gap-3 min-w-0">
            <span className="text-2xl shrink-0">{meta.icon}</span>
            <div className="min-w-0">
              <p className="font-bold text-white text-sm leading-tight truncate">{space.roomName || space.roomNumber}</p>
              {/* Campus > Block > Floor > Room breadcrumb */}
              <p className="text-[10px] text-white/60 mt-0.5 flex items-center gap-1 flex-wrap">
                <span>{space.campus}</span>
                <span className="text-white/30">›</span>
                <span>{fmtBlock(space.block)}</span>
                {space.floor && <><span className="text-white/30">›</span><span>{fmtFloor(space.floor)}</span></>}
                <span className="text-white/30">›</span>
                <span className="font-semibold text-white/80">Room {space.roomNumber}</span>
              </p>
            </div>
            {isLive && (
              <span className="flex items-center gap-1 bg-red-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-full animate-pulse shrink-0 ml-2">
                <span className="w-1.5 h-1.5 bg-white rounded-full animate-ping" /> LIVE · REC
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0 ml-3">
            <button onClick={onViewDetail}
              className="flex items-center gap-1.5 text-[11px] bg-white/15 hover:bg-white/25 text-white px-3 py-1.5 rounded-lg transition">
              <ExternalLink size={11} /> Full Details
            </button>
            <button onClick={onClose} className="text-white/70 hover:text-white hover:bg-white/10 p-1.5 rounded-lg transition">
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="flex flex-col md:flex-row">
          {/* ── Video / State area ──────────────────────────────────────── */}
          <div className="flex-1 bg-black min-h-[200px]">

            {/* CASE 1 — class is LIVE right now */}
            {isLive ? (
              <div className="flex flex-col items-center justify-center h-64 gap-4 px-8 text-center">
                {/* Animated red pulse circles */}
                <div className="relative flex items-center justify-center">
                  <span className="absolute w-20 h-20 rounded-full bg-red-600/20 animate-ping" />
                  <span className="absolute w-14 h-14 rounded-full bg-red-600/30 animate-ping" style={{ animationDelay: "0.3s" }} />
                  <div className="relative w-16 h-16 rounded-full bg-red-600 flex items-center justify-center shadow-lg shadow-red-900">
                    <CircleDot size={28} className="text-white" />
                  </div>
                </div>
                <div>
                  <p className="text-white font-bold text-base">Class is Recording Now</p>
                  <p className="text-gray-400 text-sm mt-1">Recording is in progress. The video will be available once the class ends.</p>
                </div>
                <div className="flex items-center gap-2 bg-red-950/50 border border-red-800/50 rounded-xl px-4 py-2">
                  <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                  <span className="text-red-300 text-xs font-medium">Please wait for the class to complete</span>
                </div>
              </div>
            ) : loading ? (
              /* CASE 2 — loading */
              <div className="flex flex-col items-center justify-center h-56 gap-3 text-gray-500">
                <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                <span className="text-sm">Loading recordings…</span>
              </div>
            ) : videoSrc ? (
              /* CASE 3 — latest recording available, autoplay */
              <div className="relative">
                <video
                  ref={videoRef}
                  key={videoSrc}
                  src={videoSrc}
                  controls
                  autoPlay
                  muted={false}
                  className="w-full bg-black object-contain"
                  style={{ maxHeight: 280, aspectRatio: "16/9" }}
                />
              </div>
            ) : (
              /* CASE 4 — no recordings yet */
              <div className="flex flex-col items-center justify-center h-56 gap-3 text-gray-500 px-8 text-center">
                <Camera size={40} className="text-gray-600" />
                <p className="text-sm font-medium text-gray-400">No recordings yet</p>
                <p className="text-xs text-gray-600">Recordings will appear here after classes are completed</p>
              </div>
            )}

            {/* Navigation bar for multiple recordings */}
            {!isLive && videos.length > 1 && (
              <div className="flex items-center justify-between px-4 py-2.5 bg-gray-800 border-t border-white/5">
                <button onClick={() => setCurrent(c => Math.max(0, c - 1))} disabled={current === 0}
                  className="p-1 text-gray-400 hover:text-white disabled:opacity-30 transition">
                  <ChevronLeft size={16} />
                </button>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-400">Recording {current + 1} of {videos.length}</span>
                  {current === 0 && (
                    <span className="text-[9px] bg-blue-600 text-white px-1.5 py-0.5 rounded font-semibold">LATEST</span>
                  )}
                </div>
                <button onClick={() => setCurrent(c => Math.min(videos.length - 1, c + 1))} disabled={current === videos.length - 1}
                  className="p-1 text-gray-400 hover:text-white disabled:opacity-30 transition">
                  <ChevronRightIcon size={16} />
                </button>
              </div>
            )}
          </div>

          {/* ── Info Panel ──────────────────────────────────────────────── */}
          <div className="w-full md:w-56 bg-gray-800/90 p-4 space-y-4 shrink-0 border-t md:border-t-0 md:border-l border-white/10">

            {/* Recording info */}
            {!isLive && vid && (
              <div>
                <p className="text-[10px] text-gray-500 uppercase tracking-widest mb-2.5">Recording</p>
                <p className="text-sm font-semibold text-white leading-snug mb-1.5 line-clamp-2">
                  {vid.courseName !== "–" ? vid.courseName : vid.title}
                </p>
                {vid.courseCode && (
                  <span className="inline-block text-[9px] bg-blue-900/60 text-blue-300 px-1.5 py-0.5 rounded mb-2">
                    {vid.courseCode}
                  </span>
                )}
                <div className="space-y-1 text-xs text-gray-400">
                  <p>📅 {fmtDate(vid.date)}</p>
                  <p>⏰ {vid.startTime || "–"} – {vid.endTime || "–"}</p>
                  <p>👤 {vid.teacherName || "–"}</p>
                  {vid.duration > 0 && <p>⏱ {fmtDur(vid.duration)}</p>}
                  {vid.fileSize > 0 && (
                    <p>💾 {vid.fileSize > 1e9 ? (vid.fileSize/1e9).toFixed(1)+" GB" : (vid.fileSize/1e6).toFixed(1)+" MB"}</p>
                  )}
                </div>
              </div>
            )}

            {/* Device health — compact */}
            <div>
              <p className="text-[10px] text-gray-500 uppercase tracking-widest mb-2">Device</p>
              {dev ? (
                <div className="space-y-1">
                  {[
                    { label: "Camera", ok: dev.health?.camera?.ok },
                    { label: "Mic",    ok: dev.health?.mic?.ok    },
                    { label: "Screen", ok: dev.health?.screen?.ok },
                  ].map(({ label, ok }) => (
                    <div key={label} className="flex items-center justify-between">
                      <span className="text-[11px] text-gray-400">{label}</span>
                      <span className={`text-[10px] font-semibold ${ok === true ? "text-emerald-400" : ok === false ? "text-red-400" : "text-gray-600"}`}>
                        {ok === true ? "✓ OK" : ok === false ? "✗ ERR" : "—"}
                      </span>
                    </div>
                  ))}
                  {/* CPU/RAM/Disk in modal only */}
                  {dev.health?.cpu?.usagePercent != null && (
                    <div className="pt-2 mt-2 border-t border-white/10 space-y-1.5">
                      {[
                        { l: "CPU",  v: dev.health.cpu?.usagePercent },
                        { l: "RAM",  v: dev.health.ram?.usedPercent  },
                        { l: "Disk", v: dev.health.disk?.usedPercent },
                      ].map(({ l, v }) => v != null && (
                        <div key={l} className="flex items-center gap-2">
                          <span className="text-[9px] text-gray-500 w-6">{l}</span>
                          <div className="flex-1 bg-gray-700 rounded-full h-1">
                            <div className={`h-1 rounded-full ${v >= 90 ? "bg-red-500" : v >= 75 ? "bg-amber-400" : "bg-emerald-500"}`}
                              style={{ width: `${Math.min(v, 100)}%` }} />
                          </div>
                          <span className="text-[9px] text-gray-500 w-7 text-right">{v}%</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-xs text-gray-600">No device</p>
              )}
            </div>
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
        <p className="text-[8px] text-gray-300 mt-0.5 flex items-center gap-0.5 flex-wrap leading-none">
          <span>{space.campus}</span>
          <ChevronRight size={8} className="text-gray-300" />
          <span>{fmtBlock(space.block)}</span>
          {space.floor && <><ChevronRight size={8} className="text-gray-300" /><span>{fmtFloor(space.floor)}</span></>}
        </p>
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

        {/* Room number + name */}
        <p className="font-black text-gray-800 text-sm leading-tight">{space.roomNumber}</p>
        {space.roomName && <p className="text-[10px] text-gray-500 truncate mt-0.5">{space.roomName}</p>}

        {/* Campus › Block › Floor › Room breadcrumb */}
        <p className="flex items-center flex-wrap gap-0.5 mt-1.5 text-[9px] text-gray-400 leading-none">
          <span>{space.campus}</span>
          <ChevronRight size={9} className="text-gray-300" />
          <span>{fmtBlock(space.block)}</span>
          {space.floor && (
            <>
              <ChevronRight size={9} className="text-gray-300" />
              <span>{fmtFloor(space.floor)}</span>
            </>
          )}
          <ChevronRight size={9} className="text-gray-300" />
          <span className="font-semibold text-gray-600">{space.roomNumber}</span>
        </p>

        {/* Space type badge */}
        <span className={`inline-block text-[9px] font-semibold px-2 py-0.5 rounded-full mt-2 ${meta.badge}`}>
          {meta.label}
        </span>

        {/* Footer: latency + capacity */}
        <div className="flex items-center justify-between mt-2.5 pt-2 border-t border-gray-50">
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
            py-1.5 rounded-lg border border-transparent hover:border-blue-200 transition text-center font-medium">
          View Full Details →
        </button>
      </div>
    </div>
  );
}

// ── Floor sort helper ─────────────────────────────────────────────────────────
function floorSortKey(floorStr) {
  if (!floorStr || floorStr === "__no_floor__") return 999;
  const lower = floorStr.toLowerCase();
  if (lower.includes("ground") || lower === "g") return 0;
  if (lower.includes("basement") || lower.startsWith("b")) return -1;
  const num = lower.match(/(\d+)/);
  return num ? parseInt(num[1]) : 500;
}

function floorLabel(key) {
  if (key === "__no_floor__") return "Other";
  return fmtFloor(key); // "3" → "3rd Floor", "1st Floor" stays as-is
}

// ── Floor Row (inside a block) ────────────────────────────────────────────────
function FloorRow({ floorKey, rooms, onPlay, onNavigate, compact, showFloorHeader }) {
  const [open, setOpen] = useState(true);
  const onlineCount    = rooms.filter(r => r.device?.isOnline).length;
  const recCount       = rooms.filter(r => r.device?.isRecording).length;

  const gridCols = compact
    ? "grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8"
    : "grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6";

  if (!showFloorHeader) {
    // Single floor — render grid directly, no sub-header needed
    return (
      <div className={`grid ${gridCols} gap-3`}>
        {rooms.map((space) => (
          <SpaceCard key={space._id} space={space} onPlay={onPlay} onNavigate={onNavigate} compact={compact} />
        ))}
      </div>
    );
  }

  return (
    <div className="mb-3">
      {/* Floor sub-header */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-3 py-2 mb-2 rounded-lg
          bg-white border border-slate-200 hover:border-blue-200 hover:bg-blue-50/50
          transition-all text-left group"
      >
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {open
            ? <ChevronDown size={13} className="text-slate-400 group-hover:text-blue-500 shrink-0" />
            : <ChevronRight size={13} className="text-slate-400 group-hover:text-blue-500 shrink-0" />}
          {/* Floor icon */}
          <div className="w-5 h-5 bg-slate-100 rounded flex items-center justify-center shrink-0">
            <Layers size={11} className="text-slate-500" />
          </div>
          <span className="text-[12px] font-bold text-slate-600 group-hover:text-blue-700">
            {floorLabel(floorKey)}
          </span>
          <span className="text-[10px] text-slate-400 font-normal">
            {rooms.length} room{rooms.length !== 1 ? "s" : ""}
          </span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {onlineCount > 0 && (
            <span className="text-[10px] bg-emerald-50 text-emerald-600 border border-emerald-200 px-1.5 py-0.5 rounded-full flex items-center gap-1">
              <span className="w-1 h-1 bg-emerald-500 rounded-full" /> {onlineCount}
            </span>
          )}
          {recCount > 0 && (
            <span className="text-[10px] bg-red-50 text-red-600 border border-red-200 px-1.5 py-0.5 rounded-full flex items-center gap-1 animate-pulse">
              <CircleDot size={8} /> {recCount} rec
            </span>
          )}
        </div>
      </button>

      {open && (
        <div className={`grid ${gridCols} gap-3 pl-2`}>
          {rooms.map((space) => (
            <SpaceCard key={space._id} space={space} onPlay={onPlay} onNavigate={onNavigate} compact={compact} />
          ))}
        </div>
      )}
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

  // ── Group rooms by floor ──────────────────────────────────────────────────
  const floorGroupMap = blockData.rooms.reduce((acc, room) => {
    const key = (room.floor || "").trim() || "__no_floor__";
    if (!acc[key]) acc[key] = [];
    acc[key].push(room);
    return acc;
  }, {});

  const floorGroups = Object.entries(floorGroupMap)
    .sort(([a], [b]) => floorSortKey(a) - floorSortKey(b));

  // Show floor sub-headers only when there are multiple distinct floors
  const showFloorHeaders = floorGroups.length > 1 ||
    (floorGroups.length === 1 && floorGroups[0][0] !== "__no_floor__");

  return (
    <div className="mb-5">
      {/* Block header */}
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
          <span className="font-bold text-gray-700 group-hover:text-blue-700">{fmtBlock(blockData.block)}</span>
          <span className="text-xs text-gray-400">
            {blockData.totalRooms} space{blockData.totalRooms !== 1 ? "s" : ""}
            {showFloorHeaders && ` · ${floorGroups.length} floor${floorGroups.length !== 1 ? "s" : ""}`}
          </span>
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

      {/* Floor groups */}
      {open && (
        <div className="mt-3 pl-1 space-y-1">
          {floorGroups.map(([floorKey, rooms]) => (
            <FloorRow
              key={floorKey}
              floorKey={floorKey}
              rooms={rooms}
              onPlay={onPlay}
              onNavigate={onNavigate}
              compact={compact}
              showFloorHeader={showFloorHeaders}
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

// ── Add Space Modal ───────────────────────────────────────────────────────────
const EMPTY_FORM = { campus:"", block:"", floor:"", roomNumber:"", roomName:"", spaceType:"room", capacity:"" };

function AddSpaceModal({ onClose, onSaved }) {
  const [form, setForm]     = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState("");

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    if (!form.campus.trim() || !form.block.trim() || !form.roomNumber.trim()) {
      setError("Campus, Block and Room Number are required."); return;
    }
    setSaving(true);
    try {
      await api.post("/rooms", {
        campus: form.campus.trim(),
        block:  form.block.trim(),
        floor:  form.floor.trim() || undefined,
        roomNumber: form.roomNumber.trim(),
        roomName:   form.roomName.trim() || undefined,
        spaceType:  form.spaceType,
        capacity:   form.capacity ? Number(form.capacity) : 0,
      });
      onSaved();
      onClose();
    } catch (err) {
      setError(err.response?.data?.error || "Failed to create space");
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg z-10 overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-blue-600 to-indigo-700 text-white px-6 py-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-white/20 rounded-xl flex items-center justify-center">
              <Plus size={18} />
            </div>
            <div>
              <p className="font-bold text-lg leading-tight">Add New Space</p>
              <p className="text-blue-200 text-xs">Classroom, Conference Hall or Auditorium</p>
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 hover:bg-white/20 rounded-lg flex items-center justify-center transition">
            <X size={16} />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-2.5 rounded-xl">
              <AlertTriangle size={14} /> {error}
            </div>
          )}

          {/* Campus + Block */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest mb-1.5">
                Campus *
              </label>
              <input value={form.campus} onChange={e => set("campus", e.target.value)} required
                placeholder="e.g. KIIT Campus"
                className="w-full px-3 py-2.5 border-2 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none focus:border-blue-500 text-gray-800" />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest mb-1.5">
                Block *
              </label>
              <input value={form.block} onChange={e => set("block", e.target.value)} required
                placeholder="e.g. Block 14"
                className="w-full px-3 py-2.5 border-2 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none focus:border-blue-500 text-gray-800" />
            </div>
          </div>

          {/* Floor */}
          <div>
            <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest mb-1.5">
              Floor
            </label>
            <input value={form.floor} onChange={e => set("floor", e.target.value)}
              placeholder="e.g. 2nd Floor"
              className="w-full px-3 py-2.5 border-2 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none focus:border-blue-500 text-gray-800" />
          </div>

          {/* Room Number + Name */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest mb-1.5">
                Room Number *
              </label>
              <input value={form.roomNumber} onChange={e => set("roomNumber", e.target.value)} required
                placeholder="e.g. 202 or CF-01"
                className="w-full px-3 py-2.5 border-2 border-orange-300 rounded-xl text-sm focus:ring-2 focus:ring-orange-400 outline-none focus:border-orange-400 text-gray-800" />
              <p className="text-[10px] text-orange-500 mt-1">Must match admin portal room IDs</p>
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest mb-1.5">
                Display Name
              </label>
              <input value={form.roomName} onChange={e => set("roomName", e.target.value)}
                placeholder="e.g. Conference Hall 1"
                className="w-full px-3 py-2.5 border-2 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none focus:border-blue-500 text-gray-800" />
            </div>
          </div>

          {/* Space Type + Capacity */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest mb-1.5">
                Space Type
              </label>
              <select value={form.spaceType} onChange={e => set("spaceType", e.target.value)}
                className="w-full px-3 py-2.5 border-2 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white focus:border-blue-500 text-gray-800">
                <option value="room">🚪 Classroom</option>
                <option value="conference_hall">🤝 Conference Hall</option>
                <option value="auditorium">🎭 Auditorium</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest mb-1.5">
                Capacity (seats)
              </label>
              <input type="number" min="0" value={form.capacity} onChange={e => set("capacity", e.target.value)}
                placeholder="e.g. 60"
                className="w-full px-3 py-2.5 border-2 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none focus:border-blue-500 text-gray-800" />
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-2 border-t border-gray-100">
            <button type="button" onClick={onClose}
              className="flex-1 px-4 py-2.5 rounded-xl border-2 text-sm font-semibold text-gray-600 hover:bg-gray-50 transition">
              Cancel
            </button>
            <button type="submit" disabled={saving}
              className="flex-1 px-4 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:bg-gray-200 disabled:text-gray-400 transition flex items-center justify-center gap-2">
              {saving ? (
                <><RefreshCw size={14} className="animate-spin" /> Saving...</>
              ) : (
                <><Plus size={14} /> Add Space</>
              )}
            </button>
          </div>
        </form>
      </div>
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
  const [showAddSpace, setShowAddSpace] = useState(false);
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

      {/* ── Add Space Modal ───────────────────────────────────────────────── */}
      {showAddSpace && (
        <AddSpaceModal
          onClose={() => setShowAddSpace(false)}
          onSaved={() => fetchHierarchy(true)}
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

          {/* Add Space */}
          <button
            onClick={() => setShowAddSpace(true)}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 border border-blue-600 rounded-xl text-sm text-white
              hover:bg-blue-700 transition font-semibold shadow-sm"
          >
            <Plus size={14} /> Add Space
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
