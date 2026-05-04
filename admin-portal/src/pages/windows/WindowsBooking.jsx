import { useEffect, useState } from "react";
import { winDevices } from "../../services/windowsApi";

/**
 * Windows Booking page — lets admin schedule classes specifically for Windows
 * rooms (rooms that have a Windows PC registered). Reuses the existing classes
 * API; just filtered to Windows-served rooms in the room dropdown.
 *
 * The actual class creation hits /api/classes (shared between Android + Windows)
 * since ScheduledClass model is platform-agnostic.
 */
export default function WindowsBooking() {
  const [windowsRooms, setWindowsRooms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    title: "",
    roomNumber: "",
    date: new Date().toISOString().split("T")[0],
    startTime: "10:00",
    endTime: "11:00",
    courseName: "",
    teacherName: "",
  });
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const data = await winDevices.list();
        const rooms = (data.devices || [])
          .filter((d) => d.isActive)
          .map((d) => ({
            roomNumber: d.roomNumber,
            deviceName: d.name,
            isOnline: d.isOnline,
            licenseStatus: d.licenseStatus,
          }));
        // Dedupe by roomNumber
        const seen = new Set();
        const uniq = rooms.filter((r) => (seen.has(r.roomNumber) ? false : seen.add(r.roomNumber)));
        setWindowsRooms(uniq);
        if (uniq.length > 0 && !form.roomNumber) {
          setForm((f) => ({ ...f, roomNumber: uniq[0].roomNumber }));
        }
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function submit(e) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const token = localStorage.getItem("token");
      const apiBase = import.meta.env.VITE_API_BASE || "https://lecturelens-api.draisol.com";
      const res = await fetch(`${apiBase}/api/classes`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          ...form,
          date: new Date(form.date).toISOString(),
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Failed: ${text}`);
      }
      alert("Class scheduled for Windows-served room.");
      setForm({ ...form, title: "" });
    } catch (e) {
      alert(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <div className="page-loading">Loading...</div>;

  return (
    <div className="page-windows-booking">
      <div className="page-header">
        <h1>Windows Booking</h1>
        <p className="text-muted">Schedule a class for a room served by a Windows PC.</p>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {windowsRooms.length === 0 ? (
        <div className="empty-state">
          <p>No Windows devices registered yet. Install the Windows recorder on a Mini PC first.</p>
        </div>
      ) : (
        <form onSubmit={submit} className="booking-form">
          <div className="form-row">
            <label>Room</label>
            <select
              value={form.roomNumber}
              onChange={(e) => setForm({ ...form, roomNumber: e.target.value })}
              required
            >
              {windowsRooms.map((r) => (
                <option key={r.roomNumber} value={r.roomNumber}>
                  Room {r.roomNumber} — {r.deviceName} ({r.isOnline ? "Online" : "Offline"})
                </option>
              ))}
            </select>
          </div>

          <div className="form-row">
            <label>Class Title</label>
            <input
              type="text"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              required
            />
          </div>

          <div className="form-row">
            <label>Course Name</label>
            <input
              type="text"
              value={form.courseName}
              onChange={(e) => setForm({ ...form, courseName: e.target.value })}
            />
          </div>

          <div className="form-row">
            <label>Teacher Name</label>
            <input
              type="text"
              value={form.teacherName}
              onChange={(e) => setForm({ ...form, teacherName: e.target.value })}
            />
          </div>

          <div className="form-row">
            <label>Date</label>
            <input
              type="date"
              value={form.date}
              onChange={(e) => setForm({ ...form, date: e.target.value })}
              required
            />
          </div>

          <div className="form-row-pair">
            <div className="form-row">
              <label>Start Time (IST)</label>
              <input
                type="time"
                value={form.startTime}
                onChange={(e) => setForm({ ...form, startTime: e.target.value })}
                required
              />
            </div>
            <div className="form-row">
              <label>End Time (IST)</label>
              <input
                type="time"
                value={form.endTime}
                onChange={(e) => setForm({ ...form, endTime: e.target.value })}
                required
              />
            </div>
          </div>

          <button type="submit" disabled={submitting} className="btn btn-primary">
            {submitting ? "Scheduling..." : "Schedule Class"}
          </button>
        </form>
      )}
    </div>
  );
}
