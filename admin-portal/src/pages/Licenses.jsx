/**
 * Licenses.jsx — License Key Viewer (Read-Only for Client Admin)
 *
 * Admin can:
 *  • See full list: key, label, status, bound device, location, expiry
 *  • Copy key to clipboard
 *  • Filter by status (available, activated, revoked, expired)
 *  • Search by key, label, device, room
 *  • Export to CSV
 *
 * Admin CANNOT:
 *  • Generate new licenses (Super Admin only)
 *  • Revoke licenses (Super Admin only)
 *  • Reset licenses (Super Admin only)
 */

import { useState, useEffect, useCallback } from "react";
import {
  Key, Copy, CheckCircle2, XCircle, Clock, Monitor,
  Search, Filter, Download, RefreshCw, ShieldAlert,
} from "lucide-react";
import { usePersistedState } from "../hooks/usePersistedState";

const API = import.meta.env.VITE_API_BASE_URL || "http://localhost:5020/api";

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

// ── Main page ─────────────────────────────────────────────────────────────────
export default function Licenses() {
  const [licenses, setLicenses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Filters
  const [search, setSearch] = useState("");
  // v3.5.7 — persist status filter across reload.
  const [statusFilter, setStatusFilter] = usePersistedState("all", "lcs_licenses_status_filter");

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

  // ── Export CSV ──────────────────────────────────────────────────────────────
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
            Activation codes for classroom recorder devices
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
            onClick={fetchLicenses}
            className="flex items-center gap-2 px-4 py-2 text-sm border border-slate-300 text-slate-600 rounded-lg hover:bg-slate-50 transition-colors"
          >
            <RefreshCw size={15} />
            Refresh
          </button>
        </div>
      </div>

      {/* Info banner */}
      <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 text-amber-800 text-sm px-4 py-3 rounded-xl">
        <ShieldAlert size={18} className="mt-0.5 flex-shrink-0" />
        <div>
          <p className="font-medium">License keys are managed by LectureLens</p>
          <p className="text-amber-600 mt-0.5">
            To request new licenses or manage existing ones, please contact your system administrator.
          </p>
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
            <p className={`text-2xl font-bold mt-1 ${
              color === "slate" ? "text-slate-600" :
              color === "blue" ? "text-blue-600" :
              color === "green" ? "text-green-600" :
              color === "red" ? "text-red-600" : "text-gray-600"
            }`}>
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
            placeholder="Search key, label, device, room..."
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
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-xl">
          {error}
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-slate-400">
            <RefreshCw size={20} className="animate-spin mr-2" /> Loading licenses...
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-slate-400">
            <Key size={36} className="mb-3 opacity-30" />
            <p className="font-medium">No licenses found</p>
            <p className="text-sm mt-1">
              {licenses.length === 0
                ? "No licenses have been assigned yet. Contact your system administrator."
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
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((lic) => (
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
                            .join(" > ")}
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
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Footer count */}
            <div className="px-4 py-3 border-t border-slate-100 text-xs text-slate-400">
              Showing {filtered.length} of {licenses.length} license{licenses.length !== 1 ? "s" : ""}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
