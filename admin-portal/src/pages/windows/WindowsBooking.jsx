import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { Link } from "react-router-dom";
import {
  CalendarPlus, RefreshCw, AlertTriangle, CheckCircle2, Wifi, WifiOff,
  List, Upload, Search, Filter, Trash2, QrCode, Download, FileText,
  X, Clock, Video, Plus, Activity, MapPin,
} from "lucide-react";
import api from "../../services/api";
import { winDevices } from "../../services/windowsApi";
import { usePersistedState } from "../../hooks/usePersistedState";

/**
 * Windows Booking — feature-parity with Android Booking. Three tabs:
 *
 *   "schedule" — single-form booking for a Windows-served room
 *                with day Gantt for conflict visualization.
 *   "list"     — all classes filtered to rooms that have a Windows
 *                device, with search / status filter / delete / QR.
 *   "upload"   — CSV bulk import (uses the same /api/classes/bulk-create
 *                endpoint as Android).
 *
 * Backend /api/classes is shared with Android (ScheduledClass model is
 * pipeline-agnostic), so admins can manage both pipelines from this page
 * — but here we constrain the room list to Windows-served rooms only.
 */
export default function WindowsBooking() {
  const [activeTab, setActiveTab] = usePersistedState("schedule", "win_booking_tab");
  const [windowsRooms, setWindowsRooms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Load Windows rooms once (used by all 3 tabs)
  useEffect(() => {
    (async () => {
      try {
        const d = await winDevices.list();
        const rooms = (d.devices || [])
          .filter((x) => x.isActive)
          .map((x) => ({
            roomNumber: x.roomNumber,
            deviceName: x.name,
            isOnline: x.isOnline,
            deviceId: x.deviceId,
            campus: x.campus || "",
            block: x.block || "",
            floor: x.floor || "",
          }));
        const seen = new Set();
        setWindowsRooms(
          rooms.filter((r) => (seen.has(r.roomNumber) ? false : seen.add(r.roomNumber)))
        );
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="animate-spin text-blue-500" size={32} />
        <span className="ml-3 text-slate-500">Loading Booking...</span>
      </div>
    );
  }

  const TABS = [
    { id: "schedule", label: "Schedule", icon: CalendarPlus },
    { id: "list",     label: "All bookings", icon: List },
    { id: "upload",   label: "CSV upload", icon: Upload },
  ];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">Windows Booking</h1>
        <p className="text-sm text-slate-500">
          Schedule classes for Windows-served rooms · {windowsRooms.length} room
          {windowsRooms.length === 1 ? "" : "s"} registered
        </p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded p-3 flex items-center gap-2">
          <AlertTriangle size={16} /> {error}
        </div>
      )}

      {/* Tabs */}
      <div className="border-b border-slate-200 flex gap-1 overflow-x-auto">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = activeTab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={`px-4 py-2 flex items-center gap-2 text-sm font-medium border-b-2 transition ${
                active
                  ? "border-blue-500 text-blue-600"
                  : "border-transparent text-slate-500 hover:text-slate-800"
              }`}
            >
              <Icon size={16} />
              {t.label}
            </button>
          );
        })}
      </div>

      {activeTab === "schedule" && <ScheduleTab windowsRooms={windowsRooms} />}
      {activeTab === "list" && <ListTab windowsRooms={windowsRooms} />}
      {activeTab === "upload" && <UploadTab windowsRooms={windowsRooms} />}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// TAB 1: Schedule — single-class booking form with day Gantt
// ─────────────────────────────────────────────────────────────

