import { useEffect, useState, useCallback, useMemo } from "react";
import {
  KeyRound, RefreshCw, Copy, Check, Filter, AlertTriangle,
  CalendarPlus, Ban, Clock, CheckCircle2, XCircle, Search, Trash2,
} from "lucide-react";
import { winLicenses } from "../../services/windowsApi";

const STATUS_OPTIONS = [
  { id: "all", label: "All" },
  { id: "issued", label: "Issued (unbound)" },
  { id: "active", label: "Active" },
  { id: "expired", label: "Expired" },
  { id: "revoked", label: "Revoked" },
  { id: "suspended", label: "Suspended" },
];

export default function WindowsLicenses() {
  const [licenses, setLicenses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [copiedKey, setCopiedKey] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [extendTarget, setExtendTarget] = useState(null);

  const fetchAll = useCallback(async () => {
    setRefreshing(true);
    try {
      setError("");
      const data = await winLicenses.list();
      setLicenses(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  async function revoke(key) {
    const reason = prompt("Reason for revocation:");
    if (!reason) return;
    try {
      await winLicenses.revoke(key, reason);
      fetchAll();
    } catch (e) { alert(e.message); }
  }

  async function remove(lic) {
    if (
      !confirm(
        `Permanently DELETE ${lic.licenseKey} from the database?\n\n` +
        `This is irreversible. Audit trail will be lost. Prefer Revoke ` +
        `for any case where you may want to investigate misuse later.\n\n` +
        `Backend refuses to delete a license currently bound to an active ` +
        `device — deregister the device first (Windows → Devices → 🗑️).\n\n` +
        `Continue?`
      )
    ) return;
    try {
      await winLicenses.remove(lic.licenseKey);
      fetchAll();
    } catch (e) {
      alert("Failed to delete: " + e.message);
    }
  }

  async function copyKey(key) {
    try {
      await navigator.clipboard.writeText(key);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = key;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(""), 1500);
  }

  const filtered = useMemo(() => {
    return licenses.filter((lic) => {
      if (statusFilter !== "all" && lic.status !== statusFilter) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        const fields = [
          lic.licenseKey, lic.customerName, lic.customerEmail, lic.customerOrg,
          lic.boundDevice?.name, lic.boundDevice?.roomNumber,
        ]
          .filter(Boolean)
          .map((v) => String(v).toLowerCase());
        if (!fields.some((f) => f.includes(q))) return false;
      }
      return true;
    });
  }, [licenses, statusFilter, search]);

  // Aggregate stats
  const stats = useMemo(() => {
    const t = { total: licenses.length, active: 0, issued: 0, expired: 0, revenue: 0 };
    licenses.forEach((l) => {
      if (l.status === "active") { t.active++; t.revenue += l.pricePerYearINR || 0; }
      if (l.status === "issued") t.issued++;
      if (l.status === "expired") t.expired++;
    });
    return t;
  }, [licenses]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="animate-spin text-blue-500" size={32} />
        <span className="ml-3 text-slate-500">Loading licenses...</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Windows Licenses</h1>
          <p className="text-sm text-slate-500">
            {filtered.length} of {licenses.length} licenses
            {" · "}
            {stats.active} active · {stats.issued} unbound · ₹{stats.revenue.toLocaleString("en-IN")}/yr revenue
          </p>
        </div>
        <button
          onClick={fetchAll}
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

      {/* Filters */}
      <div className="bg-white border border-slate-200 rounded-xl p-3 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search license key, customer, email, room..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-8 pr-2 py-1.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-blue-500"
          />
        </div>
        <div className="flex items-center gap-1 text-xs">
          <Filter size={12} className="text-slate-400" />
          {STATUS_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              onClick={() => setStatusFilter(opt.id)}
              className={`px-2 py-1 rounded ${
                statusFilter === opt.id
                  ? "bg-blue-100 text-blue-700"
                  : "text-slate-500 hover:bg-slate-100"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-slate-500 bg-slate-50 border-b border-slate-200">
                <th className="py-2 px-3">License Key</th>
                <th className="py-2 px-3">Tier</th>
                <th className="py-2 px-3">Customer</th>
                <th className="py-2 px-3">Status</th>
                <th className="py-2 px-3">Bound device</th>
                <th className="py-2 px-3">Expires</th>
                <th className="py-2 px-3">Price/yr</th>
                <th className="py-2 px-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((lic) => (
                <LicenseRow
                  key={lic._id || lic.licenseKey}
                  lic={lic}
                  onCopy={copyKey}
                  onRevoke={revoke}
                  onExtend={setExtendTarget}
                  onDelete={remove}
                  copiedKey={copiedKey}
                />
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-10 text-center text-slate-400 text-sm">
                    {licenses.length === 0
                      ? "No licenses provisioned yet. Use \"Issue license\" above to add one."
                      : "No licenses match the current filters."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {extendTarget && (
        <ExtendLicenseModal
          lic={extendTarget}
          onClose={() => setExtendTarget(null)}
          onExtended={() => { setExtendTarget(null); fetchAll(); }}
        />
      )}
    </div>
  );
}

function LicenseRow({ lic, onCopy, onRevoke, onExtend, onDelete, copiedKey }) {
  const isCopied = copiedKey === lic.licenseKey;
  const isRevoked = lic.status === "revoked";
  const isExpired = lic.status === "expired";
  const expiresAt = lic.expiresAt ? new Date(lic.expiresAt) : null;
  const daysUntilExpiry = expiresAt
    ? Math.floor((expiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000))
    : null;
  const expiringSoon =
    daysUntilExpiry !== null && daysUntilExpiry >= 0 && daysUntilExpiry <= 30;

  return (
    <tr className="border-b border-slate-100 hover:bg-slate-50">
      <td className="py-2 px-3 font-mono text-xs">
        <div className="flex items-center gap-2">
          <code className="text-[11px] bg-slate-100 px-2 py-0.5 rounded">{lic.licenseKey}</code>
          <button
            onClick={() => onCopy(lic.licenseKey)}
            className={`p-1 rounded ${isCopied ? "text-green-600" : "text-slate-400 hover:text-slate-700"}`}
            title="Copy"
          >
            {isCopied ? <Check size={14} /> : <Copy size={14} />}
          </button>
        </div>
      </td>
      <td className="py-2 px-3">
        <span className="text-[10px] px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 uppercase font-semibold">
          {lic.tier || "?"}
        </span>
      </td>
      <td className="py-2 px-3">
        <div className="font-medium text-slate-800">{lic.customerName || "—"}</div>
        {lic.customerEmail && (
          <div className="text-xs text-slate-500">{lic.customerEmail}</div>
        )}
        {lic.customerOrg && (
          <div className="text-[10px] text-slate-400">{lic.customerOrg}</div>
        )}
      </td>
      <td className="py-2 px-3"><StatusBadge status={lic.status} /></td>
      <td className="py-2 px-3 text-xs">
        {lic.boundDevice ? (
          <div>
            <div className="font-medium">{lic.boundDevice.name || "?"}</div>
            <div className="text-slate-500 text-[10px]">Room {lic.boundDevice.roomNumber}</div>
          </div>
        ) : (
          <span className="text-slate-400">—</span>
        )}
      </td>
      <td className="py-2 px-3 text-xs">
        {expiresAt ? (
          <div>
            <div>{expiresAt.toLocaleDateString()}</div>
            {!isRevoked && !isExpired && (
              <div className={`text-[10px] ${expiringSoon ? "text-amber-600 font-medium" : "text-slate-400"}`}>
                {daysUntilExpiry >= 0 ? `${daysUntilExpiry}d left` : `${Math.abs(daysUntilExpiry)}d ago`}
              </div>
            )}
          </div>
        ) : "—"}
      </td>
      <td className="py-2 px-3 text-xs">
        ₹{lic.pricePerYearINR?.toLocaleString("en-IN") || "—"}
      </td>
      <td className="py-2 px-3">
        <div className="flex items-center gap-3">
          {!isRevoked && (
            <>
              <button
                onClick={() => onExtend(lic)}
                className="text-xs text-blue-600 hover:underline flex items-center gap-1"
                title="Extend expiry"
              >
                <CalendarPlus size={12} /> Extend
              </button>
              <button
                onClick={() => onRevoke(lic.licenseKey)}
                className="text-xs text-amber-600 hover:underline flex items-center gap-1"
                title="Revoke license (status flips to 'revoked', row preserved for audit)"
              >
                <Ban size={12} /> Revoke
              </button>
            </>
          )}
          <button
            onClick={() => onDelete(lic)}
            className="text-xs text-red-600 hover:underline flex items-center gap-1"
            title="Permanently delete from database (audit trail lost)"
          >
            <Trash2 size={12} /> Delete
          </button>
        </div>
      </td>
    </tr>
  );
}

function StatusBadge({ status }) {
  const cfg = {
    active:    { cls: "bg-green-100 text-green-700", icon: CheckCircle2, label: "Active" },
    issued:    { cls: "bg-blue-100 text-blue-700", icon: KeyRound, label: "Issued" },
    expired:   { cls: "bg-amber-100 text-amber-700", icon: Clock, label: "Expired" },
    revoked:   { cls: "bg-red-100 text-red-700", icon: Ban, label: "Revoked" },
    suspended: { cls: "bg-slate-100 text-slate-600", icon: XCircle, label: "Suspended" },
  };
  const c = cfg[status] || { cls: "bg-slate-100 text-slate-600", icon: Clock, label: status || "?" };
  const Icon = c.icon;
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full ${c.cls}`}>
      <Icon size={10} /> {c.label}
    </span>
  );
}

// Note: Issue License modal was removed (per product decision). Licenses
// are pre-provisioned by ops via the backend API (POST /api/windows/licenses)
// in bulk batches. Admin portal only surfaces list / extend / revoke.

function ExtendLicenseModal({ lic, onClose, onExtended }) {
  const [newExpiresAt, setNewExpiresAt] = useState(() => {
    // Default: extend by 1 year from current expiry
    const cur = lic.expiresAt ? new Date(lic.expiresAt) : new Date();
    cur.setFullYear(cur.getFullYear() + 1);
    return cur.toISOString().split("T")[0];
  });
  const [submitting, setSubmitting] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await winLicenses.extend(lic.licenseKey, new Date(newExpiresAt).toISOString());
      onExtended();
    } catch (err) {
      alert("Failed to extend: " + err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title={`Extend ${lic.licenseKey}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <div className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded p-2">
          Customer: {lic.customerName || "—"} · Current expiry:{" "}
          {lic.expiresAt ? new Date(lic.expiresAt).toLocaleDateString() : "—"}
        </div>
        <FormRow label="New expiry date" required>
          <input
            type="date"
            value={newExpiresAt}
            onChange={(e) => setNewExpiresAt(e.target.value)}
            required
            className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-blue-500"
          />
        </FormRow>
        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 text-sm border border-slate-300 rounded-lg hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="px-4 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg"
          >
            {submitting ? "Extending..." : "Extend"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function Modal({ title, onClose, children }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-white w-full max-w-md mx-4 rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200">
          <h2 className="font-semibold text-slate-800 text-sm">{title}</h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700"
          >
            ✕
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

function FormRow({ label, required, children }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-slate-700 mb-1 block">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </span>
      {children}
    </label>
  );
}
