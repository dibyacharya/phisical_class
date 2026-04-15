import { useState, useEffect } from "react";
import { Video, Eye, EyeOff, Trash2, Clock, HardDrive, Play, X, Download } from "lucide-react";
import api from "../services/api";

const BACKEND_URL = import.meta.env.VITE_API_BASE_URL?.replace("/api", "") || "http://localhost:5020";

function formatDuration(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s}s`;
}

function formatSize(bytes) {
  if (bytes >= 1_000_000_000) return (bytes / 1_000_000_000).toFixed(1) + " GB";
  if (bytes >= 1_000_000) return (bytes / 1_000_000).toFixed(0) + " MB";
  return (bytes / 1_000).toFixed(0) + " KB";
}

const statusColors = {
  recording: "bg-red-100 text-red-700",
  uploading: "bg-yellow-100 text-yellow-700",
  completed: "bg-green-100 text-green-700",
  failed: "bg-gray-100 text-gray-500",
};

export default function Recordings() {
  const [recordings, setRecordings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [playingRec, setPlayingRec] = useState(null);

  const fetchRecordings = () => {
    api.get("/recordings").then((r) => { setRecordings(r.data); setLoading(false); }).catch(() => setLoading(false));
  };

  useEffect(() => { fetchRecordings(); }, []);

  const togglePublish = async (id) => {
    try {
      await api.put(`/recordings/${id}/toggle-publish`);
      fetchRecordings();
    } catch (err) {
      alert("Failed: " + (err.response?.data?.error || err.message));
    }
  };

  const handleDelete = async (id) => {
    if (!confirm("Delete this recording?")) return;
    try {
      await api.delete(`/recordings/${id}`);
      fetchRecordings();
    } catch (err) {
      alert("Delete failed: " + (err.response?.data?.error || err.message));
    }
  };

  const getVideoUrl = (rec) => {
    if (!rec.videoUrl) return null;
    // If it starts with http, use as-is; otherwise prepend backend URL
    if (rec.videoUrl.startsWith("http")) return rec.videoUrl;
    return `${BACKEND_URL}${rec.videoUrl}`;
  };

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-800 mb-6">Class Recordings</h2>

      {loading ? (
        <div className="text-center text-gray-400 py-12">Loading...</div>
      ) : recordings.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border p-12 text-center text-gray-400">
          <Video size={48} className="mx-auto mb-3 opacity-50" />
          <p>No recordings yet. Schedule a class and the device will auto-record.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {recordings.map((rec) => {
            const videoUrl = getVideoUrl(rec);
            return (
              <div key={rec._id} className="bg-white rounded-xl shadow-sm border overflow-hidden">
                {/* Video thumbnail / play area */}
                <div
                  className={`bg-gray-900 h-44 flex items-center justify-center relative group ${videoUrl && rec.status === "completed" ? "cursor-pointer" : ""}`}
                  onClick={() => videoUrl && rec.status === "completed" && setPlayingRec(rec)}
                >
                  <Video size={48} className="text-gray-600" />
                  {videoUrl && rec.status === "completed" && (
                    <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                      <div className="w-16 h-16 rounded-full bg-white/90 flex items-center justify-center shadow-lg">
                        <Play size={28} className="text-indigo-600 ml-1" fill="currentColor" />
                      </div>
                    </div>
                  )}
                  <span className={`absolute top-3 left-3 text-xs px-2 py-1 rounded-full font-medium ${statusColors[rec.status]}`}>
                    {rec.status}
                  </span>
                  {rec.isPublished && (
                    <span className="absolute top-3 right-3 text-xs px-2 py-1 rounded-full bg-blue-100 text-blue-700 font-medium">
                      Published
                    </span>
                  )}
                  {rec.status === "recording" && (
                    <span className="absolute bottom-3 left-3 flex items-center gap-1.5 text-xs text-red-400">
                      <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                      Recording in progress...
                    </span>
                  )}
                  {rec.status === "uploading" && (
                    <span className="absolute bottom-3 left-3 text-xs text-yellow-400">
                      Uploading to server...
                    </span>
                  )}
                </div>

                <div className="p-4">
                  <h4 className="font-semibold text-gray-800 truncate">{rec.title}</h4>
                  {rec.scheduledClass && (
                    <p className="text-sm text-gray-500 mt-1">
                      {rec.scheduledClass.courseCode} - {rec.scheduledClass.courseName}
                    </p>
                  )}
                  <div className="flex items-center gap-4 mt-3 text-xs text-gray-400">
                    <span className="flex items-center gap-1"><Clock size={12} /> {formatDuration(rec.duration)}</span>
                    <span className="flex items-center gap-1"><HardDrive size={12} /> {formatSize(rec.fileSize)}</span>
                  </div>
                  {rec.scheduledClass && (
                    <p className="text-xs text-gray-400 mt-1">
                      Room {rec.scheduledClass.roomNumber} | {new Date(rec.scheduledClass.date).toLocaleDateString("en-IN", { day: "numeric", month: "short" })} {rec.scheduledClass.startTime}
                    </p>
                  )}

                  <div className="flex items-center gap-2 mt-4 pt-3 border-t flex-wrap">
                    {videoUrl && rec.status === "completed" && (
                      <>
                        <button
                          onClick={() => setPlayingRec(rec)}
                          className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-indigo-50 text-indigo-600 hover:bg-indigo-100 transition"
                        >
                          <Play size={14} /> Play
                        </button>
                        <a
                          href={videoUrl}
                          download={`${rec.title || "recording"}.mp4`}
                          className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-green-50 text-green-600 hover:bg-green-100 transition"
                        >
                          <Download size={14} /> Download
                        </a>
                      </>
                    )}
                    <button
                      onClick={() => togglePublish(rec._id)}
                      className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                        rec.isPublished ? "bg-amber-50 text-amber-600 hover:bg-amber-100" : "bg-blue-50 text-blue-600 hover:bg-blue-100"
                      }`}
                    >
                      {rec.isPublished ? <><EyeOff size={14} /> Unpublish</> : <><Eye size={14} /> Publish</>}
                    </button>
                    <button
                      onClick={() => handleDelete(rec._id)}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-red-50 text-red-500 hover:bg-red-100 transition ml-auto"
                    >
                      <Trash2 size={14} /> Delete
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Video Player Modal */}
      {playingRec && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={() => setPlayingRec(null)}>
          <div className="bg-gray-900 rounded-2xl overflow-hidden max-w-4xl w-full shadow-2xl" onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3 bg-gray-800">
              <div>
                <h3 className="text-white font-semibold">{playingRec.title}</h3>
                {playingRec.scheduledClass && (
                  <p className="text-gray-400 text-sm">
                    {playingRec.scheduledClass.courseCode} - {playingRec.scheduledClass.courseName} | Room {playingRec.scheduledClass.roomNumber}
                  </p>
                )}
              </div>
              <button
                onClick={() => setPlayingRec(null)}
                className="text-gray-400 hover:text-white p-1 rounded-lg hover:bg-gray-700 transition"
              >
                <X size={22} />
              </button>
            </div>
            {/* Video */}
            <div className="bg-black">
              <video
                key={playingRec._id}
                src={getVideoUrl(playingRec)}
                controls
                className="w-full max-h-[75vh]"
                controlsList=""
                ref={(el) => {
                  if (el) {
                    el.volume = 1.0;
                    el.muted = false;
                    el.play().catch(() => {});
                  }
                }}
              >
                Your browser does not support the video tag.
              </video>
            </div>
            {/* Footer info */}
            <div className="flex items-center justify-between px-5 py-3 bg-gray-800">
              <div className="flex items-center gap-6 text-xs text-gray-400">
                <span className="flex items-center gap-1"><Clock size={12} /> {formatDuration(playingRec.duration)}</span>
                <span className="flex items-center gap-1"><HardDrive size={12} /> {formatSize(playingRec.fileSize)}</span>
                {playingRec.scheduledClass && (
                  <span>
                    {new Date(playingRec.scheduledClass.date).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })} | {playingRec.scheduledClass.startTime} - {playingRec.scheduledClass.endTime}
                  </span>
                )}
              </div>
              <a
                href={getVideoUrl(playingRec)}
                download={`${playingRec.title || "recording"}.mp4`}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-green-600 text-white hover:bg-green-500 transition"
              >
                <Download size={16} /> Download
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
