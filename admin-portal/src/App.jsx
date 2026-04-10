import { useState, useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import ScheduleClass from "./pages/ScheduleClass";
import Recordings from "./pages/Recordings";
import Devices from "./pages/Devices";
import Facility from "./pages/Facility";
import RoomDetail from "./pages/RoomDetail";
import AttendanceView from "./pages/AttendanceView";
import Users from "./pages/Users";
import Batches from "./pages/Batches";
import Layout from "./components/Layout";

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const stored = localStorage.getItem("lcs_admin_user");
    if (stored) {
      try {
        setUser(JSON.parse(stored));
      } catch {
        localStorage.removeItem("lcs_admin_user");
      }
    }
    setLoading(false);
  }, []);

  const handleLogin = (userData, token) => {
    localStorage.setItem("lcs_admin_token", token);
    localStorage.setItem("lcs_admin_user", JSON.stringify(userData));
    setUser(userData);
  };

  const handleLogout = () => {
    localStorage.removeItem("lcs_admin_token");
    localStorage.removeItem("lcs_admin_user");
    setUser(null);
  };

  if (loading) return null;

  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/login"
          element={
            user ? <Navigate to="/" /> : <Login onLogin={handleLogin} />
          }
        />
        <Route
          path="/*"
          element={
            user ? (
              <Layout user={user} onLogout={handleLogout}>
                <Routes>
                  <Route path="/" element={<Dashboard />} />
                  <Route path="/schedule" element={<ScheduleClass />} />
                  <Route path="/recordings" element={<Recordings />} />
                  <Route path="/devices" element={<Devices />} />
                  <Route path="/facility" element={<Facility />} />
                  <Route path="/facility/room/:id" element={<RoomDetail />} />
                  <Route path="/users" element={<Users />} />
                  <Route path="/batches" element={<Batches />} />
                  <Route path="/attendance/:classId" element={<AttendanceView />} />
                </Routes>
              </Layout>
            ) : (
              <Navigate to="/login" />
            )
          }
        />
      </Routes>
    </BrowserRouter>
  );
}
