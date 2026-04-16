import { useState, useEffect } from "react";
import { Plus, Trash2, ChevronDown, ChevronUp, BookOpen, X, UserPlus } from "lucide-react";
import api from "../services/api";

export default function Batches() {
  const [batches, setBatches] = useState([]);
  const [teachers, setTeachers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showBatchForm, setShowBatchForm] = useState(false);
  const [expandedBatch, setExpandedBatch] = useState(null);
  const [batchCourses, setBatchCourses] = useState({});
  const [batchForm, setBatchForm] = useState({ batchCode: "", name: "", description: "" });
  const [courseForm, setCourseForm] = useState({ courseName: "", courseCode: "", teacher: "" });
  const [showCourseForm, setShowCourseForm] = useState(null);
  const [error, setError] = useState("");

  const fetchBatches = () => {
    api.get("/batches").then((r) => { setBatches(r.data); setLoading(false); }).catch(() => setLoading(false));
  };

  const fetchTeachers = () => {
    api.get("/users/teachers").then((r) => setTeachers(r.data)).catch(() => {});
  };

  const fetchCourses = (batchId) => {
    api.get(`/batches/${batchId}/courses`).then((r) => {
      setBatchCourses((prev) => ({ ...prev, [batchId]: r.data }));
    }).catch(() => {});
  };

  useEffect(() => { fetchBatches(); fetchTeachers(); }, []);

  const toggleExpand = (batchId) => {
    if (expandedBatch === batchId) {
      setExpandedBatch(null);
    } else {
      setExpandedBatch(batchId);
      fetchCourses(batchId);
    }
  };

  const handleCreateBatch = async (e) => {
    e.preventDefault();
    setError("");
    try {
      await api.post("/batches", batchForm);
      setBatchForm({ batchCode: "", name: "", description: "" });
      setShowBatchForm(false);
      fetchBatches();
    } catch (err) {
      setError(err.response?.data?.error || "Failed to create batch");
    }
  };

  const handleDeleteBatch = async (id) => {
    if (!confirm("Delete this batch and all its courses?")) return;
    try {
      await api.delete(`/batches/${id}`);
      fetchBatches();
    } catch (err) {
      alert(err.response?.data?.error || "Failed to delete");
    }
  };

  const handleAddCourse = async (e, batchId) => {
    e.preventDefault();
    setError("");
    try {
      await api.post(`/batches/${batchId}/courses`, courseForm);
      setCourseForm({ courseName: "", courseCode: "", teacher: "" });
      setShowCourseForm(null);
      fetchCourses(batchId);
      fetchBatches();
    } catch (err) {
      setError(err.response?.data?.error || "Failed to add course");
    }
  };

  const handleAssignTeacher = async (courseId, teacherId, batchId) => {
    try {
      await api.put(`/batches/courses/${courseId}`, { teacher: teacherId || null });
      fetchCourses(batchId);
    } catch (err) {
      alert("Failed to assign teacher");
    }
  };

  const handleDeleteCourse = async (courseId, batchId) => {
    if (!confirm("Delete this course?")) return;
    try {
      await api.delete(`/batches/courses/${courseId}`);
      fetchCourses(batchId);
      fetchBatches();
    } catch (err) {
      alert("Failed to delete course");
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-800">Batches & Courses</h2>
        <button
          onClick={() => setShowBatchForm(!showBatchForm)}
          className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition"
        >
          <Plus size={18} /> New Batch
        </button>
      </div>

      {/* Create Batch Form */}
      {showBatchForm && (
        <div className="bg-white rounded-xl shadow-sm border p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold">Create New Batch</h3>
            <button onClick={() => setShowBatchForm(false)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
          </div>
          {error && <div className="bg-red-50 text-red-600 text-sm px-4 py-2 rounded-lg mb-4">{error}</div>}
          <form onSubmit={handleCreateBatch} className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Batch Code <span className="text-red-500">*</span></label>
              <input value={batchForm.batchCode} onChange={(e) => setBatchForm({ ...batchForm, batchCode: e.target.value.toUpperCase() })} className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none font-mono uppercase" placeholder="e.g. CSE-2025-A" required />
              <p className="text-xs text-gray-400 mt-1">Unique code for this batch</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Batch Name <span className="text-red-500">*</span></label>
              <input value={batchForm.name} onChange={(e) => setBatchForm({ ...batchForm, name: e.target.value })} className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" placeholder="e.g. B.Tech CSE 2025 Batch A" required />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
              <input value={batchForm.description} onChange={(e) => setBatchForm({ ...batchForm, description: e.target.value })} className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" placeholder="Optional description" />
            </div>
            <div className="md:col-span-3 flex gap-3">
              <button type="submit" className="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 transition">Create Batch</button>
              <button type="button" onClick={() => setShowBatchForm(false)} className="bg-gray-100 text-gray-600 px-6 py-2 rounded-lg hover:bg-gray-200 transition">Cancel</button>
            </div>
          </form>
        </div>
      )}

      {/* Batches List */}
      {loading ? (
        <div className="text-center text-gray-400 py-12">Loading...</div>
      ) : batches.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border p-12 text-center text-gray-400">
          <BookOpen size={48} className="mx-auto mb-3 opacity-50" />
          <p>No batches yet. Create a batch to get started.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {batches.map((batch) => (
            <div key={batch._id} className="bg-white rounded-xl shadow-sm border overflow-hidden">
              {/* Batch Header */}
              <div
                className="flex items-center justify-between px-6 py-4 cursor-pointer hover:bg-gray-50 transition"
                onClick={() => toggleExpand(batch._id)}
              >
                <div className="flex items-center gap-4">
                  {expandedBatch === batch._id ? <ChevronUp size={20} className="text-gray-400" /> : <ChevronDown size={20} className="text-gray-400" />}
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 bg-blue-100 text-blue-700 text-xs font-mono font-bold rounded">{batch.batchCode}</span>
                      <h3 className="font-semibold text-gray-800">{batch.name}</h3>
                    </div>
                    {batch.description && <p className="text-sm text-gray-500 mt-0.5">{batch.description}</p>}
                  </div>
                </div>
                <div className="flex items-center gap-6">
                  <div className="text-center">
                    <div className="text-lg font-bold text-blue-600">{batch.courseCount}</div>
                    <div className="text-xs text-gray-400">Courses</div>
                  </div>
                  <div className="text-center">
                    <div className="text-lg font-bold text-green-600">{batch.studentCount}</div>
                    <div className="text-xs text-gray-400">Students</div>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDeleteBatch(batch._id); }}
                    className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition"
                    title="Delete Batch"
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
              </div>

              {/* Expanded: Courses */}
              {expandedBatch === batch._id && (
                <div className="border-t bg-gray-50 px-6 py-4">
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="font-medium text-gray-700">Courses in {batch.name}</h4>
                    <button
                      onClick={() => setShowCourseForm(showCourseForm === batch._id ? null : batch._id)}
                      className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700"
                    >
                      <Plus size={16} /> Add Course
                    </button>
                  </div>

                  {/* Add Course Form */}
                  {showCourseForm === batch._id && (
                    <form onSubmit={(e) => handleAddCourse(e, batch._id)} className="bg-white rounded-lg border p-4 mb-4">
                      {error && <div className="bg-red-50 text-red-600 text-sm px-3 py-1 rounded mb-3">{error}</div>}
                      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                        <input value={courseForm.courseName} onChange={(e) => setCourseForm({ ...courseForm, courseName: e.target.value })} className="px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" placeholder="Course Name" required />
                        <input value={courseForm.courseCode} onChange={(e) => setCourseForm({ ...courseForm, courseCode: e.target.value })} className="px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" placeholder="Course Code" required />
                        <select value={courseForm.teacher} onChange={(e) => setCourseForm({ ...courseForm, teacher: e.target.value })} className="px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white">
                          <option value="">No Teacher</option>
                          {teachers.map((t) => <option key={t._id} value={t._id}>{t.name} ({t.employeeId})</option>)}
                        </select>
                        <div className="flex gap-2">
                          <button type="submit" className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-blue-700 transition">Add</button>
                          <button type="button" onClick={() => setShowCourseForm(null)} className="bg-gray-100 text-gray-600 px-4 py-2 rounded-lg text-sm hover:bg-gray-200 transition">Cancel</button>
                        </div>
                      </div>
                    </form>
                  )}

                  {/* Courses Table */}
                  {(batchCourses[batch._id] || []).length === 0 ? (
                    <p className="text-sm text-gray-400 py-4">No courses added yet.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left text-xs text-gray-500 uppercase">
                            <th className="px-4 py-2">Code</th>
                            <th className="px-4 py-2">Course Name</th>
                            <th className="px-4 py-2">Teacher</th>
                            <th className="px-4 py-2">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {(batchCourses[batch._id] || []).map((course) => (
                            <tr key={course._id} className="bg-white hover:bg-gray-50">
                              <td className="px-4 py-3 font-mono font-medium text-blue-600">{course.courseCode}</td>
                              <td className="px-4 py-3 text-gray-800">{course.courseName}</td>
                              <td className="px-4 py-3">
                                <select
                                  value={course.teacher?._id || ""}
                                  onChange={(e) => handleAssignTeacher(course._id, e.target.value, batch._id)}
                                  className="px-2 py-1 border rounded text-sm bg-white"
                                >
                                  <option value="">Unassigned</option>
                                  {teachers.map((t) => <option key={t._id} value={t._id}>{t.name}</option>)}
                                </select>
                              </td>
                              <td className="px-4 py-3">
                                <button
                                  onClick={() => handleDeleteCourse(course._id, batch._id)}
                                  className="p-1.5 text-red-500 hover:bg-red-50 rounded transition"
                                >
                                  <Trash2 size={16} />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
