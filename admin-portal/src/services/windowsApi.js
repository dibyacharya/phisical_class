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
  setMerged: (id, mergedVideoUrl, mergedFileSize) =>
    api(`/recordings/${id}/admin-set-merged`, {
      method: "POST",
      body: JSON.stringify({ mergedVideoUrl, mergedFileSize }),
    }),
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
};
