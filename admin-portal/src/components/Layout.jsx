import { NavLink } from "react-router-dom";
import { LayoutDashboard, CalendarPlus, Video, Building2, Users, Layers, LogOut, KeyRound, Monitor, Download, Activity, Radar } from "lucide-react";

const navItems = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/facility", label: "Facility", icon: Building2 },
  { to: "/booking", label: "Booking", icon: CalendarPlus },
  { to: "/batches", label: "Batches", icon: Layers },
  { to: "/recordings", label: "Recordings", icon: Video },
  { to: "/fleet", label: "Fleet", icon: Radar },
  { to: "/devices", label: "Devices", icon: Monitor },
  { to: "/users", label: "Users", icon: Users },
  { to: "/licenses", label: "Licenses", icon: KeyRound },
  { to: "/app-update", label: "App Update", icon: Download },
  { to: "/analytics", label: "Analytics", icon: Activity },
];

export default function Layout({ user, onLogout, children }) {
  return (
    <div className="h-screen flex overflow-hidden">
      {/* Sidebar */}
      <aside className="w-64 bg-slate-900 text-white flex flex-col flex-shrink-0">
        <div className="p-6 border-b border-slate-700">
          <h1 className="text-lg font-bold leading-tight">LectureLens</h1>
          <p className="text-slate-400 text-sm mt-1">Admin Portal</p>
        </div>
        <nav className="flex-1 p-4 space-y-1">
          {navItems.map(({ to, label, icon: Icon }) => (
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
        </nav>
        <div className="p-4 border-t border-slate-700">
          <div className="text-sm text-slate-300 mb-2">{user.name}</div>
          <button
            onClick={onLogout}
            className="flex items-center gap-2 text-sm text-slate-400 hover:text-red-400 transition-colors"
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
