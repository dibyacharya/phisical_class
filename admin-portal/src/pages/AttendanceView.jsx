import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, QrCode, Users, CheckCircle, RefreshCw } from "lucide-react";
import api from "../services/api";

export default function AttendanceView() {
  const { classId } = useParams();
  const navigate = useNavigate();
  const [cls, setCls] = useState(null);
  const [attendance, setAttendance] = useState(null);
  const [qrModal, setQrModal] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    try {
      const [clsRes, attRes] = await Promise.all([
        api.get(`/classes/${classId}`),
        api.get(`/attendance/${classId}`),
      ]);
      setCls(clsRes.data);
      setAttendance(attRes.data);
    } catch {
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, [classId]);

  // Auto-refresh every 10 seconds
  useEffect(() => {
    const interval = setInterval(fetchData, 10000);
    return () => clearInterval(interval);
  }, [classId]);

  const handleGenerateQr = async () => {
    try {
      const { data } = await api.post(`/attendance/generate-qr/${classId}`);
      setQrModal(data);
    } catch (err) {
      alert("Failed: " + (err.response?.data?.error || err.message));
    }
  };

  if (loading) return <div className="text-center text-gray-400 py-12">Loading...</div>;
  if (!cls) return <div className="text-center text-red-500 py-12">Class not found</div>;

  const attendees = attendance?.attendees || [];

  return (
    <div>
      <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-gray-500 hover:text-gray-700 mb-4 transition">
        <ArrowLeft size={18} /> Back
      </button>

      {/* Class Info */}
      <div className="bg-white rounded-xl shadow-sm border p-6 mb-6">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-2xl font-bold text-gray-800">{cls.title}</h2>
            <p className="text-gray-500 mt-1">{cls.courseCode} - {cls.courseName}</p>
            <div className="flex items-center gap-4 mt-3 text-sm text-gray-500">
              <span>Teacher: {cls.teacher}</span>
              <span>Room: {cls.roomNumber}</span>
              <span>{new Date(cls.date).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</span>
              <span>{cls.startTime} - {cls.endTime}</span>
            </div>
          </div>
          <button
            onClick={handleGenerateQr}
            className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition"
          >
            <QrCode size={18} /> Generate QR
          </button>
        </div>
      </div>

      {/* Attendance Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-xl shadow-sm border p-5 flex items-center gap-4">
          <div className="bg-emerald-100 p-3 rounded-lg">
            <Users size={24} className="text-emerald-600" />
          </div>
          <div>
            <p className="text-sm text-gray-500">Students Present</p>
            <p className="text-2xl font-bold text-gray-800">{attendees.length}</p>
          </div>
        </div>
        <div className="bg-white rounded-xl shadow-sm border p-5 flex items-center gap-4">
          <div className="bg-blue-100 p-3 rounded-lg">
            <CheckCircle size={24} className="text-blue-600" />
          </div>
          <div>
            <p className="text-sm text-gray-500">Verified Scans</p>
            <p className="text-2xl font-bold text-gray-800">{attendees.filter((a) => a.verified).length}</p>
          </div>
        </div>
        <div className="bg-white rounded-xl shadow-sm border p-5 flex items-center gap-4">
          <div className="bg-purple-100 p-3 rounded-lg">
            <RefreshCw size={24} className="text-purple-600" />
          </div>
          <div>
            <p className="text-sm text-gray-500">Auto-refreshing</p>
            <p className="text-sm font-medium text-green-600 mt-1">Every 10 seconds</p>
          </div>
        </div>
      </div>

      {/* Attendees Table */}
      <div className="bg-white rounded-xl shadow-sm border">
        <div className="p-6 border-b flex items-center justify-between">
          <h3 className="text-lg font-semibold">Attendance List</h3>
          <button onClick={fetchData} className="text-sm text-blue-600 hover:text-blue-800 flex items-center gap-1">
            <RefreshCw size={14} /> Refresh
          </button>
        </div>
        {attendees.length === 0 ? (
          <div className="p-12 text-center text-gray-400">
            No students have scanned yet. Generate a QR code and display it in class.
          </div>
        ) : (
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase">#</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase">Student</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase">Roll Number</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase">Scanned At</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {attendees.map((a, i) => (
                <tr key={a._id || i} className="hover:bg-gray-50">
                  <td className="px-6 py-3 text-sm text-gray-500">{i + 1}</td>
                  <td className="px-6 py-3 text-sm font-medium text-gray-800">{a.name}</td>
                  <td className="px-6 py-3 text-sm text-gray-600">{a.rollNumber || "-"}</td>
                  <td className="px-6 py-3 text-sm text-gray-600">
                    {new Date(a.scannedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                  </td>
                  <td className="px-6 py-3">
                    <span className={`text-xs px-2 py-1 rounded-full font-medium ${a.verified ? "bg-green-100 text-green-700" : "bg-yellow-100 text-yellow-700"}`}>
                      {a.verified ? "Verified" : "Pending"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* QR Modal */}
      {qrModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-md w-full text-center relative">
            <button onClick={() => setQrModal(null)} className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 text-2xl">&times;</button>
            <h3 className="text-xl font-bold mb-2">Scan to Mark Attendance</h3>
            <p className="text-gray-500 text-sm mb-4">Show this QR in the classroom. Expires in {qrModal.expiresIn}s.</p>
            <img src={qrModal.qrCode} alt="QR" className="mx-auto w-64 h-64 border-4 border-gray-100 rounded-xl" />
            <button onClick={handleGenerateQr} className="mt-4 bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 transition">
              Refresh QR
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
