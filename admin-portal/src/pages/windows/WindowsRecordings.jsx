import { useEffect, useState, useCallback, useMemo } from "react";
import { Link } from "react-router-dom";
import {
  Video, Search, RefreshCw, Play, Download, Filter,
  Clock, HardDrive, CheckCircle2, XCircle, Loader2, Radio,
  AlertTriangle, ChevronRight, ChevronDown, Trash2, DoorOpen,
  FileVideo, Eye, BarChart3, CalendarDays, X, MapPin,
} from "lucide-react";
import { winRecordings, winDevices } from "../../services/windowsApi";
import { usePersistedState } from "../../hooks/usePersistedState";

// Visual layout mirrors the Android Recordings page (src/pages/Recordings.jsx)
// so the admin portal looks identical across the TV and Mini-PC fleets:
// eyebrow + heading, 4 stat cards, search/filter bar, and room-grouped
// collapsible sections of recording cards. Wired to the Windows API.

// Recording lifecycle phases. The recorder reports "recording" at start,
// "merging" when post-processing begins, "uploading" when the upload begins,
// and the backend sets "completed" at finalize. Each gets a distinct, plain-
// English badge so the operator always knows the exact current phase.
const STATUS_META = {
  recording: { label: "Recording",       cls: "bg-blue-50 text-blue-600 border-blue-200" },
  merging:   { label: "Post-processing", cls: "bg-amber-50 text-amber-700 border-amber-200" },
  uploading: { label: "Uploading",       cls: "bg-indigo-50 text-indigo-600 border-indigo-200" },
  completed: { label: "Completed",       cls: "bg-green-50 text-green-600 border-green-200" },
  failed:    { label: "Failed",          cls: "bg-red-50 text-red-600 border-red-200" },
};
const statusMeta = (s) =>
  STATUS_META[(s || "").toLowerCase()] ||
  { label: s || "Unknown", cls: "bg-slate-50 text-slate-600 border-slate-200" };

// "Campus · Block · Floor" from a device record — only the parts that exist.
const locationText = (device) => {
  if (!device) return "";
  return [device.campus, device.block, device.floor && `Floor ${device.floor}`]
    .filter(Boolean)
    .join(" · ");
};

