import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Trash2, QrCode, Users, X } from "lucide-react";
import api from "../services/api";

export default function ScheduleClass() {
  const [classes, setClasses] = useState([]);
  const [devices, setDevices] = useState([]);
  const [batches, setBatches] = useState([]);
  const [courses, setCourses] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [qrModal, setQrModal] = useState(null);
  const [qrLoading, setQrLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  const [form, setForm] = useState({
    title: "",
    batch: "",
    course: "",
    teacher: "",
    roomNumber: "",
    date: new Date().toISOString().split("T")[0],
    startTime: "09:00",
    endTime: "10:00",
  });

  const fetchClasses = () => {
    api.get("/classes").then((r) => { setClasses(r.data); setLoading(false); }).catch(() => setLoading(false));
  };

  const fetchDevices = () => {
    api.get("/classroom-recording/devices").then((r) => setDevices(r.data)).catch(() => {});
  };

  const fetchBatches = () => {
    api.get("/batches").then((r) => setBatches(r.data)).catch(() => {});
  };

  useEffect(() => { fetchClasses(); fetchDevices(); fetchBatches(); }, []);

  // When batch changes, fetch courses for that batch
  const handleBatchChange = (batchId) => {
    setForm({ ...form, batch: batchId, course: "", teacher: "" });
    if (batchId) {
      api.get(`/batches/${batchId}/courses`).then((r) => setCourses(r.data)).catch(() => setCourses([]));
    } else {
      setCourses([]);
    }
  };

  // When course changes, auto-fill teacher
  const handleCourseChange = (courseId) => {
    const course = courses.find((c) => c._id === courseId);
    setForm({
      ...form,
      course: courseId,
      teacher: course?.teacher?._id || "",
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await api.post("/classes", {
        title: form.title,
        course: form.course,
        teacher: form.teacher,
        roomNumber: form.roomNumber,
        date: form.date,
        startTime: form.startTime,
        endTime: form.endTime,
      });
      setShowForm(false);
      setForm({ title: "", batch: "", course: "", teacher: "", roomNumber: "", date: new Date().toISOString().split("T")[0], startTime: "09:00", endTime: "10:00" });
      setCourses([]);
      fetchClasses();
    } catch (err) {
      alert(err.response?.data?.error || "Failed to create class");
    }
  };

  const handleDelete = async (id) => {
    if (!confirm("Delete this class and its recording/attendance?")) return;
    await api.delete(`/classes/${id}`);
    fetchClasses();
  };

  const handleGenerateQr = async (classId) => {
    setQrLoading(true);
    try {
      const { data } = await api.post(`/attendance/generate-qr/${classId}`);
      setQrModal(data);
    } catch (err) {
      alert("Failed to generate QR: " + (err.response?.data?.error || err.message));
    } finally {
      setQrLoading(false);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-800">Schedule Classes</h2>
        <button onClick={() => setShowForm(!showForm)} className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition">
          <Plus size={18} /> New Class
        </button>
      </div>

      {/* Create Form */}
      {showForm && (
        <div className="bg-white rounded-xl shadow-sm border p-6 mb-6">
          <h3 className="text-lg font-semibold mb-4">Schedule a New Class</h3>
          <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Class Title</label>
              <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" placeholder="e.g. Lecture 1 - Arrays" required />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Batch</label>
              <select value={form.batch} onChange={(e) => handleBatchChange(e.target.value)} className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none bg-white" required>
                <option value="">-- Select Batch --</option>
                {batches.map((b) => <option key={b._id} value={b._id}>{b.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Course</label>
              <select value={form.course} onChange={(e) => handleCourseChange(e.target.value)} className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none bg-white" required disabled={!form.batch}>
                <option value="">{form.batch ? "-- Select Course --" : "Select batch first"}</option>
                {courses.map((c) => <option key={c._id} value={c._id}>{c.courseCode} - {c.courseName}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Teacher</label>
              <input
                value={form.teacher ? (courses.find(c => c._id === form.course)?.teacher?.name || form.teacher) : ""}
                className="w-full px-3 py-2 border rounded-lg bg-gray-50 text-gray-600 outline-none"
                placeholder="Auto-filled from course"
                readOnly
              />
              {form.course && !form.teacher && <p className="text-xs text-amber-500 mt-1">No teacher assigned to this course</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Recording Device / Room</label>
              {devices.length > 0 ? (
                <select value={form.roomNumber} onChange={(e) => setForm({ ...form, roomNumber: e.target.value })} className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none bg-white" required>
                  <option value="">-- Select Device --</option>
                  {devices.map((d) => {
                    const online = d.lastHeartbeat && (Date.now() - new Date(d.lastHeartbeat).getTime() < 5 * 60 * 1000);
                    return <option key={d._id} value={d.roomNumber || d.roomId}>{d.name} — Room {d.roomNumber || d.roomId} {online ? "(Online)" : "(Offline)"}</option>;
                  })}
                </select>
              ) : (
                <div>
                  <input value={form.roomNumber} onChange={(e) => setForm({ ...form, roomNumber: e.target.value })} className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" placeholder="e.g. A-101" required />
                  <p className="text-xs text-amber-500 mt-1">No devices registered.</p>
                </div>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
              <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" required />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Start Time</label>
              <input type="time" value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" required />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">End Time</label>
              <input type="time" value={form.endTime} onChange={(e) => setForm({ ...form, endTime: e.target.value })} className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" required />
            </div>
            <div className="md:col-span-2 flex gap-3 pt-2">
              <button type="submit" className="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 transition">Create Class</button>
              <button type="button" onClick={() => setShowForm(false)} className="bg-gray-100 text-gray-600 px-6 py-2 rounded-lg hover:bg-gray-200 transition">Cancel</button>
            </div>
          </form>
        </div>
      )}

      {/* Classes List */}
      <div className="bg-white rounded-xl shadow-sm border">
        <div className="p-6 border-b">
          <h3 className="text-lg font-semibold">All Scheduled Classes</h3>
        </div>
        {loading ? (
          <div className="p-12 text-center text-gray-400">Loading...</div>
        ) : classes.length === 0 ? (
          <div className="p-12 text-center text-gray-400">No classes scheduled yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase">Class</th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase">Course</th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase">Teacher</th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase">Room</th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase">Date & Time</th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {classes.map((cls) => (
                  <tr key={cls._id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 font-medium text-gray-800">{cls.title}</td>
                    <td className="px-6 py-4 text-sm text-gray-600">
                      {cls.course?.courseCode || cls.courseCode || "—"}
                      {(cls.course?.courseName || cls.courseName) && (
                        <span className="block text-xs text-gray-400">{cls.course?.courseName || cls.courseName}</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600">{cls.teacher?.name || cls.teacherName || cls.teacher || "—"}</td>
                    <td className="px-6 py-4 text-sm text-gray-600">{cls.roomNumber}</td>
                    <td className="px-6 py-4 text-sm text-gray-600">
                      {new Date(cls.date).toLocaleDateString("en-IN", { day: "numeric", month: "short" })} | {cls.startTime}-{cls.endTime}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <button onClick={() => handleGenerateQr(cls._id)} className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition" title="Generate QR"><QrCode size={18} /></button>
                        <button onClick={() => navigate(`/attendance/${cls._id}`)} className="p-2 text-emerald-600 hover:bg-emerald-50 rounded-lg transition" title="View Attendance"><Users size={18} /></button>
                        <button onClick={() => handleDelete(cls._id)} className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition" title="Delete"><Trash2 size={18} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* QR Modal */}
      {qrModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-md w-full text-center relative">
            <button onClick={() => setQrModal(null)} className="absolute top-4 right-4 text-gray-400 hover:text-gray-600"><X size={24} /></button>
            <h3 className="text-xl font-bold mb-2">Attendance QR Code</h3>
            <p className="text-gray-500 text-sm mb-4">Students scan this to mark attendance. Expires in {qrModal.expiresIn}s.</p>
            <img src={qrModal.qrCode} alt="QR Code" className="mx-auto w-64 h-64 border-4 border-gray-100 rounded-xl" />
            <p className="text-xs text-gray-400 mt-4 break-all">{qrModal.qrData}</p>
          </div>
        </div>
      )}
    </div>
  );
}
