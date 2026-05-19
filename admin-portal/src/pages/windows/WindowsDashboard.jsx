import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import {
  Cpu, Video, KeyRound, CalendarPlus, Activity, Radio,
  HardDrive, RefreshCw, ChevronRight, Wifi,
  AlertTriangle,
} from "lucide-react";
import { winDevices, winRecordings, winLicenses, winLiveWatch } from "../../services/windowsApi";
import api from "../../services/api";

/**
 * Windows-pipeline overview dashboard. Mirrors the Android Dashboard's
 * structure (KPI cards + recent classes) but with Windows-specific signals:
 *   - Devices online / recording
 *   - Live-watch sessions active right now
 *   - Disk warnings across the fleet
 *   - Active license count + annual revenue
 *   - Recent scheduled classes filtered to Windows-served rooms
 */
export default function WindowsDashboard() {
  const [devices, setDevices] = useState([]);
  const [recordings, setRecordings] = useState([]);
  const [licenses, setLicenses] = useState([]);
  const [liveActive, setLiveActive] = useState([]);
  const [recentClasses, setRecentClasses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefresh, setLastRefresh] = useState(null);

  const fetchAll = useCallback(async () => {
    setRefreshing(true);
    try {
      const [d, r, l, live, classesRes] = await Promise.all([
        winDevices.list().catch(() => ({ devices: [] })),
        winRecordings.list({ limit: 50 }).catch(() => []),
        winLicenses.list().catch(() => []),
        winLiveWatch.active().catch(() => ({ sessions: [] })),
        api.get("/classes").then((r) => r.data).catch(() => []),
      ]);
      setDevices(d.devices || []);
      setRecordings(Array.isArray(r) ? r : r.recordings || []);
      setLicenses(Array.isArray(l) ? l : []);
      setLiveActive(live.sessions || []);
      // Filter classes scheduled in rooms that have a Windows device.
      const winRooms = new Set((d.devices || []).map((x) => String(x.roomNumber)));
      const filtered = (classesRes || []).filter((c) =>
        winRooms.has(String(c.roomNumber))
      );
      setRecentClasses(filtered.slice(0, 8));
      setLastRefresh(new Date());
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
    const t = setInterval(fetchAll, 60_000);
    return () => clearInterval(t);
  }, [fetchAll]);

  // ── Derived stats ────────────────────────────────────
  const onlineCount = devices.filter((d) => d.isOnline).length;
  const recordingCount = devices.filter((d) => d.health?.recording?.isRecording).length;
  const diskWarnCount = devices.filter((d) => {
    const s = d.health?.diskGovernor?.state;
    return s === "Warn" || s === "Cleanup" || s === "HardStop";
  }).length;
  const activeLicenses = licenses.filter((x) => x.status === "active");

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="animate-spin text-blue-500" size={32} />
        <span className="ml-3 text-slate-500">Loading Windows dashboard...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Windows Edition Dashboard</h1>
          <p className="text-sm text-slate-500">
            {lastRefresh && `Updated ${lastRefresh.toLocaleTimeString()}`} · Auto-refresh 60s
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

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <Kpi
          icon={Cpu}
          label="Devices"
          value={devices.length}
          sub={`${onlineCount} online`}
          color="blue"
          to="/windows/devices"
        />
        <Kpi
          icon={Video}
          label="Recording now"
          value={recordingCount}
          color={recordingCount > 0 ? "emerald" : "slate"}
          to="/windows/analytics"
        />
        <Kpi
          icon={Radio}
          label="Live sessions"
          value={liveActive.length}
          color={liveActive.length > 0 ? "red" : "slate"}
          to="/windows/analytics"
        />
        <Kpi
          icon={HardDrive}
          label="Disk warnings"
          value={diskWarnCount}
          color={diskWarnCount > 0 ? "amber" : "emerald"}
          to="/windows/devices"
        />
        <Kpi
          icon={KeyRound}
          label="Active licenses"
          value={activeLicenses.length}
          sub={`${licenses.length} total`}
          color="violet"
          to="/windows/licenses"
        />
      </div>

      {/* Active live-watch alert */}
      {liveActive.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-center gap-3">
          <Radio size={18} className="text-red-600 animate-pulse" />
          <div className="flex-1 text-sm">
            <span className="font-semibold text-red-800">
              {liveActive.length} live-watch session{liveActive.length === 1 ? "" : "s"} active right now
            </span>
            <span className="text-red-700 ml-2">
              — admins can subscribe via Devices → Manage → Live tab
            </span>
          </div>
          <Link
            to="/windows/analytics"
            className="text-xs px-3 py-1.5 bg-white border border-red-300 rounded text-red-700 hover:bg-red-100"
          >
            View
          </Link>
        </div>
      )}

      {/* Disk warnings alert */}
      {diskWarnCount > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-center gap-3">
          <AlertTriangle size={18} className="text-amber-600" />
          <div className="flex-1 text-sm">
            <span className="font-semibold text-amber-800">
              {diskWarnCount} device{diskWarnCount === 1 ? "" : "s"} reporting disk pressure
            </span>
            <span className="text-amber-700 ml-2">
              — DiskGovernor may auto-purge or refuse new recordings.
            </span>
          </div>
          <Link
            to="/windows/devices"
            className="text-xs px-3 py-1.5 bg-white border border-amber-300 rounded text-amber-700 hover:bg-amber-100"
          >
            Inspect
          </Link>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Recent classes */}
        <div className="lg:col-span-2 bg-white border border-slate-200 rounded-xl">
          <div className="px-5 py-3 border-b border-slate-200 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-700">Recent Windows Classes</h3>
            <Link to="/windows/booking" className="text-xs text-blue-600 hover:underline">
              Schedule new
            </Link>
          </div>
          {recentClasses.length === 0 ? (
            <div className="p-10 text-center text-sm text-slate-400">
              No classes scheduled for Windows rooms yet. Use{" "}
              <Link to="/windows/booking" className="text-blue-600 hover:underline">
                Booking
              </Link>{" "}
              to create one.
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {recentClasses.map((cls) => (
                <div
                  key={cls._id}
                  className="p-3 px-5 flex items-center justify-between hover:bg-slate-50"
                >
                  <div className="min-w-0">
                    <p className="font-medium text-slate-800 truncate">{cls.title}</p>
                    <p className="text-xs text-slate-500">
                      {cls.courseCode ? `${cls.courseCode} · ` : ""}
                      {cls.courseName} · Room {cls.roomNumber}
                    </p>
                  </div>
                  <div className="text-right ml-4 flex-shrink-0">
                    <p className="text-xs text-slate-600">
                      {new Date(cls.date).toLocaleDateString("en-IN", {
                        day: "numeric",
                        month: "short",
                      })}
                    </p>
                    <p className="text-[10px] text-slate-400">
                      {cls.startTime} – {cls.endTime}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Quick actions */}
        <div className="bg-white border border-slate-200 rounded-xl">
          <div className="px-5 py-3 border-b border-slate-200">
            <h3 className="text-sm font-semibold text-slate-700">Quick actions</h3>
          </div>
          <div className="p-3 space-y-1">
            <QuickAction to="/windows/booking" icon={CalendarPlus} label="Schedule a class" />
            <QuickAction to="/windows/devices" icon={Cpu} label="View device fleet" />
            <QuickAction to="/windows/analytics" icon={Activity} label="Fleet analytics" />
            <QuickAction to="/windows/recordings" icon={Video} label="Browse recordings" />
            <QuickAction to="/windows/licenses" icon={KeyRound} label="Manage licenses" />
          </div>
        </div>
      </div>
    </div>
  );
}

function Kpi({ icon: Icon, label, value, sub, color, to }) {
  const colors = {
    blue: "border-blue-300 bg-blue-50 text-blue-700",
    emerald: "border-emerald-300 bg-emerald-50 text-emerald-700",
    amber: "border-amber-300 bg-amber-50 text-amber-700",
    red: "border-red-300 bg-red-50 text-red-700",
    slate: "border-slate-200 bg-slate-50 text-slate-700",
    violet: "border-violet-300 bg-violet-50 text-violet-700",
    cyan: "border-cyan-300 bg-cyan-50 text-cyan-700",
  };
  const cls = colors[color] || "border-slate-200 bg-white text-slate-700";
  const inner = (
    <div className={`border rounded-lg p-3 hover:shadow transition ${cls}`}>
      <div className="flex items-center justify-between text-[11px] uppercase tracking-wide">
        <span className="opacity-70">{label}</span>
        {Icon && <Icon size={14} />}
      </div>
      <div className="text-2xl font-bold mt-1">{value}</div>
      {sub && <div className="text-[11px] opacity-70 mt-0.5">{sub}</div>}
    </div>
  );
  return to ? <Link to={to}>{inner}</Link> : inner;
}

function QuickAction({ to, icon: Icon, label }) {
  return (
    <Link
      to={to}
      className="flex items-center gap-3 px-3 py-2 hover:bg-slate-50 rounded-lg group"
    >
      <Icon size={16} className="text-slate-400 group-hover:text-blue-500" />
      <span className="text-sm text-slate-700 flex-1">{label}</span>
      <ChevronRight size={14} className="text-slate-300 group-hover:text-slate-500" />
    </Link>
  );
}
