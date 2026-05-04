import { useEffect, useState } from "react";
import { winRecordings } from "../../services/windowsApi";

export default function WindowsRecordings() {
  const [recordings, setRecordings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState({});

  async function load() {
    try {
      setLoading(true);
      const data = await winRecordings.list(filter);
      setRecordings(Array.isArray(data) ? data : data.recordings || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function formatBytes(bytes) {
    if (!bytes) return "—";
    const mb = bytes / 1024 / 1024;
    if (mb < 1024) return `${mb.toFixed(1)} MB`;
    return `${(mb / 1024).toFixed(2)} GB`;
  }

  function formatDuration(seconds) {
    if (!seconds) return "—";
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}m ${s}s`;
  }

  if (loading) return <div className="page-loading">Loading Windows recordings...</div>;

  return (
    <div className="page-windows-recordings">
      <div className="page-header">
        <h1>Windows Recordings</h1>
        <p className="text-muted">{recordings.length} recordings</p>
        <button className="btn btn-secondary" onClick={load}>Refresh</button>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <table className="recordings-table">
        <thead>
          <tr>
            <th>Title</th>
            <th>Room</th>
            <th>Started</th>
            <th>Duration</th>
            <th>Size</th>
            <th>Chunks</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {recordings.map((r) => (
            <tr key={r._id}>
              <td>{r.title || r.scheduledClass?.title || "—"}</td>
              <td>{r.roomNumber || r.scheduledClass?.roomNumber || "—"}</td>
              <td>{r.recordingStart ? new Date(r.recordingStart).toLocaleString() : "—"}</td>
              <td>{formatDuration(r.duration)}</td>
              <td>{formatBytes(r.fileSize || r.mergedFileSize)}</td>
              <td>{r.chunks?.length || 0}</td>
              <td>
                <span className={`status-pill status-${r.status}`}>{r.status}</span>
              </td>
              <td>
                {r.mergedVideoUrl && (
                  <a href={r.mergedVideoUrl} target="_blank" rel="noreferrer" className="btn-link">
                    Play
                  </a>
                )}
                <a href={`#/windows/recordings/${r._id}`} className="btn-link">
                  Details
                </a>
              </td>
            </tr>
          ))}
          {recordings.length === 0 && (
            <tr>
              <td colSpan={8} className="empty-state">
                No Windows recordings yet. Schedule a class on a Windows-equipped room.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
