import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  CalendarPlus, RefreshCw, AlertTriangle, CheckCircle2,
  Wifi, WifiOff,
} from "lucide-react";
import api from "../../services/api";
import { winDevices } from "../../services/windowsApi";

/**
 * Schedule a class on a Windows-served room.
 *
 * Backend /api/classes is shared with the Android pipeline (ScheduledClass
 * model is platform-agnostic). Payload contract:
 *   { title, course (ObjectId), teacher (ObjectId),
 *     roomNumber, date, startTime (HH:MM), endTime (HH:MM) }
 *
 * Course list is fetched per batch (same as Android Booking page). Teacher
 * auto-fills from the selected course (one teacher per course).
 */
export default function WindowsBooking() {
  const [windowsRooms, setWindowsRooms] = useState([]);
  const [batches, setBatches] = useState([]);
  const [courses, setCourses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const today = new Date().toISOString().split("T")[0];
  const [form, setForm] = useState({
    title: "",
    roomNumber: "",
    date: today,
    startTime: defaultStartTime(),
    endTime: defaultEndTime(),
    batch: "",
    course: "",
    teacher: "",
    teacherName: "",
    courseName: "",
  });

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
            deviceId: d.deviceId,
          }));
        const seen = new Set();
        const uniqRooms = rooms.filter((r) =>
          seen.has(r.roomNumber) ? false : seen.add(r.roomNumber)
        );
        setWindowsRooms(uniqRooms);

        const batchList = batchesRes.data || [];
        setBatches(batchList);

        setForm((f) => ({
          ...f,
          roomNumber: uniqRooms[0]?.roomNumber ?? "",
          batch: batchList[0]?._id ?? "",
        }));

        if (batchList[0]?._id) await loadCoursesForBatch(batchList[0]._id, true);
      } catch (e) {
        setError(e.response?.data?.error || e.message);
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadCoursesForBatch(batchId, autoSelectFirst) {
    if (!batchId) {
      setCourses([]);
      return;
    }
    try {
      const cr = await api.get(`/batches/${batchId}/courses`);
      const courseList = cr.data || [];
      setCourses(courseList);
      if (autoSelectFirst && courseList[0]) {
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

  async function handleBatchChange(batchId) {
    setForm((f) => ({
      ...f,
      batch: batchId,
      course: "",
      teacher: "",
      teacherName: "",
      courseName: "",
    }));
    await loadCoursesForBatch(batchId, true);
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
    setError("");
    setSuccess("");
    if (!form.course || !form.teacher) {
      setError("Pick a course that has a teacher assigned.");
      return;
    }
    if (form.startTime >= form.endTime) {
      setError("End time must be after start time.");
      return;
    }
    setSubmitting(true);
    try {
      await api.post("/classes", {
        title: form.title,
        course: form.course,
        teacher: form.teacher,
        roomNumber: form.roomNumber,
        date: new Date(form.date).toISOString(),
        startTime: form.startTime,
        endTime: form.endTime,
      });
      setSuccess(
        `Class "${form.title}" scheduled in Room ${form.roomNumber}. The Windows recorder will pick it up on next heartbeat (within 30s).`
      );
      setForm((f) => ({ ...f, title: "" }));
    } catch (e) {
      setError(`Failed: ${e.response?.data?.error || e.message}`);
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="animate-spin text-blue-500" size={32} />
        <span className="ml-3 text-slate-500">Loading Booking...</span>
      </div>
    );
  }

  const noBatch = batches.length === 0;
  const noCourseInBatch = !noBatch && courses.length === 0;

  return (
    <div className="space-y-4 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">Windows Booking</h1>
        <p className="text-sm text-slate-500">
          Schedule a class for a room served by a Windows PC. The device picks
          it up on the next heartbeat (within 30s) and auto-starts at the
          scheduled time.
        </p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded p-3 flex items-center gap-2">
          <AlertTriangle size={16} /> {error}
        </div>
      )}
      {success && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm rounded p-3 flex items-center gap-2">
          <CheckCircle2 size={16} /> {success}
        </div>
      )}

      {windowsRooms.length === 0 ? (
        <EmptyState
          title="No Windows devices registered yet"
          body={
            <>
              Install the Windows recorder on a Mini PC first. Once registered,
              its room will appear in this booking form. See{" "}
              <Link to="/windows/devices" className="text-blue-600 hover:underline">
                Windows → Devices
              </Link>
              .
            </>
          }
        />
      ) : noBatch ? (
        <EmptyState
          title="No batches created yet"
          body={
            <>
              Batches (and the courses + teachers inside them) are org-wide
              data shared with the Android pipeline. Add at least one batch
              under{" "}
              <Link to="/batches" className="text-blue-600 hover:underline">
                Batches
              </Link>{" "}
              first.
            </>
          }
        />
      ) : (
        <form onSubmit={submit} className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <FormRow label="Room" required>
            <select
              value={form.roomNumber}
              onChange={(e) => setForm({ ...form, roomNumber: e.target.value })}
              required
              className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-blue-500"
            >
              {windowsRooms.map((r) => (
                <option key={r.deviceId} value={r.roomNumber}>
                  Room {r.roomNumber} — {r.deviceName} {r.isOnline ? "✅ Online" : "⚠ Offline"}
                </option>
              ))}
            </select>
            <RoomHint room={windowsRooms.find((r) => r.roomNumber === form.roomNumber)} />
          </FormRow>

          <FormRow label="Class title" required>
            <input
              type="text"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="e.g., Algebra 101 — Section A"
              required
              className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-blue-500"
            />
          </FormRow>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormRow label="Batch" required>
              <select
                value={form.batch}
                onChange={(e) => handleBatchChange(e.target.value)}
                required
                className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-blue-500"
              >
                {batches.map((b) => (
                  <option key={b._id} value={b._id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </FormRow>
            <FormRow label="Course" required>
              {noCourseInBatch ? (
                <p className="text-xs text-slate-500 italic">
                  No courses in this batch.{" "}
                  <Link to="/batches" className="text-blue-600 hover:underline">
                    Add one
                  </Link>{" "}
                  first.
                </p>
              ) : (
                <select
                  value={form.course}
                  onChange={(e) => handleCourseChange(e.target.value)}
                  required
                  className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-blue-500"
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
            </FormRow>
          </div>

          <FormRow label="Teacher">
            <input
              value={form.teacherName}
              readOnly
              placeholder="Auto-filled from course"
              className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-lg bg-slate-50 text-slate-600"
            />
          </FormRow>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <FormRow label="Date" required>
              <input
                type="date"
                value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
                min={today}
                required
                className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-blue-500"
              />
            </FormRow>
            <FormRow label="Start time (IST)" required>
              <input
                type="time"
                value={form.startTime}
                onChange={(e) => setForm({ ...form, startTime: e.target.value })}
                required
                className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-blue-500"
              />
            </FormRow>
            <FormRow label="End time (IST)" required>
              <input
                type="time"
                value={form.endTime}
                onChange={(e) => setForm({ ...form, endTime: e.target.value })}
                required
                className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-blue-500"
              />
            </FormRow>
          </div>

          <div className="flex justify-end pt-2">
            <button
              type="submit"
              disabled={submitting || noCourseInBatch}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm rounded-lg flex items-center gap-2"
            >
              <CalendarPlus size={14} />
              {submitting ? "Scheduling..." : "Schedule class"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

function RoomHint({ room }) {
  if (!room) return null;
  return (
    <p className="text-xs text-slate-500 mt-1 flex items-center gap-1">
      {room.isOnline ? (
        <>
          <Wifi size={12} className="text-emerald-500" />
          {room.deviceName} is online — heartbeat is fresh.
        </>
      ) : (
        <>
          <WifiOff size={12} className="text-amber-500" />
          {room.deviceName} is offline. The class is still saved; it will
          auto-start when the device comes back online.
        </>
      )}
    </p>
  );
}

function FormRow({ label, required, children }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-slate-700 mb-1 block">
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </span>
      {children}
    </label>
  );
}

function EmptyState({ title, body }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-8 text-center">
      <AlertTriangle size={32} className="mx-auto text-amber-400 mb-2" />
      <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
      <p className="text-sm text-slate-500 mt-1 max-w-md mx-auto">{body}</p>
    </div>
  );
}

function defaultStartTime() {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  return d.toTimeString().slice(0, 5);
}

function defaultEndTime() {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 2);
  return d.toTimeString().slice(0, 5);
}
