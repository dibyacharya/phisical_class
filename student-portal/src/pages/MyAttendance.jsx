import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, CheckCircle, Calendar } from "lucide-react";
import api from "../services/api";

export default function MyAttendance({ user }) {
  const navigate = useNavigate();
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get("/attendance/my").then((r) => { setRecords(r.data); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 to-purple-50">
      <header className="bg-white shadow-sm">
        <div className="max-w-lg mx-auto px-4 py-4 flex items-center gap-3">
          <button onClick={() => navigate("/")} className="text-gray-500 hover:text-gray-700">
            <ArrowLeft size={20} />
          </button>
          <div>
            <h1 className="text-lg font-bold text-gray-800">My Attendance</h1>
            <p className="text-sm text-gray-500">{user.name} - {user.rollNumber}</p>
          </div>
        </div>
      </header>

      <div className="max-w-lg mx-auto px-4 py-6">
        {/* Summary */}
        <div className="bg-white rounded-2xl shadow-sm border p-6 mb-6 text-center">
          <p className="text-sm text-gray-500">Total Classes Attended</p>
          <p className="text-4xl font-bold text-purple-600 mt-1">{records.length}</p>
        </div>

        {loading ? (
          <div className="text-center text-gray-400 py-8">Loading...</div>
        ) : records.length === 0 ? (
          <div className="bg-white rounded-2xl shadow-sm border p-8 text-center text-gray-400">
            <Calendar size={48} className="mx-auto mb-3 opacity-50" />
            <p>No attendance records yet.</p>
            <p className="text-sm mt-1">Scan a QR code in class to mark attendance.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {records.map((r, i) => (
              <div key={i} className="bg-white rounded-xl shadow-sm border p-4 flex items-center gap-4">
                <div className="bg-green-100 p-2.5 rounded-lg">
                  <CheckCircle size={20} className="text-green-600" />
                </div>
                <div className="flex-1">
                  <p className="font-medium text-gray-800">{r.title || "Class"}</p>
                  <p className="text-sm text-gray-500">{r.courseCode} - {r.courseName}</p>
                  <p className="text-xs text-gray-400 mt-1">
                    Room {r.roomNumber} | {r.date ? new Date(r.date).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : ""} {r.startTime}-{r.endTime}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-gray-400">Scanned</p>
                  <p className="text-sm text-green-600 font-medium">
                    {r.scannedAt ? new Date(r.scannedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "-"}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
