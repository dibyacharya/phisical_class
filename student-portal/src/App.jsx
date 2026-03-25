import { useState, useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Login from "./pages/Login";
import Home from "./pages/Home";
import CourseDetail from "./pages/CourseDetail";
import ScanQR from "./pages/ScanQR";
import AttendPage from "./pages/AttendPage";
import MyAttendance from "./pages/MyAttendance";

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const stored = localStorage.getItem("lcs_student_user");
    if (stored) {
      try {
        setUser(JSON.parse(stored));
      } catch {
        localStorage.removeItem("lcs_student_user");
      }
    }
    setLoading(false);
  }, []);

  const handleLogin = (userData, token) => {
    localStorage.setItem("lcs_student_token", token);
    localStorage.setItem("lcs_student_user", JSON.stringify(userData));
    setUser(userData);
  };

  const handleLogout = () => {
    localStorage.removeItem("lcs_student_token");
    localStorage.removeItem("lcs_student_user");
    setUser(null);
  };

  if (loading) return null;

  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/login"
          element={user ? <Navigate to="/" /> : <Login onLogin={handleLogin} />}
        />
        <Route
          path="/attend"
          element={user ? <AttendPage /> : <Navigate to="/login" />}
        />
        <Route
          path="/*"
          element={
            user ? (
              <Routes>
                <Route path="/" element={<Home user={user} onLogout={handleLogout} />} />
                <Route path="/course/:id" element={<CourseDetail user={user} />} />
                <Route path="/scan" element={<ScanQR user={user} onLogout={handleLogout} />} />
                <Route path="/my-attendance" element={<MyAttendance user={user} onLogout={handleLogout} />} />
              </Routes>
            ) : (
              <Navigate to="/login" />
            )
          }
        />
      </Routes>
    </BrowserRouter>
  );
}
