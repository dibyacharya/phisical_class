import { useState, useEffect, useRef } from "react";

const API = import.meta.env.VITE_API_URL || "/api";

export default function AppUpdate() {
  const [versions, setVersions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const fileRef = useRef(null);
  const [form, setForm] = useState({
    versionCode: "",
    versionName: "",
    releaseNotes: "",
  });

  const token = localStorage.getItem("lcs_admin_token");
  const headers = { Authorization: `Bearer ${token}` };

  useEffect(() => {
    fetchVersions();
  }, []);

  const fetchVersions = async () => {
    try {
      const res = await fetch(`${API}/app/versions`, { headers });
      if (res.ok) {
        const data = await res.json();
        setVersions(data);
      }
    } catch (err) {
      console.error("Failed to fetch versions:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleUpload = async (e) => {
    e.preventDefault();
    setError("");
    setSuccess("");

    const file = fileRef.current?.files[0];
    if (!file) {
      setError("Please select an APK file");
      return;
    }
    if (!form.versionCode || !form.versionName) {
      setError("Version code and version name are required");
      return;
    }
    if (!file.name.endsWith(".apk")) {
      setError("Only .apk files are allowed");
      return;
    }

    setUploading(true);
    setUploadProgress(0);

    try {
      const formData = new FormData();
      formData.append("apk", file);
      formData.append("versionCode", form.versionCode);
      formData.append("versionName", form.versionName);
      formData.append("releaseNotes", form.releaseNotes);

      const xhr = new XMLHttpRequest();
      xhr.open("POST", `${API}/app/upload`);
      xhr.setRequestHeader("Authorization", `Bearer ${token}`);

      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          setUploadProgress(Math.round((event.loaded / event.total) * 100));
        }
      };

      xhr.onload = () => {
        if (xhr.status === 201) {
          setSuccess("APK uploaded successfully! Devices will auto-update on next heartbeat.");
          setForm({ versionCode: "", versionName: "", releaseNotes: "" });
          if (fileRef.current) fileRef.current.value = "";
          fetchVersions();
        } else {
          try {
            const resp = JSON.parse(xhr.responseText);
            setError(resp.error || "Upload failed");
          } catch {
            setError("Upload failed (HTTP " + xhr.status + ")");
          }
        }
        setUploading(false);
        setUploadProgress(0);
      };

      xhr.onerror = () => {
        setError("Network error during upload");
        setUploading(false);
        setUploadProgress(0);
      };

      xhr.send(formData);
    } catch (err) {
      setError(err.message);
      setUploading(false);
      setUploadProgress(0);
    }
  };

  const handleDelete = async (id, versionName) => {
    if (!confirm(`Delete version ${versionName}? This cannot be undone.`)) return;
    try {
      const res = await fetch(`${API}/app/versions/${id}`, {
        method: "DELETE",
        headers,
      });
      if (res.ok) {
        fetchVersions();
        setSuccess(`Version ${versionName} deleted`);
      }
    } catch (err) {
      setError("Delete failed: " + err.message);
    }
  };

  const formatSize = (bytes) => {
    if (!bytes) return "—";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + " KB";
    return (bytes / 1024 / 1024).toFixed(1) + " MB";
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return "—";
    return new Date(dateStr).toLocaleString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">App Updates (OTA)</h1>
          <p className="text-slate-500 mt-1">
            Upload new APK versions. Devices auto-update silently on next heartbeat.
          </p>
        </div>
      </div>

      {/* Upload Form */}
      <div className="bg-white rounded-xl border border-slate-200 p-6 mb-8">
        <h2 className="text-lg font-semibold text-slate-800 mb-4">Upload New Version</h2>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-4">
            {error}
          </div>
        )}
        {success && (
          <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg mb-4">
            {success}
          </div>
        )}

        <form onSubmit={handleUpload} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Version Code <span className="text-red-500">*</span>
              </label>
              <input
                type="number"
                min="1"
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="e.g. 6"
                value={form.versionCode}
                onChange={(e) => setForm({ ...form, versionCode: e.target.value })}
              />
              <p className="text-xs text-slate-400 mt-1">Must be higher than current version</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Version Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="e.g. 1.5.0-draisol"
                value={form.versionName}
                onChange={(e) => setForm({ ...form, versionName: e.target.value })}
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Release Notes
            </label>
            <textarea
              rows={3}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="What changed in this version..."
              value={form.releaseNotes}
              onChange={(e) => setForm({ ...form, releaseNotes: e.target.value })}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              APK File <span className="text-red-500">*</span>
            </label>
            <input
              type="file"
              ref={fileRef}
              accept=".apk"
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm file:mr-4 file:py-1 file:px-3 file:rounded-md file:border-0 file:bg-blue-50 file:text-blue-700 file:font-medium file:text-sm hover:file:bg-blue-100"
            />
            <p className="text-xs text-slate-400 mt-1">Max 500MB. Stored in MongoDB for reliability.</p>
          </div>

          {uploading && (
            <div className="w-full bg-slate-100 rounded-full h-3 overflow-hidden">
              <div
                className="bg-blue-600 h-full rounded-full transition-all duration-300"
                style={{ width: `${uploadProgress}%` }}
              />
              <p className="text-xs text-slate-500 mt-1 text-center">{uploadProgress}% uploaded</p>
            </div>
          )}

          <button
            type="submit"
            disabled={uploading}
            className={`px-6 py-2.5 rounded-lg text-white text-sm font-medium transition-colors ${
              uploading
                ? "bg-slate-400 cursor-not-allowed"
                : "bg-blue-600 hover:bg-blue-700"
            }`}
          >
            {uploading ? `Uploading... ${uploadProgress}%` : "Upload APK"}
          </button>
        </form>
      </div>

      {/* Versions List */}
      <div className="bg-white rounded-xl border border-slate-200">
        <div className="px-6 py-4 border-b border-slate-200">
          <h2 className="text-lg font-semibold text-slate-800">Version History</h2>
        </div>

        {loading ? (
          <div className="p-8 text-center text-slate-500">Loading...</div>
        ) : versions.length === 0 ? (
          <div className="p-8 text-center text-slate-400">
            No versions uploaded yet. Upload your first APK above.
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {versions.map((v) => (
              <div
                key={v._id}
                className="px-6 py-4 flex items-center justify-between hover:bg-slate-50"
              >
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <span className="text-lg font-bold text-slate-900">
                      v{v.versionName}
                    </span>
                    <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">
                      Code {v.versionCode}
                    </span>
                    {v.isActive && (
                      <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">
                        Active
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-6 text-sm text-slate-500">
                  <span>{formatSize(v.apkSize)}</span>
                  <span>{formatDate(v.createdAt)}</span>
                  <button
                    onClick={() => handleDelete(v._id, v.versionName)}
                    className="text-red-500 hover:text-red-700 text-xs font-medium"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Instructions Card */}
      <div className="mt-8 bg-blue-50 border border-blue-200 rounded-xl p-6">
        <h3 className="font-semibold text-blue-900 mb-2">How OTA Updates Work</h3>
        <ul className="text-sm text-blue-800 space-y-1.5">
          <li>1. Upload a new APK with a higher version code</li>
          <li>2. Devices check for updates every heartbeat (2 minutes)</li>
          <li>3. If a newer version is found, the APK downloads automatically</li>
          <li>4. In Device Owner mode, install is completely silent (no user tap needed)</li>
          <li>5. App restarts automatically after update</li>
        </ul>
        <div className="mt-3 pt-3 border-t border-blue-200">
          <p className="text-xs text-blue-700 font-mono">
            Setup Device Owner via ADB:{" "}
            <code className="bg-blue-100 px-1.5 py-0.5 rounded">
              adb shell dpm set-device-owner in.lecturelens.recorder/.service.LectureLensDeviceAdmin
            </code>
          </p>
        </div>
      </div>
    </div>
  );
}
