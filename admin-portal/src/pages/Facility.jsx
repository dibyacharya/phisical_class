import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  Building2, Wifi, WifiOff, CircleDot, AlertTriangle,
  ChevronDown, ChevronRight, RefreshCw, Activity,
} from "lucide-react";
import api from "../services/api";

// ── Space type config ─────────────────────────────────────────────────────────
const SPACE_TYPES = [
  { value: "room",           label: "Classroom",       icon: "🚪", gradient: "from-blue-500 to-blue-600",    ring: "ring-blue-200",   badge: "bg-blue-100 text-blue-700"   },
  { value: "conference_hall",label: "Conference Hall", icon: "🤝", gradient: "from-purple-500 to-purple-600", ring: "ring-purple-200", badge: "bg-purple-100 text-purple-700"},
  { value: "auditorium",     label: "Auditorium",      icon: "🎭", gradient: "from-orange-500 to-orange-600", ring: "ring-orange-200", badge: "bg-orange-100 text-orange-700"},
];
const spaceTypeMeta = (t) => SPACE_TYPES.find((s) => s.value === t) || SPACE_TYPES[0];

// ── Mini progress bar ─────────────────────────────────────────────────────────
function MiniBar({ value, warn = 75, danger = 90 }) {
  if (value == null) return null;
  const color = value >= danger ? "bg-red-500" : value >= warn ? "bg-amber-400" : "bg-emerald-500";
  return (
    <div className="flex-1 bg-gray-200 rounded-full h-1 overflow-hidden">
      <div className={`${color} h-1 rounded-full transition-all`} style={{ width: `${Math.min(value, 100)}%` }} />
    </div>
  );
}

