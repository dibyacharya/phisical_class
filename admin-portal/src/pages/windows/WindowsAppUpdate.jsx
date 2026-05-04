import { useEffect, useRef, useState } from "react";

const API_BASE = (import.meta.env.VITE_API_BASE_URL || "http://localhost:5020/api").replace(/\/api$/, "");

function authHeaders() {
  const token = localStorage.getItem("lcs_admin_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * Windows App Update — admin uploads a new LectureLens-Setup-vX.Y.Z.exe
 * here. Once uploaded + activated, every Windows device picks it up on
 * its next heartbeat (within 30 sec) and self-updates.
 */
export default function WindowsAppUpdate() {
  const [versions, setVersions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);

  const fileRef = useRef(null);
  const versionCodeRef = useRef(null);
  const versionNameRef = useRef(null);
  const releaseNotesRef = useRef(null);

  async function load() {
    try {
      setLoading(true);
      const res = await fetch(`${API_BASE}/api/windows/app/versions`, {
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setVersions(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function handleUpload(e) {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) {
      alert("Choose a .exe file first");
      return;
    }
    if (!file.name.endsWith(".exe")) {
      alert("File must be a .exe installer");
      return;
    }
    const versionCode = versionCodeRef.current.value;
    const versionName = versionNameRef.current.value;
    if (!versionCode || !versionName) {
      alert("versionCode and versionName are required");
      return;
    }

    const fd = new FormData();
    fd.append("exe", file);
    fd.append("versionCode", versionCode);
    fd.append("versionName", versionName);
    fd.append("releaseNotes", releaseNotesRef.current?.value || "");

    setUploading(true);
    setProgress(0);
    try {
      // Use XHR for upload progress
      await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", `${API_BASE}/api/windows/app/upload`);
        const token = localStorage.getItem("lcs_admin_token");
        if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
        xhr.upload.addEventListener("progress", (ev) => {
          if (ev.lengthComputable) setProgress(Math.round((ev.loaded / ev.total) * 100));
        });
        xhr.onload = () => (xhr.status >= 200 && xhr.status < 300) ? resolve() : reject(new Error(`HTTP ${xhr.status}: ${xhr.responseText}`));
        xhr.onerror = () => reject(new Error("Network error"));
        xhr.send(fd);
      });
      alert("Installer uploaded successfully. Devices will auto-update on next heartbeat.");
      load();
    } catch (e) {
      alert(`Upload failed: ${e.message}`);
    } finally {
      setUploading(false);
      setProgress(0);
    }
  }

  async function activate(id) {
    if (!confirm("Activate this version? All Windows devices will download + install it on their next heartbeat.")) return;
    try {
      const res = await fetch(`${API_BASE}/api/windows/app/versions/${id}/activate`, {
        method: "POST",
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      load();
    } catch (e) {
      alert(`Activate failed: ${e.message}`);
    }
  }

  function formatBytes(bytes) {
    if (!bytes) return "—";
    const mb = bytes / 1024 / 1024;
    return mb < 1024 ? `${mb.toFixed(1)} MB` : `${(mb / 1024).toFixed(2)} GB`;
  }

  if (loading) return <div className="page-loading">Loading...</div>;

  return (
    <div className="page-windows-app-update">
      <div className="page-header">
        <h1>Windows App Update (OTA)</h1>
        <p className="text-muted">
          Upload a LectureLens-Setup-vX.Y.Z.exe — devices auto-update via heartbeat.
        </p>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="upload-form">
        <h2>Upload new installer</h2>
        <form onSubmit={handleUpload}>
          <div className="form-row">
            <label>Installer (.exe)</label>
            <input type="file" accept=".exe" ref={fileRef} required />
          </div>
          <div className="form-row-pair">
            <div className="form-row">
              <label>Version Code (integer, monotonic)</label>
              <input type="number" ref={versionCodeRef} placeholder="100" required />
            </div>
            <div className="form-row">
              <label>Version Name</label>
              <input type="text" ref={versionNameRef} placeholder="1.0.0" required />
            </div>
          </div>
          <div className="form-row">
            <label>Release Notes</label>
            <textarea ref={releaseNotesRef} rows={3} placeholder="What's new in this version" />
          </div>
          <button type="submit" disabled={uploading} className="btn btn-primary">
            {uploading ? `Uploading ${progress}%...` : "Upload + Activate"}
          </button>
          {uploading && (
            <div className="progress-bar">
              <div className="progress-fill" style={{ width: `${progress}%` }} />
            </div>
          )}
        </form>
      </div>

      <h2 style={{ marginTop: 32 }}>Version history</h2>
      <table className="versions-table">
        <thead>
          <tr>
            <th>Version</th>
            <th>Code</th>
            <th>Size</th>
            <th>Uploaded</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {versions.map(v => (
            <tr key={v._id}>
              <td><code>{v.versionName}</code></td>
              <td>{v.versionCode}</td>
              <td>{formatBytes(v.exeSize)}</td>
              <td>{new Date(v.createdAt).toLocaleString()}</td>
              <td>
                {v.isActive
                  ? <span className="status-pill status-active">★ Active</span>
                  : <span className="status-pill status-issued">Inactive</span>}
              </td>
              <td>
                {!v.isActive && (
                  <button onClick={() => activate(v._id)} className="btn-link">Activate</button>
                )}
              </td>
            </tr>
          ))}
          {versions.length === 0 && (
            <tr>
              <td colSpan={6} className="empty-state">
                No installers uploaded yet. Build one with <code>scripts\build-installer.ps1</code>.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
