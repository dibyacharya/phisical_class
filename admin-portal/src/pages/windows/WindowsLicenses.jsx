import { useEffect, useState } from "react";
import { winLicenses } from "../../services/windowsApi";

// Single-tier catalogue: 1080p Professional with live-watch.
// (Starter / Enterprise were retired — keep this constant if they return later.)
const PRO_PRICE = { inr: 45000, usd: 600 };

export default function WindowsLicenses() {
  const [licenses, setLicenses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showIssueForm, setShowIssueForm] = useState(false);
  const [issueResult, setIssueResult] = useState(null);

  async function load() {
    try {
      setLoading(true);
      const data = await winLicenses.list();
      setLicenses(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function revoke(key) {
    const reason = prompt("Reason for revocation:");
    if (!reason) return;
    try {
      await winLicenses.revoke(key, reason);
      load();
    } catch (e) {
      alert(e.message);
    }
  }

  if (loading) return <div className="page-loading">Loading licenses...</div>;

  return (
    <div className="page-windows-licenses">
      <div className="page-header">
        <h1>Windows Licenses</h1>
        <p className="text-muted">{licenses.length} licenses issued</p>
        <button className="btn btn-primary" onClick={() => setShowIssueForm(true)}>
          + Issue New License
        </button>
        <button className="btn btn-secondary" onClick={load}>Refresh</button>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {issueResult && (
        <div className="success-banner">
          <h3>License Issued Successfully!</h3>
          <p>Share this key with the customer:</p>
          <code className="license-key">{issueResult.shareThisKey}</code>
          <p className="text-muted">
            Customer enters this key during Windows app installation.
          </p>
          <button onClick={() => setIssueResult(null)}>Dismiss</button>
        </div>
      )}

      {showIssueForm && (
        <IssueLicenseForm
          onClose={() => setShowIssueForm(false)}
          onIssued={(result) => {
            setIssueResult(result);
            setShowIssueForm(false);
            load();
          }}
        />
      )}

      <table className="licenses-table">
        <thead>
          <tr>
            <th>License Key</th>
            <th>Tier</th>
            <th>Customer</th>
            <th>Status</th>
            <th>Bound Device</th>
            <th>Expires</th>
            <th>Price/yr</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {licenses.map((lic) => (
            <tr key={lic._id}>
              <td><code>{lic.licenseKey}</code></td>
              <td>
                <span className={`tier-badge tier-${lic.tier}`}>{lic.tier}</span>
              </td>
              <td>
                <div>{lic.customerName}</div>
                <small>{lic.customerEmail}</small>
              </td>
              <td>
                <span className={`status-pill status-${lic.status}`}>{lic.status}</span>
              </td>
              <td>
                {lic.boundDevice ? (
                  <span>
                    {lic.boundDevice.name || lic.boundDevice.deviceId} (Room {lic.boundDevice.roomNumber})
                  </span>
                ) : (
                  <span className="text-muted">—</span>
                )}
              </td>
              <td>
                {lic.expiresAt
                  ? new Date(lic.expiresAt).toLocaleDateString()
                  : "—"}
              </td>
              <td>
                ₹{lic.pricePerYearINR?.toLocaleString() || "—"}
              </td>
              <td>
                {lic.status !== "revoked" && (
                  <button onClick={() => revoke(lic.licenseKey)} className="btn-danger-link">
                    Revoke
                  </button>
                )}
              </td>
            </tr>
          ))}
          {licenses.length === 0 && (
            <tr>
              <td colSpan={8} className="empty-state">
                No licenses issued yet. Click "Issue New License" to create one.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function IssueLicenseForm({ onClose, onIssued }) {
  const [form, setForm] = useState({
    customerName: "",
    customerEmail: "",
    customerOrg: "",
    expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
    notes: "",
  });
  const [submitting, setSubmitting] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const result = await winLicenses.issue({
        tier: "professional",
        ...form,
        pricePerYearINR: PRO_PRICE.inr,
        pricePerYearUSD: PRO_PRICE.usd,
      });
      onIssued(result);
    } catch (e) {
      alert(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Issue New License</h2>
          <button onClick={onClose}>×</button>
        </div>
        <form onSubmit={submit} className="modal-body">
          <div className="form-row plan-summary">
            <strong>Plan:</strong> Professional &mdash; 1080p recording, live-watch, 12 hrs/day, 5 concurrent viewers, 500 GB cloud storage. <em>₹{PRO_PRICE.inr.toLocaleString()}/yr</em>
          </div>
          <div className="form-row">
            <label>Customer Name *</label>
            <input
              type="text"
              value={form.customerName}
              onChange={(e) => setForm({ ...form, customerName: e.target.value })}
              required
            />
          </div>
          <div className="form-row">
            <label>Customer Email</label>
            <input
              type="email"
              value={form.customerEmail}
              onChange={(e) => setForm({ ...form, customerEmail: e.target.value })}
            />
          </div>
          <div className="form-row">
            <label>Customer Organization</label>
            <input
              type="text"
              value={form.customerOrg}
              onChange={(e) => setForm({ ...form, customerOrg: e.target.value })}
            />
          </div>
          <div className="form-row">
            <label>Expires *</label>
            <input
              type="date"
              value={form.expiresAt}
              onChange={(e) => setForm({ ...form, expiresAt: e.target.value })}
              required
            />
          </div>
          <div className="form-row">
            <label>Notes</label>
            <textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              rows={3}
            />
          </div>
          <button type="submit" disabled={submitting} className="btn btn-primary">
            {submitting ? "Issuing..." : "Issue License"}
          </button>
        </form>
      </div>
    </div>
  );
}
