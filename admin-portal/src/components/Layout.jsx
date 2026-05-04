import { NavLink } from "react-router-dom";
import { useState } from "react";
import { LayoutDashboard, CalendarPlus, Video, Building2, Users, Layers, LogOut, KeyRound, Monitor, Download, Activity, User as UserIcon, Cpu } from "lucide-react";
import AdminProfileModal from "./AdminProfileModal";

// v3.5.8 — "Fleet" nav entry removed. Devices page now serves both
// roles: per-device detail AND fleet-wide bulk operations. Old /fleet
// URLs redirect to /devices in App.jsx routing.
//
// v4.0 — Android nav (existing, untouched). Windows nav (new) appended
// as a separate isolated group. All Windows routes live under /windows/*.
const androidNavItems = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/facility", label: "Facility", icon: Building2 },
  { to: "/booking", label: "Booking", icon: CalendarPlus },
  { to: "/batches", label: "Batches", icon: Layers },
  { to: "/recordings", label: "Recordings", icon: Video },
  { to: "/devices", label: "Devices", icon: Monitor },
  { to: "/users", label: "Users", icon: Users },
  { to: "/licenses", label: "Licenses", icon: KeyRound },
  { to: "/app-update", label: "App Update", icon: Download },
  { to: "/analytics", label: "Analytics", icon: Activity },
];

const windowsNavItems = [
  { to: "/windows", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/windows/booking", label: "Booking", icon: CalendarPlus },
  { to: "/windows/devices", label: "Devices", icon: Cpu },
  { to: "/windows/recordings", label: "Recordings", icon: Video },
  { to: "/windows/licenses", label: "Licenses", icon: KeyRound },
  { to: "/windows/app-update", label: "App Update", icon: Download },
];

export default function Layout({ user, onLogout, children }) {
  // v3.6.0 — admin profile modal (clickable from sidebar bottom).
  const [profileOpen, setProfileOpen] = useState(false);

  return (
    <div className="h-screen flex overflow-hidden">
      {profileOpen && (
        <AdminProfileModal user={user} onClose={() => setProfileOpen(false)} />
      )}
      {/* Sidebar */}
      <aside className="w-64 bg-slate-900 text-white flex flex-col flex-shrink-0">
        <div className="p-6 border-b border-slate-700">
          <h1 className="text-lg font-bold leading-tight">LectureLens</h1>
          <p className="text-slate-400 text-sm mt-1">Admin Portal</p>
        </div>
        <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
          {/* Android section header */}
          <div className="text-xs uppercase tracking-wider text-slate-500 px-4 pt-1 pb-2">
            Android
          </div>
          {androidNavItems.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              className={({ isActive }) =>
                `flex items-center gap-3 px-4 py-3 rounded-lg text-sm transition-colors ${
                  isActive
                    ? "bg-blue-600 text-white"
                    : "text-slate-300 hover:bg-slate-800 hover:text-white"
                }`
              }
            >
              <Icon size={18} />
              {label}
            </NavLink>
          ))}

          {/* Windows section header — visually separated */}
          <div className="border-t border-slate-700 my-4"></div>
          <div className="text-xs uppercase tracking-wider text-slate-500 px-4 pb-2 flex items-center gap-2">
            <span>Windows</span>
            <span className="text-[10px] bg-blue-900 text-blue-300 px-1.5 py-0.5 rounded">NEW</span>
          </div>
          {windowsNavItems.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex items-center gap-3 px-4 py-3 rounded-lg text-sm transition-colors ${
                  isActive
                    ? "bg-emerald-600 text-white"
                    : "text-slate-300 hover:bg-slate-800 hover:text-white"
                }`
              }
            >
              <Icon size={18} />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="p-4 border-t border-slate-700 space-y-2">
          {/* v3.6.0 — clickable user row opens profile modal where the
              admin can view their LMS login id (email) + change their
              own password. */}
          <button
            onClick={() => setProfileOpen(true)}
            className="w-full flex items-center gap-2 text-sm text-slate-300 hover:text-white hover:bg-slate-800 rounded-lg px-2 py-1.5 transition-colors"
          >
            <UserIcon size={16} />
            <span className="truncate">{user.name}</span>
          </button>
          <button
            onClick={onLogout}
            className="flex items-center gap-2 text-sm text-slate-400 hover:text-red-400 transition-colors px-2"
          >
            <LogOut size={16} />
            Logout
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        <div className="p-8">{children}</div>
      </main>
    </div>
  );
}
