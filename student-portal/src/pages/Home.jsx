import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { BookOpen, LogOut, QrCode, User } from "lucide-react";
import api from "../services/api";

export default function Home({ user, onLogout }) {
  const [courses, setCourses] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    api.get("/courses/my")
      .then((r) => { setCourses(r.data); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const isTeacher = user?.role === "teacher";

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-gray-800">
              {isTeacher ? "Teacher Portal" : "Student Portal"}
            </h1>
            <p className="text-xs text-gray-500">{user?.name} {user?.rollNumber ? `(${user.rollNumber})` : user?.employeeId ? `(${user.employeeId})` : ""}</p>
          </div>
          <div className="flex items-center gap-3">
            {!isTeacher && (
              <button
                onClick={() => navigate("/scan")}
                className="flex items-center gap-1.5 bg-purple-600 text-white px-3 py-2 rounded-lg text-sm hover:bg-purple-700 transition"
              >
                <QrCode size={16} /> Scan QR
              </button>
            )}
            <button onClick={onLogout} className="flex items-center gap-1.5 text-gray-500 hover:text-red-500 text-sm transition">
              <LogOut size={16} /> Logout
            </button>
          </div>
        </div>
      </header>

      {/* Content */}
      <div className="max-w-5xl mx-auto px-4 py-6">
        <h2 className="text-xl font-bold text-gray-800 mb-1">My Courses</h2>
        <p className="text-sm text-gray-500 mb-6">
          {isTeacher ? "Courses assigned to you" : "Courses in your batch"}
        </p>

        {loading ? (
          <div className="text-center text-gray-400 py-12">Loading courses...</div>
        ) : courses.length === 0 ? (
          <div className="bg-white rounded-xl shadow-sm border p-12 text-center text-gray-400">
            <BookOpen size={48} className="mx-auto mb-3 opacity-50" />
            <p>No courses assigned yet.</p>
            <p className="text-sm mt-1">Contact admin to assign you to a batch.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {courses.map((course) => (
              <div
                key={course._id}
                onClick={() => navigate(`/course/${course._id}`)}
                className="bg-white rounded-xl shadow-sm border p-5 cursor-pointer hover:shadow-md hover:border-purple-200 transition group"
              >
                <div className="flex items-start justify-between mb-3">
                  <span className="text-xs font-mono font-bold text-purple-600 bg-purple-50 px-2 py-1 rounded">
                    {course.courseCode}
                  </span>
                  <BookOpen size={20} className="text-gray-300 group-hover:text-purple-400 transition" />
                </div>
                <h3 className="font-semibold text-gray-800 mb-1">{course.courseName}</h3>
                {course.teacher && (
                  <p className="text-sm text-gray-500 flex items-center gap-1">
                    <User size={14} /> {course.teacher.name}
                  </p>
                )}
                {course.batch && (
                  <p className="text-xs text-gray-400 mt-2">{course.batch.name}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
