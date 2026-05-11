import { useEffect, useRef, useState, useCallback } from "react";
import {
  Download, RefreshCw, Upload, Star, AlertTriangle, FileText,
  Copy, Check, ChevronDown, ChevronRight,
} from "lucide-react";

const API_BASE = (
  import.meta.env.VITE_API_BASE_URL || "http://localhost:5020/api"
).replace(/\/api$/, "");

function authHeaders() {
  const token = localStorage.getItem("lcs_admin_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * Windows App Update — admin uploads LectureLens-Setup-vX.Y.Z.exe and
 * activates it. Every device picks up the active version on its next
 * heartbeat and self-updates via the SelfUpdater pipeline.
 */
export default function WindowsAppUpdate() {
  const [versions, setVersions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [expanded, setExpanded] = useState({});
  const [copiedHash, setCopiedHash] = useState("");

  const fileRef = useRef(null);
  const versionCodeRef = useRef(null);
  const versionNameRef = useRef(null);
  const releaseNotesRef = useRef(null);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      setError("");
      const res = await fetch(`${API_BASE}/api/windows/app/versions`, {
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setVersions(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleUpload(e) {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) return alert("Choose a .exe file first.");
    if (!file.name.endsWith(".exe")) return alert("File must be a .exe installer.");
    const versionCode = versionCodeRef.current.value;
    const versionName = versionNameRef.current.value;
    if (!versionCode || !versionName)
      return alert("versionCode and versionName are required.");

    const fd = new FormData();
    fd.append("exe", file);
    fd.append("versionCode", versionCode);
    fd.append("versionName", versionName);
    fd.append("releaseNotes", releaseNotesRef.current?.value || "");

    setUploading(true);
    setProgress(0);
    try {
      await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", `${API_BASE}/api/windows/app/upload`);
        const token = localStorage.getItem("lcs_admin_token");
        if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
        xhr.upload.addEventListener("progress", (ev) => {
          if (ev.lengthComputable)
            setProgress(Math.round((ev.loaded / ev.total) * 100));
        });
        xhr.onload = () =>
          xhr.status >= 200 && xhr.status < 300
            ? resolve()
            : reject(new Error(`HTTP ${xhr.status}: ${xhr.responseText}`));
        xhr.onerror = () => reject(new Error("Network error"));
        xhr.send(fd);
      });
      alert(
        "Installer uploaded + auto-activated. Devices will pick it up on next heartbeat (within 30s)."
      );
      // Reset form
      fileRef.current.value = "";
      versionCodeRef.current.value = "";
      versionNameRef.current.value = "";
      releaseNotesRef.current.value = "";
      load();
    } catch (e) {
      alert("Upload failed: " + e.message);
    } finally {
      setUploading(false);
      setProgress(0);
    }
  }

  async function activate(id) {
    if (
      !confirm(
        "Activate this version? Every Windows device will download + install it on its next heartbeat."
      )
    ) return;
    try {
      const res = await fetch(
        `${API_BASE}/api/windows/app/versions/${id}/activate`,
        { method: "POST", headers: authHeaders() }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      load();
    } catch (e) {
      alert("Activate failed: " + e.message);
    }
  }

  async function copyHash(sha) {
    try {
      await navigator.clipboard.writeText(sha);
      setCopiedHash(sha);
      setTimeout(() => setCopiedHash(""), 1500);
    } catch {
      /* ignored */
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="animate-spin text-blue-500" size={32} />
        <span className="ml-3 text-slate-500">Loading installer versions...</span>
      </div>
    );
  }

  const activeVersion = versions.find((v) => v.isActive);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">
            Windows App Update (OTA)
          </h1>
          <p className="text-sm text-slate-500">
            Upload a <code className="bg-slate-100 px-1 rounded">LectureLens-Setup-vX.Y.Z.exe</code>{" "}
            — devices auto-update via heartbeat. Active version is what every
            device installs.
          </p>
        </div>
        <button
          onClick={load}
          disabled={refreshing}
          className="p-2 hover:bg-slate-100 rounded-lg disabled:opacity-50"
          title="Refresh"
        >
          <RefreshCw size={18} className={refreshing ? "animate-spin" : ""} />
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded p-3 flex items-center gap-2">
          <AlertTriangle size={16} /> {error}
        </div>
      )}

      {activeVersion && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 flex items-center gap-3">
          <Star size={18} className="text-emerald-600" />
          <div className="flex-1 text-sm">
            <span className="font-semibold text-emerald-800">
              Active version: v{activeVersion.versionName} (vc=
              {activeVersion.versionCode})
            </span>
            <span className="text-emerald-700 ml-2">
              · {formatBytes(activeVersion.exeSize)} ·{" "}
              {new Date(activeVersion.createdAt).toLocaleDateString()}
            </span>
          </div>
        </div>
      )}

      {/* Upload form */}
      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <h2 className="text-sm font-semibold text-slate-800 mb-3 flex items-center gap-2">
          <Upload size={16} /> Upload new installer
        </h2>
        <form onSubmit={handleUpload} className="space-y-3">
          <FormRow label="Installer (.exe)" required>
            <input
              type="file"
              accept=".exe"
              ref={fileRef}
              required
              className="block w-full text-sm text-slate-700 file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:text-sm file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
            />
          </FormRow>
          <div className="grid grid-cols-2 gap-3">
            <FormRow label="Version code (integer)" required>
              <input
                type="number"
                ref={versionCodeRef}
                placeholder="210"
                required
                className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-blue-500"
              />
            </FormRow>
            <FormRow label="Version name" required>
              <input
                type="text"
                ref={versionNameRef}
                placeholder="2.1.0"
                required
                className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-blue-500"
              />
            </FormRow>
          </div>
          <FormRow label="Release notes">
            <textarea
              ref={releaseNotesRef}
              rows={3}
              placeholder="What's new in this version (markdown OK)"
              className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-blue-500"
            />
          </FormRow>
          <button
            type="submit"
            disabled={uploading}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm rounded-lg flex items-center gap-2"
          >
            <Upload size={14} />
            {uploading
              ? `Uploading ${progress}%...`
              : "Upload + auto-activate"}
          </button>
          {uploading && (
            <div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500 transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
          )}
        </form>
      </div>

      {/* Version history */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-200">
          <h2 className="text-sm font-semibold text-slate-800">
            Version history ({versions.length})
          </h2>
        </div>
        {versions.length === 0 ? (
          <div className="p-10 text-center text-sm text-slate-400">
            No installers uploaded yet. Build one with{" "}
            <code className="bg-slate-100 px-1 rounded">scripts\build-installer.ps1</code>{" "}
            and upload above.
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {versions.map((v) => (
              <div key={v._id} className="px-5 py-3">
                <div className="flex items-center gap-3">
                  <button
                    onClick={() =>
                      setExpanded((e) => ({ ...e, [v._id]: !e[v._id] }))
                    }
                    className="text-slate-400 hover:text-slate-700"
                  >
                    {expanded[v._id] ? (
                      <ChevronDown size={16} />
                    ) : (
                      <ChevronRight size={16} />
                    )}
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-medium">
                        v{v.versionName}
                      </span>
                      <span className="text-xs text-slate-500">
                        vc={v.versionCode}
                      </span>
                      {v.isActive && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-semibold flex items-center gap-1">
                          <Star size={10} /> Active
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      {formatBytes(v.exeSize)} ·{" "}
                      {new Date(v.createdAt).toLocaleString()}
                      {v.uploadedBy?.name && ` · uploaded by ${v.uploadedBy.name}`}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {!v.isActive && (
                      <button
                        onClick={() => activate(v._id)}
                        className="text-xs px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded"
                      >
                        Activate
                      </button>
                    )}
                    <a
                      href={`${API_BASE}/api/windows/app/download?versionCode=${v.versionCode}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-slate-500 hover:text-slate-800 flex items-center gap-1"
                      title="Download installer"
                    >
                      <Download size={12} /> Download
                    </a>
                  </div>
                </div>

                {expanded[v._id] && (
                  <div className="mt-3 ml-7 pl-3 border-l border-slate-200 space-y-2 text-xs">
                    {v.sha256 && (
                      <div className="flex items-start gap-2">
                        <span className="font-medium text-slate-500 min-w-[80px]">
                          SHA-256
                        </span>
                        <code className="bg-slate-100 px-1.5 py-0.5 rounded text-[11px] break-all flex-1">
                          {v.sha256}
                        </code>
                        <button
                          onClick={() => copyHash(v.sha256)}
                          className={`p-1 rounded ${
                            copiedHash === v.sha256
                              ? "text-green-600"
                              : "text-slate-400 hover:text-slate-700"
                          }`}
                        >
                          {copiedHash === v.sha256 ? (
                            <Check size={12} />
                          ) : (
                            <Copy size={12} />
                          )}
                        </button>
                      </div>
                    )}
                    {v.releaseNotes && (
                      <div className="flex items-start gap-2">
                        <span className="font-medium text-slate-500 min-w-[80px] flex items-center gap-1">
                          <FileText size={12} /> Notes
                        </span>
                        <div className="text-slate-700 flex-1 whitespace-pre-wrap">
                          {v.releaseNotes}
                        </div>
                      </div>
                    )}
                    {v.fsPath && (
                      <div className="flex items-start gap-2">
                        <span className="font-medium text-slate-500 min-w-[80px]">
                          Storage
                        </span>
                        <code className="text-[10px] text-slate-500 break-all flex-1">
                          {v.fsPath}
                        </code>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function FormRow({ label, required, children }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-slate-700 mb-1 block">
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </span>
      {children}
    </label>
  );
}

function formatBytes(bytes) {
  if (!bytes) return "—";
  const mb = bytes / 1024 / 1024;
  return mb < 1024 ? `${mb.toFixed(1)} MB` : `${(mb / 1024).toFixed(2)} GB`;
}
