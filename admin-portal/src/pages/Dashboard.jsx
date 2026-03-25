import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { BookOpen, Video, Users, CalendarCheck } from "lucide-react";
import api from "../services/api";

export default function Dashboard() {
  const [stats, setStats] = useState(null);
  const [classes, setClasses] = useState([]);
  const navigate = useNavigate();

  useEffect(() => {
    api.get("/classes/dashboard").then((r) => setStats(r.data)).catch(() => {});
    api.get("/classes").then((r) => setClasses(r.data.slice(0, 5))).catch(() => {});
  }, []);

  const statCards = [
    { label: "Total Classes", value: stats?.totalClasses || 0, icon: BookOpen, color: "bg-blue-500" },
    { label: "Recordings", value: stats?.totalRecordings || 0, icon: Video, color: "bg-emerald-500" },
    { label: "QR Scans", value: stats?.totalAttendanceScans || 0, icon: Users, color: "bg-purple-500" },
    { label: "Today's Classes", value: stats?.todayClasses || 0, icon: CalendarCheck, color: "bg-amber-500" },
  ];

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-800 mb-6">Dashboard</h2>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        {statCards.map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="bg-white rounded-xl shadow-sm border p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">{label}</p>
                <p className="text-3xl font-bold text-gray-800 mt-1">{value}</p>
              </div>
              <div className={`${color} p-3 rounded-lg`}>
                <Icon size={24} className="text-white" />
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-xl shadow-sm border">
        <div className="p-6 border-b">
          <h3 className="text-lg font-semibold">Recent Scheduled Classes</h3>
        </div>
        {classes.length === 0 ? (
          <div className="p-12 text-center text-gray-400">
            No classes scheduled yet. Go to "Schedule Class" to create one.
          </div>
        ) : (
          <div className="divide-y">
            {classes.map((cls) => (
              <div
                key={cls._id}
                className="p-4 px-6 flex items-center justify-between hover:bg-gray-50 cursor-pointer"
                onClick={() => navigate(`/attendance/${cls._id}`)}
              >
                <div>
                  <p className="font-medium text-gray-800">{cls.title}</p>
                  <p className="text-sm text-gray-500">
                    {cls.courseCode} - {cls.courseName} | Room {cls.roomNumber}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm text-gray-600">
                    {new Date(cls.date).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                  </p>
                  <p className="text-xs text-gray-400">
                    {cls.startTime} - {cls.endTime}
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
