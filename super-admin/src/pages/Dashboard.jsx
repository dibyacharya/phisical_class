/**
 * Dashboard.jsx — Super Admin License Management
 *
 * Super Admin can:
 *  - Generate 1-100 license keys (with label + expiry)
 *  - View all licenses with status
 *  - Revoke licenses (permanently disable devices)
 *  - Reset licenses (unbind device, allow re-use)
 *  - Export CSV
 *  - Search & filter
 */

import { useState, useEffect, useCallback } from "react";
import {
  Key, Plus, Copy, Trash2, RefreshCw, CheckCircle2,
  XCircle, Clock, Monitor, Search, Filter, Download,
  Shield, AlertTriangle,
} from "lucide-react";

const API = import.meta.env.VITE_API_URL || "http://localhost:5020/api";

function token() {
  return localStorage.getItem("ll_superadmin_token") || "";
}

// ── Status badge ──────────────────────────────────────────────────────────────
function StatusBadge({ lic }) {
  if (!lic.isActive) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-500/20 text-red-400 border border-red-500/30">
        <XCircle size={11} /> Revoked
      </span>
    );
  }
  if (lic.expiresAt && new Date() > new Date(lic.expiresAt)) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-orange-500/20 text-orange-400 border border-orange-500/30">
        <Clock size={11} /> Expired
      </span>
    );
  }
  if (lic.isActivated) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-500/20 text-green-400 border border-green-500/30">
        <CheckCircle2 size={11} /> Activated
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-500/20 text-blue-400 border border-blue-500/30">
      <Key size={11} /> Available
    </span>
  );
}

