import { useEffect, useState, useCallback, useMemo } from "react";
import { Link } from "react-router-dom";
import {
  Video, Search, RefreshCw, Play, Download, Filter,
  Clock, HardDrive, CheckCircle2, XCircle, Loader2, Radio,
  AlertTriangle, ChevronRight, Trash2,
} from "lucide-react";
import { winRecordings, winDevices } from "../../services/windowsApi";

const STATUS_OPTIONS = [
  { id: "all", label: "All" },
  { id: "recording", label: "Recording" },
  { id: "merging", label: "Merging" },
  { id: "completed", label: "Completed" },
  { id: "failed", label: "Failed" },
];

/**
 * Browse recordings produced by the Windows fleet. Mirrors Android's
 * Recordings.jsx pattern but uses Windows-specific status / merge fields
 * and links to WindowsDeviceRemote for the source device.
 */
export default function WindowsRecordings() {
  const [recordings, setRecordings] = useState([]);
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [roomFilter, setRoomFilter] = useState("all");
  const [selected, setSelected] = useState(null); // for inline player modal

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

  // Delete a single recording. Confirms first because the R2 file stays
  // intact behind it (backend removes only the Mongo row), so technically
  // the recording is recoverable by an admin who knows the URL — but the
  // operator-facing UX should still feel like "this disappears".
  const handleDelete = useCallback(
    async (rec) => {
      const title = rec.title || rec.scheduledClass?.title || "this recording";
      const ok = window.confirm(
        `Delete "${title}"?\n\n` +
        `This removes it from the admin portal. The underlying R2 file is\n` +
        `kept in cold storage as a safety net — contact engineering to\n` +
        `restore if deleted by mistake.`
      );
      if (!ok) return;
      try {
        await winRecordings.remove(rec._id);
        setRecordings((prev) => prev.filter((x) => x._id !== rec._id));
      } catch (e) {
        alert("Delete failed: " + (e.message || e));
      }
    },
    []
  );

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
      if (statusFilter !== "all") {
        const s = (r.status || "").toLowerCase();
        if (s !== statusFilter) return false;
      }
      if (roomFilter !== "all") {
        const room = String(r.scheduledClass?.roomNumber || r.roomNumber || "");
        if (room !== roomFilter) return false;
      }
      if (search.trim()) {
        const q = search.toLowerCase();
        const title = (r.title || r.scheduledClass?.title || "").toLowerCase();
        const course = (r.scheduledClass?.courseName || "").toLowerCase();
        const teacher = (r.scheduledClass?.teacherName || "").toLowerCase();
        if (!title.includes(q) && !course.includes(q) && !teacher.includes(q)) return false;
      }
      return true;
    });
  }, [recordings, statusFilter, roomFilter, search]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="animate-spin text-blue-500" size={32} />
        <span className="ml-3 text-slate-500">Loading Windows recordings...</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Windows Recordings</h1>
          <p className="text-sm text-slate-500">
            {filtered.length} of {recordings.length} recordings
          </p>
        </div>
        <button
          onClick={fetchAll}
          disabled={refreshing}
          className="p-2 hover:bg-slate-100 rounded-lg disabled:opacity-50"
          title="Refresh"
        >
          <RefreshCw size={18} className={refreshing ? "animate-spin" : ""} />
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded p-3 flex items-center gap-2">
          <AlertTriangle size={16} />
          {error}
        </div>
      )}

      {/* Filters */}
      <div className="bg-white border border-slate-200 rounded-xl p-3 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search
            size={14}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400"
          />
          <input
            type="text"
            placeholder="Search title, course, teacher..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-8 pr-2 py-1.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-blue-500"
          />
        </div>
        <div className="flex items-center gap-1 text-xs">
          <Filter size={12} className="text-slate-400" />
          <span className="text-slate-500 mr-1">Status:</span>
          {STATUS_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              onClick={() => setStatusFilter(opt.id)}
              className={`px-2 py-1 rounded ${
                statusFilter === opt.id
                  ? "bg-blue-100 text-blue-700"
                  : "text-slate-500 hover:bg-slate-100"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1 text-xs">
          <span className="text-slate-500 mr-1">Room:</span>
          <select
            value={roomFilter}
            onChange={(e) => setRoomFilter(e.target.value)}
            className="text-xs border border-slate-300 rounded px-2 py-1"
          >
            {rooms.map((r) => (
              <option key={r} value={r}>
                {r === "all" ? "All" : `Room ${r}`}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-slate-500 bg-slate-50 border-b border-slate-200">
                <th className="py-2 px-3">Class</th>
                <th className="py-2 px-3">Room</th>
                <th className="py-2 px-3">Started</th>
                <th className="py-2 px-3">Duration</th>
                <th className="py-2 px-3">Size</th>
                <th className="py-2 px-3">Status</th>
                <th className="py-2 px-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <RecordingRow
                  key={r._id}
                  r={r}
                  devices={devices}
                  onPlay={() => setSelected(r)}
                  onDelete={() => handleDelete(r)}
                />
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-10 text-center text-slate-400 text-sm">
                    {recordings.length === 0 ? (
                      <>
                        No Windows recordings yet.{" "}
                        <Link to="/windows/booking" className="text-blue-600 hover:underline">
                          Schedule a class
                        </Link>{" "}
                        on a Windows-served room to create one.
                      </>
                    ) : (
                      "No recordings match the current filters."
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {selected && (
        <PlayerModal recording={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}

function RecordingRow({ r, devices, onPlay, onDelete }) {
  const room = r.scheduledClass?.roomNumber || r.roomNumber || "?";
  const title = r.title || r.scheduledClass?.title || "—";
  const courseName = r.scheduledClass?.courseName;
  const sourceDevice = devices.find((d) => String(d.roomNumber) === String(room));
  const status = (r.status || "").toLowerCase();
  const bytes = r.mergedFileSize || r.fileSize || 0;

  return (
    <tr className="border-b border-slate-100 hover:bg-slate-50">
      <td className="py-2 px-3 max-w-xs">
        <div className="font-medium text-slate-800 truncate">{title}</div>
        {courseName && (
          <div className="text-xs text-slate-500 truncate">{courseName}</div>
        )}
      </td>
      <td className="py-2 px-3">
        {sourceDevice ? (
          <Link
            to={`/windows/devices/${sourceDevice.deviceId}/remote`}
            className="text-blue-600 hover:underline text-xs flex items-center gap-1"
          >
            Room {room} <ChevronRight size={12} />
          </Link>
        ) : (
          <span className="text-xs">Room {room}</span>
        )}
      </td>
      <td className="py-2 px-3 text-xs">
        {r.recordingStart ? new Date(r.recordingStart).toLocaleString() : "—"}
      </td>
      <td className="py-2 px-3 font-mono text-xs">{formatDuration(r.duration)}</td>
      <td className="py-2 px-3 text-xs">{formatBytes(bytes)}</td>
      <td className="py-2 px-3"><StatusBadge status={r.status} mergeStatus={r.mergeStatus} /></td>
      <td className="py-2 px-3">
        <div className="flex items-center gap-2">
          {r.mergedVideoUrl ? (
            <>
              <button
                onClick={onPlay}
                className="text-xs flex items-center gap-1 px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded"
                title="Play in modal"
              >
                <Play size={12} /> Play
              </button>
              <a
                href={r.mergedVideoUrl}
                download
                target="_blank"
                rel="noopener noreferrer"
                className="text-slate-500 hover:text-slate-800"
                title="Download"
              >
                <Download size={14} />
              </a>
            </>
          ) : (
            <span className="text-xs text-slate-400">—</span>
          )}
          {/* Delete is always available regardless of merge state — orphan
              "merging" rows from killed recordings should also be cleanable.
              The confirmation dialog (in handleDelete) covers operator safety. */}
          <button
            onClick={onDelete}
            className="text-slate-400 hover:text-red-600 ml-auto"
            title="Delete recording"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </td>
    </tr>
  );
}

function StatusBadge({ status, mergeStatus }) {
  const s = (status || "").toLowerCase();
  const cfg = {
    recording: { cls: "bg-blue-100 text-blue-700", icon: Radio, label: "Recording" },
    merging:   { cls: "bg-yellow-100 text-yellow-700", icon: Loader2, label: "Merging" },
    completed: { cls: "bg-green-100 text-green-700", icon: CheckCircle2, label: "Completed" },
    failed:    { cls: "bg-red-100 text-red-700", icon: XCircle, label: "Failed" },
  };
  const c = cfg[s] || { cls: "bg-slate-100 text-slate-600", icon: Clock, label: status || "?" };
  const Icon = c.icon;
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full ${c.cls}`}>
      <Icon size={10} className={s === "merging" || s === "recording" ? "animate-pulse" : ""} />
      {c.label}
      {mergeStatus && mergeStatus !== "ready" && s !== "merging" && (
        <span className="text-[9px] opacity-70 ml-1">· {mergeStatus}</span>
      )}
    </span>
  );
}

function PlayerModal({ recording, onClose }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="relative w-full max-w-4xl mx-4 bg-gray-900 rounded-2xl overflow-hidden shadow-2xl">
        <div className="flex items-center justify-between px-5 py-3 bg-gray-950 border-b border-gray-800">
          <h2 className="text-white font-medium text-sm">
            {recording.title || recording.scheduledClass?.title || "Recording"}
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white px-2 py-1"
          >
            ✕
          </button>
        </div>
        <div className="aspect-video bg-black">
          <video
            src={recording.mergedVideoUrl}
            controls
            autoPlay
            className="w-full h-full"
            preload="metadata"
          />
        </div>
        <div className="px-5 py-2 bg-gray-950 text-[11px] text-gray-500 border-t border-gray-800 flex items-center justify-between">
          <span>
            Duration: {formatDuration(recording.duration)} · Size: {formatBytes(recording.mergedFileSize || recording.fileSize)}
          </span>
          <a
            href={recording.mergedVideoUrl}
            download
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-400 hover:underline flex items-center gap-1"
          >
            <Download size={12} /> Download
          </a>
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
