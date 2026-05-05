import { useEffect, useState } from "react";
import api from "../../services/api";
import { winDevices } from "../../services/windowsApi";

/**
 * Windows Booking page - schedule classes for Windows-served rooms.
 *
 * Backend /api/classes is shared with Android (ScheduledClass model is
 * platform-agnostic), so we follow the same payload contract:
 *   { title, course (ObjectId), teacher (ObjectId),
 *     roomNumber, date, startTime (HH:MM), endTime (HH:MM) }
 *
 * Course list is fetched per batch (same as Android Booking page).
 * Teacher auto-fills from the selected course (one teacher per course).
 */
export default function WindowsBooking() {
  const [windowsRooms, setWindowsRooms] = useState([]);
  const [batches, setBatches] = useState([]);
  const [courses, setCourses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    title: "",
    roomNumber: "",
    date: new Date().toISOString().split("T")[0],
    startTime: "10:00",
    endTime: "11:00",
    batch: "",
    course: "",       // Course ObjectId
    teacher: "",      // Teacher ObjectId (auto-filled from course)
    teacherName: "",  // display only
    courseName: "",   // display only
  });
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [devicesRes, batchesRes] = await Promise.all([
          winDevices.list(),
          api.get("/batches"),
        ]);

        const rooms = (devicesRes.devices || [])
          .filter((d) => d.isActive)
          .map((d) => ({
            roomNumber: d.roomNumber,
            deviceName: d.name,
            isOnline: d.isOnline,
          }));
        const seen = new Set();
        const uniqRooms = rooms.filter((r) => (seen.has(r.roomNumber) ? false : seen.add(r.roomNumber)));
        setWindowsRooms(uniqRooms);

        const batchList = batchesRes.data || [];
        setBatches(batchList);

        setForm((f) => ({
          ...f,
          roomNumber: uniqRooms[0]?.roomNumber ?? "",
          batch: batchList[0]?._id ?? "",
        }));

        // Auto-load courses for the first batch
        if (batchList[0]?._id) {
          const cr = await api.get(`/batches/${batchList[0]._id}/courses`);
          const courseList = cr.data || [];
          setCourses(courseList);
          if (courseList[0]) {
            const c = courseList[0];
            setForm((f) => ({
              ...f,
              course: c._id,
              courseName: c.courseName ?? "",
              teacher: c.teacher?._id ?? "",
              teacherName: c.teacher?.name ?? "",
            }));
          }
        }
      } catch (e) {
        setError(e.response?.data?.error || e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function handleBatchChange(batchId) {
    setForm((f) => ({ ...f, batch: batchId, course: "", teacher: "", teacherName: "", courseName: "" }));
    if (!batchId) {
      setCourses([]);
      return;
    }
    try {
      const cr = await api.get(`/batches/${batchId}/courses`);
      const courseList = cr.data || [];
      setCourses(courseList);
      if (courseList[0]) {
        const c = courseList[0];
        setForm((f) => ({
          ...f,
          course: c._id,
          courseName: c.courseName ?? "",
          teacher: c.teacher?._id ?? "",
          teacherName: c.teacher?.name ?? "",
        }));
      }
    } catch (e) {
      setError(`Failed to load courses: ${e.response?.data?.error || e.message}`);
    }
  }

  function handleCourseChange(courseId) {
    const c = courses.find((x) => x._id === courseId);
    setForm((f) => ({
      ...f,
      course: courseId,
      courseName: c?.courseName || "",
      teacher: c?.teacher?._id || "",
      teacherName: c?.teacher?.name || "",
    }));
  }

  async function submit(e) {
    e.preventDefault();
    if (!form.course || !form.teacher) {
      alert("Please pick a course (course must have a teacher assigned).");
      return;
    }
    setSubmitting(true);
    try {
      // /api/classes expects ISO date + HH:MM times. The shared `api` axios
      // instance attaches Authorization: Bearer <lcs_admin_token> via its
      // request interceptor.
      await api.post("/classes", {
        title: form.title,
        course: form.course,
        teacher: form.teacher,
        roomNumber: form.roomNumber,
        date: new Date(form.date).toISOString(),
        startTime: form.startTime,
        endTime: form.endTime,
      });
      alert(
        "Class scheduled. The Windows recorder in this room will pick it up on next heartbeat (within 30s)."
      );
      setForm({ ...form, title: "" });
    } catch (e) {
      alert(`Failed: ${e.response?.data?.error || e.message}`);
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <div className="page-loading">Loading...</div>;

  const noBatch = batches.length === 0;
  const noCourseInBatch = !noBatch && courses.length === 0;

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
      ) : noBatch ? (
        <div className="empty-state">
          <p>
            No batches created yet. Add at least one batch (with a course + teacher) under
            <strong> Android &rarr; Batches </strong> first &mdash; the same data is shared
            with Windows.
          </p>
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
                  Room {r.roomNumber} &mdash; {r.deviceName} ({r.isOnline ? "Online" : "Offline"})
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
            <label>Batch</label>
            <select
              value={form.batch}
              onChange={(e) => handleBatchChange(e.target.value)}
              required
            >
              {batches.map((b) => (
                <option key={b._id} value={b._id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>

          <div className="form-row">
            <label>Course</label>
            {noCourseInBatch ? (
              <p className="text-muted" style={{ marginTop: 4 }}>
                No courses in this batch. Add one under Android &rarr; Batches first.
              </p>
            ) : (
              <select
                value={form.course}
                onChange={(e) => handleCourseChange(e.target.value)}
                required
              >
                {courses.map((c) => (
                  <option key={c._id} value={c._id}>
                    {c.courseCode ? `${c.courseCode} - ` : ""}
                    {c.courseName}
                    {c.teacher?.name ? ` (${c.teacher.name})` : " (no teacher!)"}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="form-row">
            <label>Teacher</label>
            <input value={form.teacherName} readOnly placeholder="Auto-filled from course" />
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

          <button type="submit" disabled={submitting || noCourseInBatch} className="btn btn-primary">
            {submitting ? "Scheduling..." : "Schedule Class"}
          </button>
        </form>
      )}
    </div>
  );
}
