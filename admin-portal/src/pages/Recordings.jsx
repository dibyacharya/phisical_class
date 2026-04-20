import { useState, useEffect, useMemo, useRef } from "react";
import {
  Video, Eye, EyeOff, Trash2, Clock, HardDrive, Play, X, Download,
  Search, Filter, Building2, Layers, MapPin, CalendarDays, ChevronDown,
  RefreshCw, BarChart3, ChevronRight, DoorOpen, FileVideo,
} from "lucide-react";
import api from "../services/api";

const BACKEND_URL = import.meta.env.VITE_API_BASE_URL?.replace("/api", "") || "http://localhost:5020";

/* ── Helpers ─────────────────────────────────────────────────────────── */
function formatDuration(seconds) {
  if (!seconds) return "0s";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${s}s`;
}

function formatSize(bytes) {
  if (!bytes) return "0 KB";
  if (bytes >= 1_000_000_000) return (bytes / 1_000_000_000).toFixed(1) + " GB";
  if (bytes >= 1_000_000) return (bytes / 1_000_000).toFixed(0) + " MB";
  return (bytes / 1_000).toFixed(0) + " KB";
}

function formatDate(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function fmtBlock(b) {
  if (!b) return b;
  const t = b.trim();
  return /^\d+$/.test(t) ? `Block ${t}` : t;
}

function fmtFloor(f) {
  if (!f) return f;
  const t = f.trim();
  if (/^\d+$/.test(t)) {
    const n = parseInt(t, 10);
    if (n === 0) return "Ground Floor";
    const sfx = n === 1 ? "st" : n === 2 ? "nd" : n === 3 ? "rd" : "th";
    return `${n}${sfx} Floor`;
  }
  if (/^g(round)?$/i.test(t)) return "Ground Floor";
  if (/^b(asement)?$/i.test(t)) return "Basement";
  return t;
}

const statusColors = {
  recording: "bg-red-100 text-red-700 border-red-200",
  uploading: "bg-yellow-100 text-yellow-700 border-yellow-200",
  completed: "bg-green-100 text-green-700 border-green-200",
  failed: "bg-gray-100 text-gray-500 border-gray-200",
};

/* ── Build hierarchy tree from recordings ────────────────────────────── */
function buildTree(recordings) {
  const tree = {};
  recordings.forEach((rec) => {
    const campus = rec.room?.campus || "Unknown Campus";
    const block = rec.room?.block || "Unknown Block";
    const floor = rec.room?.floor || "Unknown Floor";
    const roomNum = rec.scheduledClass?.roomNumber || "Unknown";
    const roomName = rec.room?.roomName || "";

    if (!tree[campus]) tree[campus] = {};
    if (!tree[campus][block]) tree[campus][block] = {};
    if (!tree[campus][block][floor]) tree[campus][block][floor] = {};
    if (!tree[campus][block][floor][roomNum]) {
      tree[campus][block][floor][roomNum] = { roomName, recordings: [] };
    }
    tree[campus][block][floor][roomNum].recordings.push(rec);
  });

  // Sort recordings inside each room by date (newest first)
  Object.values(tree).forEach((blocks) =>
    Object.values(blocks).forEach((floors) =>
      Object.values(floors).forEach((rooms) =>
        Object.values(rooms).forEach((roomData) => {
          roomData.recordings.sort((a, b) => {
            const dA = a.scheduledClass?.date || a.createdAt || "";
            const dB = b.scheduledClass?.date || b.createdAt || "";
            return new Date(dB) - new Date(dA);
          });
        })
      )
    )
  );

  return tree;
}

/* ── Segment Player: seamless playback across multiple 5-min segments ── */
function SegmentPlayer({ recording, segmentUrls, fallbackUrl }) {
  const videoRef = useRef(null);
  const [currentIdx, setCurrentIdx] = useState(0);

  // If no segments or only 1 → single-file playback
  const hasMultiSegments = segmentUrls && segmentUrls.length > 1;
  const sources = hasMultiSegments ? segmentUrls : (fallbackUrl ? [fallbackUrl] : []);

  useEffect(() => {
    // Reset to first segment whenever a new recording is opened
    setCurrentIdx(0);
  }, [recording?._id]);

  const handleEnded = () => {
    if (currentIdx < sources.length - 1) {
      setCurrentIdx(currentIdx + 1);
    }
  };

  // Auto-play next segment when currentIdx changes
  useEffect(() => {
    const v = videoRef.current;
    if (v && currentIdx > 0) {
      // Small delay to let src swap
      v.play().catch(() => {});
    }
  }, [currentIdx]);

  if (!sources.length) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-400">
        No playable video available
      </div>
    );
  }

  return (
    <div className="relative">
      <video
        key={`${recording._id}-${currentIdx}`}
        ref={videoRef}
        src={sources[currentIdx]}
        controls
        autoPlay
        className="w-full max-h-[75vh]"
        onEnded={handleEnded}
        onLoadedMetadata={(e) => { e.currentTarget.volume = 1.0; e.currentTarget.muted = false; }}
      />
      {hasMultiSegments && (
        <div className="absolute top-3 right-3 bg-black/70 text-white text-xs px-3 py-1.5 rounded-full flex items-center gap-2">
          <span>Segment {currentIdx + 1} / {sources.length}</span>
          <div className="flex gap-1">
            {sources.map((_, i) => (
              <button
                key={i}
                onClick={() => setCurrentIdx(i)}
                className={`w-2 h-2 rounded-full transition ${i === currentIdx ? "bg-white" : "bg-white/30 hover:bg-white/60"}`}
                title={`Jump to segment ${i + 1}`}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Main Component ──────────────────────────────────────────────────── */
export default function Recordings() {
  const [recordings, setRecordings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [playingRec, setPlayingRec] = useState(null);

  // Filters
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterDate, setFilterDate] = useState("");
  const [showFilters, setShowFilters] = useState(false);

  // Expanded state
  const [expandedCampuses, setExpandedCampuses] = useState({});
  const [expandedBlocks, setExpandedBlocks] = useState({});
  const [expandedFloors, setExpandedFloors] = useState({});
  const [expandedRooms, setExpandedRooms] = useState({});

  const fetchRecordings = () => {
    setLoading(true);
    api.get("/recordings")
      .then((r) => { setRecordings(r.data); setLoading(false); })
      .catch(() => setLoading(false));
  };

  useEffect(() => { fetchRecordings(); }, []);

  // Auto-expand all on first load
  useEffect(() => {
    if (recordings.length > 0) {
      const ec = {}, eb = {}, ef = {}, er = {};
      recordings.forEach((rec) => {
        const campus = rec.room?.campus || "Unknown Campus";
        const block = rec.room?.block || "Unknown Block";
        const floor = rec.room?.floor || "Unknown Floor";
        const roomNum = rec.scheduledClass?.roomNumber || "Unknown";
        ec[campus] = true;
        eb[`${campus}|${block}`] = true;
        ef[`${campus}|${block}|${floor}`] = true;
        er[`${campus}|${block}|${floor}|${roomNum}`] = true;
      });
      setExpandedCampuses(ec);
      setExpandedBlocks(eb);
      setExpandedFloors(ef);
      setExpandedRooms(er);
    }
  }, [recordings]);

  const togglePublish = async (id) => {
    try { await api.put(`/recordings/${id}/toggle-publish`); fetchRecordings(); }
    catch (err) { alert("Failed: " + (err.response?.data?.error || err.message)); }
  };

  const handleDelete = async (id) => {
    if (!confirm("Delete this recording?")) return;
    try { await api.delete(`/recordings/${id}`); fetchRecordings(); }
    catch (err) { alert("Delete failed: " + (err.response?.data?.error || err.message)); }
  };

  const toAbsoluteUrl = (url) => {
    if (!url) return null;
    return url.startsWith("http") ? url : `${BACKEND_URL}${url}`;
  };

  const getVideoUrl = (rec) => {
    if (!rec.videoUrl) return null;
    return toAbsoluteUrl(rec.videoUrl);
  };

  // Get ordered list of segment URLs (for multi-segment recordings)
  const getSegmentUrls = (rec) => {
    const segs = (rec.segments || [])
      .filter((s) => s && s.videoUrl)
      .sort((a, b) => (a.segmentIndex || 0) - (b.segmentIndex || 0));
    return segs.map((s) => toAbsoluteUrl(s.videoUrl));
  };

  // Apply filters
  const filtered = useMemo(() => {
    return recordings.filter((rec) => {
      if (filterStatus !== "all" && rec.status !== filterStatus) return false;
      if (filterDate && rec.scheduledClass?.date) {
        const recDate = new Date(rec.scheduledClass.date).toISOString().split("T")[0];
        if (recDate !== filterDate) return false;
      }
      if (search) {
        const q = search.toLowerCase();
        const haystack = [
          rec.title, rec.scheduledClass?.courseName, rec.scheduledClass?.courseCode,
          rec.scheduledClass?.teacherName, rec.scheduledClass?.roomNumber,
          rec.room?.campus, rec.room?.block, rec.room?.floor, rec.room?.roomName,
        ].filter(Boolean).join(" ").toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [recordings, search, filterStatus, filterDate]);

  // Stats
  const stats = useMemo(() => ({
    total: recordings.length,
    completed: recordings.filter(r => r.status === "completed").length,
    published: recordings.filter(r => r.isPublished).length,
    totalSize: recordings.reduce((s, r) => s + (r.fileSize || 0), 0),
  }), [recordings]);

  // Build hierarchy from filtered recordings
  const tree = useMemo(() => buildTree(filtered), [filtered]);

  const activeFilterCount = [filterStatus, filterDate].filter(f => f && f !== "all").length;
  const clearFilters = () => { setFilterStatus("all"); setFilterDate(""); setSearch(""); };

  // Count helpers for tree headers
  function countRecInBlock(blocks) {
    let c = 0;
    Object.values(blocks).forEach((floors) =>
      Object.values(floors).forEach((rooms) =>
        Object.values(rooms).forEach((rd) => { c += rd.recordings.length; })
      )
    );
    return c;
  }

  function countRecInFloors(floors) {
    let c = 0;
    Object.values(floors).forEach((rooms) =>
      Object.values(rooms).forEach((rd) => { c += rd.recordings.length; })
    );
    return c;
  }

  function countRecInRooms(rooms) {
    let c = 0;
    Object.values(rooms).forEach((rd) => { c += rd.recordings.length; });
    return c;
  }

  function countRoomsInCampus(blocks) {
    let c = 0;
    Object.values(blocks).forEach((floors) =>
      Object.values(floors).forEach((rooms) => { c += Object.keys(rooms).length; })
    );
    return c;
  }

  const toggleMap = (setter, key) => setter((prev) => ({ ...prev, [key]: !prev[key] }));

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <p className="text-xs font-semibold text-indigo-500 tracking-wider uppercase">Recording Library</p>
          <h2 className="text-2xl font-bold text-gray-800">Class Recordings</h2>
        </div>
        <button onClick={fetchRecordings} className="flex items-center gap-2 px-4 py-2 bg-white border rounded-lg text-sm text-gray-600 hover:bg-gray-50 transition">
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {/* Stats Bar */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {[
          { label: "Total Recordings", value: stats.total, icon: Video, color: "text-blue-600", bg: "bg-blue-50" },
          { label: "Completed", value: stats.completed, icon: Eye, color: "text-green-600", bg: "bg-green-50" },
          { label: "Published", value: stats.published, icon: BarChart3, color: "text-purple-600", bg: "bg-purple-50" },
          { label: "Total Size", value: formatSize(stats.totalSize), icon: HardDrive, color: "text-orange-600", bg: "bg-orange-50" },
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
            <input type="text" placeholder="Search by title, course, teacher, room..."
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
            <button onClick={clearFilters} className="text-sm text-red-500 hover:text-red-700 transition">Clear all</button>
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
                <option value="completed">Completed</option>
                <option value="recording">Recording</option>
                <option value="uploading">Uploading</option>
                <option value="failed">Failed</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 mb-1 flex items-center gap-1"><CalendarDays size={11} /> Date</label>
              <input type="date" value={filterDate} onChange={(e) => setFilterDate(e.target.value)}
                className="w-full px-3 py-2 border rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 outline-none" />
            </div>
          </div>
        )}
      </div>

      {/* ── Tree Hierarchy ─────────────────────────────────────────────── */}
      {loading ? (
        <div className="text-center text-gray-400 py-12"><RefreshCw size={20} className="inline animate-spin mr-2" />Loading recordings...</div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border p-12 text-center text-gray-400">
          <Video size={48} className="mx-auto mb-3 opacity-50" />
          <p className="font-medium text-gray-600">No recordings found</p>
          <p className="text-sm mt-1">{recordings.length > 0 ? "Try changing the filter or search term." : "Schedule a class and the device will auto-record."}</p>
        </div>
      ) : (
        <div className="space-y-4">
          {Object.entries(tree).sort(([a], [b]) => a.localeCompare(b)).map(([campus, blocks]) => {
            const campusKey = campus;
            const isOpen = expandedCampuses[campusKey] !== false;
            const totalRec = countRecInBlock(blocks);
            const totalRooms = countRoomsInCampus(blocks);
            const totalBlocks = Object.keys(blocks).length;

            return (
              <div key={campus} className="rounded-xl overflow-hidden border border-slate-200">
                {/* ── Campus Header ───────────────────────────────────── */}
                <button
                  onClick={() => toggleMap(setExpandedCampuses, campusKey)}
                  className="w-full flex items-center justify-between px-5 py-4 bg-gradient-to-r from-slate-800 to-slate-700 text-white hover:from-slate-700 hover:to-slate-600 transition-all"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-white/10 rounded-lg flex items-center justify-center">
                      <Building2 size={20} />
                    </div>
                    <div className="text-left">
                      <p className="text-[10px] tracking-wider uppercase text-slate-400">Campus</p>
                      <h3 className="text-lg font-bold">{campus}</h3>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs bg-white/10 px-3 py-1 rounded-full">{totalBlocks} block{totalBlocks !== 1 ? "s" : ""} · {totalRooms} room{totalRooms !== 1 ? "s" : ""}</span>
                    <span className="text-xs bg-indigo-500/80 px-3 py-1 rounded-full font-medium">{totalRec} recording{totalRec !== 1 ? "s" : ""}</span>
                    <ChevronDown size={18} className={`transition-transform ${isOpen ? "" : "-rotate-90"}`} />
                  </div>
                </button>

                {isOpen && (
                  <div className="bg-slate-50">
                    {Object.entries(blocks).sort(([a], [b]) => a.localeCompare(b)).map(([block, floors]) => {
                      const blockKey = `${campus}|${block}`;
                      const isBlockOpen = expandedBlocks[blockKey] !== false;
                      const blockRecCount = countRecInFloors(floors);
                      const blockFloorCount = Object.keys(floors).length;

                      return (
                        <div key={block}>
                          {/* ── Block Header ──────────────────────────── */}
                          <button
                            onClick={() => toggleMap(setExpandedBlocks, blockKey)}
                            className="w-full flex items-center justify-between px-6 py-3 border-b border-slate-200 hover:bg-slate-100 transition-colors"
                          >
                            <div className="flex items-center gap-2">
                              <ChevronRight size={16} className={`text-slate-400 transition-transform ${isBlockOpen ? "rotate-90" : ""}`} />
                              <Layers size={16} className="text-slate-500" />
                              <span className="font-semibold text-slate-700">{fmtBlock(block)}</span>
                              <span className="text-xs text-slate-400">{blockFloorCount} floor{blockFloorCount !== 1 ? "s" : ""}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs bg-blue-100 text-blue-700 px-2.5 py-0.5 rounded-full font-medium">{blockRecCount} recording{blockRecCount !== 1 ? "s" : ""}</span>
                            </div>
                          </button>

                          {isBlockOpen && (
                            <div className="bg-white">
                              {Object.entries(floors).sort(([a], [b]) => a.localeCompare(b)).map(([floor, rooms]) => {
                                const floorKey = `${campus}|${block}|${floor}`;
                                const isFloorOpen = expandedFloors[floorKey] !== false;
                                const floorRecCount = countRecInRooms(rooms);
                                const floorRoomCount = Object.keys(rooms).length;

                                return (
                                  <div key={floor}>
                                    {/* ── Floor Header ────────────────── */}
                                    <button
                                      onClick={() => toggleMap(setExpandedFloors, floorKey)}
                                      className="w-full flex items-center justify-between px-8 py-2.5 border-b border-slate-100 hover:bg-slate-50 transition-colors"
                                    >
                                      <div className="flex items-center gap-2">
                                        <ChevronRight size={14} className={`text-slate-400 transition-transform ${isFloorOpen ? "rotate-90" : ""}`} />
                                        <Layers size={14} className="text-slate-400" />
                                        <span className="text-sm font-medium text-slate-600">{fmtFloor(floor)}</span>
                                        <span className="text-xs text-slate-400">{floorRoomCount} room{floorRoomCount !== 1 ? "s" : ""}</span>
                                      </div>
                                      <span className="text-xs text-slate-400">{floorRecCount} recording{floorRecCount !== 1 ? "s" : ""}</span>
                                    </button>

                                    {isFloorOpen && (
                                      <div>
                                        {Object.entries(rooms).sort(([a], [b]) => a.localeCompare(b)).map(([roomNum, roomData]) => {
                                          const roomKey = `${campus}|${block}|${floor}|${roomNum}`;
                                          const isRoomOpen = expandedRooms[roomKey] !== false;
                                          const recs = roomData.recordings;

                                          return (
                                            <div key={roomNum} className="border-b border-slate-100 last:border-b-0">
                                              {/* ── Room Header ─────────── */}
                                              <button
                                                onClick={() => toggleMap(setExpandedRooms, roomKey)}
                                                className="w-full flex items-center justify-between pl-12 pr-8 py-3 hover:bg-indigo-50/50 transition-colors"
                                              >
                                                <div className="flex items-center gap-2">
                                                  <ChevronRight size={14} className={`text-slate-400 transition-transform ${isRoomOpen ? "rotate-90" : ""}`} />
                                                  <DoorOpen size={16} className="text-indigo-500" />
                                                  <span className="font-medium text-indigo-700">Room {roomNum}</span>
                                                  {roomData.roomName && <span className="text-xs text-slate-400">({roomData.roomName})</span>}
                                                </div>
                                                <div className="flex items-center gap-2">
                                                  <span className="text-xs bg-indigo-100 text-indigo-700 px-2.5 py-0.5 rounded-full font-medium">
                                                    <FileVideo size={11} className="inline mr-1" />{recs.length} recording{recs.length !== 1 ? "s" : ""}
                                                  </span>
                                                </div>
                                              </button>

                                              {/* ── Recording Cards inside Room ── */}
                                              {isRoomOpen && (
                                                <div className="pl-14 pr-6 pb-4 space-y-2">
                                                  {recs.map((rec) => {
                                                    const videoUrl = getVideoUrl(rec);
                                                    const sc = rec.scheduledClass;
                                                    return (
                                                      <div key={rec._id}
                                                        className="flex items-stretch bg-white rounded-xl border border-slate-200 hover:shadow-md hover:border-indigo-200 transition-all overflow-hidden group">
                                                        {/* Thumbnail */}
                                                        <div
                                                          className={`w-44 flex-shrink-0 bg-gray-900 flex items-center justify-center relative ${videoUrl && rec.status === "completed" ? "cursor-pointer" : ""}`}
                                                          onClick={() => videoUrl && rec.status === "completed" && setPlayingRec(rec)}
                                                        >
                                                          <Video size={28} className="text-gray-600" />
                                                          {videoUrl && rec.status === "completed" && (
                                                            <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                                              <div className="w-10 h-10 rounded-full bg-white/90 flex items-center justify-center shadow-lg">
                                                                <Play size={18} className="text-indigo-600 ml-0.5" fill="currentColor" />
                                                              </div>
                                                            </div>
                                                          )}
                                                          {rec.status === "recording" && (
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
                                                              <h4 className="font-semibold text-gray-800 truncate flex-1 text-sm">{rec.title}</h4>
                                                              <div className="flex items-center gap-1.5 flex-shrink-0">
                                                                <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium border ${statusColors[rec.status]}`}>
                                                                  {rec.status}
                                                                </span>
                                                                {rec.isPublished && (
                                                                  <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-blue-50 text-blue-600 border border-blue-200">Published</span>
                                                                )}
                                                              </div>
                                                            </div>
                                                            {sc && (
                                                              <p className="text-xs text-gray-500 truncate">
                                                                {sc.courseCode} — {sc.courseName}
                                                                {(sc.teacher?.name || sc.teacherName) && <span className="text-gray-400"> | {sc.teacher?.name || sc.teacherName}</span>}
                                                              </p>
                                                            )}
                                                          </div>

                                                          <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-100">
                                                            <div className="flex items-center gap-3 text-[11px] text-gray-400">
                                                              {sc?.date && (
                                                                <span className="flex items-center gap-1">
                                                                  <CalendarDays size={11} /> {formatDate(sc.date)}
                                                                </span>
                                                              )}
                                                              {sc?.startTime && (
                                                                <span className="flex items-center gap-1">
                                                                  <Clock size={11} /> {sc.startTime}{sc.endTime ? ` - ${sc.endTime}` : ""}
                                                                </span>
                                                              )}
                                                              <span className="flex items-center gap-1">
                                                                <HardDrive size={11} /> {formatSize(rec.fileSize)}
                                                              </span>
                                                            </div>

                                                            <div className="flex items-center gap-1">
                                                              {videoUrl && rec.status === "completed" && (
                                                                <>
                                                                  <button onClick={() => setPlayingRec(rec)}
                                                                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium bg-indigo-50 text-indigo-600 hover:bg-indigo-100 transition">
                                                                    <Play size={11} /> Play
                                                                  </button>
                                                                  <a href={videoUrl} download={`${rec.title || "recording"}.mp4`}
                                                                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium bg-green-50 text-green-600 hover:bg-green-100 transition">
                                                                    <Download size={11} /> Download
                                                                  </a>
                                                                </>
                                                              )}
                                                              <button onClick={() => togglePublish(rec._id)}
                                                                className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium transition ${
                                                                  rec.isPublished ? "bg-amber-50 text-amber-600 hover:bg-amber-100" : "bg-blue-50 text-blue-600 hover:bg-blue-100"
                                                                }`}>
                                                                {rec.isPublished ? <><EyeOff size={11} /> Unpublish</> : <><Eye size={11} /> Publish</>}
                                                              </button>
                                                              <button onClick={() => handleDelete(rec._id)}
                                                                className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium bg-red-50 text-red-500 hover:bg-red-100 transition">
                                                                <Trash2 size={11} /> Delete
                                                              </button>
                                                            </div>
                                                          </div>
                                                        </div>
                                                      </div>
                                                    );
                                                  })}
                                                </div>
                                              )}
                                            </div>
                                          );
                                        })}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Video Player Modal */}
      {playingRec && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={() => setPlayingRec(null)}>
          <div className="bg-gray-900 rounded-2xl overflow-hidden max-w-5xl w-full shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 bg-gray-800">
              <div>
                <h3 className="text-white font-semibold">{playingRec.title}</h3>
                <p className="text-gray-400 text-sm">
                  {playingRec.room?.campus && `${playingRec.room.campus} › `}
                  {playingRec.room?.block && `${fmtBlock(playingRec.room.block)} › `}
                  {playingRec.room?.floor && `${fmtFloor(playingRec.room.floor)} › `}
                  Room {playingRec.scheduledClass?.roomNumber}
                  {playingRec.scheduledClass && ` | ${playingRec.scheduledClass.courseCode} - ${playingRec.scheduledClass.courseName}`}
                </p>
              </div>
              <button onClick={() => setPlayingRec(null)}
                className="text-gray-400 hover:text-white p-1 rounded-lg hover:bg-gray-700 transition">
                <X size={22} />
              </button>
            </div>
            <div className="bg-black">
              <SegmentPlayer
                recording={playingRec}
                segmentUrls={getSegmentUrls(playingRec)}
                fallbackUrl={getVideoUrl(playingRec)}
              />
            </div>
            <div className="flex items-center justify-between px-5 py-3 bg-gray-800">
              <div className="flex items-center gap-6 text-xs text-gray-400">
                <span className="flex items-center gap-1"><Clock size={12} /> {formatDuration(playingRec.duration)}</span>
                <span className="flex items-center gap-1"><HardDrive size={12} /> {formatSize(playingRec.fileSize)}</span>
                {(playingRec.segments || []).length > 1 && (
                  <span className="flex items-center gap-1 text-blue-300">
                    <FileVideo size={12} /> {playingRec.segments.length} segments
                  </span>
                )}
                {playingRec.scheduledClass && (
                  <span className="flex items-center gap-1">
                    <CalendarDays size={12} />
                    {formatDate(playingRec.scheduledClass.date)} | {playingRec.scheduledClass.startTime} - {playingRec.scheduledClass.endTime}
                  </span>
                )}
              </div>
              <div className="flex gap-2">
                {(playingRec.segments || []).length > 1 ? (
                  <button
                    onClick={() => {
                      // Download all segments sequentially
                      getSegmentUrls(playingRec).forEach((url, idx) => {
                        const a = document.createElement("a");
                        a.href = url;
                        a.download = `${playingRec.title || "recording"}_seg${idx + 1}.mp4`;
                        document.body.appendChild(a);
                        setTimeout(() => { a.click(); a.remove(); }, idx * 500);
                      });
                    }}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-green-600 text-white hover:bg-green-500 transition"
                  >
                    <Download size={16} /> Download All ({playingRec.segments.length})
                  </button>
                ) : (
                  <a href={getVideoUrl(playingRec)} download={`${playingRec.title || "recording"}.mp4`}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-green-600 text-white hover:bg-green-500 transition">
                    <Download size={16} /> Download
                  </a>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
