import { useState, useEffect } from "react";
import { UserPlus, Trash2, Search, GraduationCap, BookOpen, Shield, X } from "lucide-react";
import api from "../services/api";

const roleBadge = {
  admin: "bg-purple-100 text-purple-700",
  teacher: "bg-blue-100 text-blue-700",
  student: "bg-green-100 text-green-700",
};

const roleIcon = {
  admin: Shield,
  teacher: BookOpen,
  student: GraduationCap,
};

export default function Users() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    role: "student",
    rollNumber: "",
    employeeId: "",
    batch: "",
  });
  const [batches, setBatches] = useState([]);
  const [error, setError] = useState("");

  const fetchUsers = () => {
    const params = filter !== "all" ? `?role=${filter}` : "";
    api.get(`/users${params}`)
      .then((r) => { setUsers(r.data); setLoading(false); })
      .catch(() => setLoading(false));
  };

  const fetchBatches = () => {
    api.get("/batches").then((r) => setBatches(r.data)).catch(() => {});
  };

  useEffect(() => { fetchUsers(); fetchBatches(); }, [filter]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    try {
      await api.post("/users", form);
      setShowForm(false);
      setForm({ name: "", email: "", password: "", role: "student", rollNumber: "", employeeId: "", batch: "" });
      fetchUsers();
    } catch (err) {
      setError(err.response?.data?.error || "Failed to create user");
    }
  };

  const handleDelete = async (id, name) => {
    if (!confirm(`Delete user "${name}"? This cannot be undone.`)) return;
    try {
      await api.delete(`/users/${id}`);
      fetchUsers();
    } catch (err) {
      alert(err.response?.data?.error || "Failed to delete");
    }
  };

  const filtered = users.filter((u) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      u.name?.toLowerCase().includes(q) ||
      u.email?.toLowerCase().includes(q) ||
      u.rollNumber?.toLowerCase().includes(q) ||
      u.employeeId?.toLowerCase().includes(q)
    );
  });

  const counts = {
    all: users.length,
    admin: users.filter((u) => u.role === "admin").length,
    teacher: users.filter((u) => u.role === "teacher").length,
    student: users.filter((u) => u.role === "student").length,
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-800">User Management</h2>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition"
        >
          <UserPlus size={18} />
          Add User
        </button>
      </div>

      {/* Add User Form */}
      {showForm && (
        <div className="bg-white rounded-xl shadow-sm border p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold">Register New User</h3>
            <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-600">
              <X size={20} />
            </button>
          </div>
          {error && (
            <div className="bg-red-50 text-red-600 text-sm px-4 py-2 rounded-lg mb-4">{error}</div>
          )}
          <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
              <select
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value, rollNumber: "", employeeId: "" })}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none bg-white"
              >
                <option value="student">Student</option>
                <option value="teacher">Teacher</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                placeholder="e.g. Rahul Kumar"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                placeholder="e.g. user@university.edu"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
              <input
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                placeholder="Login password"
                required
                minLength={6}
              />
            </div>
            {form.role === "student" && (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Roll Number</label>
                  <input
                    value={form.rollNumber}
                    onChange={(e) => setForm({ ...form, rollNumber: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                    placeholder="e.g. 21CS001"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Batch</label>
                  <select
                    value={form.batch}
                    onChange={(e) => setForm({ ...form, batch: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none bg-white"
                    required
                  >
                    <option value="">-- Select Batch --</option>
                    {batches.map((b) => (
                      <option key={b._id} value={b._id}>{b.name}</option>
                    ))}
                  </select>
                </div>
              </>
            )}
            {form.role === "teacher" && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Employee ID</label>
                <input
                  value={form.employeeId}
                  onChange={(e) => setForm({ ...form, employeeId: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                  placeholder="e.g. EMP001"
                  required
                />
              </div>
            )}
            <div className="md:col-span-2 flex gap-3 pt-2">
              <button type="submit" className="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 transition">
                Create User
              </button>
              <button type="button" onClick={() => setShowForm(false)} className="bg-gray-100 text-gray-600 px-6 py-2 rounded-lg hover:bg-gray-200 transition">
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Filter tabs + Search */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div className="flex gap-2">
          {["all", "admin", "teacher", "student"].map((r) => (
            <button
              key={r}
              onClick={() => setFilter(r)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
                filter === r
                  ? "bg-blue-600 text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {r.charAt(0).toUpperCase() + r.slice(1)} ({counts[r]})
            </button>
          ))}
        </div>
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search users..."
            className="pl-9 pr-4 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none w-64"
          />
        </div>
      </div>

      {/* Users Table */}
      <div className="bg-white rounded-xl shadow-sm border">
        {loading ? (
          <div className="p-12 text-center text-gray-400">Loading...</div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center text-gray-400">
            <UserPlus size={48} className="mx-auto mb-3 opacity-50" />
            <p>No users found. Click "Add User" to register.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase">Name</th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase">Email</th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase">Role</th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase">ID</th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase">Batch</th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase">Joined</th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filtered.map((u) => {
                  const Icon = roleIcon[u.role] || Shield;
                  return (
                    <tr key={u._id} className="hover:bg-gray-50">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center ${roleBadge[u.role]}`}>
                            <Icon size={16} />
                          </div>
                          <span className="font-medium text-gray-800">{u.name}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-600">{u.email}</td>
                      <td className="px-6 py-4">
                        <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${roleBadge[u.role]}`}>
                          {u.role}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-600 font-mono">
                        {u.role === "student" && u.rollNumber}
                        {u.role === "teacher" && u.employeeId}
                        {u.role === "admin" && "—"}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-500">
                        {u.batch?.name || "—"}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-500">
                        {new Date(u.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                      </td>
                      <td className="px-6 py-4">
                        <button
                          onClick={() => handleDelete(u._id, u.name)}
                          className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition"
                          title="Delete User"
                        >
                          <Trash2 size={18} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
