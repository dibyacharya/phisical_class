import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, ClipboardList, Video, QrCode, Play, X, Clock, HardDrive, CheckCircle, XCircle, Download } from "lucide-react";
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

export default function CourseDetail({ user }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const [tab, setTab] = useState("attendance");
  const [attendance, setAttendance] = useState(null);
  const [recordings, setRecordings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [playingRec, setPlayingRec] = useState(null);

  // QR scan state
  const [scanResult, setScanResult] = useState(null);
  const [scanToken, setScanToken] = useState("");
  const [scanning, setScanning] = useState(false);

  const isTeacher = user?.role === "teacher";

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api.get(`/courses/${id}/attendance`).then((r) => setAttendance(r.data)).catch(() => {}),
      api.get(`/courses/${id}/recordings`).then((r) => setRecordings(r.data)).catch(() => {}),
    ]).finally(() => setLoading(false));
  }, [id]);

  const getVideoUrl = (rec) => {
    if (!rec.videoUrl) return null;
    if (rec.videoUrl.startsWith("http")) return rec.videoUrl;
    return `${BACKEND_URL}${rec.videoUrl}`;
  };

  const handleScanSubmit = async () => {
    if (!scanToken.trim()) return;
    setScanning(true);
    try {
      const { data } = await api.post("/attendance/verify", { token: scanToken.trim() });
      setScanResult({ success: true, ...data });
      setScanToken("");
    } catch (err) {
      setScanResult({ success: false, error: err.response?.data?.error || "Verification failed" });
    } finally {
      setScanning(false);
    }
  };

  const tabs = isTeacher
    ? [{ key: "recordings", label: "Recordings", icon: Video }]
    : [
        { key: "attendance", label: "Attendance", icon: ClipboardList },
        { key: "recordings", label: "Recordings", icon: Video },
        { key: "scan", label: "Scan QR", icon: QrCode },
      ];

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-3">
          <button onClick={() => navigate("/")} className="flex items-center gap-1.5 text-gray-500 hover:text-gray-800 text-sm mb-2 transition">
            <ArrowLeft size={16} /> Back to Courses
          </button>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-4 py-6">
        {/* Tabs */}
        <div className="flex gap-2 mb-6">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition ${
                tab === t.key ? "bg-purple-600 text-white" : "bg-white text-gray-600 border hover:bg-gray-50"
              }`}
            >
              <t.icon size={16} /> {t.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="text-center text-gray-400 py-12">Loading...</div>
        ) : (
          <>
            {/* Attendance Tab */}
            {tab === "attendance" && attendance && (
              <div>
                <div className="flex gap-4 mb-6">
                  <div className="bg-white rounded-xl border p-4 flex-1 text-center">
                    <div className="text-2xl font-bold text-purple-600">{attendance.attended}</div>
                    <div className="text-xs text-gray-500">{attendance.isTeacherView ? "Total Scans" : "Present"}</div>
                  </div>
                  <div className="bg-white rounded-xl border p-4 flex-1 text-center">
                    <div className="text-2xl font-bold text-gray-600">{attendance.totalClasses}</div>
                    <div className="text-xs text-gray-500">Total Classes</div>
                  </div>
                  <div className="bg-white rounded-xl border p-4 flex-1 text-center">
                    <div className="text-2xl font-bold text-green-600">
                      {attendance.isTeacherView
                        ? (attendance.totalClasses > 0 ? Math.round(attendance.attended / attendance.totalClasses) : 0) + " avg"
                        : (attendance.totalClasses > 0 ? Math.round((attendance.attended / attendance.totalClasses) * 100) : 0) + "%"
                      }
                    </div>
                    <div className="text-xs text-gray-500">{attendance.isTeacherView ? "Avg/Class" : "Percentage"}</div>
                  </div>
                </div>

                {attendance.records.length === 0 ? (
                  <div className="bg-white rounded-xl border p-8 text-center text-gray-400">No attendance records yet.</div>
                ) : attendance.isTeacherView ? (
                  /* Teacher View: show per-class breakdown with all students */
                  <div className="space-y-4">
                    {attendance.records.map((r, i) => (
                      <div key={i} className="bg-white rounded-xl border overflow-hidden">
                        <div className="px-4 py-3 bg-gray-50 flex justify-between items-center">
                          <div>
                            <span className="font-semibold text-gray-800">{r.classTitle}</span>
                            <span className="text-gray-500 text-sm ml-2">
                              {new Date(r.date).toLocaleDateString("en-IN", { day: "numeric", month: "short" })} {r.startTime} | Room {r.roomNumber}
                            </span>
                          </div>
                          <span className="bg-purple-100 text-purple-700 text-xs font-medium px-2 py-1 rounded-full">
                            {r.totalPresent} present
                          </span>
                        </div>
                        {r.attendees.length > 0 ? (
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="border-b">
                                <th className="text-left px-4 py-2 text-xs text-gray-500 uppercase">#</th>
                                <th className="text-left px-4 py-2 text-xs text-gray-500 uppercase">Student</th>
                                <th className="text-left px-4 py-2 text-xs text-gray-500 uppercase">Roll No.</th>
                                <th className="text-left px-4 py-2 text-xs text-gray-500 uppercase">Scanned At</th>
                                <th className="text-left px-4 py-2 text-xs text-gray-500 uppercase">Status</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y">
                              {r.attendees.map((a, j) => (
                                <tr key={j} className="hover:bg-gray-50">
                                  <td className="px-4 py-2 text-gray-500">{j + 1}</td>
                                  <td className="px-4 py-2 text-gray-800">{a.name}</td>
                                  <td className="px-4 py-2 text-gray-600">{a.rollNumber}</td>
                                  <td className="px-4 py-2 text-gray-600">
                                    {new Date(a.scannedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
                                  </td>
                                  <td className="px-4 py-2">
                                    <span className="flex items-center gap-1 text-green-600 text-xs"><CheckCircle size={14} /> Verified</span>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        ) : (
                          <div className="p-4 text-center text-gray-400 text-sm">No students scanned for this class</div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  /* Student View: simple attendance list */
                  <div className="bg-white rounded-xl border overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="text-left px-4 py-3 text-xs text-gray-500 uppercase">Class</th>
                          <th className="text-left px-4 py-3 text-xs text-gray-500 uppercase">Date</th>
                          <th className="text-left px-4 py-3 text-xs text-gray-500 uppercase">Scanned At</th>
                          <th className="text-left px-4 py-3 text-xs text-gray-500 uppercase">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {attendance.records.map((r, i) => (
                          <tr key={i} className="hover:bg-gray-50">
                            <td className="px-4 py-3 text-gray-800">{r.classTitle}</td>
                            <td className="px-4 py-3 text-gray-600">
                              {new Date(r.date).toLocaleDateString("en-IN", { day: "numeric", month: "short" })} {r.startTime}
                            </td>
                            <td className="px-4 py-3 text-gray-600">
                              {new Date(r.scannedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
                            </td>
                            <td className="px-4 py-3">
                              <span className="flex items-center gap-1 text-green-600 text-xs"><CheckCircle size={14} /> Present</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* Recordings Tab */}
            {tab === "recordings" && (
              <div>
                {recordings.length === 0 ? (
                  <div className="bg-white rounded-xl border p-8 text-center text-gray-400">
                    <Video size={40} className="mx-auto mb-2 opacity-50" />
                    <p>No recordings available for this course.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {recordings.map((rec) => {
                      const videoUrl = getVideoUrl(rec);
                      return (
                        <div key={rec._id} className="bg-white rounded-xl border overflow-hidden">
                          <div
                            className="bg-gray-900 h-36 flex items-center justify-center relative cursor-pointer group"
                            onClick={() => videoUrl && setPlayingRec(rec)}
                          >
                            <Video size={36} className="text-gray-600" />
                            {videoUrl && (
                              <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                <div className="w-12 h-12 rounded-full bg-white/90 flex items-center justify-center">
                                  <Play size={20} className="text-purple-600 ml-0.5" fill="currentColor" />
                                </div>
                              </div>
                            )}
                          </div>
                          <div className="p-4">
                            <h4 className="font-semibold text-gray-800 text-sm truncate">{rec.title}</h4>
                            <div className="flex items-center gap-3 mt-2 text-xs text-gray-400">
                              <span className="flex items-center gap-1"><Clock size={12} /> {formatDuration(rec.duration)}</span>
                              <span className="flex items-center gap-1"><HardDrive size={12} /> {formatSize(rec.fileSize)}</span>
                            </div>
                            {rec.scheduledClass && (
                              <p className="text-xs text-gray-400 mt-1">
                                {new Date(rec.scheduledClass.date).toLocaleDateString("en-IN", { day: "numeric", month: "short" })} | {rec.scheduledClass.startTime}
                              </p>
                            )}
                            <div className="flex gap-2 mt-3">
                              {videoUrl && (
                                <>
                                  <button onClick={() => setPlayingRec(rec)} className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-purple-50 text-purple-600 hover:bg-purple-100 transition">
                                    <Play size={14} /> Play
                                  </button>
                                  <a href={videoUrl} download={`${rec.title}.mp4`} className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-green-50 text-green-600 hover:bg-green-100 transition">
                                    <Download size={14} /> Download
                                  </a>
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Scan QR Tab */}
            {tab === "scan" && !isTeacher && (
              <div className="bg-white rounded-xl border p-6 max-w-md mx-auto text-center">
                <QrCode size={48} className="mx-auto mb-4 text-purple-300" />
                <h3 className="text-lg font-semibold mb-2">Mark Attendance</h3>
                <p className="text-sm text-gray-500 mb-4">Paste the QR token or scan from the Scan QR page</p>
                <div className="flex gap-2">
                  <input
                    value={scanToken}
                    onChange={(e) => setScanToken(e.target.value)}
                    className="flex-1 px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-purple-500 outline-none"
                    placeholder="Paste attendance token..."
                  />
                  <button
                    onClick={handleScanSubmit}
                    disabled={scanning || !scanToken.trim()}
                    className="bg-purple-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-purple-700 transition disabled:opacity-50"
                  >
                    {scanning ? "..." : "Submit"}
                  </button>
                </div>
                {scanResult && (
                  <div className={`mt-4 p-3 rounded-lg text-sm ${scanResult.success ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>
                    {scanResult.success ? (
                      <div className="flex items-center gap-2 justify-center">
                        <CheckCircle size={18} /> Attendance marked for {scanResult.className}
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 justify-center">
                        <XCircle size={18} /> {scanResult.error}
                      </div>
                    )}
                  </div>
                )}
                <button
                  onClick={() => navigate("/scan")}
                  className="mt-4 text-purple-600 text-sm hover:underline"
                >
                  Open full QR Scanner instead
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Video Player Modal */}
      {playingRec && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={() => setPlayingRec(null)}>
          <div className="bg-gray-900 rounded-2xl overflow-hidden max-w-3xl w-full shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-2 bg-gray-800">
              <h3 className="text-white font-semibold text-sm">{playingRec.title}</h3>
              <button onClick={() => setPlayingRec(null)} className="text-gray-400 hover:text-white p-1"><X size={20} /></button>
            </div>
            <video
              key={playingRec._id}
              src={getVideoUrl(playingRec)}
              controls
              className="w-full max-h-[70vh]"
              ref={(el) => { if (el) { el.volume = 1.0; el.muted = false; el.play().catch(() => {}); } }}
            />
            <div className="flex items-center justify-between px-4 py-2 bg-gray-800">
              <div className="flex items-center gap-4 text-xs text-gray-400">
                <span><Clock size={12} className="inline mr-1" />{formatDuration(playingRec.duration)}</span>
                <span><HardDrive size={12} className="inline mr-1" />{formatSize(playingRec.fileSize)}</span>
              </div>
              <a href={getVideoUrl(playingRec)} download className="flex items-center gap-1 text-sm text-green-400 hover:text-green-300">
                <Download size={14} /> Download
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
