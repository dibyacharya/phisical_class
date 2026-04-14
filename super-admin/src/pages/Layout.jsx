import { Shield, LogOut } from "lucide-react";

export default function Layout({ user, onLogout, children }) {
  return (
    <div className="min-h-screen bg-gray-950">
      {/* Top bar */}
      <header className="bg-gray-900 border-b border-white/10 px-6 py-3">
        <div className="flex items-center justify-between max-w-7xl mx-auto">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center">
              <Shield size={18} className="text-white" />
            </div>
            <div>
              <h1 className="text-white font-bold text-lg leading-tight">LectureLens</h1>
              <p className="text-amber-400 text-xs font-medium">Super Admin Panel</p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="text-white text-sm font-medium">{user.name}</p>
              <p className="text-gray-500 text-xs">{user.email}</p>
            </div>
            <button
              onClick={onLogout}
              className="p-2 rounded-lg text-gray-500 hover:text-red-400 hover:bg-white/5 transition-colors"
              title="Logout"
            >
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-7xl mx-auto p-6">
        {children}
      </main>
    </div>
  );
}