// ── Copy-to-clipboard ─────────────────────────────────────────────────────────
function CopyBtn({ text }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const el = document.createElement("textarea");
      el.value = text;
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      onClick={handleCopy}
      title="Copy to clipboard"
      className={`p-1.5 rounded transition-colors ${
        copied ? "text-green-400 bg-green-500/10" : "text-gray-500 hover:text-white hover:bg-white/10"
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="bg-gray-900 border border-white/10 rounded-2xl shadow-2xl w-full max-w-md mx-4">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-amber-500/20 flex items-center justify-center">
              <Key size={16} className="text-amber-400" />
            </div>
            <h2 className="font-semibold text-white">Generate License Keys</h2>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white text-xl leading-none">x</button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-1">
              Client / Label <span className="text-gray-600 font-normal">(e.g. "KIIT University Block 14")</span>
            </label>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. KIIT University Block 14"
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-400 mb-1">
              Number of Keys <span className="text-gray-600 font-normal">(1-100)</span>
            </label>
            <input
              type="number"
              min={1}
              max={100}
              value={count}
              onChange={(e) => setCount(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-400 mb-1">
              Expiry Date <span className="text-gray-600 font-normal">(optional - leave blank for no expiry)</span>
            </label>
            <input
              type="date"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
          </div>

          {error && (
            <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm px-3 py-2 rounded-lg">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 px-6 py-4 border-t border-white/10">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-400 hover:text-white rounded-lg hover:bg-white/5 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleGenerate}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 text-sm bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700 text-white rounded-lg transition-colors disabled:opacity-60"
          >
            {loading ? (
              <RefreshCw size={14} className="animate-spin" />
            ) : (
              <Plus size={14} />
            )}
            {loading ? "Generating..." : `Generate ${count > 1 ? `${count} Keys` : "Key"}`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Dashboard ────────────────────────────────────────────────────────────
export default function Dashboard() {
  const [licenses, setLicenses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showGenerate, setShowGenerate] = useState(false);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

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
    if (!window.confirm("Reset this license? The device binding will be removed and the key can be used on a new device.")) return;
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

  // Export CSV
  const exportCSV = () => {
    const rows = [
      ["Key", "Label", "Status", "Device MAC", "Device Model", "Room", "Campus", "Block", "Created", "Expires"],
      ...licenses.map((l) => [
        l.key,
        l.label || "",
        !l.isActive ? "Revoked" : (l.expiresAt && new Date() > new Date(l.expiresAt)) ? "Expired" : l.isActivated ? "Activated" : "Available",
        l.deviceMac || "",
        l.deviceModel || "",
        l.roomNumber || "",
        l.campus || "",
        l.block || "",
        new Date(l.createdAt).toLocaleDateString(),
        l.expiresAt ? new Date(l.expiresAt).toLocaleDateString() : "Never",
      ]),
    ];
    const csv = rows.map((r) => r.map((c) => `"${c}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `licenses-superadmin-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Filter
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

  // Stats
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
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Shield size={24} className="text-amber-400" />
            License Management
          </h1>
          <p className="text-gray-500 text-sm mt-1">
            Generate, manage, and control all device licenses
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={exportCSV}
            className="flex items-center gap-2 px-4 py-2 text-sm border border-white/10 text-gray-400 rounded-lg hover:bg-white/5 hover:text-white transition-colors"
          >
            <Download size={15} />
            Export CSV
          </button>
          <button
            onClick={() => setShowGenerate(true)}
            className="flex items-center gap-2 px-4 py-2 text-sm bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700 text-white rounded-lg transition-colors"
          >
            <Plus size={15} />
            Generate Keys
          </button>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: "Total", value: stats.total, color: "gray", border: "white/10" },
          { label: "Available", value: stats.available, color: "blue", border: "blue-500/30" },
          { label: "Activated", value: stats.activated, color: "green", border: "green-500/30" },
          { label: "Revoked", value: stats.revoked, color: "red", border: "red-500/30" },
        ].map(({ label, value, color, border }) => (
          <div
            key={label}
            className={`bg-gray-900 rounded-xl border border-${border} p-4 cursor-pointer hover:bg-gray-800 transition ${
              statusFilter === label.toLowerCase() ? "ring-2 ring-amber-500" : ""
            }`}
            onClick={() =>
              setStatusFilter(statusFilter === label.toLowerCase() ? "all" : label.toLowerCase())
            }
          >
            <p className="text-sm text-gray-500">{label}</p>
            <p className={`text-2xl font-bold mt-1 text-${color}-400`}>{value}</p>
          </div>
        ))}
      </div>

      {/* Filters bar */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-600" />
          <input
            type="text"
            placeholder="Search key, label, device, room..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-amber-500"
          />
        </div>
        <div className="flex items-center gap-2">
          <Filter size={15} className="text-gray-600" />
          {["all", "available", "activated", "revoked", "expired"].map((f) => (
            <button
              key={f}
              onClick={() => setStatusFilter(f)}
              className={`px-3 py-1.5 text-xs rounded-full capitalize transition-colors ${
                statusFilter === f
                  ? "bg-amber-500 text-white"
                  : "bg-white/5 text-gray-400 hover:bg-white/10 border border-white/10"
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* Error */}
      {(error || actionError) && (
        <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/30 text-red-400 text-sm px-4 py-3 rounded-xl">
          <AlertTriangle size={16} />
          {error || actionError}
        </div>
      )}

      {/* Table */}
      <div className="bg-gray-900 rounded-xl border border-white/10 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-gray-500">
            <RefreshCw size={20} className="animate-spin mr-2" /> Loading licenses...
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-gray-500">
            <Key size={36} className="mb-3 opacity-30" />
            <p className="font-medium text-gray-400">No licenses found</p>
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
                <tr className="bg-white/5 border-b border-white/10">
                  <th className="text-left px-4 py-3 text-gray-500 font-medium">Key</th>
                  <th className="text-left px-4 py-3 text-gray-500 font-medium">Label</th>
                  <th className="text-left px-4 py-3 text-gray-500 font-medium">Status</th>
                  <th className="text-left px-4 py-3 text-gray-500 font-medium">Bound Device</th>
                  <th className="text-left px-4 py-3 text-gray-500 font-medium">Location</th>
                  <th className="text-left px-4 py-3 text-gray-500 font-medium">Created</th>
                  <th className="text-left px-4 py-3 text-gray-500 font-medium">Expires</th>
                  <th className="px-4 py-3 text-gray-500 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {filtered.map((lic) => {
                  const isActionPending =
                    actionLoading === lic._id + ":revoke" ||
                    actionLoading === lic._id + ":reset";

                  return (
                    <tr
                      key={lic._id}
                      className={`hover:bg-white/5 transition-colors ${
                        !lic.isActive ? "opacity-50" : ""
                      }`}
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          <span className="font-mono text-sm font-semibold tracking-wide text-white">
                            {lic.key}
                          </span>
                          <CopyBtn text={lic.key} />
                        </div>
                      </td>

                      <td className="px-4 py-3 text-gray-400">
                        {lic.label || <span className="text-gray-700 italic">-</span>}
                      </td>

                      <td className="px-4 py-3">
                        <StatusBadge lic={lic} />
                      </td>

                      <td className="px-4 py-3">
                        {lic.deviceMac ? (
                          <div className="flex items-center gap-1.5 text-gray-400">
                            <Monitor size={13} className="text-gray-600" />
                            <div>
                              <div className="font-mono text-xs">{lic.deviceMac}</div>
                              {lic.deviceModel && (
                                <div className="text-xs text-gray-600">{lic.deviceModel}</div>
                              )}
                            </div>
                          </div>
                        ) : (
                          <span className="text-gray-700 text-xs italic">Not bound</span>
                        )}
                      </td>

                      <td className="px-4 py-3 text-gray-400 text-xs">
                        {lic.campus || lic.block || lic.roomNumber ? (
                          <span>
                            {[lic.campus, lic.block, lic.roomNumber].filter(Boolean).join(" > ")}
                          </span>
                        ) : (
                          <span className="text-gray-700 italic">-</span>
                        )}
                      </td>

                      <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">
                        {new Date(lic.createdAt).toLocaleDateString("en-IN", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })}
                      </td>

                      <td className="px-4 py-3 text-xs">
                        {lic.expiresAt ? (
                          <span
                            className={
                              new Date() > new Date(lic.expiresAt)
                                ? "text-red-400"
                                : "text-gray-500"
                            }
                          >
                            {new Date(lic.expiresAt).toLocaleDateString("en-IN", {
                              day: "numeric",
                              month: "short",
                              year: "numeric",
                            })}
                          </span>
                        ) : (
                          <span className="text-gray-700 italic">Never</span>
                        )}
                      </td>

                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1 justify-end">
                          {(lic.isActivated || !lic.isActive) && (
                            <button
                              onClick={() => handleReset(lic._id)}
                              disabled={isActionPending}
                              title="Reset (unbind device, allow re-use)"
                              className="p-1.5 rounded text-amber-400 hover:bg-amber-500/10 transition-colors disabled:opacity-50"
                            >
                              {actionLoading === lic._id + ":reset" ? (
                                <RefreshCw size={14} className="animate-spin" />
                              ) : (
                                <RefreshCw size={14} />
                              )}
                            </button>
                          )}

                          {lic.isActive && (
                            <button
                              onClick={() => handleRevoke(lic._id)}
                              disabled={isActionPending}
                              title="Revoke (permanently disable)"
                              className="p-1.5 rounded text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-50"
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

            <div className="px-4 py-3 border-t border-white/5 text-xs text-gray-600">
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
