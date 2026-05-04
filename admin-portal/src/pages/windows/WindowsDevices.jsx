import { useEffect, useState } from "react";
import { winDevices } from "../../services/windowsApi";

export default function WindowsDevices() {
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedDevice, setSelectedDevice] = useState(null);

  async function load() {
    try {
      setLoading(true);
      const data = await winDevices.list();
      setDevices(data.devices || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const interval = setInterval(load, 30000); // Refresh every 30s
    return () => clearInterval(interval);
  }, []);

  async function sendCommand(deviceId, command, params = {}) {
    try {
      await winDevices.issueCommand(deviceId, command, params);
      alert(`Command "${command}" queued for device.`);
    } catch (e) {
      alert(`Failed: ${e.message}`);
    }
  }

  function statusBadge(device) {
    if (!device.isOnline) return <span className="badge badge-offline">Offline</span>;
    if (device.isRecording) return <span className="badge badge-recording">Recording</span>;
    return <span className="badge badge-online">Online</span>;
  }

  function licenseBadge(device) {
    const tier = device.licenseTier;
    const status = device.licenseStatus;
    if (status === "active") return <span className="badge badge-license">{tier}</span>;
    if (status === "expired") return <span className="badge badge-warning">Expired</span>;
    if (status === "revoked") return <span className="badge badge-danger">Revoked</span>;
    return <span className="badge badge-muted">Unlicensed</span>;
  }

  if (loading) return <div className="page-loading">Loading Windows devices...</div>;

  return (
    <div className="page-windows-devices">
      <div className="page-header">
        <h1>Windows Devices</h1>
        <p className="text-muted">
          {devices.length} device{devices.length !== 1 ? "s" : ""} registered
        </p>
        <button className="btn btn-secondary" onClick={load}>
          Refresh
        </button>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="device-grid">
        {devices.map((d) => (
          <div key={d._id} className="device-card">
            <div className="device-card-header">
              <span className="device-icon">🖥️</span>
              <div>
                <h3>{d.name || `Room ${d.roomNumber}`}</h3>
                <small>Room {d.roomNumber} · {d.deviceId.substring(0, 16)}...</small>
              </div>
              {statusBadge(d)}
            </div>

            <div className="device-card-body">
              <div className="metric-row">
                <span>Version:</span>
                <span>{d.appVersionName || "—"}</span>
              </div>
              <div className="metric-row">
                <span>License:</span>
                {licenseBadge(d)}
              </div>
              <div className="metric-row">
                <span>Last seen:</span>
                <span>{d.lastHeartbeat ? new Date(d.lastHeartbeat).toLocaleString() : "Never"}</span>
              </div>
              {d.health?.cpu && (
                <div className="metric-row">
                  <span>CPU:</span>
                  <span>
                    {d.health.cpu.usagePercent ?? "?"}%{" "}
                    {d.health.cpu.temperature && `(${d.health.cpu.temperature}°C)`}
                  </span>
                </div>
              )}
              {d.health?.disk && (
                <div className="metric-row">
                  <span>Disk free:</span>
                  <span>{d.health.disk.freeGB?.toFixed(1) ?? "?"} GB</span>
                </div>
              )}
              {d.health?.recording && (
                <div className="metric-row">
                  <span>Chunks:</span>
                  <span>
                    {d.health.recording.chunksUploaded ?? 0} / {d.health.recording.chunksWritten ?? 0}
                  </span>
                </div>
              )}
            </div>

            <div className="device-card-actions">
              <button onClick={() => setSelectedDevice(d)}>Details</button>
              <button onClick={() => sendCommand(d.deviceId, "pull_logs")}>Logs</button>
              <button onClick={() => sendCommand(d.deviceId, "restart_service")}>Restart Service</button>
            </div>
          </div>
        ))}
      </div>

      {selectedDevice && (
        <DeviceDetailModal device={selectedDevice} onClose={() => setSelectedDevice(null)} />
      )}
    </div>
  );
}

function DeviceDetailModal({ device, onClose }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{device.name}</h2>
          <button onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          <pre>{JSON.stringify(device, null, 2)}</pre>
        </div>
      </div>
    </div>
  );
}