function ScheduleTab({ windowsRooms }) {
  const today = new Date().toISOString().split("T")[0];
  const [batches, setBatches] = useState([]);
  const [courses, setCourses] = useState([]);
  const [daySchedule, setDaySchedule] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState("");
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    title: "",
    roomNumber: windowsRooms[0]?.roomNumber || "",
    date: today,
    startTime: defaultStartTime(),
    endTime: defaultEndTime(),
    batch: "",
    course: "",
    teacher: "",
    teacherName: "",
    courseName: "",
  });

  // Load batches
  useEffect(() => {
    api.get("/batches").then((r) => {
      setBatches(r.data || []);
      if (r.data?.[0]) handleBatchChange(r.data[0]._id, true);
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load day schedule when room+date changes
  useEffect(() => {
    if (!form.roomNumber || !form.date) {
      setDaySchedule([]);
      return;
    }
    api
      .get(`/classes`)
      .then((r) => {
        const items = (r.data || []).filter((c) => {
          const sameRoom = String(c.roomNumber) === String(form.roomNumber);
          if (!sameRoom) return false;
          const cd = new Date(c.date).toISOString().split("T")[0];
          return cd === form.date;
        });
        setDaySchedule(items);
      })
      .catch(() => setDaySchedule([]));
  }, [form.roomNumber, form.date]);

  async function handleBatchChange(batchId, autoSelectFirst) {
    setForm((f) => ({
      ...f,
      batch: batchId,
      course: "",
      teacher: "",
      teacherName: "",
      courseName: "",
    }));
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
          batch: batchId,
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
    // Conflict check (client-side warning, backend also enforces)
    const conflict = daySchedule.find((c) => {
      const cs = toMin(c.startTime),
        ce = toMin(c.endTime),
        fs = toMin(form.startTime),
        fe = toMin(form.endTime);
      return fs < ce && fe > cs;
    });
    if (conflict) {
      if (
        !confirm(
          `Conflict with "${conflict.title}" (${conflict.startTime}–${conflict.endTime}). Schedule anyway?`
        )
      )
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
        // Pin to Windows recorder — the Android TV ClassroomRecorder in the
        // same room (if any) will NOT see this class on its next heartbeat
        // and therefore won't wake the screen / steal HDMI input.
        assignedPlatform: "windows",
      });
      setSuccess(
        `Class "${form.title}" scheduled in Room ${form.roomNumber} on Windows recorder. Device picks it up on next heartbeat (within 30s).`
      );
      setForm((f) => ({ ...f, title: "" }));
      // refresh day schedule
      api.get(`/classes`).then((r) => {
        setDaySchedule(
          (r.data || []).filter(
            (c) =>
              String(c.roomNumber) === String(form.roomNumber) &&
              new Date(c.date).toISOString().split("T")[0] === form.date
          )
        );
      });
    } catch (e) {
      setError(`Failed: ${e.response?.data?.error || e.message}`);
    } finally {
      setSubmitting(false);
    }
  }

  const noBatch = batches.length === 0;
  const noCourseInBatch = !noBatch && courses.length === 0;

  if (windowsRooms.length === 0) {
    return (
      <EmptyState
        title="No Windows devices registered yet"
        body={
          <>
            Install the Windows recorder on a Mini PC first. Once registered,
            its room will appear in this form. See{" "}
            <Link to="/windows/devices" className="text-blue-600 hover:underline">
              Windows → Devices
            </Link>
            .
          </>
        }
      />
    );
  }
  if (noBatch) {
    return (
      <EmptyState
        title="No batches created yet"
        body={
          <>
            Batches (and the courses + teachers inside them) are org-wide data
            shared with the Android pipeline. Add at least one under{" "}
            <Link to="/batches" className="text-blue-600 hover:underline">
              Batches
            </Link>{" "}
            first.
          </>
        }
      />
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div className="lg:col-span-2">
        <form
          onSubmit={submit}
          className="bg-white border border-slate-200 rounded-xl p-5 space-y-4"
        >
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

          <FormRow label="Room" required>
            <select
              value={form.roomNumber}
              onChange={(e) => setForm({ ...form, roomNumber: e.target.value })}
              required
              className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-blue-500"
            >
              {windowsRooms.map((r) => (
                <option key={r.deviceId} value={r.roomNumber}>
                  {roomLoc(r) ? `${roomLoc(r)} · ` : ""}Room {r.roomNumber} — {r.deviceName} {r.isOnline ? "✅ Online" : "⚠ Offline"}
                </option>
              ))}
            </select>
            <RoomHint
              room={windowsRooms.find((r) => r.roomNumber === form.roomNumber)}
            />
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
                onChange={(e) => handleBatchChange(e.target.value, true)}
                required
                className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-blue-500"
              >
                <option value="">— pick a batch —</option>
                {batches.map((b) => (
                  <option key={b._id} value={b._id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </FormRow>
            <FormRow label="Course" required>
              {noCourseInBatch ? (
                <p className="text-xs text-slate-500 italic mt-2">
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
                  <option value="">— pick a course —</option>
                  {courses.map((c) => (
                    <option key={c._id} value={c._id}>
                      {c.courseCode ? `${c.courseCode} - ` : ""}
                      {c.courseName}
                      {c.teacher?.name
                        ? ` (${c.teacher.name})`
                        : " (no teacher!)"}
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
      </div>

      {/* Day Gantt — visual conflict detection */}
      <div className="lg:col-span-1">
        <DayGantt
          schedule={daySchedule}
          selStart={form.startTime}
          selEnd={form.endTime}
          room={form.roomNumber}
          date={form.date}
          onClickTime={(t) => setForm({ ...form, startTime: t })}
        />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// TAB 2: List — all bookings filtered to Windows rooms
// ─────────────────────────────────────────────────────────────

function ListTab({ windowsRooms }) {
  const [classes, setClasses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [roomFilter, setRoomFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [qrModal, setQrModal] = useState(null);

  const winRoomSet = useMemo(
    () => new Set(windowsRooms.map((r) => String(r.roomNumber))),
    [windowsRooms]
  );

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      setError("");
      const r = await api.get("/classes");
      setClasses(r.data || []);
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleDelete(cls) {
    if (!confirm(`Delete "${cls.title}" (Room ${cls.roomNumber}, ${cls.startTime})?\n\nAny recording / attendance data for this class will also be removed.`)) return;
    try {
      await api.delete(`/classes/${cls._id}`);
      load();
    } catch (e) {
      alert(`Failed: ${e.response?.data?.error || e.message}`);
    }
  }

  async function handleGenerateQr(cls) {
    try {
      const { data } = await api.post(`/attendance/generate-qr/${cls._id}`);
      setQrModal({ ...data, cls });
    } catch (e) {
      alert(`Failed to generate QR: ${e.response?.data?.error || e.message}`);
    }
  }

  const filtered = useMemo(() => {
    return classes.filter((c) => {
      // Only Windows rooms
      if (!winRoomSet.has(String(c.roomNumber))) return false;
      if (roomFilter !== "all" && String(c.roomNumber) !== roomFilter)
        return false;
      if (statusFilter !== "all") {
        const s = (c.status || "").toLowerCase();
        if (s !== statusFilter) return false;
      }
      if (search.trim()) {
        const q = search.toLowerCase();
        const fields = [
          c.title, c.courseName, c.courseCode, c.teacherName, c.roomNumber,
        ].filter(Boolean).map((v) => String(v).toLowerCase());
        if (!fields.some((f) => f.includes(q))) return false;
      }
      return true;
    });
  }, [classes, winRoomSet, roomFilter, statusFilter, search]);

  if (loading) return <div className="text-sm text-slate-500">Loading classes...</div>;

  return (
    <div className="space-y-3">
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded p-3 flex items-center gap-2">
          <AlertTriangle size={16} /> {error}
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-xl p-3 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search title / course / teacher / room..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-8 pr-2 py-1.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-blue-500"
          />
        </div>
        <div className="flex items-center gap-1 text-xs">
          <Filter size={12} className="text-slate-400" />
          <span className="text-slate-500 mr-1">Room:</span>
          <select
            value={roomFilter}
            onChange={(e) => setRoomFilter(e.target.value)}
            className="text-xs border border-slate-300 rounded px-2 py-1"
          >
            <option value="all">All</option>
            {windowsRooms.map((r) => (
              <option key={r.roomNumber} value={r.roomNumber}>
                {roomLoc(r) ? `${roomLoc(r)} · ` : ""}Room {r.roomNumber}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-1 text-xs">
          <span className="text-slate-500 mr-1">Status:</span>
          {["all", "scheduled", "completed", "missed"].map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-2 py-1 rounded ${
                statusFilter === s
                  ? "bg-blue-100 text-blue-700"
                  : "text-slate-500 hover:bg-slate-100"
              }`}
            >
              {s === "all" ? "All" : s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
        <button
          onClick={load}
          disabled={refreshing}
          className="p-1.5 hover:bg-slate-100 rounded disabled:opacity-50"
          title="Refresh"
        >
          <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} />
        </button>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-slate-500 bg-slate-50 border-b border-slate-200">
                <th className="py-2 px-3">Class</th>
                <th className="py-2 px-3">Room</th>
                <th className="py-2 px-3">Date</th>
                <th className="py-2 px-3">Time</th>
                <th className="py-2 px-3">Status</th>
                <th className="py-2 px-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <ClassRow
                  key={c._id}
                  c={c}
                  loc={roomLoc(windowsRooms.find((r) => String(r.roomNumber) === String(c.roomNumber)))}
                  onDelete={() => handleDelete(c)}
                  onQr={() => handleGenerateQr(c)}
                />
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-10 text-center text-slate-400 text-sm">
                    {classes.length === 0
                      ? "No classes scheduled yet. Use the Schedule tab to create one."
                      : "No classes match the current filters."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {qrModal && <QrModal data={qrModal} onClose={() => setQrModal(null)} />}
    </div>
  );
}

function ClassRow({ c, loc, onDelete, onQr }) {
  const status = (c.status || "scheduled").toLowerCase();
  const cfg = {
    scheduled: "bg-blue-100 text-blue-700",
    completed: "bg-emerald-100 text-emerald-700",
    missed:    "bg-amber-100 text-amber-700",
    cancelled: "bg-slate-100 text-slate-600",
  }[status] || "bg-slate-100 text-slate-600";

  const date = new Date(c.date);
  const isPast = date < new Date(new Date().toISOString().split("T")[0]);

  return (
    <tr className="border-b border-slate-100 hover:bg-slate-50">
      <td className="py-2 px-3 max-w-xs">
        <div className="font-medium text-slate-800 truncate">{c.title}</div>
        <div className="text-xs text-slate-500 truncate">
          {c.courseCode ? `${c.courseCode} · ` : ""}
          {c.courseName}
          {c.teacherName ? ` · ${c.teacherName}` : ""}
        </div>
      </td>
      <td className="py-2 px-3 text-xs">
        <div className="text-slate-700">Room {c.roomNumber}</div>
        {loc && <div className="text-[10px] text-slate-400">{loc}</div>}
      </td>
      <td className="py-2 px-3 text-xs">
        {date.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
        {isPast && (
          <span className="ml-1 text-[10px] text-slate-400">past</span>
        )}
      </td>
      <td className="py-2 px-3 text-xs font-mono">
        {c.startTime} – {c.endTime}
      </td>
      <td className="py-2 px-3">
        <span className={`text-[10px] px-2 py-0.5 rounded-full ${cfg}`}>
          {status}
        </span>
      </td>
      <td className="py-2 px-3">
        <div className="flex items-center gap-2">
          <button
            onClick={onQr}
            className="text-xs text-blue-600 hover:underline flex items-center gap-1"
            title="Generate QR for attendance"
          >
            <QrCode size={12} /> QR
          </button>
          <button
            onClick={onDelete}
            className="text-xs text-red-600 hover:underline flex items-center gap-1"
            title="Delete this booking"
          >
            <Trash2 size={12} /> Delete
          </button>
        </div>
      </td>
    </tr>
  );
}

function QrModal({ data, onClose }) {
  return (
    <Modal title={`QR · ${data.cls.title}`} onClose={onClose}>
      <div className="text-center">
        {data.qrCodeDataURL || data.qrCode ? (
          <img
            src={data.qrCodeDataURL || data.qrCode}
            alt="Attendance QR"
            className="mx-auto border border-slate-200 rounded-lg"
            style={{ width: 256, height: 256 }}
          />
        ) : (
          <div className="text-sm text-slate-500">No QR returned</div>
        )}
        <p className="text-xs text-slate-500 mt-3">
          Room {data.cls.roomNumber} ·{" "}
          {new Date(data.cls.date).toLocaleDateString()} · {data.cls.startTime}–{data.cls.endTime}
        </p>
        {data.qrCodeDataURL && (
          <a
            href={data.qrCodeDataURL}
            download={`qr-${data.cls.title}.png`}
            className="inline-flex items-center gap-1 mt-3 text-xs text-blue-600 hover:underline"
          >
            <Download size={12} /> Download PNG
          </a>
        )}
      </div>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────
// TAB 3: Upload — CSV bulk import
// ─────────────────────────────────────────────────────────────

function UploadTab({ windowsRooms }) {
  const [rows, setRows] = useState([]);
  const [filename, setFilename] = useState("");
  const [validating, setValidating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef();

  const winRoomSet = useMemo(
    () => new Set(windowsRooms.map((r) => String(r.roomNumber))),
    [windowsRooms]
  );

  function downloadTemplate() {
    const sampleRoom = windowsRooms[0]?.roomNumber || "001";
    const csv = [
      "title,date,startTime,endTime,roomNumber,courseCode,teacherName,courseName",
      `Algebra Ch. 1,${new Date().toISOString().split("T")[0]},09:00,10:30,${sampleRoom},m1,Rishi,Mathematics`,
      `Physics Lab,${new Date().toISOString().split("T")[0]},11:00,12:30,${sampleRoom},p1,Sneha,Physics`,
    ].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "windows_timetable_template.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  function parseCSV(text) {
    const lines = text.trim().split(/\r?\n/);
    if (lines.length < 2) return [];
    const headers = lines[0].split(",").map((h) => h.trim());
    return lines.slice(1).map((line, idx) => {
      const cols = line.split(",").map((c) => c.trim());
      const row = { _row: idx + 2 };
      headers.forEach((h, i) => (row[h] = cols[i] || ""));
      return row;
    });
  }

  function handleFile(file) {
    if (!file) return;
    setFilename(file.name);
    setResult(null);
    const reader = new FileReader();
    reader.onload = (e) => {
      const parsed = parseCSV(e.target.result);
      setRows(parsed);
    };
    reader.readAsText(file);
  }

  function handleDrop(e) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    handleFile(file);
  }

  function validateRow(r) {
    const errors = [];
    if (!r.title) errors.push("title");
    if (!r.date) errors.push("date");
    if (!r.startTime) errors.push("startTime");
    if (!r.endTime) errors.push("endTime");
    if (!r.roomNumber) errors.push("roomNumber");
    else if (!winRoomSet.has(String(r.roomNumber)))
      errors.push("roomNumber (not a Windows room)");
    if (!r.courseCode && !r.courseName) errors.push("courseCode or courseName");
    if (!r.teacherName) errors.push("teacherName");
    return errors;
  }

  async function importAll() {
    if (rows.length === 0) return;
    const validRows = rows.filter((r) => validateRow(r).length === 0);
    if (validRows.length === 0) {
      alert("No valid rows to import. Fix the errors first.");
      return;
    }
    setImporting(true);
    setResult(null);
    try {
      // Whole CSV import from Windows Booking → pin every row to Windows recorder.
      // Backend's bulk-create reads req.body.assignedPlatform as the default for
      // rows that don't carry the field themselves (see classController bulk path).
      const { data } = await api.post("/classes/bulk-create", { rows: validRows, assignedPlatform: "windows" });
      setResult(data);
    } catch (e) {
      alert(`Import failed: ${e.response?.data?.error || e.message}`);
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-900">
        <p className="font-medium mb-2">CSV format</p>
        <p className="text-blue-700 text-xs mb-2">
          Columns: <code className="bg-white px-1 rounded">title, date, startTime, endTime, roomNumber, courseCode, teacherName, courseName</code>
        </p>
        <p className="text-blue-700 text-xs mb-2">
          Date format: <code className="bg-white px-1 rounded">YYYY-MM-DD</code>. Time: <code className="bg-white px-1 rounded">HH:MM</code> (IST 24-hour).
          Provide either <code>courseCode</code> or <code>courseName</code>.
          <code>teacherName</code> must match a registered teacher's name.
        </p>
        <p className="text-blue-700 text-xs">
          Only Windows-served rooms are allowed in this importer. Rows with non-Windows rooms are flagged.
        </p>
        <button
          onClick={downloadTemplate}
          className="mt-2 text-xs px-3 py-1 bg-white border border-blue-300 rounded text-blue-700 hover:bg-blue-100 flex items-center gap-1 w-fit"
        >
          <Download size={12} /> Download template
        </button>
      </div>

      {/* Dropzone */}
      <div
        onDrop={handleDrop}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onClick={() => fileRef.current?.click()}
        className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition ${
          dragOver
            ? "border-blue-500 bg-blue-50"
            : "border-slate-300 hover:border-slate-400 bg-white"
        }`}
      >
        <Upload size={32} className="mx-auto text-slate-400 mb-2" />
        <p className="text-sm text-slate-600">
          {filename ? (
            <>
              <strong>{filename}</strong> ({rows.length} rows parsed)
            </>
          ) : (
            "Drop a CSV here or click to pick one"
          )}
        </p>
        <input
          ref={fileRef}
          type="file"
          accept=".csv"
          className="hidden"
          onChange={(e) => handleFile(e.target.files?.[0])}
        />
      </div>

      {/* Parsed preview */}
      {rows.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-4 py-2 border-b border-slate-200 flex items-center justify-between">
            <h3 className="text-sm font-medium text-slate-800">
              Preview ({rows.length} rows · {rows.filter((r) => validateRow(r).length === 0).length} valid)
            </h3>
            <button
              onClick={importAll}
              disabled={importing}
              className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm rounded flex items-center gap-1"
            >
              <Upload size={12} />
              {importing ? "Importing..." : `Import valid rows`}
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-slate-500 bg-slate-50 border-b border-slate-200">
                  <th className="py-2 px-3">#</th>
                  <th className="py-2 px-3">Title</th>
                  <th className="py-2 px-3">Date</th>
                  <th className="py-2 px-3">Time</th>
                  <th className="py-2 px-3">Room</th>
                  <th className="py-2 px-3">Course</th>
                  <th className="py-2 px-3">Teacher</th>
                  <th className="py-2 px-3">Errors</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const errs = validateRow(r);
                  return (
                    <tr
                      key={i}
                      className={`border-b border-slate-100 ${errs.length > 0 ? "bg-red-50" : ""}`}
                    >
                      <td className="py-1 px-3 text-xs">{r._row}</td>
                      <td className="py-1 px-3 text-xs">{r.title}</td>
                      <td className="py-1 px-3 text-xs">{r.date}</td>
                      <td className="py-1 px-3 text-xs font-mono">
                        {r.startTime}-{r.endTime}
                      </td>
                      <td className="py-1 px-3 text-xs">{r.roomNumber}</td>
                      <td className="py-1 px-3 text-xs">
                        {r.courseCode || r.courseName}
                      </td>
                      <td className="py-1 px-3 text-xs">{r.teacherName}</td>
                      <td className="py-1 px-3 text-[10px] text-red-700">
                        {errs.join(", ")}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Import result */}
      {result && (
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <h3 className="text-sm font-medium text-slate-800 mb-2">Import result</h3>
          <p className="text-sm text-emerald-700 mb-2">
            ✅ Created: {result.created?.length || 0}
          </p>
          {result.failed?.length > 0 && (
            <div>
              <p className="text-sm text-red-700 mb-1">
                ❌ Failed: {result.failed.length}
              </p>
              <ul className="text-xs text-red-700 space-y-1 ml-4 list-disc">
                {result.failed.slice(0, 10).map((f, i) => (
                  <li key={i}>
                    Row "{f.title || f.row?.title || "?"}": {f.error}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function DayGantt({ schedule, selStart, selEnd, room, date, onClickTime }) {
  // 8:00 → 18:00 = 600 minutes wide
  const DAY_START = 8 * 60;
  const DAY_END = 18 * 60;
  const RANGE = DAY_END - DAY_START;
  const barRef = useRef();
  const hours = [8, 10, 12, 14, 16, 18];

  function leftPct(t) {
    return Math.max(0, ((toMin(t) - DAY_START) / RANGE) * 100);
  }
  function widthPct(s, e) {
    return Math.max(0, ((toMin(e) - toMin(s)) / RANGE) * 100);
  }

  function handleClick(e) {
    if (!barRef.current) return;
    const rect = barRef.current.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    const min = DAY_START + pct * RANGE;
    const snap = Math.round(min / 30) * 30;
    const h = Math.floor(snap / 60),
      m = snap % 60;
    const timeStr = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    if (toMin(timeStr) >= DAY_START && toMin(timeStr) <= DAY_END - 30)
      onClickTime(timeStr);
  }

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 sticky top-4">
      <h3 className="text-sm font-semibold text-slate-800 mb-1 flex items-center gap-1">
        <Activity size={14} /> Day schedule
      </h3>
      <p className="text-xs text-slate-500 mb-3">
        Room {room || "?"} ·{" "}
        {date
          ? new Date(date).toLocaleDateString("en-IN", {
              day: "numeric",
              month: "short",
              year: "numeric",
            })
          : "?"}
      </p>

      {/* Hour labels */}
      <div className="relative h-4 mb-1 text-[10px] text-slate-400">
        {hours.map((h) => (
          <span
            key={h}
            className="absolute -translate-x-1/2"
            style={{ left: `${((h * 60 - DAY_START) / RANGE) * 100}%` }}
          >
            {h}
          </span>
        ))}
      </div>

      {/* Bar */}
      <div
        ref={barRef}
        onClick={handleClick}
        className="relative h-10 bg-slate-100 rounded-lg cursor-crosshair border border-slate-200 overflow-hidden"
      >
        {/* Hour grid lines */}
        {[9, 10, 11, 12, 13, 14, 15, 16, 17].map((h) => (
          <div
            key={h}
            className="absolute top-0 bottom-0 w-px bg-slate-200"
            style={{ left: `${((h * 60 - DAY_START) / RANGE) * 100}%` }}
          />
        ))}

        {/* Existing bookings */}
        {schedule.map((c) => (
          <div
            key={c._id}
            title={`${c.title} (${c.startTime}–${c.endTime})`}
            className="absolute top-1 bottom-1 bg-red-400 rounded-md flex items-center px-2 text-white text-[10px] truncate"
            style={{
              left: `${leftPct(c.startTime)}%`,
              width: `${widthPct(c.startTime, c.endTime)}%`,
            }}
          >
            {c.title}
          </div>
        ))}

        {/* User's selection */}
        {selStart && selEnd && toMin(selEnd) > toMin(selStart) && (
          <div
            className="absolute top-1 bottom-1 bg-blue-500 rounded-md flex items-center px-2 text-white text-[10px] font-semibold truncate opacity-90"
            style={{
              left: `${leftPct(selStart)}%`,
              width: `${widthPct(selStart, selEnd)}%`,
            }}
          >
            {selStart}–{selEnd}
          </div>
        )}
      </div>

      <div className="flex gap-3 mt-2 text-[10px] text-slate-500">
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 bg-red-400 rounded-sm" /> Booked
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 bg-blue-500 rounded-sm" /> Your selection
        </span>
        <span className="italic">Click bar = set start time</span>
      </div>

      {schedule.length > 0 && (
        <div className="mt-3 pt-3 border-t border-slate-200 space-y-1">
          <p className="text-[10px] uppercase text-slate-400 font-semibold mb-1">
            Existing ({schedule.length})
          </p>
          {schedule.map((c) => (
            <div key={c._id} className="text-xs flex items-center gap-2">
              <Clock size={10} className="text-slate-400" />
              <span className="font-mono text-slate-500">
                {c.startTime}-{c.endTime}
              </span>
              <span className="text-slate-700 truncate">{c.title}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// "Campus · Block · Floor" for a Windows room record — only the parts present.
function roomLoc(r) {
  if (!r) return "";
  return [r.campus, r.block, r.floor && `Floor ${r.floor}`].filter(Boolean).join(" · ");
}

function RoomHint({ room }) {
  if (!room) return null;
  const loc = roomLoc(room);
  return (
    <div className="mt-1 space-y-0.5">
      <p className="text-xs text-slate-600 flex items-center gap-1">
        <MapPin size={12} className="text-slate-400" />
        {loc ? `${loc} · ` : ""}Room {room.roomNumber}
      </p>
      <p className="text-xs text-slate-500 flex items-center gap-1">
        {room.isOnline ? (
          <>
            <Wifi size={12} className="text-emerald-500" />
            {room.deviceName} is online — heartbeat fresh.
          </>
        ) : (
          <>
            <WifiOff size={12} className="text-amber-500" />
            {room.deviceName} is offline. Class is still saved; auto-starts when device comes back.
          </>
        )}
      </p>
    </div>
  );
}

function Modal({ title, onClose, children }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200">
          <h2 className="font-semibold text-slate-800 text-sm">{title}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
            <X size={18} />
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

function toMin(t) {
  if (!t) return 0;
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
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
