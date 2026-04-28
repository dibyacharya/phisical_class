// v3.6.0 — User detail modal (admin-side).
//
// Opens when admin clicks a user card in the Users page. Shows the
// full profile + LMS login id (email) + admin-reset password button.
//
// Backend endpoints:
//   GET   /api/users/:id              — full profile
//   PATCH /api/users/:id/password     — admin reset (no currentPassword)

import { useState, useEffect } from "react";
import { X, Mail, Shield, KeyRound, CheckCircle2, GraduationCap, BookOpen, BadgeCheck, Hash, Layers, Eye, EyeOff, Copy, Check } from "lucide-react";
import api from "../services/api";

const roleColor = {
  superadmin: "bg-purple-100 text-purple-700",
  admin: "bg-blue-100 text-blue-700",
  teacher: "bg-emerald-100 text-emerald-700",
  student: "bg-slate-100 text-slate-700",
};

export default function UserDetailModal({ userId, onClose }) {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showReset, setShowReset] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState("");
  const [error, setError] = useState("");
  // v3.6.1 — password show/hide toggle + copy.
  const [showPassword, setShowPassword] = useState(false);
  const [copied, setCopied] = useState(false);

  const refetchProfile = () => {
    setLoading(true);
    api.get(`/users/${userId}`)
      .then((r) => setProfile(r.data))
      .catch((err) => setError(err.response?.data?.error || err.message))
      .finally(() => setLoading(false));
  };
  useEffect(() => {
    if (!userId) return;
    refetchProfile();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const copyPassword = async () => {
    if (!profile?.passwordPlaintext) return;
    try {
      await navigator.clipboard.writeText(profile.passwordPlaintext);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (_) {}
  };

  const handleReset = async (e) => {
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
      await api.patch(`/users/${userId}/password`, { newPassword });
      setSuccess(`Password reset for ${profile.email}`);
      setNewPassword(""); setConfirmPassword("");
      refetchProfile(); // v3.6.1 — pull the new visible password
      setTimeout(() => setShowReset(false), 2000);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl max-w-md w-full overflow-hidden max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="bg-gradient-to-r from-slate-700 to-slate-900 text-white p-6 flex items-center justify-between sticky top-0">
          <div>
            <h2 className="text-xl font-bold">User Profile</h2>
            <p className="text-slate-300 text-sm mt-1">Admin view + password reset</p>
          </div>
          <button onClick={onClose} className="text-white/80 hover:text-white p-1">
            <X size={20} />
          </button>
        </div>

        {loading ? (
          <div className="p-8 text-center text-slate-500">Loading…</div>
        ) : !profile ? (
          <div className="p-8 text-center text-red-600">{error || "User not found"}</div>
        ) : (
          <div className="p-6 space-y-4">
            {/* Profile fields */}
            <div className="space-y-3">
              <div>
                <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Name</p>
                <p className="text-base font-semibold text-slate-800">{profile.name}</p>
              </div>

              <div>
                <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Role</p>
                <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${roleColor[profile.role] || "bg-slate-100 text-slate-700"}`}>
                  <Shield size={11} />
                  {profile.role}
                </span>
              </div>

              {/* Role-specific fields */}
              {profile.role === "student" && profile.rollNumber && (
                <div>
                  <p className="text-xs font-medium text-slate-500 uppercase tracking-wider flex items-center gap-1">
                    <Hash size={11} /> Roll Number
                  </p>
                  <p className="text-sm font-mono text-slate-800">{profile.rollNumber}</p>
                </div>
              )}
              {profile.role === "teacher" && profile.employeeId && (
                <div>
                  <p className="text-xs font-medium text-slate-500 uppercase tracking-wider flex items-center gap-1">
                    <BadgeCheck size={11} /> Employee ID
                  </p>
                  <p className="text-sm font-mono text-slate-800">{profile.employeeId}</p>
                </div>
              )}
              {profile.batch && (
                <div>
                  <p className="text-xs font-medium text-slate-500 uppercase tracking-wider flex items-center gap-1">
                    <Layers size={11} /> Batch
                  </p>
                  <p className="text-sm text-slate-800">{profile.batch.name || profile.batch}</p>
                </div>
              )}
              {profile.courses && profile.courses.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-slate-500 uppercase tracking-wider flex items-center gap-1">
                    <BookOpen size={11} /> Courses ({profile.courses.length})
                  </p>
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {profile.courses.map((c) => (
                      <span key={c._id || c} className="inline-flex items-center gap-1 px-2 py-0.5 bg-slate-100 text-slate-700 rounded text-xs">
                        {c.courseCode || ""} {c.courseName || (typeof c === "string" ? c : "")}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* LMS Login section — admin-explicit ask */}
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
                <p className="text-xs font-semibold text-slate-700 mb-2">LMS Login Credentials</p>
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Mail size={14} className="text-slate-500 shrink-0" />
                    <div>
                      <p className="text-[10px] text-slate-500 uppercase">Login ID (Email)</p>
                      <p className="text-sm font-mono text-slate-800">{profile.email}</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-2">
                    <KeyRound size={14} className="text-slate-500 shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <p className="text-[10px] text-slate-500 uppercase">Password</p>
                      {profile.passwordPlaintext ? (
                        <div className="flex items-center gap-2 mt-0.5">
                          <p className="text-sm font-mono text-slate-800">
                            {showPassword ? profile.passwordPlaintext : "•".repeat(Math.min(profile.passwordPlaintext.length, 12))}
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
                          <p className="text-sm font-mono text-slate-400">•••••••• <span className="text-xs text-slate-400">(hashed only)</span></p>
                          <p className="text-[10px] text-slate-400 mt-0.5">Use "Reset Password" below to set a new visible password.</p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Reset password section */}
            {!showReset ? (
              <button
                onClick={() => setShowReset(true)}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition font-medium text-sm"
              >
                <KeyRound size={16} /> Reset Password (Admin Override)
              </button>
            ) : (
              <form onSubmit={handleReset} className="space-y-3 border-t pt-4">
                <p className="text-sm font-semibold text-slate-700">Reset Password for {profile.name}</p>
                <p className="text-xs text-slate-500">
                  Admin override — no current-password check. The user will need to log in with this new password.
                </p>
                <input
                  type="password"
                  placeholder="New password (min 6 chars)"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                  minLength={6}
                  className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                />
                <input
                  type="password"
                  placeholder="Confirm new password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
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
                    onClick={() => { setShowReset(false); setError(""); setSuccess(""); }}
                    disabled={submitting}
                    className="flex-1 px-4 py-2 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 text-sm"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="flex-1 px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 text-sm disabled:opacity-50"
                  >
                    {submitting ? "Saving…" : "Reset Password"}
                  </button>
                </div>
              </form>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
