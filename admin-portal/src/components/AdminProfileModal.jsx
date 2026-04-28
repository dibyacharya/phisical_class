// v3.6.0 — Admin profile modal.
//
// Opens from the user's name in the sidebar bottom. Two purposes:
//   1. View own LMS login id (email) + role
//   2. Change own password (requires current password — defends against
//      session-hijack scenarios where someone with a stolen token could
//      otherwise lock the real owner out)
//
// Backend endpoint: PATCH /api/auth/me/password { currentPassword, newPassword }

import { useState, useEffect } from "react";
import { X, Mail, Shield, KeyRound, CheckCircle2, Eye, EyeOff, Copy, Check } from "lucide-react";
import api from "../services/api";

const roleColor = {
  superadmin: "bg-purple-100 text-purple-700",
  admin: "bg-blue-100 text-blue-700",
  teacher: "bg-emerald-100 text-emerald-700",
  student: "bg-slate-100 text-slate-700",
};

export default function AdminProfileModal({ user, onClose }) {
  const [showChange, setShowChange] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState("");
  const [error, setError] = useState("");
  // v3.6.1 — fetch own profile (incl. passwordPlaintext) since the
  // `user` prop from App.jsx came from /auth/login which doesn't include
  // it. After change-password we refetch so the displayed value is live.
  const [me, setMe] = useState(null);
  const [showPassword, setShowPassword] = useState(false);
  const [copied, setCopied] = useState(false);

  const refetchMe = () => {
    api.get("/auth/me")
      .then((r) => setMe(r.data?.user))
      .catch(() => setMe(null));
  };
  useEffect(() => { refetchMe(); }, []);

  const currentPlain = me?.passwordPlaintext;
  const copyPassword = async () => {
    if (!currentPlain) return;
    try {
      await navigator.clipboard.writeText(currentPlain);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (_) {}
  };

  const handleChangePassword = async (e) => {
    e.preventDefault();
    setError(""); setSuccess("");
    if (newPassword !== confirmPassword) {
      setError("New password and confirmation don't match");
      return;
    }
    if (newPassword.length < 6) {
      setError("New password must be at least 6 characters");
      return;
    }
    setSubmitting(true);
    try {
      await api.patch("/auth/me/password", { currentPassword, newPassword });
      setSuccess("Password changed successfully");
      setCurrentPassword(""); setNewPassword(""); setConfirmPassword("");
      refetchMe(); // v3.6.1 — pull the freshly-stored plaintext
      // Auto-close the change form after 2 s.
      setTimeout(() => setShowChange(false), 2000);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl max-w-md w-full overflow-hidden" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white p-6 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold">My Profile</h2>
            <p className="text-blue-100 text-sm mt-1">Account details + password reset</p>
          </div>
          <button onClick={onClose} className="text-white/80 hover:text-white p-1">
            <X size={20} />
          </button>
        </div>

        <div className="p-6 space-y-4">
          {/* Profile fields */}
          <div className="space-y-3">
            <div>
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Name</p>
              <p className="text-base font-semibold text-slate-800">{user?.name || "–"}</p>
            </div>

            <div>
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Role</p>
              <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${roleColor[user?.role] || "bg-slate-100 text-slate-700"}`}>
                <Shield size={11} />
                {user?.role || "–"}
              </span>
            </div>

            {/* LMS Login section — emphasised because admin specifically asked
                for "lms login id password kounsa he wo bhi mention rehna chahiye". */}
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
              <p className="text-xs font-semibold text-slate-700 mb-2">LMS Login Credentials</p>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Mail size={14} className="text-slate-500 shrink-0" />
                  <div>
                    <p className="text-[10px] text-slate-500 uppercase">Login ID (Email)</p>
                    <p className="text-sm font-mono text-slate-800">{user?.email || "–"}</p>
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <KeyRound size={14} className="text-slate-500 shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-[10px] text-slate-500 uppercase">Password</p>
                    {currentPlain ? (
                      <div className="flex items-center gap-2 mt-0.5">
                        <p className="text-sm font-mono text-slate-800">
                          {showPassword ? currentPlain : "•".repeat(Math.min(currentPlain.length, 12))}
                        </p>
                        <button
                          type="button"
                          onClick={() => setShowPassword(v => !v)}
                          className="p-1 text-slate-500 hover:text-slate-700"
                          title={showPassword ? "Hide" : "Show"}
                        >
                          {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                        </button>
                        <button
                          type="button"
                          onClick={copyPassword}
                          className="p-1 text-slate-500 hover:text-slate-700"
                          title="Copy to clipboard"
                        >
                          {copied ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}
                        </button>
                      </div>
                    ) : (
                      <div className="mt-0.5">
                        <p className="text-sm font-mono text-slate-400">•••••••• <span className="text-xs text-slate-400">(not yet set/changed via this portal)</span></p>
                        <p className="text-[10px] text-slate-400 mt-0.5">Change your password once to make it visible here.</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Change password section */}
          {!showChange ? (
            <button
              onClick={() => setShowChange(true)}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition font-medium text-sm"
            >
              <KeyRound size={16} /> Change My Password
            </button>
          ) : (
            <form onSubmit={handleChangePassword} className="space-y-3 border-t pt-4">
              <p className="text-sm font-semibold text-slate-700">Change Password</p>
              <input
                type="password"
                placeholder="Current password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
                className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <input
                type="password"
                placeholder="New password (min 6 chars)"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                minLength={6}
                className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <input
                type="password"
                placeholder="Confirm new password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              {error && (
                <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2">{error}</div>
              )}
              {success && (
                <div className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded p-2 flex items-center gap-1.5">
                  <CheckCircle2 size={12} /> {success}
                </div>
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => { setShowChange(false); setError(""); setSuccess(""); }}
                  disabled={submitting}
                  className="flex-1 px-4 py-2 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 text-sm"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm disabled:opacity-50"
                >
                  {submitting ? "Saving…" : "Save Password"}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
