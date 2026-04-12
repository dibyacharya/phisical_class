/**
 * Licenses.jsx — License Key Management
 *
 * Admin can:
 *  • Generate 1–100 license keys at once (with optional label + expiry)
 *  • See full list: key, label, status, bound device, created date
 *  • Copy key to clipboard
 *  • Revoke a key (permanently disable)
 *  • Reset a key (unbind device, allow re-use)
 */

import { useState, useEffect, useCallback } from "react";
import {
  Key, Plus, Copy, Trash2, RefreshCw, CheckCircle2,
  XCircle, Clock, Monitor, Search, Filter, Download,
} from "lucide-react";

const API = import.meta.env.VITE_API_URL || "http://localhost:4000/api";

function token() {
  return localStorage.getItem("lcs_admin_token") || "";
}

// ── Status badge ──────────────────────────────────────────────────────────────
function StatusBadge({ lic }) {
  if (!lic.isActive) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">
        <XCircle size={11} /> Revoked
      </span>
    );
  }
  if (lic.expiresAt && new Date() > new Date(lic.expiresAt)) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-700">
        <Clock size={11} /> Expired
      </span>
    );
  }
  if (lic.isActivated) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
        <CheckCircle2 size={11} /> Activated
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
      <Key size={11} /> Available
    </span>
  );
}

// ── Copy-to-clipboard button ──────────────────────────────────────────────────
function CopyBtn({ text }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback for non-HTTPS contexts
      const el = document.createElement("textarea");
      el.value = text;
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <button
      onClick={handleCopy}
      title="Copy to clipboard"
      className={`p-1.5 rounded transition-colors ${
        copied
          ? "text-green-600 bg-green-50"
          : "text-slate-400 hover:text-slate-700 hover:bg-slate-100"
      }`}
    >
      {copied ? <CheckCircle2 size={14} /> : <Copy size={14} />}
    </button>
  );
}

