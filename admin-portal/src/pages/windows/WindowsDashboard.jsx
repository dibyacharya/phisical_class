import { useEffect, useState } from "react";
import { winDevices, winRecordings, winLicenses } from "../../services/windowsApi";

export default function WindowsDashboard() {
  const [stats, setStats] = useState({ devices: 0, online: 0, recordings: 0, activeLicenses: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [d, r, l] = await Promise.all([
          winDevices.list(),
          winRecordings.list({ limit: 50 }),
          winLicenses.list(),
        ]);
        const devices = d.devices || [];
        const recordings = Array.isArray(r) ? r : [];
        const licenses = l || [];
        setStats({
          devices: devices.length,
          online: devices.filter((x) => x.isOnline).length,
          recording: devices.filter((x) => x.isRecording).length,
          recordings: recordings.length,
          activeLicenses: licenses.filter((x) => x.status === "active").length,
          totalRevenueINR: licenses
            .filter((x) => x.status === "active")
            .reduce((sum, x) => sum + (x.pricePerYearINR || 0), 0),
        });
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return <div className="page-loading">Loading...</div>;

  return (
    <div className="page-windows-dashboard">
      <div className="page-header">
        <h1>Windows Edition Dashboard</h1>
        <p className="text-muted">Overview of Windows fleet, recordings, and licenses</p>
      </div>

      <div className="stat-grid">
        <StatCard label="Windows Devices" value={stats.devices} sub={`${stats.online} online`} icon="🖥️" />
        <StatCard label="Currently Recording" value={stats.recording || 0} icon="🔴" />
        <StatCard label="Total Recordings" value={stats.recordings} icon="🎬" />
        <StatCard label="Active Licenses" value={stats.activeLicenses} icon="🔑" />
        <StatCard
          label="Annual Revenue (INR)"
          value={`₹${(stats.totalRevenueINR || 0).toLocaleString()}`}
          icon="💰"
        />
      </div>

      <div className="quick-actions">
        <h2>Quick actions</h2>
        <a href="#/windows/booking" className="action-link">📅 Schedule a class on a Windows room</a>
        <a href="#/windows/devices" className="action-link">📊 View device fleet</a>
        <a href="#/windows/licenses" className="action-link">🔑 Manage licenses</a>
        <a href="#/windows/recordings" className="action-link">📺 Browse recordings</a>
      </div>
    </div>
  );
}

function StatCard({ label, value, sub, icon }) {
  return (
    <div className="stat-card">
      <div className="stat-icon">{icon}</div>
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}
