import { NavLink, useLocation } from "react-router-dom";
import { useEffect, useState } from "react";
import {
  LayoutDashboard, CalendarPlus, Video, Building2, Users, Layers,
  LogOut, KeyRound, Monitor, Download, Activity, User as UserIcon,
  Cpu, ChevronDown, ChevronRight, Smartphone, MonitorSmartphone,
} from "lucide-react";
import AdminProfileModal from "./AdminProfileModal";

// v3.5.8 — "Fleet" nav entry removed. Devices page now serves both
// roles: per-device detail AND fleet-wide bulk operations. Old /fleet
// URLs redirect to /devices in App.jsx routing.
//
// v4.0 — Android nav (existing). Windows nav (new) appended as a
// separate isolated group. All Windows routes live under /windows/*.
//
// v4.1 — Sidebar restructured into two collapsible sections (Android +
// Windows). Click on a section header expands/collapses its children.
// State persisted in localStorage. The active section auto-expands so
// you can never end up with the current page hidden inside a collapsed
// group.
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

const STORAGE_KEY = "ll_sidebar_expanded_v1";

function readPersisted() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export default function Layout({ user, onLogout, children }) {
  const [profileOpen, setProfileOpen] = useState(false);
  const location = useLocation();

  // The current section is decided from the URL — Windows pages live under
  // /windows/*, everything else is Android. The active section is always
  // expanded; the other section's open/closed state is remembered between
  // visits so users can keep their preferred layout.
  const onWindows = location.pathname.startsWith("/windows");

  const [expanded, setExpanded] = useState(() => {
    const persisted = readPersisted() || {};
    return {
      android: persisted.android ?? true,
      windows: persisted.windows ?? true,
    };
  });

  useEffect(() => {
    // Auto-expand whichever section the current page belongs to so the
    // active link is never hidden inside a collapsed group.
    setExpanded((prev) => {
      if (onWindows && !prev.windows) return { ...prev, windows: true };
      if (!onWindows && !prev.android) return { ...prev, android: true };
      return prev;
    });
  }, [onWindows]);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(expanded)); } catch { /* quota / private mode */ }
  }, [expanded]);

  function toggle(section) {
    setExpanded((prev) => ({ ...prev, [section]: !prev[section] }));
  }

  return (
    <div className="h-screen flex overflow-hidden">
      {profileOpen && (
        <AdminProfileModal user={user} onClose={() => setProfileOpen(false)} />
      )}
      <aside className="w-64 bg-slate-900 text-white flex flex-col flex-shrink-0">
        <div className="p-6 border-b border-slate-700">
          <h1 className="text-lg font-bold leading-tight">LectureLens</h1>
          <p className="text-slate-400 text-sm mt-1">Admin Portal</p>
        </div>
        <nav className="flex-1 p-3 space-y-2 overflow-y-auto">
          <SidebarGroup
            id="android"
            title="Android"
            icon={Smartphone}
            isOpen={expanded.android}
            onToggle={() => toggle("android")}
            items={androidNavItems}
            activeColor="bg-blue-600"
          />
          <SidebarGroup
            id="windows"
            title="Windows"
            icon={MonitorSmartphone}
            isOpen={expanded.windows}
            onToggle={() => toggle("windows")}
            items={windowsNavItems}
            activeColor="bg-emerald-600"
            badge="NEW"
          />
        </nav>
        <div className="p-4 border-t border-slate-700 space-y-2">
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

      <main className="flex-1 overflow-auto">
        <div className="p-8">{children}</div>
      </main>
    </div>
  );
}

function SidebarGroup({ id, title, icon: GroupIcon, isOpen, onToggle, items, activeColor, badge }) {
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        aria-controls={`sidebar-group-${id}`}
        className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-semibold text-slate-200 hover:bg-slate-800 transition-colors"
      >
        <span className="flex items-center gap-2.5">
          <GroupIcon size={18} className="text-slate-400" />
          {title}
          {badge && (
            <span className="text-[10px] bg-blue-900 text-blue-300 px-1.5 py-0.5 rounded font-medium">
              {badge}
            </span>
          )}
        </span>
        {isOpen ? <ChevronDown size={16} className="text-slate-400" /> : <ChevronRight size={16} className="text-slate-400" />}
      </button>
      {isOpen && (
        <div id={`sidebar-group-${id}`} className="mt-1 ml-3 pl-3 border-l border-slate-700 space-y-0.5">
          {items.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end ?? to === "/"}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                  isActive
                    ? `${activeColor} text-white shadow-sm`
                    : "text-slate-300 hover:bg-slate-800 hover:text-white"
                }`
              }
            >
              <Icon size={16} />
              {label}
            </NavLink>
          ))}
        </div>
      )}
    </div>
  );
}
