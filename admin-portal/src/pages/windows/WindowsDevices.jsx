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
              {d.detectedHardware && (
                <div className="metric-row">
                  <span>Hardware:</span>
                  <span>
                    {(d.detectedHardware.cameras?.length ?? 0)} cam ·{" "}
                    {(d.detectedHardware.microphones?.length ?? 0)} mic ·{" "}
                    {(d.detectedHardware.ramGB ?? 0)} GB RAM
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
  const hw = device.detectedHardware;
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{device.name}</h2>
          <button onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          {hw ? (
            <div className="device-hardware-section">
              <h3>Hardware Inventory</h3>
              <p className="text-muted" style={{ marginTop: "-8px", marginBottom: "12px" }}>
                Detected at install
                {hw.detectedAt ? ` · ${new Date(hw.detectedAt).toLocaleString()}` : ""}
              </p>

              <div className="hw-grid">
                <div className="hw-section">
                  <h4>Cameras ({hw.cameras?.length ?? 0})</h4>
                  {hw.cameras?.length > 0 ? (
                    <ul>{hw.cameras.map((c, i) => <li key={i}>{c}</li>)}</ul>
                  ) : (
                    <p className="text-muted">None detected</p>
                  )}
                </div>

                <div className="hw-section">
                  <h4>Microphones ({hw.microphones?.length ?? 0})</h4>
                  {hw.microphones?.length > 0 ? (
                    <ul>{hw.microphones.map((m, i) => <li key={i}>{m}</li>)}</ul>
                  ) : (
                    <p className="text-muted">None detected</p>
                  )}
                </div>

                <div className="hw-section">
                  <h4>Displays ({hw.displays?.length ?? 0})</h4>
                  {hw.displays?.length > 0 ? (
                    <ul>
                      {hw.displays.map((d, i) => (
                        <li key={i}>
                          {d.name} — {d.width}×{d.height} @ {d.refreshRate}Hz
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-muted">None detected</p>
                  )}
                  {hw.monitorCount > 0 && (
                    <p className="text-muted">{hw.monitorCount} monitor{hw.monitorCount !== 1 ? "s" : ""} connected</p>
                  )}
                </div>

                <div className="hw-section">
                  <h4>System</h4>
                  <table className="hw-system-table">
                    <tbody>
                      {hw.hostname &&      <tr><td>Hostname</td><td>{hw.hostname}</td></tr>}
                      {hw.hardwareModel && <tr><td>Model</td><td>{hw.hardwareModel}</td></tr>}
                      {hw.cpuModel &&      <tr><td>CPU</td><td>{hw.cpuModel} ({hw.cpuCores} cores / {hw.cpuLogical} threads)</td></tr>}
                      {hw.gpu &&           <tr><td>GPU</td><td>{hw.gpu}</td></tr>}
                      {hw.ramGB &&         <tr><td>RAM</td><td>{hw.ramGB} GB</td></tr>}
                      {hw.diskGB &&        <tr><td>Disk</td><td>{hw.diskGB} GB total · {hw.diskFreeGB} GB free</td></tr>}
                      {hw.osCaption &&     <tr><td>OS</td><td>{hw.osCaption} (build {hw.osBuild})</td></tr>}
                    </tbody>
                  </table>
                </div>
              </div>

              <details style={{ marginTop: "16px" }}>
                <summary>Raw device document</summary>
                <pre style={{ fontSize: "11px", marginTop: "8px" }}>{JSON.stringify(device, null, 2)}</pre>
              </details>
            </div>
          ) : (
            <>
              <p className="text-muted">
                Hardware inventory not yet captured. This device may have been registered with an older
                installer (before v1.0.4). Run the latest installer to populate hardware details.
              </p>
              <pre>{JSON.stringify(device, null, 2)}</pre>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