// ── Generate modal ────────────────────────────────────────────────────────────
function GenerateModal({ onClose, onGenerated }) {
  const [label, setLabel] = useState("");
  const [count, setCount] = useState(1);
  const [expiresAt, setExpiresAt] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleGenerate = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${API}/licenses`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token()}`,
        },
        body: JSON.stringify({
          label: label.trim(),
          count: parseInt(count) || 1,
          expiresAt: expiresAt || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to generate");
      onGenerated(data);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center">
              <Key size={16} className="text-blue-600" />
            </div>
            <h2 className="font-semibold text-slate-800">Generate License Key(s)</h2>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">×</button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Label <span className="text-slate-400 font-normal">(optional — e.g. "Block 14 Room 202")</span>
            </label>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Block 14 Room 202"
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Number of Keys <span className="text-slate-400 font-normal">(1–100)</span>
            </label>
            <input
              type="number"
              min={1}
              max={100}
              value={count}
              onChange={(e) => setCount(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Expiry Date <span className="text-slate-400 font-normal">(optional — leave blank for no expiry)</span>
            </label>
            <input
              type="date"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2 rounded-lg">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 px-6 py-4 border-t">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800 rounded-lg hover:bg-slate-100 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleGenerate}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors disabled:opacity-60"
          >
            {loading ? (
              <RefreshCw size={14} className="animate-spin" />
            ) : (
              <Plus size={14} />
            )}
            {loading ? "Generating…" : `Generate ${count > 1 ? `${count} Keys` : "Key"}`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function Licenses() {
  const [licenses, setLicenses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showGenerate, setShowGenerate] = useState(false);

  // Filters
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all"); // all | available | activated | revoked | expired

  // Action in progress (id → "revoke"|"reset")
  const [actionLoading, setActionLoading] = useState(null);
  const [actionError, setActionError] = useState("");

  const fetchLicenses = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${API}/licenses`, {
        headers: { Authorization: `Bearer ${token()}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to fetch licenses");
      setLicenses(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLicenses();
  }, [fetchLicenses]);

  const handleRevoke = async (id) => {
    if (!window.confirm("Permanently revoke this license? The bound device will stop working.")) return;
    setActionLoading(id + ":revoke");
    setActionError("");
    try {
      const res = await fetch(`${API}/licenses/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token()}` },
      });
      if (!res.ok) throw new Error("Failed to revoke");
      setLicenses((prev) =>
        prev.map((l) => (l._id === id ? { ...l, isActive: false } : l))
      );
    } catch (err) {
      setActionError(err.message);
    } finally {
      setActionLoading(null);
    }
  };

  const handleReset = async (id) => {
    if (!window.confirm("Reset this license? The device binding will be removed and the key can be used again on a new device.")) return;
    setActionLoading(id + ":reset");
    setActionError("");
    try {
      const res = await fetch(`${API}/licenses/${id}/reset`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token()}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to reset");
      setLicenses((prev) => prev.map((l) => (l._id === id ? data : l)));
    } catch (err) {
      setActionError(err.message);
    } finally {
      setActionLoading(null);
    }
  };

  const handleGenerated = (newLicenses) => {
    setLicenses((prev) => [...newLicenses, ...prev]);
  };

  // ── Export CSV ──────────────────────────────────────────────────────────────
  const exportCSV = () => {
    const rows = [
      ["Key", "Label", "Status", "Device MAC", "Room", "Campus", "Block", "Created"],
      ...licenses.map((l) => [
        l.key,
        l.label || "",
        !l.isActive ? "Revoked" : l.isActivated ? "Activated" : "Available",
        l.deviceMac || "",
        l.roomNumber || "",
        l.campus || "",
        l.block || "",
        new Date(l.createdAt).toLocaleDateString(),
      ]),
    ];
    const csv = rows.map((r) => r.map((c) => `"${c}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `licenses-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── Filter logic ────────────────────────────────────────────────────────────
  const filtered = licenses.filter((l) => {
    const q = search.toLowerCase();
    const matchSearch =
      !q ||
      l.key.toLowerCase().includes(q) ||
      (l.label || "").toLowerCase().includes(q) ||
      (l.deviceMac || "").toLowerCase().includes(q) ||
      (l.roomNumber || "").toLowerCase().includes(q) ||
      (l.campus || "").toLowerCase().includes(q) ||
      (l.block || "").toLowerCase().includes(q);

    let matchStatus = true;
    if (statusFilter === "available") matchStatus = l.isActive && !l.isActivated;
    else if (statusFilter === "activated") matchStatus = l.isActive && l.isActivated;
    else if (statusFilter === "revoked") matchStatus = !l.isActive;
    else if (statusFilter === "expired")
      matchStatus = l.expiresAt && new Date() > new Date(l.expiresAt);

    return matchSearch && matchStatus;
  });

  // ── Stats ───────────────────────────────────────────────────────────────────
  const stats = {
    total: licenses.length,
    available: licenses.filter((l) => l.isActive && !l.isActivated).length,
    activated: licenses.filter((l) => l.isActive && l.isActivated).length,
    revoked: licenses.filter((l) => !l.isActive).length,
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">License Keys</h1>
          <p className="text-slate-500 text-sm mt-1">
            One-time activation codes for classroom recorder devices
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={exportCSV}
            className="flex items-center gap-2 px-4 py-2 text-sm border border-slate-300 text-slate-600 rounded-lg hover:bg-slate-50 transition-colors"
          >
            <Download size={15} />
            Export CSV
          </button>
          <button
            onClick={() => setShowGenerate(true)}
            className="flex items-center gap-2 px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
          >
            <Plus size={15} />
            Generate Keys
          </button>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: "Total", value: stats.total, color: "slate" },
          { label: "Available", value: stats.available, color: "blue" },
          { label: "Activated", value: stats.activated, color: "green" },
          { label: "Revoked", value: stats.revoked, color: "red" },
        ].map(({ label, value, color }) => (
          <div
            key={label}
            className={`bg-white rounded-xl border border-slate-200 p-4 cursor-pointer hover:shadow-md transition-shadow ${
              statusFilter === label.toLowerCase() ? "ring-2 ring-blue-500" : ""
            }`}
            onClick={() =>
              setStatusFilter(statusFilter === label.toLowerCase() ? "all" : label.toLowerCase())
            }
          >
            <p className="text-sm text-slate-500">{label}</p>
            <p
              className={`text-2xl font-bold mt-1 text-${color}-600`}
            >
              {value}
            </p>
          </div>
        ))}
      </div>

      {/* Filters bar */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search key, label, device, room…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div className="flex items-center gap-2">
          <Filter size={15} className="text-slate-400" />
          {["all", "available", "activated", "revoked", "expired"].map((f) => (
            <button
              key={f}
              onClick={() => setStatusFilter(f)}
              className={`px-3 py-1.5 text-xs rounded-full capitalize transition-colors ${
                statusFilter === f
                  ? "bg-blue-600 text-white"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* Error */}
      {(error || actionError) && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-xl">
          {error || actionError}
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-slate-400">
            <RefreshCw size={20} className="animate-spin mr-2" /> Loading licenses…
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-slate-400">
            <Key size={36} className="mb-3 opacity-30" />
            <p className="font-medium">No licenses found</p>
            <p className="text-sm mt-1">
              {licenses.length === 0
                ? 'Click "Generate Keys" to create your first license.'
                : "Try changing the filter or search term."}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="text-left px-4 py-3 text-slate-500 font-medium">Key</th>
                  <th className="text-left px-4 py-3 text-slate-500 font-medium">Label</th>
                  <th className="text-left px-4 py-3 text-slate-500 font-medium">Status</th>
                  <th className="text-left px-4 py-3 text-slate-500 font-medium">Bound Device</th>
                  <th className="text-left px-4 py-3 text-slate-500 font-medium">Location</th>
                  <th className="text-left px-4 py-3 text-slate-500 font-medium">Created</th>
                  <th className="text-left px-4 py-3 text-slate-500 font-medium">Expires</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((lic) => {
                  const isActionPending =
                    actionLoading === lic._id + ":revoke" ||
                    actionLoading === lic._id + ":reset";

                  return (
                    <tr
                      key={lic._id}
                      className={`hover:bg-slate-50 transition-colors ${
                        !lic.isActive ? "opacity-60" : ""
                      }`}
                    >
                      {/* Key */}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          <span className="font-mono text-sm font-semibold tracking-wide text-slate-800">
                            {lic.key}
                          </span>
                          <CopyBtn text={lic.key} />
                        </div>
                      </td>

                      {/* Label */}
                      <td className="px-4 py-3 text-slate-600">
                        {lic.label || <span className="text-slate-300 italic">—</span>}
                      </td>

                      {/* Status */}
                      <td className="px-4 py-3">
                        <StatusBadge lic={lic} />
                      </td>

                      {/* Bound device */}
                      <td className="px-4 py-3">
                        {lic.deviceMac ? (
                          <div className="flex items-center gap-1.5 text-slate-600">
                            <Monitor size={13} className="text-slate-400" />
                            <div>
                              <div className="font-mono text-xs">{lic.deviceMac}</div>
                              {lic.deviceModel && (
                                <div className="text-xs text-slate-400">{lic.deviceModel}</div>
                              )}
                            </div>
                          </div>
                        ) : (
                          <span className="text-slate-300 text-xs italic">Not bound</span>
                        )}
                      </td>

                      {/* Location */}
                      <td className="px-4 py-3 text-slate-600 text-xs">
                        {lic.campus || lic.block || lic.roomNumber ? (
                          <span>
                            {[lic.campus, lic.block, lic.roomNumber]
                              .filter(Boolean)
                              .join(" › ")}
                          </span>
                        ) : (
                          <span className="text-slate-300 italic">—</span>
                        )}
                      </td>

                      {/* Created */}
                      <td className="px-4 py-3 text-slate-500 text-xs whitespace-nowrap">
                        {new Date(lic.createdAt).toLocaleDateString("en-IN", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })}
                        <div className="text-slate-400">
                          by {lic.createdBy?.name || "Admin"}
                        </div>
                      </td>

                      {/* Expires */}
                      <td className="px-4 py-3 text-xs">
                        {lic.expiresAt ? (
                          <span
                            className={
                              new Date() > new Date(lic.expiresAt)
                                ? "text-red-500"
                                : "text-slate-500"
                            }
                          >
                            {new Date(lic.expiresAt).toLocaleDateString("en-IN", {
                              day: "numeric",
                              month: "short",
                              year: "numeric",
                            })}
                          </span>
                        ) : (
                          <span className="text-slate-300 italic">Never</span>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1 justify-end">
                          {/* Reset — only if activated or revoked */}
                          {(lic.isActivated || !lic.isActive) && (
                            <button
                              onClick={() => handleReset(lic._id)}
                              disabled={isActionPending}
                              title="Reset (unbind device, allow re-use)"
                              className="p-1.5 rounded text-amber-500 hover:bg-amber-50 transition-colors disabled:opacity-50"
                            >
                              {actionLoading === lic._id + ":reset" ? (
                                <RefreshCw size={14} className="animate-spin" />
                              ) : (
                                <RefreshCw size={14} />
                              )}
                            </button>
                          )}

                          {/* Revoke — only if still active */}
                          {lic.isActive && (
                            <button
                              onClick={() => handleRevoke(lic._id)}
                              disabled={isActionPending}
                              title="Revoke (permanently disable)"
                              className="p-1.5 rounded text-red-500 hover:bg-red-50 transition-colors disabled:opacity-50"
                            >
                              {actionLoading === lic._id + ":revoke" ? (
                                <RefreshCw size={14} className="animate-spin" />
                              ) : (
                                <Trash2 size={14} />
                              )}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {/* Footer count */}
            <div className="px-4 py-3 border-t border-slate-100 text-xs text-slate-400">
              Showing {filtered.length} of {licenses.length} license{licenses.length !== 1 ? "s" : ""}
            </div>
          </div>
        )}
      </div>

      {/* Generate modal */}
      {showGenerate && (
        <GenerateModal
          onClose={() => setShowGenerate(false)}
          onGenerated={handleGenerated}
        />
      )}
    </div>
  );
}