// ── Space Card ────────────────────────────────────────────────────────────────
function SpaceCard({ space, onClick }) {
  const dev    = space.device;
  const h      = dev?.health || {};
  const meta   = spaceTypeMeta(space.spaceType);
  const isOnline    = dev?.isOnline;
  const isRecording = dev?.isRecording;
  const hasAlert    = (h.alerts?.length > 0) ||
    h.camera?.ok === false || h.mic?.ok === false || (h.disk?.usedPercent ?? 0) >= 90;

  const borderColor = isRecording ? "border-l-red-500"
    : isOnline ? "border-l-emerald-500"
    : dev ? "border-l-gray-300" : "border-l-gray-100";

  return (
    <div
      onClick={onClick}
      className={`relative bg-white rounded-2xl border border-gray-100 border-l-[4px] ${borderColor}
        p-4 cursor-pointer transition-all duration-200 hover:shadow-lg hover:-translate-y-0.5
        ${isRecording ? "shadow-red-100 shadow-md" : "shadow-sm"} overflow-hidden`}
    >
      {/* Recording ambient glow */}
      {isRecording && (
        <div className="absolute inset-0 bg-gradient-to-br from-red-500/5 to-transparent animate-pulse pointer-events-none rounded-2xl" />
      )}

      {/* Top row: icon + status */}
      <div className="flex items-start justify-between mb-3">
        <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${meta.gradient} flex items-center justify-center text-lg shadow-sm`}>
          {meta.icon}
        </div>
        <div className="flex flex-col items-end gap-1">
          {!dev ? (
            <span className="text-[10px] text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">No device</span>
          ) : isRecording ? (
            <span className="flex items-center gap-1 text-[10px] font-bold bg-red-500 text-white px-2.5 py-0.5 rounded-full animate-pulse shadow-md shadow-red-200">
              <span className="w-1.5 h-1.5 bg-white rounded-full animate-ping inline-block" />
              LIVE · REC
            </span>
          ) : isOnline ? (
            <span className="flex items-center gap-1.5 text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded-full">
              <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full" />
              Online
            </span>
          ) : (
            <span className="text-[10px] text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">Offline</span>
          )}
          {hasAlert && (
            <span className="flex items-center gap-1 text-[10px] bg-amber-50 text-amber-600 border border-amber-200 px-2 py-0.5 rounded-full">
              <AlertTriangle size={8} /> Alert
            </span>
          )}
        </div>
      </div>

      {/* Room name / number */}
      <p className="font-bold text-gray-800 text-sm leading-tight">{space.roomNumber}</p>
      {space.roomName && <p className="text-xs text-gray-500 truncate mt-0.5">{space.roomName}</p>}
      {space.floor    && <p className="text-[10px] text-gray-400 mt-0.5">{space.floor}</p>}

      {/* Space type badge */}
      <span className={`inline-block text-[10px] font-medium px-2 py-0.5 rounded-full mt-2 ${meta.badge}`}>
        {meta.label}
      </span>

      {/* Hardware health chips */}
      {dev && (
        <div className="flex gap-1.5 mt-2.5 flex-wrap">
          {[
            { emoji: "📷", ok: h.camera?.ok, tip: "Camera" },
            { emoji: "🎤", ok: h.mic?.ok,    tip: "Mic"    },
            { emoji: "🖥",  ok: h.screen?.ok, tip: "Screen" },
          ].map(({ emoji, ok, tip }) => (
            <span key={tip}
              className={`text-[9px] px-1.5 py-0.5 rounded-md font-medium
                ${ok === true  ? "bg-emerald-100 text-emerald-700"
                : ok === false ? "bg-red-100 text-red-600"
                :               "bg-gray-100 text-gray-400"}`}>
              {emoji} {ok === true ? "✓" : ok === false ? "✗" : "–"}
            </span>
          ))}
        </div>
      )}

      {/* Mini resource bars */}
      {dev && (h.cpu?.usagePercent != null || h.ram?.usedPercent != null || h.disk?.usedPercent != null) && (
        <div className="mt-3 space-y-1.5">
          {h.cpu?.usagePercent != null && (
            <div className="flex items-center gap-2">
              <span className="text-[9px] text-gray-400 w-7">CPU</span>
              <MiniBar value={h.cpu.usagePercent} />
              <span className="text-[9px] text-gray-500 w-6 text-right">{h.cpu.usagePercent}%</span>
            </div>
          )}
          {h.ram?.usedPercent != null && (
            <div className="flex items-center gap-2">
              <span className="text-[9px] text-gray-400 w-7">RAM</span>
              <MiniBar value={h.ram.usedPercent} />
              <span className="text-[9px] text-gray-500 w-6 text-right">{h.ram.usedPercent}%</span>
            </div>
          )}
          {h.disk?.usedPercent != null && (
            <div className="flex items-center gap-2">
              <span className="text-[9px] text-gray-400 w-7">Disk</span>
              <MiniBar value={h.disk.usedPercent} warn={80} danger={90} />
              <span className="text-[9px] text-gray-500 w-6 text-right">{h.disk.usedPercent}%</span>
            </div>
          )}
        </div>
      )}

      {/* Network + capacity footer */}
      <div className="flex items-center justify-between mt-3 pt-2.5 border-t border-gray-50">
        {dev && h.network?.latencyMs != null ? (
          <span className={`text-[9px] ${h.network.latencyMs > 500 ? "text-amber-500" : "text-emerald-600"}`}>
            📶 {h.network.latencyMs}ms
          </span>
        ) : <span />}
        {space.capacity > 0 && (
          <span className="text-[9px] text-gray-400">💺 {space.capacity}</span>
        )}
      </div>
    </div>
  );
}

// ── Block Section ─────────────────────────────────────────────────────────────
function BlockSection({ blockData, onSpaceClick }) {
  const [open, setOpen] = useState(true);
  const alertCount  = blockData.rooms.filter(r =>
    r.device?.health && (
      r.device.health.camera?.ok === false ||
      r.device.health.mic?.ok   === false ||
      (r.device.health.disk?.usedPercent ?? 0) >= 90 ||
      (r.device.health.alerts?.length ?? 0) > 0
    )
  ).length;

  return (
    <div className="mb-5">
      {/* Block header */}
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-3 px-4 py-3 bg-gradient-to-r from-slate-50 to-gray-50
          border border-gray-200 rounded-xl hover:from-blue-50 hover:to-slate-50 hover:border-blue-200
          transition-all text-left group"
      >
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {open
            ? <ChevronDown size={15} className="text-gray-400 group-hover:text-blue-500 shrink-0" />
            : <ChevronRight size={15} className="text-gray-400 group-hover:text-blue-500 shrink-0" />}
          <span className="font-semibold text-gray-700 group-hover:text-blue-700">{blockData.block}</span>
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

      {/* Space grid */}
      {open && (
        <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 pl-1">
          {blockData.rooms.map((space) => (
            <SpaceCard key={space._id} space={space} onClick={() => onSpaceClick(space)} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Campus Section ────────────────────────────────────────────────────────────
const CAMPUS_GRADIENTS = [
  "from-slate-800 to-slate-700",
  "from-indigo-800 to-indigo-700",
  "from-blue-900 to-blue-800",
  "from-gray-800 to-gray-700",
];

function CampusSection({ campusData, idx, onSpaceClick }) {
  const [open, setOpen] = useState(true);
  const gradient     = CAMPUS_GRADIENTS[idx % CAMPUS_GRADIENTS.length];
  const onlineTotal  = campusData.blocks.reduce((s, b) => s + b.onlineDevices, 0);
  const recTotal     = campusData.blocks.reduce((s, b) => s + b.recordingNow, 0);
  const alertTotal   = campusData.blocks.reduce((s, b) => s + b.rooms.filter(r =>
    r.device?.health && (
      r.device.health.camera?.ok === false ||
      r.device.health.mic?.ok   === false ||
      (r.device.health.disk?.usedPercent ?? 0) >= 90 ||
      (r.device.health.alerts?.length ?? 0) > 0
    )
  ).length, 0);

  return (
    <div className="mb-8 rounded-2xl overflow-hidden border border-gray-200 shadow-sm">
      {/* Campus header */}
      <button
        onClick={() => setOpen(!open)}
        className={`w-full bg-gradient-to-r ${gradient} text-white px-6 py-5 flex items-center gap-4 hover:brightness-110 transition text-left`}
      >
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div className="w-10 h-10 bg-white/10 backdrop-blur rounded-xl flex items-center justify-center border border-white/20">
            <Building2 size={20} className="text-white" />
          </div>
          <div>
            <p className="text-xs text-white/60 font-medium uppercase tracking-widest">Campus</p>
            <p className="text-xl font-bold leading-tight">{campusData.campus}</p>
          </div>
          <span className="text-sm text-white/50 ml-2">
            {campusData.blocks.length} block{campusData.blocks.length !== 1 ? "s" : ""} · {campusData.totalRooms} space{campusData.totalRooms !== 1 ? "s" : ""}
          </span>
        </div>

        {/* Live stats */}
        <div className="flex items-center gap-3 shrink-0">
          {onlineTotal > 0 && (
            <div className="flex items-center gap-2 bg-white/10 border border-white/20 px-3 py-1.5 rounded-xl">
              <span className="w-2 h-2 bg-emerald-400 rounded-full" />
              <span className="text-sm font-semibold">{onlineTotal}</span>
              <span className="text-xs text-white/60">online</span>
            </div>
          )}
          {recTotal > 0 && (
            <div className="flex items-center gap-2 bg-red-500/80 border border-red-400/50 px-3 py-1.5 rounded-xl animate-pulse">
              <CircleDot size={14} className="text-white" />
              <span className="text-sm font-semibold">{recTotal}</span>
              <span className="text-xs text-white/80">recording</span>
            </div>
          )}
          {alertTotal > 0 && (
            <div className="flex items-center gap-2 bg-amber-500/80 border border-amber-400/50 px-3 py-1.5 rounded-xl">
              <AlertTriangle size={14} className="text-white" />
              <span className="text-sm font-semibold">{alertTotal}</span>
              <span className="text-xs text-white/80">alert{alertTotal > 1 ? "s" : ""}</span>
            </div>
          )}
          {open
            ? <ChevronDown size={20} className="text-white/50 ml-2" />
            : <ChevronRight size={20} className="text-white/50 ml-2" />}
        </div>
      </button>

      {/* Blocks */}
      {open && (
        <div className="bg-gray-50 px-5 py-5">
          {campusData.blocks.map((block) => (
            <BlockSection key={block.block} blockData={block} onSpaceClick={onSpaceClick} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Stat Card ─────────────────────────────────────────────────────────────────
function StatCard({ label, value, sub, icon: Icon, gradient, pulse }) {
  return (
    <div className={`relative bg-gradient-to-br ${gradient} rounded-2xl p-5 overflow-hidden shadow-md`}>
      <div className="absolute top-3 right-3 opacity-20">
        <Icon size={48} />
      </div>
      <p className="text-xs font-semibold text-white/70 uppercase tracking-widest mb-2">{label}</p>
      <p className={`text-4xl font-black text-white leading-none ${pulse ? "animate-pulse" : ""}`}>{value}</p>
      {sub && <p className="text-xs text-white/60 mt-1.5">{sub}</p>}
    </div>
  );
}

// ── Main Facility Page ────────────────────────────────────────────────────────
export default function Facility() {
  const navigate   = useNavigate();
  const [hierarchy, setHierarchy] = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [lastSync,  setLastSync]  = useState(null);
  const [refreshing, setRefreshing] = useState(false);

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

  // ── Aggregate stats ────────────────────────────────────────────────────────
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

  return (
    <div>
      {/* ── Page header ──────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <p className="text-xs text-gray-400 uppercase tracking-widest font-semibold mb-1">ICT Operations</p>
          <h2 className="text-2xl font-black text-gray-900">Facility Overview</h2>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-xs text-gray-400 bg-gray-50 border rounded-xl px-3 py-2">
            <Activity size={12} className={refreshing ? "animate-pulse text-blue-500" : "text-gray-400"} />
            {syncLabel}
          </div>
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

      {/* ── Live stat cards ───────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <StatCard
          label="Campuses" value={hierarchy.length}
          sub={`${hierarchy.reduce((s, c) => s + c.blocks.length, 0)} blocks`}
          icon={Building2} gradient="from-slate-700 to-slate-600"
        />
        <StatCard
          label="Total Spaces" value={totalSpaces}
          sub={`${totalOnline} devices active`}
          icon={Wifi} gradient="from-blue-600 to-blue-500"
        />
        <StatCard
          label="Online Now" value={totalOnline}
          sub={totalSpaces > 0 ? `${Math.round(totalOnline / totalSpaces * 100)}% uptime` : "–"}
          icon={Activity} gradient="from-emerald-600 to-emerald-500"
        />
        <StatCard
          label="Recording" value={totalRec}
          sub={totalAlerts > 0 ? `⚠ ${totalAlerts} alert${totalAlerts > 1 ? "s" : ""}` : "All clear"}
          icon={CircleDot} gradient={totalRec > 0 ? "from-red-600 to-red-500" : "from-gray-500 to-gray-400"}
          pulse={totalRec > 0}
        />
      </div>

      {/* ── Space type legend ─────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 mb-6">
        <span className="text-xs text-gray-400 font-medium">Space types:</span>
        {SPACE_TYPES.map((t) => (
          <span key={t.value} className={`text-xs px-3 py-1 rounded-full font-medium ${t.badge}`}>
            {t.icon} {t.label}
          </span>
        ))}
        {totalRec > 0 && (
          <span className="ml-auto flex items-center gap-1.5 text-xs text-red-600 bg-red-50 border border-red-200 px-3 py-1 rounded-full animate-pulse font-semibold">
            <CircleDot size={10} /> {totalRec} live recording{totalRec > 1 ? "s" : ""} in progress
          </span>
        )}
      </div>

      {/* ── Content ───────────────────────────────────────────────────────── */}
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
            Spaces appear here automatically when a classroom recording device is installed and registered.
            The device setup process sends the campus, block, and room details to create the space.
          </p>
          <div className="mt-8 flex items-center justify-center gap-3 text-sm text-gray-500">
            <div className="flex items-center gap-2 bg-white border rounded-xl px-4 py-2 shadow-sm">
              <span>📱</span> Install the classroom recorder app
            </div>
            <span className="text-gray-300">→</span>
            <div className="flex items-center gap-2 bg-white border rounded-xl px-4 py-2 shadow-sm">
              <span>📋</span> Enter campus / block / room details
            </div>
            <span className="text-gray-300">→</span>
            <div className="flex items-center gap-2 bg-white border rounded-xl px-4 py-2 shadow-sm">
              <span>✅</span> Space appears here automatically
            </div>
          </div>
        </div>
      ) : (
        hierarchy.map((campus, idx) => (
          <CampusSection
            key={campus.campus}
            campusData={campus}
            idx={idx}
            onSpaceClick={(space) => navigate(`/facility/room/${space._id}`)}
          />
        ))
      )}
    </div>
  );
}
