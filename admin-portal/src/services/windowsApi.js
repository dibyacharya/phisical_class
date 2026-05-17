/**
 * Windows-specific API client. Completely separate from android api.
 * All endpoints are under /api/windows/*.
 *
 * Uses the SAME env var (VITE_API_BASE_URL) and token key (lcs_admin_token)
 * as the existing api.js so the admin's single login powers both Android
 * and Windows sections.
 */

const API_BASE = (import.meta.env.VITE_API_BASE_URL || "http://localhost:5020/api").replace(/\/api$/, "");

function authHeaders() {
  const token = localStorage.getItem("lcs_admin_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function api(path, opts = {}) {
  const res = await fetch(`${API_BASE}/api/windows${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
      ...(opts.headers || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API ${res.status}: ${text}`);
  }
  return res.json();
}

// ── Devices ───────────────────────────────────────────────
export const winDevices = {
  list: () => api("/devices"),
  get: (id) => api(`/devices/${id}`),
  // Edit a device's location hierarchy (campus/block/floor/room) + name.
  update: (id, fields) =>
    api(`/devices/${id}`, { method: "PATCH", body: JSON.stringify(fields) }),
  deregister: (id) => api(`/devices/${id}`, { method: "DELETE" }),
  issueCommand: (id, command, params) =>
    api(`/devices/${id}/command`, {
      method: "POST",
      body: JSON.stringify({ command, params }),
    }),
  listCommands: (id) => api(`/devices/${id}/commands`),
};

// ── Recordings ────────────────────────────────────────────
export const winRecordings = {
  list: (filters = {}) => {
    const qs = new URLSearchParams(filters).toString();
    return api(`/recordings${qs ? `?${qs}` : ""}`);
  },
  get: (id) => api(`/recordings/${id}`),
  // R2 storage: audit = dry-run orphan report; cleanup = delete orphans.
  r2Audit: () => api("/recordings/r2-audit"),
  r2Cleanup: () =>
    api("/recordings/r2-cleanup", {
      method: "POST",
      body: JSON.stringify({ confirm: "DELETE" }),
    }),
  setMerged: (id, mergedVideoUrl, mergedFileSize) =>
    api(`/recordings/${id}/admin-set-merged`, {
      method: "POST",
      body: JSON.stringify({ mergedVideoUrl, mergedFileSize }),
    }),
  // v2.3.2 — Admin can delete a recording. Backend route exists at
  // DELETE /api/windows/recordings/:id (recordingController.remove).
  // Note: backend currently only removes the Mongo row, NOT the R2
  // object (intentional — keeps a recoverable copy of the .mp4 on R2
  // in case of accidental delete; storage cost is trivial).
  remove: (id) => api(`/recordings/${id}`, { method: "DELETE" }),

  // 2026-05-15 — Force-download a recording. The R2 public URL is cross-
  // origin (different host than this admin portal), which means the HTML
  // `download` attribute is silently ignored by every modern browser —
  // clicking it just opens the .mp4 in a new tab. We work around this by
  // routing the download through our backend, which streams the bytes
  // back with `Content-Disposition: attachment` so the browser saves
  // the file instead.
  //
  // Implementation: authenticated fetch → blob → trigger a synthetic
  // `<a download>` click on a blob: URL. Blob URLs are same-origin to
  // the admin portal's JS, so the `download` attribute IS respected
  // there. Filename comes from the backend's Content-Disposition header
  // (it builds a friendly "<Title>_RoomNNN_YYYY-MM-DD.mp4" string).
  //
  // Caveat: the file is fetched fully into browser memory before the
  // save dialog appears. For our 200-400 MB recordings on a modern admin
  // machine that's fine; users see a brief loading state, then the save
  // dialog. If file sizes climb into multi-GB territory, replace with R2
  // signed URLs + `response-content-disposition` query override (no
  // proxy through Railway, no in-memory buffering).
  download: async (id) => {
    const token = localStorage.getItem("lcs_admin_token");
    const url = `${API_BASE}/api/windows/recordings/${id}/download`;
    const resp = await fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`Download failed: HTTP ${resp.status}${text ? ` — ${text}` : ""}`);
    }

    // Extract filename from `Content-Disposition: attachment; filename="..."`
    // (backend sets this; fall back to a generic name if header is missing).
    const cd = resp.headers.get("content-disposition") || "";
    const match = /filename="([^"]+)"/.exec(cd);
    const filename = match ? match[1] : `recording-${id}.mp4`;

    const blob = await resp.blob();
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = filename;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // Slight delay before revoking so Chrome has time to grab the blob —
    // immediate revoke sometimes truncates the saved file on slow disks.
    setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
    return { filename, sizeBytes: blob.size };
  },
};

// ── Licenses ──────────────────────────────────────────────
export const winLicenses = {
  list: (status) => api(`/licenses${status ? `?status=${status}` : ""}`),
  get: (key) => api(`/licenses/${key}`),
  issue: (data) => api("/licenses", { method: "POST", body: JSON.stringify(data) }),
  revoke: (key, reason) =>
    api(`/licenses/${key}/revoke`, { method: "POST", body: JSON.stringify({ reason }) }),
  extend: (key, newExpiresAt) =>
    api(`/licenses/${key}/extend`, { method: "PATCH", body: JSON.stringify({ newExpiresAt }) }),
  remove: (key) => api(`/licenses/${key}`, { method: "DELETE" }),
};

// ── Diagnostics (v2.1.0) ───────────────────────────────────
// Admin endpoints. The device-side upload endpoints aren't exposed
// here — only the device hits those, with its X-Device-Id + X-Device-Token.
export const winDiagnostics = {
  listForDevice: (deviceId) => api(`/diagnostics/device/${deviceId}`),
  // Returns a direct URL the browser can <img src> or <a href download> from.
  fileUrl: (id) => `${API_BASE}/api/windows/diagnostics/file/${id}`,
};

// ── Live watch (v2.1.0) ────────────────────────────────────
export const winLiveWatch = {
  // Admin subscriber JWT for the LiveKit room. recordingId is optional;
  // when omitted, backend resolves it from the latest active ingress.
  viewerToken: (deviceId, recordingId) => {
    const qs = new URLSearchParams({ deviceId });
    if (recordingId) qs.set("recordingId", recordingId);
    return api(`/live-watch/viewer-token?${qs.toString()}`);
  },
  active: () => api("/live-watch/active"),
};
