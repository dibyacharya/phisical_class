import { useState, useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Booking from "./pages/Booking";
import Recordings from "./pages/Recordings";
import Devices from "./pages/Devices";
import Facility from "./pages/Facility";
import RoomDetail from "./pages/RoomDetail";
import AttendanceView from "./pages/AttendanceView";
import Users from "./pages/Users";
import Batches from "./pages/Batches";
import Licenses from "./pages/Licenses";
import AppUpdate from "./pages/AppUpdate";
import Analytics from "./pages/Analytics";
import DeviceRemote from "./pages/DeviceRemote";
import Layout from "./components/Layout";

// ── Windows Edition pages (isolated namespace, no Android pages touched) ──
import WindowsDashboard from "./pages/windows/WindowsDashboard";
import WindowsDevices from "./pages/windows/WindowsDevices";
import WindowsRecordings from "./pages/windows/WindowsRecordings";
import WindowsBooking from "./pages/windows/WindowsBooking";
import WindowsLicenses from "./pages/windows/WindowsLicenses";
import WindowsAppUpdate from "./pages/windows/WindowsAppUpdate";
import "./pages/windows/windows.css";

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
                  <Route path="/booking" element={<Booking />} />
                  <Route path="/schedule" element={<Navigate to="/booking" />} />
                  <Route path="/recordings" element={<Recordings />} />
                  <Route path="/devices" element={<Devices />} />
                  {/* v3.5.8 — /fleet merged into /devices. Old links and
                      bookmarks redirect to the unified Devices page (which
                      now has Fleet's bulk-action bar + multi-select). */}
                  <Route path="/fleet" element={<Navigate to="/devices" replace />} />
                  <Route path="/facility" element={<Facility />} />
                  <Route path="/facility/room/:id" element={<RoomDetail />} />
                  <Route path="/users" element={<Users />} />
                  <Route path="/batches" element={<Batches />} />
                  <Route path="/licenses" element={<Licenses />} />
                  <Route path="/app-update" element={<AppUpdate />} />
                  <Route path="/analytics" element={<Analytics />} />
                  <Route path="/device/:deviceId/remote" element={<DeviceRemote />} />
                  <Route path="/attendance/:classId" element={<AttendanceView />} />

                  {/* ── Windows Edition routes (isolated under /windows/*) ── */}
                  <Route path="/windows" element={<WindowsDashboard />} />
                  <Route path="/windows/devices" element={<WindowsDevices />} />
                  <Route path="/windows/recordings" element={<WindowsRecordings />} />
                  <Route path="/windows/booking" element={<WindowsBooking />} />
                  <Route path="/windows/licenses" element={<WindowsLicenses />} />
                  <Route path="/windows/app-update" element={<WindowsAppUpdate />} />
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
