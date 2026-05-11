import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  BookOpen, Video, Users, CalendarCheck, RefreshCw, Trash2,
} from "lucide-react";
import api from "../services/api";

const AUTO_REFRESH_MS = 30_000; // 30s polling so deletes elsewhere reflect quickly

export default function Dashboard() {
  const [stats, setStats] = useState(null);
  const [classes, setClasses] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefresh, setLastRefresh] = useState(null);
  const [cleanupRunning, setCleanupRunning] = useState(false);
  const navigate = useNavigate();

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const [statsRes, classesRes] = await Promise.all([
        api.get("/classes/dashboard").catch(() => null),
        api.get("/classes").catch(() => null),
      ]);
      if (statsRes) setStats(statsRes.data);
      if (classesRes) {
        // Skip rows whose course / teacher populated to null (the underlying
        // refs were hard-deleted). Without this we'd render "—" rows for
        // bookings that should no longer show.
        const valid = (classesRes.data || []).filter(
          (c) => c && c._id && (c.title || c.courseName)
        );
        setClasses(valid.slice(0, 5));
      }
      setLastRefresh(new Date());
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, AUTO_REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);

  async function cleanupOrphans() {
    if (
      !confirm(
        "Purge orphan Recording / Attendance rows whose parent class no longer exists?\n\n" +
        "Use this when dashboard counts look inflated from old test data. " +
        "Live classes are NEVER touched — only orphans (records whose " +
        "scheduledClass reference points to a deleted or missing row).\n\nContinue?"
      )
    ) return;
    setCleanupRunning(true);
    try {
      const r = await api.post("/classes/cleanup-orphans");
      const d = r.data;
      alert(
        `Cleanup done.\n\n` +
        `Live classes: ${d.liveClasses}\n` +
        `Orphan recordings deleted: ${d.deleted.recordings}\n` +
        `Orphan attendance rows deleted: ${d.deleted.attendances}`
      );
      load();
    } catch (e) {
      alert("Cleanup failed: " + (e.response?.data?.error || e.message));
    } finally {
      setCleanupRunning(false);
    }
  }

  const statCards = [
    {
      label: "Total Classes",
      value: stats?.totalClasses ?? "—",
      icon: BookOpen,
      color: "bg-blue-500",
    },
    {
      label: "Recordings",
      value: stats?.totalRecordings ?? "—",
      icon: Video,
      color: "bg-emerald-500",
    },
    {
      label: "QR Scans",
      value: stats?.totalAttendanceScans ?? "—",
      icon: Users,
      color: "bg-purple-500",
    },
    {
      label: "Today's Classes",
      value: stats?.todayClasses ?? "—",
      icon: CalendarCheck,
      color: "bg-amber-500",
    },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">Dashboard</h2>
          <p className="text-xs text-slate-500">
            {lastRefresh && `Updated ${lastRefresh.toLocaleTimeString()}`} ·
            Auto-refresh every 30s
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={cleanupOrphans}
            disabled={cleanupRunning}
            className="text-xs px-3 py-1.5 border border-amber-300 text-amber-700 rounded-lg hover:bg-amber-50 disabled:opacity-50 flex items-center gap-1"
            title="Delete recordings/attendance rows whose parent class no longer exists"
          >
            <Trash2 size={14} />
            {cleanupRunning ? "Cleaning..." : "Cleanup orphans"}
          </button>
          <button
            onClick={load}
            disabled={refreshing}
            className="p-2 hover:bg-slate-100 rounded-lg disabled:opacity-50"
            title="Refresh now"
          >
            <RefreshCw
              size={18}
              className={refreshing ? "animate-spin" : ""}
            />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        {statCards.map(({ label, value, icon: Icon, color }) => (
          <div
            key={label}
            className="bg-white rounded-xl shadow-sm border p-6"
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">{label}</p>
                <p className="text-3xl font-bold text-gray-800 mt-1">
                  {value}
                </p>
              </div>
              <div className={`${color} p-3 rounded-lg`}>
                <Icon size={24} className="text-white" />
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-xl shadow-sm border">
        <div className="p-6 border-b">
          <h3 className="text-lg font-semibold">Recent Scheduled Classes</h3>
        </div>
        {classes.length === 0 ? (
          <div className="p-12 text-center text-gray-400">
            No classes scheduled yet. Go to "Booking" to create one.
          </div>
        ) : (
          <div className="divide-y">
            {classes.map((cls) => (
              <div
                key={cls._id}
                className="p-4 px-6 flex items-center justify-between hover:bg-gray-50 cursor-pointer"
                onClick={() => navigate(`/attendance/${cls._id}`)}
              >
                <div className="min-w-0">
                  <p className="font-medium text-gray-800 truncate">
                    {cls.title}
                  </p>
                  <p className="text-sm text-gray-500 truncate">
                    {cls.courseCode ? `${cls.courseCode} - ` : ""}
                    {cls.courseName || cls.course?.courseName || "—"} | Room{" "}
                    {cls.roomNumber}
                  </p>
                </div>
                <div className="text-right ml-4 flex-shrink-0">
                  <p className="text-sm text-gray-600">
                    {new Date(cls.date).toLocaleDateString("en-IN", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                  </p>
                  <p className="text-xs text-gray-400">
                    {cls.startTime} - {cls.endTime}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