export default function WindowsRecordings() {
  const [recordings, setRecordings] = useState([]);
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterRoom, setFilterRoom] = useState("all");
  const [playingRec, setPlayingRec] = useState(null);
  // Persisted so a browser refresh / 30s auto-refresh keeps each room's
  // expand/collapse state. Semantics: a room is OPEN by default; an entry of
  // `false` means the operator explicitly collapsed it.
  const [expandedRooms, setExpandedRooms] = usePersistedState({}, "win_recordings_expanded_rooms");
  const [downloadingId, setDownloadingId] = useState(null);

  const fetchAll = useCallback(async () => {
    setRefreshing(true);
    try {
      setError("");
      const [r, d] = await Promise.all([
        winRecordings.list({ limit: 200 }),
        winDevices.list().catch(() => ({ devices: [] })),
      ]);
      setRecordings(Array.isArray(r) ? r : r.recordings || []);
      setDevices(d.devices || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
    const t = setInterval(fetchAll, 30_000);
    return () => clearInterval(t);
  }, [fetchAll]);

  const handleDelete = useCallback(async (rec) => {
    const title = rec.title || rec.scheduledClass?.title || "this recording";
    if (!window.confirm(
      `Delete "${title}"?\n\n` +
      `This removes it from the admin portal. The underlying R2 file is kept ` +
      `in cold storage as a safety net — contact engineering to restore if ` +
      `deleted by mistake.`
    )) return;
    try {
      await winRecordings.remove(rec._id);
      setRecordings((prev) => prev.filter((x) => x._id !== rec._id));
    } catch (e) {
      alert("Delete failed: " + (e.message || e));
    }
  }, []);

  // Force-download routes through the backend proxy (R2 URLs are cross-origin
  // so the HTML `download` attribute is ignored by browsers). One at a time
  // to avoid buffering multiple large files in browser memory.
  const handleDownload = useCallback(async (rec) => {
    if (downloadingId) return;
    setDownloadingId(rec._id);
    try {
      await winRecordings.download(rec._id);
    } catch (e) {
      alert("Download failed: " + (e.message || e));
    } finally {
      setDownloadingId(null);
    }
  }, [downloadingId]);

  // ── Stats (mirrors Android Recordings stat bar) ───────────────────────────
  const stats = useMemo(() => {
    let completed = 0, inProgress = 0, totalSize = 0;
    for (const r of recordings) {
      const s = (r.status || "").toLowerCase();
      if (s === "completed") completed++;
      // "In progress" = anything not yet finished: live recording, post-
      // processing, or uploading.
      if (s === "recording" || s === "merging" || s === "uploading") inProgress++;
      totalSize += r.mergedFileSize || r.fileSize || 0;
    }
    return { total: recordings.length, completed, inProgress, totalSize };
  }, [recordings]);

  const rooms = useMemo(() => {
    const set = new Set();
    recordings.forEach((r) => {
      const room = r.scheduledClass?.roomNumber || r.roomNumber;
      if (room) set.add(String(room));
    });
    return ["all", ...Array.from(set).sort()];
  }, [recordings]);

  const filtered = useMemo(() => {
    return recordings.filter((r) => {
      if (filterStatus !== "all" && (r.status || "").toLowerCase() !== filterStatus) return false;
      if (filterRoom !== "all") {
        const room = String(r.scheduledClass?.roomNumber || r.roomNumber || "");
        if (room !== filterRoom) return false;
      }
      if (search.trim()) {
        const q = search.toLowerCase();
        const hay = [
          r.title, r.scheduledClass?.title, r.scheduledClass?.courseName,
          r.scheduledClass?.teacherName,
        ].filter(Boolean).map((v) => String(v).toLowerCase());
        if (!hay.some((h) => h.includes(q))) return false;
      }
      return true;
    });
  }, [recordings, filterStatus, filterRoom, search]);

  // Group filtered recordings by room number (single-level collapsible tree —
  // a lighter version of Android's campus → block → floor → room hierarchy,
  // which fits the flatter Windows-fleet layout).
  const grouped = useMemo(() => {
    const map = {};
    for (const r of filtered) {
      const room = String(r.scheduledClass?.roomNumber || r.roomNumber || "Unassigned");
      (map[room] = map[room] || []).push(r);
    }
    return map;
  }, [filtered]);

  const activeFilterCount = (filterStatus !== "all" ? 1 : 0) + (filterRoom !== "all" ? 1 : 0);
  // Rooms are expanded by default; an entry is only stored when the operator
  // explicitly collapses (false) or re-opens (true) one. Toggling flips it.
  const toggleRoom = (room) =>
    setExpandedRooms((prev) => ({ ...prev, [room]: prev[room] === false }));

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <p className="text-xs font-semibold text-indigo-500 tracking-wider uppercase">Recording Library</p>
          <h2 className="text-2xl font-bold text-gray-800">Windows Recordings</h2>
        </div>
        <button onClick={fetchAll}
          className="flex items-center gap-2 px-4 py-2 bg-white border rounded-lg text-sm text-gray-600 hover:bg-gray-50 transition">
          <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} /> Refresh
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3 mb-4 flex items-center gap-2">
          <AlertTriangle size={16} /> {error}
        </div>
      )}

      {/* Stats Bar */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {[
          { label: "Total Recordings", value: stats.total, icon: Video, color: "text-blue-600", bg: "bg-blue-50" },
          { label: "Completed", value: stats.completed, icon: Eye, color: "text-green-600", bg: "bg-green-50" },
          { label: "In Progress", value: stats.inProgress, icon: BarChart3, color: "text-purple-600", bg: "bg-purple-50" },
          { label: "Total Size", value: formatBytes(stats.totalSize), icon: HardDrive, color: "text-orange-600", bg: "bg-orange-50" },
        ].map(({ label, value, icon: Icon, color, bg }) => (
          <div key={label} className="bg-white rounded-xl border p-4">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 ${bg} rounded-lg flex items-center justify-center`}>
                <Icon size={18} className={color} />
              </div>
              <div>
                <p className="text-xs text-gray-500">{label}</p>
                <p className={`text-xl font-bold ${color}`}>{value}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Search + Filter Bar */}
      <div className="bg-white rounded-xl border p-4 mb-6">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[240px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input type="text" placeholder="Search by title, course, teacher..."
              value={search} onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2.5 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
          </div>
          <button onClick={() => setShowFilters(!showFilters)}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium border transition ${
              activeFilterCount > 0 ? "bg-blue-50 border-blue-200 text-blue-700" : "bg-white text-gray-600 hover:bg-gray-50"
            }`}>
            <Filter size={14} />
            Filters {activeFilterCount > 0 && <span className="bg-blue-600 text-white text-xs px-1.5 py-0.5 rounded-full">{activeFilterCount}</span>}
            <ChevronDown size={14} className={`transition-transform ${showFilters ? "rotate-180" : ""}`} />
          </button>
          {activeFilterCount > 0 && (
            <button onClick={() => { setFilterStatus("all"); setFilterRoom("all"); }}
              className="text-sm text-red-500 hover:text-red-700 transition">Clear all</button>
          )}
          <span className="text-sm text-gray-400 ml-auto">Showing {filtered.length} of {recordings.length}</span>
        </div>

        {showFilters && (
          <div className="grid grid-cols-2 gap-3 mt-4 pt-4 border-t">
            <div>
              <label className="text-xs font-medium text-gray-500 mb-1 flex items-center gap-1"><Video size={11} /> Status</label>
              <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}
                className="w-full px-3 py-2 border rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 outline-none">
                <option value="all">All Status</option>
                <option value="recording">Recording</option>
                <option value="merging">Post-processing</option>
                <option value="uploading">Uploading</option>
                <option value="completed">Completed</option>
                <option value="failed">Failed</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 mb-1 flex items-center gap-1"><DoorOpen size={11} /> Room</label>
              <select value={filterRoom} onChange={(e) => setFilterRoom(e.target.value)}
                className="w-full px-3 py-2 border rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 outline-none">
                {rooms.map((r) => (
                  <option key={r} value={r}>{r === "all" ? "All Rooms" : `Room ${r}`}</option>
                ))}
              </select>
            </div>
          </div>
        )}
      </div>

      {/* Room-grouped recording list */}
      {loading ? (
        <div className="text-center text-gray-400 py-12">
          <RefreshCw size={20} className="inline animate-spin mr-2" />Loading recordings...
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border p-12 text-center text-gray-400">
          <Video size={48} className="mx-auto mb-3 opacity-50" />
          <p className="font-medium text-gray-600">No recordings found</p>
          <p className="text-sm mt-1">
            {recordings.length > 0 ? (
              "Try changing the filter or search term."
            ) : (
              <>Schedule a class from <Link to="/windows/booking" className="text-blue-600 hover:underline">Windows → Booking</Link> and the device will auto-record.</>
            )}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b)).map(([room, recs]) => {
            const isOpen = expandedRooms[room] !== false;
            const sourceDevice = devices.find((d) => String(d.roomNumber) === String(room));
            const loc = locationText(sourceDevice);
            return (
              <div key={room} className="rounded-xl overflow-hidden border border-slate-200">
                {/* Room header */}
                <button
                  onClick={() => toggleRoom(room)}
                  className="w-full flex items-center justify-between px-5 py-4 bg-gradient-to-r from-slate-800 to-slate-700 text-white hover:from-slate-700 hover:to-slate-600 transition-all"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-white/10 rounded-lg flex items-center justify-center">
                      <DoorOpen size={20} />
                    </div>
                    <div className="text-left">
                      <p className="text-[10px] tracking-wider uppercase text-slate-400 flex items-center gap-1">
                        {loc ? <><MapPin size={9} /> {loc}</> : "Room"}
                      </p>
                      <h3 className="text-lg font-bold">{room === "Unassigned" ? "Unassigned" : `Room ${room}`}</h3>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {sourceDevice && (
                      <Link
                        to={`/windows/devices/${sourceDevice.deviceId}/remote`}
                        onClick={(e) => e.stopPropagation()}
                        className="text-xs bg-white/10 hover:bg-white/20 px-3 py-1 rounded-full flex items-center gap-1"
                      >
                        Device console <ChevronRight size={12} />
                      </Link>
                    )}
                    <span className="text-xs bg-indigo-500/80 px-3 py-1 rounded-full font-medium">
                      {recs.length} recording{recs.length !== 1 ? "s" : ""}
                    </span>
                    <ChevronDown size={18} className={`transition-transform ${isOpen ? "" : "-rotate-90"}`} />
                  </div>
                </button>

                {isOpen && (
                  <div className="bg-slate-50 p-4 space-y-2">
                    {recs.map((rec) => (
                      <RecordingCard
                        key={rec._id}
                        rec={rec}
                        onPlay={() => setPlayingRec(rec)}
                        onDownload={() => handleDownload(rec)}
                        onDelete={() => handleDelete(rec)}
                        isDownloading={downloadingId === rec._id}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {playingRec && (
        <PlayerModal recording={playingRec} onClose={() => setPlayingRec(null)} />
      )}
    </div>
  );
}

// ── Recording card (mirrors Android Recordings.jsx recording card) ────────────

function RecordingCard({ rec, onPlay, onDownload, onDelete, isDownloading }) {
  const sc = rec.scheduledClass;
  const status = (rec.status || "").toLowerCase();
  const meta = statusMeta(status);
  const playable = rec.mergedVideoUrl && status === "completed";
  const inProgress = status === "recording" || status === "merging" || status === "uploading";
  const bytes = rec.mergedFileSize || rec.fileSize || 0;

  return (
    <div className="flex items-stretch bg-white rounded-xl border border-slate-200 hover:shadow-md hover:border-indigo-200 transition-all overflow-hidden group">
      {/* Thumbnail */}
      <div
        className={`w-44 flex-shrink-0 bg-gray-900 flex items-center justify-center relative ${playable ? "cursor-pointer" : ""}`}
        onClick={() => playable && onPlay()}
      >
        <Video size={28} className="text-gray-600" />
        {playable && (
          <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
            <div className="w-10 h-10 rounded-full bg-white/90 flex items-center justify-center shadow-lg">
              <Play size={18} className="text-indigo-600 ml-0.5" fill="currentColor" />
            </div>
          </div>
        )}
        {status === "recording" && (
          <span className="absolute bottom-2 left-2 flex items-center gap-1.5 text-[10px] text-red-400">
            <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" /> LIVE
          </span>
        )}
        {rec.duration > 0 && (
          <span className="absolute bottom-2 right-2 text-[10px] bg-black/70 text-white px-1.5 py-0.5 rounded">
            {formatDuration(rec.duration)}
          </span>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 p-3 flex flex-col justify-between min-w-0">
        <div>
          <div className="flex items-start gap-2 mb-0.5">
            <h4 className="font-semibold text-gray-800 truncate flex-1 text-sm">
              {rec.title || sc?.title || "Untitled recording"}
            </h4>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <span className={`flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-medium border ${meta.cls}`}>
                {inProgress && status !== "recording" && <Loader2 size={9} className="animate-spin" />}
                {meta.label}
              </span>
            </div>
          </div>
          {sc && (sc.courseName || sc.teacherName) && (
            <p className="text-xs text-gray-500 truncate">
              {sc.courseName}
              {sc.teacherName && <span className="text-gray-400"> | {sc.teacherName}</span>}
            </p>
          )}
        </div>

        <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-100">
          <div className="flex items-center gap-3 text-[11px] text-gray-400">
            {rec.recordingStart && (
              <span className="flex items-center gap-1">
                <CalendarDays size={11} /> {new Date(rec.recordingStart).toLocaleDateString()}
              </span>
            )}
            {rec.recordingStart && (
              <span className="flex items-center gap-1">
                <Clock size={11} /> {new Date(rec.recordingStart).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </span>
            )}
            <span className="flex items-center gap-1">
              <HardDrive size={11} /> {formatBytes(bytes)}
            </span>
          </div>

          <div className="flex items-center gap-1">
            {playable && (
              <>
                <button onClick={onPlay}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium bg-indigo-50 text-indigo-600 hover:bg-indigo-100 transition">
                  <Play size={11} /> Play
                </button>
                <button onClick={onDownload} disabled={isDownloading}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium bg-green-50 text-green-600 hover:bg-green-100 transition disabled:opacity-50 disabled:cursor-wait">
                  {isDownloading
                    ? <><Loader2 size={11} className="animate-spin" /> Downloading…</>
                    : <><Download size={11} /> Download</>}
                </button>
              </>
            )}
            <button onClick={onDelete}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium bg-red-50 text-red-500 hover:bg-red-100 transition">
              <Trash2 size={11} /> Delete
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Video player modal (mirrors Android Recordings.jsx player modal) ──────────

function PlayerModal({ recording, onClose }) {
  const [downloading, setDownloading] = useState(false);
  const sc = recording.scheduledClass;

  const handleDownload = async () => {
    if (downloading) return;
    setDownloading(true);
    try {
      await winRecordings.download(recording._id);
    } catch (e) {
      alert("Download failed: " + (e.message || e));
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-gray-900 rounded-2xl overflow-hidden max-w-5xl w-full shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 bg-gray-800">
          <div>
            <h3 className="text-white font-semibold">{recording.title || sc?.title || "Recording"}</h3>
            <p className="text-gray-400 text-sm">
              Room {sc?.roomNumber || recording.roomNumber || "?"}
              {sc?.courseName && ` | ${sc.courseName}`}
              {sc?.teacherName && ` — ${sc.teacherName}`}
            </p>
          </div>
          <button onClick={onClose}
            className="text-gray-400 hover:text-white p-1 rounded-lg hover:bg-gray-700 transition">
            <X size={22} />
          </button>
        </div>
        <div className="bg-black aspect-video">
          <video src={recording.mergedVideoUrl} controls autoPlay preload="metadata" className="w-full h-full" />
        </div>
        <div className="flex items-center justify-between px-5 py-3 bg-gray-800">
          <div className="flex items-center gap-6 text-xs text-gray-400">
            <span className="flex items-center gap-1"><Clock size={12} /> {formatDuration(recording.duration)}</span>
            <span className="flex items-center gap-1">
              <HardDrive size={12} /> {formatBytes(recording.mergedFileSize || recording.fileSize)}
            </span>
            {recording.recordingStart && (
              <span className="flex items-center gap-1">
                <CalendarDays size={12} /> {new Date(recording.recordingStart).toLocaleString()}
              </span>
            )}
          </div>
          <button onClick={handleDownload} disabled={downloading}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-green-600 text-white hover:bg-green-500 transition disabled:opacity-50 disabled:cursor-wait">
            {downloading
              ? <><Loader2 size={16} className="animate-spin" /> Downloading…</>
              : <><Download size={16} /> Download</>}
          </button>
        </div>
      </div>
    </div>
  );
}

function formatBytes(bytes) {
  if (!bytes) return "—";
  const mb = bytes / 1024 / 1024;
  return mb < 1024 ? `${mb.toFixed(1)} MB` : `${(mb / 1024).toFixed(2)} GB`;
}

function formatDuration(seconds) {
  if (!seconds) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}
