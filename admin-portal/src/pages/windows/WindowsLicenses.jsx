import { useEffect, useState } from "react";
import { winLicenses } from "../../services/windowsApi";

export default function WindowsLicenses() {
  const [licenses, setLicenses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [copiedKey, setCopiedKey] = useState("");

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

  async function copyKey(key) {
    try {
      await navigator.clipboard.writeText(key);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(""), 1500);
    } catch {
      // Fallback for older browsers / non-secure contexts
      const ta = document.createElement("textarea");
      ta.value = key;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(""), 1500);
    }
  }

  if (loading) return <div className="page-loading">Loading licenses...</div>;

  return (
    <div className="page-windows-licenses">
      <div className="page-header">
        <h1>Windows Licenses</h1>
        <p className="text-muted">{licenses.length} licenses available</p>
        <button className="btn btn-secondary" onClick={load}>Refresh</button>
      </div>

      {error && <div className="error-banner">{error}</div>}

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
              <td>
                <div className="license-key-cell">
                  <code>{lic.licenseKey}</code>
                  <button
                    type="button"
                    onClick={() => copyKey(lic.licenseKey)}
                    className="btn-copy"
                    title="Copy license key"
                    aria-label="Copy license key"
                  >
                    {copiedKey === lic.licenseKey ? "Copied!" : "Copy"}
                  </button>
                </div>
              </td>
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
                No licenses available. Contact engineering to provision more.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
