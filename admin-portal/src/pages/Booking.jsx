import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { usePersistedState } from "../hooks/usePersistedState";
import {
  CalendarPlus, Building2, MapPin, Clock, BookOpen, CheckCircle2,
  ChevronLeft, Upload, Download, FileText, AlertTriangle, Wifi,
  CheckCircle, XCircle, Trash2, QrCode, Users, X,
  Search, WifiOff, RefreshCw, ArrowRight, Activity,
  CircleDot, List, Monitor,
} from "lucide-react";
import api from "../services/api";

// ── Constants ──────────────────────────────────────────────────────────────────
const SPACE_META = {
  room:            { icon: "🚪", label: "Classroom",       bg: "bg-blue-600",   light: "bg-blue-50",   text: "text-blue-700"   },
  conference_hall: { icon: "🤝", label: "Conference Hall", bg: "bg-purple-600", light: "bg-purple-50", text: "text-purple-700" },
  auditorium:      { icon: "🎭", label: "Auditorium",      bg: "bg-orange-600", light: "bg-orange-50", text: "text-orange-700" },
};
const spMeta = (t) => SPACE_META[t] || SPACE_META.room;

// Half-hour slots 08:00–17:30
const HOURS = Array.from({ length: 20 }, (_, i) => {
  const totalMin = 8 * 60 + i * 30;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`;
});

const toMin = (t) => { if (!t) return 0; const [h,m] = t.split(":").map(Number); return h*60+m; };

const DAY_START = 8 * 60;   // 480
const DAY_END   = 18 * 60;  // 1080
const DAY_RANGE = 600;

const leftPct  = (t) => Math.max(0, (toMin(t) - DAY_START) / DAY_RANGE * 100);
const widthPct = (s, e) => Math.max(0, (toMin(e) - toMin(s)) / DAY_RANGE * 100);

// ── Step Wizard ────────────────────────────────────────────────────────────────
function Steps({ current }) {
  const STEPS = [
    { label: "Space",      icon: MapPin     },
    { label: "Date & Time",icon: Clock      },
    { label: "Class Info", icon: BookOpen   },
    { label: "Confirm",    icon: CheckCircle2 },
  ];
  return (
    <div className="flex items-start gap-0 mb-8 overflow-x-auto pb-2">
      {STEPS.map(({ label, icon: Icon }, idx) => {
        const n = idx + 1;
        const done   = current > n;
        const active = current === n;
        return (
          <div key={n} className="flex items-center flex-1 last:flex-none min-w-[80px]">
            <div className="flex flex-col items-center gap-1.5 flex-shrink-0">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold transition-all
                ${done ? "bg-emerald-500 text-white shadow-sm" : active ? "bg-blue-600 text-white shadow-lg shadow-blue-200 scale-110" : "bg-gray-100 text-gray-400"}`}>
                {done ? <CheckCircle2 size={20} /> : <Icon size={18} />}
              </div>
              <span className={`text-xs font-semibold whitespace-nowrap ${active ? "text-blue-600" : done ? "text-emerald-600" : "text-gray-400"}`}>{label}</span>
            </div>
            {idx < STEPS.length - 1 && (
              <div className={`flex-1 h-0.5 mx-3 mb-5 transition-all ${done ? "bg-emerald-400" : "bg-gray-200"}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Device Status Badge ────────────────────────────────────────────────────────
function DeviceBadge({ device, size = "sm" }) {
  const s = size === "xs" ? 10 : 12;
  if (!device)             return <span className="flex items-center gap-1 text-gray-300" style={{fontSize:10}}><Monitor size={s} /> No device</span>;
  if (device.isRecording)  return <span className="flex items-center gap-1 text-red-500 font-semibold" style={{fontSize:10}}><CircleDot size={s} className="animate-pulse" /> REC</span>;
  if (device.isOnline)     return <span className="flex items-center gap-1 text-emerald-500 font-semibold" style={{fontSize:10}}><Wifi size={s} /> Online</span>;
  return                          <span className="flex items-center gap-1 text-gray-400" style={{fontSize:10}}><WifiOff size={s} /> Offline</span>;
}

// ── Gantt Timeline ─────────────────────────────────────────────────────────────
function GanttBar({ gantt, selStart, selEnd, onClickTime }) {
  const barRef = useRef();
  const hours = [8,9,10,11,12,13,14,15,16,17,18];

  const handleClick = (e) => {
    const rect = barRef.current.getBoundingClientRect();
    const pct  = (e.clientX - rect.left) / rect.width;
    const min  = DAY_START + pct * DAY_RANGE;
    const snap = Math.round(min / 30) * 30;
    const h = Math.floor(snap / 60), m = snap % 60;
    const timeStr = `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`;
    if (HOURS.includes(timeStr)) onClickTime(timeStr);
  };

  return (
    <div className="select-none">
      {/* Hour labels */}
      <div className="relative h-5 mb-1">
        {hours.map(h => (
          <span key={h} className="absolute text-xs text-gray-400 -translate-x-1/2" style={{ left: `${(h*60 - DAY_START) / DAY_RANGE * 100}%` }}>
            {h}
          </span>
        ))}
      </div>
      {/* Bar */}
      <div ref={barRef} onClick={handleClick}
        className="relative h-12 bg-gray-100 rounded-xl overflow-hidden cursor-crosshair border border-gray-200">
        {/* Hour tick lines */}
        {hours.slice(1,-1).map(h => (
          <div key={h} className="absolute top-0 bottom-0 w-px bg-gray-200"
            style={{ left: `${(h*60 - DAY_START) / DAY_RANGE * 100}%` }} />
        ))}
        {/* Existing bookings */}
        {(gantt || []).map((g, i) => (
          <div key={i} title={`${g.title} (${g.startTime}–${g.endTime})`}
            className="absolute top-1 bottom-1 bg-red-400 rounded-lg flex items-center px-2 overflow-hidden"
            style={{ left: `${leftPct(g.startTime)}%`, width: `${widthPct(g.startTime, g.endTime)}%` }}>
            <span className="text-white text-xs font-medium truncate">{g.title}</span>
          </div>
        ))}
        {/* User's selection */}
        {selStart && selEnd && toMin(selEnd) > toMin(selStart) && (
          <div className="absolute top-1 bottom-1 bg-blue-500 rounded-lg flex items-center px-2 overflow-hidden opacity-80"
            style={{ left: `${leftPct(selStart)}%`, width: `${widthPct(selStart, selEnd)}%` }}>
            <span className="text-white text-xs font-semibold truncate">{selStart}–{selEnd}</span>
          </div>
        )}
      </div>
      <div className="flex gap-4 mt-2 text-xs text-gray-400">
        <span className="flex items-center gap-1"><span className="w-3 h-2 bg-red-400 rounded inline-block" /> Booked</span>
        <span className="flex items-center gap-1"><span className="w-3 h-2 bg-blue-500 rounded inline-block opacity-80" /> Your selection</span>
        <span className="text-gray-400 italic">↖ Click bar to set start time</span>
      </div>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────
export default function Booking() {
  const navigate = useNavigate();

  // v3.5.7 — booking page tab persists across reload via the shared
  // usePersistedState hook (replaces v3.5.6's inline localStorage logic).
  const [activeTab, setActiveTab] = usePersistedState("new", "lcs_booking_tab"); // new | all | upload

  // ── NEW BOOKING ───────────────────────────────────────────────────────────
  const [step, setStep]         = useState(1);
  const [hierarchy, setHierarchy]           = useState([]);
  const [hierarchyLoading, setHierarchyLoading] = useState(true);
  const [sel, setSel] = useState({
    campus:"", campusName:"", block:"", blockName:"", floor:"", room:null,
    date: new Date().toISOString().split("T")[0],
    startTime:"09:00", endTime:"10:30",
    title:"", batch:"", batchName:"", course:"", courseName:"", courseCode:"",
    teacher:"", teacherName:"", notes:"",
  });
  const [daySchedule, setDaySchedule]   = useState(null);
  const [schedLoading, setSchedLoading] = useState(false);
  const [batches, setBatches]   = useState([]);
  const [courses, setCourses]   = useState([]);
  const [bookLoading, setBookLoading] = useState(false);
  const [bookSuccess, setBookSuccess] = useState(false);
  const [onlineOnly, setOnlineOnly]   = useState(false);
  const [slotMode, setSlotMode]       = useState("start"); // "start" | "end"

  // ── ALL BOOKINGS ──────────────────────────────────────────────────────────
  const [classes, setClasses]     = useState([]);
  const [classLoad, setClassLoad] = useState(false);
  // v3.5.7 — persist room + status filters (search is transient, not persisted).
  const [filters, _setFilters] = useState({ room:"", search:"", status:"" });
  const [persistedFilters, setPersistedFilters] = usePersistedState({ room:"", status:"" }, "lcs_booking_filters");
  // Apply persisted values once on mount.
  useEffect(() => {
    _setFilters(prev => ({ ...prev, room: persistedFilters.room || "", status: persistedFilters.status || "" }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const setFilters = (updater) => {
    _setFilters(prev => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      // Save just room + status to localStorage (not search).
      setPersistedFilters({ room: next.room || "", status: next.status || "" });
      return next;
    });
  };
  const [qrModal, setQrModal]     = useState(null);

  // ── UPLOAD ────────────────────────────────────────────────────────────────
  const [uploadFile, setUploadFile]     = useState(null);
  const [uploadRows, setUploadRows]     = useState([]);
  const [report, setReport]             = useState(null);
  const [validateLoad, setValidateLoad] = useState(false);
  const [importLoad, setImportLoad]     = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [dragOver, setDragOver]         = useState(false);
  const fileRef = useRef();

  // ── Init ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    api.get("/rooms/hierarchy")
      .then(r => { setHierarchy(r.data); setHierarchyLoading(false); })
      .catch(() => setHierarchyLoading(false));
    api.get("/batches").then(r => setBatches(r.data)).catch(() => {});
  }, []);

  const loadClasses = useCallback(() => {
    setClassLoad(true);
    api.get("/classes").then(r => { setClasses(r.data); setClassLoad(false); }).catch(() => setClassLoad(false));
  }, []);
  useEffect(() => { if (activeTab === "all") loadClasses(); }, [activeTab, loadClasses]);

  // Fetch room schedule when room+date change in step 2
  useEffect(() => {
    if (sel.room && sel.date && step === 2) {
      setSchedLoading(true);
      setSlotMode("start"); // reset slot click mode on room/date change
      api.get(`/rooms/${sel.room._id}/schedule?date=${sel.date}`)
        .then(r => { setDaySchedule(r.data); setSchedLoading(false); })
        .catch(() => setSchedLoading(false));
    }
  }, [sel.room, sel.date, step]);

  // ── Space selector data ───────────────────────────────────────────────────
  const campusData  = hierarchy;
  const blocks      = sel.campus ? (campusData.find(c => c.campus === sel.campus)?.blocks || []) : [];
  const blockRooms  = sel.block  ? (blocks.find(b => b.block === sel.block)?.rooms || []) : [];

  // Derive unique floors from the selected block's rooms
  const floorSortKey = (f) => {
    if (!f) return 999;
    const lower = f.toLowerCase();
    if (lower.includes("ground")) return 0;
    if (lower.includes("basement")) return -1;
    const n = lower.match(/(\d+)/);
    return n ? parseInt(n[1]) : 500;
  };
  const uniqueFloors = sel.block
    ? [...new Set(blockRooms.map(r => r.floor || "").filter(Boolean))]
        .sort((a, b) => floorSortKey(a) - floorSortKey(b))
    : [];
  const hasFloors = uniqueFloors.length > 0;

  // Rooms filtered by selected floor (or all if no floor data exists)
  let rooms = sel.block
    ? (hasFloors && sel.floor
        ? blockRooms.filter(r => (r.floor || "") === sel.floor)
        : (!hasFloors ? blockRooms : []))  // show all if no floor info at all
    : [];
  if (onlineOnly) rooms = rooms.filter(r => r.device?.isOnline);

  // ── Batch → Course ────────────────────────────────────────────────────────
  const handleBatchChange = (batchId) => {
    const b = batches.find(b => b._id === batchId);
    setSel(s => ({ ...s, batch: batchId, batchName: b?.name || "", course:"", courseName:"", courseCode:"", teacher:"", teacherName:"" }));
    if (batchId) api.get(`/batches/${batchId}/courses`).then(r => setCourses(r.data)).catch(() => setCourses([]));
  };
  const handleCourseChange = (courseId) => {
    const c = courses.find(c => c._id === courseId);
    setSel(s => ({ ...s, course: courseId, courseName: c?.courseName||"", courseCode: c?.courseCode||"", teacher: c?.teacher?._id||"", teacherName: c?.teacher?.name||"" }));
  };

  // ── Submit booking ────────────────────────────────────────────────────────
  const handleBook = async () => {
    setBookLoading(true);
    try {
      await api.post("/classes", {
        title:      sel.title,
        course:     sel.course,
        teacher:    sel.teacher,
        roomNumber: sel.room.roomNumber,
        date:       sel.date,
        startTime:  sel.startTime,
        endTime:    sel.endTime,
      });
      setBookSuccess(true);
      if (activeTab === "all") loadClasses();
    } catch (err) {
      alert(err.response?.data?.error || "Booking failed");
    } finally { setBookLoading(false); }
  };

  const resetBooking = () => {
    setSel({ campus:"", campusName:"", block:"", blockName:"", floor:"", room:null,
      date: new Date().toISOString().split("T")[0], startTime:"09:00", endTime:"10:30",
      title:"", batch:"", batchName:"", course:"", courseName:"", courseCode:"",
      teacher:"", teacherName:"", notes:"" });
    setStep(1); setBookSuccess(false); setDaySchedule(null);
  };

  // ── Delete ────────────────────────────────────────────────────────────────
  const handleDelete = async (id) => {
    if (!confirm("Delete this booking and its recording/attendance?")) return;
    await api.delete(`/classes/${id}`); loadClasses();
  };

  const handleGenerateQr = async (classId) => {
    try {
      const { data } = await api.post(`/attendance/generate-qr/${classId}`);
      setQrModal(data);
    } catch { alert("Failed to generate QR"); }
  };

  // ── CSV Template download ─────────────────────────────────────────────────
  const downloadTemplate = () => {
    const csv = [
      "title,date,startTime,endTime,roomNumber,courseCode,teacherName,courseName",
      "Calculus - Chapter 1,2026-04-15,09:00,10:30,202,m1,Rishi,Mathematics",
      "Odia Prose - Chapter 4,2026-04-15,11:00,12:30,101,o1,Rishi,Odia Language",
      "Faculty Development Program,2026-04-16,10:00,12:00,CF-01,m1,Rishi,Mathematics",
    ].join("\n");
    const blob = new Blob([csv], { type:"text/csv" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url; a.download = "timetable_template.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  // ── CSV Parse ─────────────────────────────────────────────────────────────
  const parseCSV = (text) => {
    const lines = text.trim().split(/\r?\n/);
    if (lines.length < 2) return [];
    const headers = lines[0].split(",").map(h => h.trim().replace(/^"|"$/g,""));
    return lines.slice(1).map((line, i) => {
      const vals = line.split(",").map(v => v.trim().replace(/^"|"$/g,""));
      const obj = { rowNum: i + 1 };
      headers.forEach((h, j) => { obj[h] = vals[j] || ""; });
      return obj;
    }).filter(r => r.title || r.date);
  };

  const handleFileSelect = (e) => {
    const file = e.target?.files?.[0] || e.dataTransfer?.files?.[0];
    if (!file) return;
    setUploadFile(file); setReport(null); setImportResult(null);
    const reader = new FileReader();
    reader.onload = (ev) => setUploadRows(parseCSV(ev.target.result));
    reader.readAsText(file);
  };

  const handleValidate = async () => {
    if (!uploadRows.length) return;
    setValidateLoad(true);
    try {
      const { data } = await api.post("/classes/bulk-validate", { rows: uploadRows });
      setReport(data);
    } catch (err) { alert(err.response?.data?.error || "Validation failed"); }
    finally { setValidateLoad(false); }
  };

  const handleImport = async () => {
    if (!report) return;
    const validRows = report.rows.filter(r => r.status === "valid").map(r => ({ ...r.data, rowNum: r.rowNum }));
    if (!validRows.length) return;
    setImportLoad(true);
    try {
      const { data } = await api.post("/classes/bulk-create", { rows: validRows });
      setImportResult(data);
    } catch (err) { alert(err.response?.data?.error || "Import failed"); }
    finally { setImportLoad(false); }
  };

  // ── Filter + group classes ────────────────────────────────────────────────
  const filtered = classes.filter(cls => {
    if (filters.room && !cls.roomNumber?.includes(filters.room)) return false;
    if (filters.status && cls.status !== filters.status) return false;
    if (filters.search) {
      const q = filters.search.toLowerCase();
      return (cls.title||"").toLowerCase().includes(q)
          || (cls.teacherName||cls.teacher?.name||"").toLowerCase().includes(q)
          || (cls.courseName||cls.course?.courseName||"").toLowerCase().includes(q);
    }
    return true;
  });

  const byDate = {};
  for (const cls of filtered) {
    const d = new Date(cls.date).toISOString().split("T")[0];
    if (!byDate[d]) byDate[d] = [];
    byDate[d].push(cls);
  }
  const sortedDates = Object.keys(byDate).sort((a,b) => b.localeCompare(a));

  const fmtDate  = (d) => new Date(d + "T12:00:00").toLocaleDateString("en-IN", { weekday:"long", day:"numeric", month:"long", year:"numeric" });
  const fmtShort = (d) => new Date(d + "T12:00:00").toLocaleDateString("en-IN", { day:"numeric", month:"short", year:"numeric" });

  const STATUS_STYLE = {
    completed: "bg-emerald-100 text-emerald-700",
    live:      "bg-red-100 text-red-700",
    scheduled: "bg-blue-100 text-blue-700",
    cancelled: "bg-gray-100 text-gray-500",
  };

  const allRoomNumbers = hierarchy.flatMap(c => c.blocks?.flatMap(b => b.rooms?.map(r => r.roomNumber) || []) || []);

  // ── RENDER ────────────────────────────────────────────────────────────────
  return (
    <div>
      {/* Page header */}
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-800">Room Booking</h2>
        <p className="text-sm text-gray-500 mt-0.5">Book classrooms, upload timetables, manage all schedules</p>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl mb-6 w-fit">
        {[
          { key:"new",    label:"New Booking",      icon: CalendarPlus },
          { key:"all",    label:"All Bookings",     icon: List          },
          { key:"upload", label:"Upload Timetable", icon: Upload        },
        ].map(({ key, label, icon: Icon }) => (
          <button key={key} onClick={() => setActiveTab(key)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all
              ${activeTab === key ? "bg-white text-blue-700 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}>
            <Icon size={16} /> {label}
          </button>
        ))}
      </div>

      {/* ═══════════════════════════════ TAB: NEW BOOKING ═══════════════════ */}
      {activeTab === "new" && (
        bookSuccess ? (
          <div className="bg-white rounded-2xl border shadow-sm p-12 text-center max-w-lg mx-auto">
            <div className="w-20 h-20 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <CheckCircle2 size={40} className="text-emerald-500" />
            </div>
            <h3 className="text-2xl font-bold text-gray-800 mb-2">Booking Confirmed!</h3>
            <div className="bg-gray-50 rounded-xl p-4 text-left mb-6 space-y-2">
              <p className="text-sm"><span className="text-gray-400">Class:</span> <strong className="text-gray-700">{sel.title}</strong></p>
              <p className="text-sm"><span className="text-gray-400">Room:</span> <strong className="text-gray-700">{sel.room?.roomNumber} — {sel.room?.roomName}</strong></p>
              <p className="text-sm"><span className="text-gray-400">Location:</span> <strong className="text-gray-700">{sel.campusName} › {sel.blockName}{sel.floor ? ` › ${sel.floor}` : ""}</strong></p>
              <p className="text-sm"><span className="text-gray-400">Date:</span> <strong className="text-gray-700">{fmtShort(sel.date)}</strong></p>
              <p className="text-sm"><span className="text-gray-400">Time:</span> <strong className="text-gray-700">{sel.startTime} – {sel.endTime}</strong></p>
              {sel.teacherName && <p className="text-sm"><span className="text-gray-400">Faculty:</span> <strong className="text-gray-700">{sel.teacherName}</strong></p>}
            </div>
            <div className="flex gap-3 justify-center">
              <button onClick={resetBooking} className="bg-blue-600 text-white px-6 py-2.5 rounded-lg hover:bg-blue-700 font-medium">+ Book Another</button>
              <button onClick={() => { setActiveTab("all"); loadClasses(); }} className="bg-gray-100 text-gray-700 px-6 py-2.5 rounded-lg hover:bg-gray-200 font-medium">View All Bookings</button>
            </div>
          </div>
        ) : (
          <div className="bg-white rounded-2xl border shadow-sm p-6">
            <Steps current={step} />

            {/* ── STEP 1: Space ── */}
            {step === 1 && (
              <div className="space-y-7">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
                    <MapPin size={20} className="text-blue-600" /> Select Your Space
                  </h3>
                </div>

                {hierarchyLoading ? (
                  <div className="py-12 text-center text-gray-400">Loading spaces...</div>
                ) : (
                  <>
                    {/* Campus */}
                    <div>
                      <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">1. Campus</p>
                      <div className="flex flex-wrap gap-3">
                        {campusData.map(c => (
                          <button key={c.campus}
                            onClick={() => setSel(s => ({ ...s, campus:c.campus, campusName:c.campus, block:"", blockName:"", room:null }))}
                            className={`flex flex-col gap-1 p-5 rounded-2xl border-2 text-left transition-all min-w-[200px] hover:shadow-md
                              ${sel.campus===c.campus ? "border-blue-500 bg-blue-50 shadow-md" : "border-gray-200 hover:border-blue-300 bg-white"}`}>
                            <span className="text-3xl">🏫</span>
                            <span className="font-bold text-gray-800">{c.campus}</span>
                            <span className="text-xs text-gray-500">{c.totalRooms} spaces · {c.blocks?.length} blocks</span>
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Block */}
                    {sel.campus && (
                      <div>
                        <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">2. Block</p>
                        <div className="flex flex-wrap gap-3">
                          {blocks.map(b => (
                            <button key={b.block}
                              onClick={() => setSel(s => ({ ...s, block:b.block, blockName:b.block, floor:"", room:null }))}
                              className={`flex flex-col gap-1 p-4 rounded-xl border-2 text-left transition-all min-w-[150px] hover:shadow-sm
                                ${sel.block===b.block ? "border-blue-500 bg-blue-50 shadow" : "border-gray-200 hover:border-blue-300 bg-white"}`}>
                              <span className="text-2xl">🏗️</span>
                              <span className="font-bold text-gray-800 text-sm">{b.block}</span>
                              <span className="text-xs text-gray-500">{b.totalRooms} rooms · {b.onlineDevices} online</span>
                              {b.recordingNow > 0 && <span className="text-xs text-red-500 font-semibold">● {b.recordingNow} recording</span>}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Floor — only shown when the selected block has floor data */}
                    {sel.block && hasFloors && (
                      <div>
                        <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">3. Floor</p>
                        <div className="flex flex-wrap gap-3">
                          {uniqueFloors.map(fl => {
                            const flRooms   = blockRooms.filter(r => (r.floor || "") === fl);
                            const flOnline  = flRooms.filter(r => r.device?.isOnline).length;
                            const flRec     = flRooms.filter(r => r.device?.isRecording).length;
                            const chosen    = sel.floor === fl;
                            return (
                              <button key={fl}
                                onClick={() => setSel(s => ({ ...s, floor: fl, room: null }))}
                                className={`flex flex-col gap-1.5 p-4 rounded-xl border-2 text-left transition-all min-w-[140px] hover:shadow-sm
                                  ${chosen ? "border-blue-500 bg-blue-50 shadow" : "border-gray-200 hover:border-blue-300 bg-white"}`}>
                                <div className="flex items-center gap-2">
                                  <span className="text-xl">🪜</span>
                                  {chosen && <CheckCircle2 size={14} className="text-blue-500 ml-auto" />}
                                </div>
                                <span className="font-bold text-gray-800 text-sm">{fl}</span>
                                <span className="text-xs text-gray-500">{flRooms.length} room{flRooms.length !== 1 ? "s" : ""}</span>
                                <div className="flex items-center gap-2 flex-wrap">
                                  {flOnline > 0 && (
                                    <span className="text-[10px] text-emerald-600 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded-full flex items-center gap-1">
                                      <span className="w-1 h-1 bg-emerald-500 rounded-full" /> {flOnline} online
                                    </span>
                                  )}
                                  {flRec > 0 && (
                                    <span className="text-[10px] text-red-600 bg-red-50 border border-red-200 px-1.5 py-0.5 rounded-full flex items-center gap-1 animate-pulse">
                                      ● {flRec} rec
                                    </span>
                                  )}
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Room */}
                    {sel.block && (hasFloors ? !!sel.floor : true) && (
                      <div>
                        <div className="flex items-center justify-between mb-3">
                          <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">
                            {hasFloors ? "4." : "3."} Room / Space / Device
                          </p>
                          <label className="flex items-center gap-2 text-xs text-gray-500 cursor-pointer">
                            <input type="checkbox" checked={onlineOnly} onChange={e => setOnlineOnly(e.target.checked)} className="rounded" />
                            Online devices only
                          </label>
                        </div>
                        {rooms.length === 0 ? (
                          <p className="text-gray-400 text-sm py-4">No rooms{onlineOnly ? " with online devices" : ""}{sel.floor ? ` on ${sel.floor}` : ""}.</p>
                        ) : (
                          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-3">
                            {rooms.map(r => {
                              const meta = spMeta(r.spaceType);
                              const chosen = sel.room?._id === r._id;
                              return (
                                <button key={r._id} onClick={() => setSel(s => ({ ...s, room:r }))}
                                  className={`flex flex-col gap-2 p-4 rounded-xl border-2 text-left transition-all hover:shadow-md group
                                    ${chosen ? "border-blue-500 bg-blue-50 shadow-lg" : "border-gray-200 hover:border-blue-300 bg-white"}`}>
                                  <div className="flex items-start justify-between">
                                    <span className="text-2xl">{meta.icon}</span>
                                    {chosen && <CheckCircle2 size={16} className="text-blue-500" />}
                                  </div>
                                  <div>
                                    <p className="font-bold text-gray-800 text-lg leading-tight">{r.roomNumber}</p>
                                    <p className="text-xs text-gray-500 leading-tight truncate">{r.roomName}</p>
                                    <p className="text-xs text-gray-400 mt-0.5">{r.capacity > 0 ? `${r.capacity} seats` : "—"}</p>
                                  </div>
                                  <div className="flex flex-col gap-1 border-t pt-2">
                                    <DeviceBadge device={r.device} size="xs" />
                                    {r.device?.health?.disk && (
                                      <span className="text-xs text-gray-400">
                                        Disk: {r.device.health.disk.usedPercent}% · CPU: {r.device.health.cpu?.usagePercent ?? "—"}%
                                      </span>
                                    )}
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}

                {/* Selected summary bar */}
                {sel.room && (
                  <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="text-2xl">{spMeta(sel.room.spaceType).icon}</span>
                      <div>
                        <p className="font-bold text-blue-800">{sel.room.roomNumber} — {sel.room.roomName}</p>
                        <p className="text-xs text-blue-600 flex items-center flex-wrap gap-1">
                          <span>{sel.campusName}</span>
                          <span className="text-blue-300">›</span>
                          <span>{sel.blockName}</span>
                          {sel.floor && <><span className="text-blue-300">›</span><span>{sel.floor}</span></>}
                          <span className="text-blue-300">›</span>
                          <span className="font-semibold">Room {sel.room.roomNumber}</span>
                          {sel.room.capacity > 0 && <span className="text-blue-400 ml-1">· {sel.room.capacity} seats</span>}
                        </p>
                      </div>
                    </div>
                    <DeviceBadge device={sel.room.device} />
                  </div>
                )}

                <div className="flex justify-end">
                  <button onClick={() => setStep(2)} disabled={!sel.room}
                    className="flex items-center gap-2 bg-blue-600 text-white px-6 py-2.5 rounded-xl hover:bg-blue-700 disabled:bg-gray-200 disabled:text-gray-400 font-semibold transition shadow-sm">
                    Continue <ArrowRight size={16} />
                  </button>
                </div>
              </div>
            )}

            {/* ── STEP 2: Date & Time ── */}
            {step === 2 && (
              <div className="space-y-6">
                <h3 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
                  <Clock size={20} className="text-blue-600" />
                  Date & Time — <span className="text-blue-600">{sel.room?.roomNumber}</span>
                  <span className="text-gray-400 text-sm font-normal">({sel.room?.roomName})</span>
                </h3>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                  {/* Left: Inputs */}
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-1.5">📅 Date</label>
                      <input type="date" value={sel.date}
                        min={new Date().toISOString().split("T")[0]}
                        onChange={e => setSel(s => ({ ...s, date:e.target.value }))}
                        className="w-full px-4 py-3 border-2 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-gray-800 font-medium focus:border-blue-500" />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-sm font-semibold text-gray-700 mb-1.5">🕐 Start Time</label>
                        <input type="time" value={sel.startTime}
                          onChange={e => {
                            const val = e.target.value;
                            if (!val) return;
                            setSel(s => ({
                              ...s, startTime: val,
                              // auto-push endTime if it's now <= startTime
                              endTime: toMin(s.endTime) <= toMin(val)
                                ? (() => { const m = toMin(val)+60; const hh=Math.floor(m/60), mm=m%60; return `${String(hh).padStart(2,"0")}:${String(mm).padStart(2,"0")}`; })()
                                : s.endTime
                            }));
                            setSlotMode("end");
                          }}
                          className="w-full px-3 py-3 border-2 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none bg-white text-gray-800 font-medium focus:border-blue-500" />
                      </div>
                      <div>
                        <label className="block text-sm font-semibold text-gray-700 mb-1.5">🕑 End Time</label>
                        <input type="time" value={sel.endTime}
                          onChange={e => {
                            const val = e.target.value;
                            if (!val) return;
                            if (toMin(val) <= toMin(sel.startTime)) {
                              alert("End time must be after start time");
                              return;
                            }
                            setSel(s => ({ ...s, endTime: val }));
                            setSlotMode("start");
                          }}
                          className="w-full px-3 py-3 border-2 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none bg-white text-gray-800 font-medium focus:border-blue-500" />
                      </div>
                    </div>

                    {/* Duration pill */}
                    <div className="inline-flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-full px-4 py-2">
                      <Clock size={14} className="text-blue-500" />
                      <span className="text-sm text-blue-700 font-semibold">
                        {toMin(sel.endTime) - toMin(sel.startTime) > 0
                          ? `${toMin(sel.endTime) - toMin(sel.startTime)} minutes`
                          : "—"}
                      </span>
                    </div>

                    {/* Device info for selected room */}
                    {sel.room?.device && (
                      <div className="bg-gray-50 rounded-xl p-3 border text-xs space-y-1">
                        <p className="font-semibold text-gray-600 mb-1.5 flex items-center gap-1.5">
                          <Monitor size={13} /> Device — {sel.room.device.deviceId}
                        </p>
                        <div className="flex flex-wrap gap-2">
                          <DeviceBadge device={sel.room.device} />
                          {sel.room.device.health?.disk && (
                            <>
                              <span className="text-gray-400">Disk: <b>{sel.room.device.health.disk.freeGB}GB free</b></span>
                              <span className="text-gray-400">CPU: <b>{sel.room.device.health.cpu?.usagePercent}%</b></span>
                            </>
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Right: Visual timeline */}
                  <div>
                    <p className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                      Room availability — {fmtShort(sel.date)}
                      {schedLoading && <RefreshCw size={13} className="animate-spin text-gray-400" />}
                    </p>
                    <GanttBar
                      gantt={daySchedule?.gantt || []}
                      selStart={sel.startTime}
                      selEnd={sel.endTime}
                      onClickTime={(t) => setSel(s => ({ ...s, startTime:t }))}
                    />

                    {/* Slot pills — two-click range selector */}
                    <div className="mt-3 mb-2 flex items-center justify-between gap-2 flex-wrap">
                      <div>
                        {slotMode === "start" ? (
                          <span className="text-xs font-semibold text-blue-600 flex items-center gap-1">
                            <span className="w-2 h-2 bg-blue-500 rounded-full animate-pulse inline-block" />
                            Quick-select start slot ↓
                          </span>
                        ) : (
                          <span className="text-xs font-semibold text-indigo-600 flex items-center gap-1">
                            <span className="w-2 h-2 bg-indigo-500 rounded-full animate-pulse inline-block" />
                            Quick-select end slot (after {sel.startTime}) ↓
                          </span>
                        )}
                      </div>
                      <span className="text-[10px] text-gray-400 italic">Or type any time directly above ↑</span>
                    </div>
                    <div className="grid grid-cols-5 gap-1.5">
                      {HOURS.map(slot => {
                        const m       = toMin(slot);
                        const startM  = toMin(sel.startTime);
                        const endM    = toMin(sel.endTime);
                        const occupied = (daySchedule?.gantt||[]).some(g => m >= toMin(g.startTime) && m < toMin(g.endTime));
                        // FIX: inclusive range — both start AND end pill are highlighted
                        const isStart  = m === startM;
                        const isEnd    = m === endM;
                        const inRange  = m > startM && m < endM;

                        let pillCls = "";
                        if (occupied) {
                          pillCls = "bg-red-50 text-red-400 border-red-200 cursor-not-allowed";
                        } else if (isStart) {
                          pillCls = "bg-blue-600 text-white border-blue-600 ring-2 ring-blue-200 scale-105";
                        } else if (isEnd) {
                          pillCls = "bg-indigo-600 text-white border-indigo-600 ring-2 ring-indigo-200 scale-105";
                        } else if (inRange) {
                          pillCls = "bg-blue-100 text-blue-700 border-blue-300";
                        } else if (slotMode === "end" && m > startM) {
                          pillCls = "bg-white text-gray-600 border-gray-200 hover:bg-indigo-50 hover:border-indigo-300 hover:text-indigo-700 cursor-pointer";
                        } else {
                          pillCls = "bg-white text-gray-600 border-gray-200 hover:bg-emerald-50 hover:border-emerald-300 hover:text-emerald-700 cursor-pointer";
                        }

                        const handleSlotClick = () => {
                          if (occupied) return;
                          if (slotMode === "start") {
                            setSel(s => ({ ...s, startTime: slot }));
                            setSlotMode("end");
                          } else {
                            // End click: must be after start
                            if (m > startM) {
                              setSel(s => ({ ...s, endTime: slot }));
                              setSlotMode("start");
                            } else {
                              // Clicked before/equal start → reset start
                              setSel(s => ({ ...s, startTime: slot }));
                              // stay in "end" mode
                            }
                          }
                        };

                        return (
                          <button key={slot} disabled={occupied} onClick={handleSlotClick}
                            className={`py-1.5 rounded-lg text-xs font-semibold border transition-all ${pillCls}`}
                            title={
                              occupied ? "Already booked" :
                              isStart  ? `Start: ${slot}` :
                              isEnd    ? `End: ${slot}` :
                              slotMode === "end" ? `Set end to ${slot}` : `Set start to ${slot}`
                            }>
                            {isStart ? `▶ ${slot}` : isEnd ? `${slot} ◀` : slot}
                          </button>
                        );
                      })}
                    </div>

                    {!schedLoading && daySchedule?.gantt?.length === 0 && (
                      <p className="text-emerald-600 text-sm font-medium mt-3 flex items-center gap-1.5">
                        <CheckCircle size={14} /> All time slots available for this date
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex justify-between pt-2 border-t">
                  <button onClick={() => setStep(1)} className="flex items-center gap-2 text-gray-500 hover:text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-50">
                    <ChevronLeft size={16} /> Back
                  </button>
                  <button onClick={() => setStep(3)} disabled={toMin(sel.endTime) <= toMin(sel.startTime)}
                    className="flex items-center gap-2 bg-blue-600 text-white px-6 py-2.5 rounded-xl hover:bg-blue-700 disabled:bg-gray-200 disabled:text-gray-400 font-semibold transition">
                    Continue <ArrowRight size={16} />
                  </button>
                </div>
              </div>
            )}

            {/* ── STEP 3: Class Info ── */}
            {step === 3 && (
              <div className="space-y-5">
                <h3 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
                  <BookOpen size={20} className="text-blue-600" /> Class Details
                </h3>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="md:col-span-2">
                    <label className="block text-sm font-semibold text-gray-700 mb-1.5">Class Title *</label>
                    <input value={sel.title} onChange={e => setSel(s => ({ ...s, title:e.target.value }))}
                      className="w-full px-4 py-3 border-2 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none focus:border-blue-500 text-gray-800"
                      placeholder="e.g. Calculus — Limits & Derivatives" />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1.5">Batch *</label>
                    <select value={sel.batch} onChange={e => handleBatchChange(e.target.value)}
                      className="w-full px-4 py-3 border-2 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none bg-white focus:border-blue-500 text-gray-800">
                      <option value="">— Select Batch —</option>
                      {batches.map(b => <option key={b._id} value={b._id}>{b.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1.5">Course *</label>
                    <select value={sel.course} onChange={e => handleCourseChange(e.target.value)} disabled={!sel.batch}
                      className="w-full px-4 py-3 border-2 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none bg-white disabled:bg-gray-50 focus:border-blue-500 text-gray-800">
                      <option value="">{sel.batch ? "— Select Course —" : "Select batch first"}</option>
                      {courses.map(c => <option key={c._id} value={c._id}>{c.courseCode} — {c.courseName}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1.5">Faculty</label>
                    <input value={sel.teacherName} readOnly placeholder="Auto-filled from course"
                      className="w-full px-4 py-3 border-2 rounded-xl bg-gray-50 text-gray-500 outline-none" />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1.5">Notes (optional)</label>
                    <input value={sel.notes} onChange={e => setSel(s => ({ ...s, notes:e.target.value }))}
                      className="w-full px-4 py-3 border-2 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none focus:border-blue-500"
                      placeholder="e.g. Bring lab manual" />
                  </div>
                </div>

                <div className="flex justify-between pt-2 border-t">
                  <button onClick={() => setStep(2)} className="flex items-center gap-2 text-gray-500 hover:text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-50">
                    <ChevronLeft size={16} /> Back
                  </button>
                  <button onClick={() => setStep(4)} disabled={!sel.title.trim() || !sel.course}
                    className="flex items-center gap-2 bg-blue-600 text-white px-6 py-2.5 rounded-xl hover:bg-blue-700 disabled:bg-gray-200 disabled:text-gray-400 font-semibold transition">
                    Continue <ArrowRight size={16} />
                  </button>
                </div>
              </div>
            )}

            {/* ── STEP 4: Confirm ── */}
            {step === 4 && (
              <div className="space-y-6">
                <h3 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
                  <CheckCircle2 size={20} className="text-blue-600" /> Confirm Booking
                </h3>

                {/* Booking Ticket */}
                <div className="border-2 border-blue-200 rounded-2xl overflow-hidden shadow-xl max-w-2xl">
                  {/* Header */}
                  <div className="bg-gradient-to-r from-blue-600 via-blue-600 to-indigo-700 text-white p-6">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="text-blue-200 text-xs font-bold uppercase tracking-widest">Booking Reference</p>
                        <p className="text-4xl font-black mt-1 tracking-tight">{sel.room?.roomNumber}</p>
                        <p className="text-blue-200 text-sm mt-0.5">{sel.room?.roomName}</p>
                      </div>
                      <div className="text-right">
                        <span className="text-5xl">{spMeta(sel.room?.spaceType).icon}</span>
                        <p className="text-blue-200 text-xs mt-1 font-medium">{spMeta(sel.room?.spaceType).label}</p>
                      </div>
                    </div>
                    {/* Flight-style route bar */}
                    <div className="mt-5 flex items-center gap-3 bg-white/10 rounded-xl px-4 py-3">
                      <div className="text-center">
                        <p className="text-blue-200 text-xs">CAMPUS</p>
                        <p className="font-bold text-sm">{sel.campusName}</p>
                      </div>
                      <div className="flex-1 flex items-center gap-1">
                        <div className="flex-1 h-px bg-blue-300" />
                        <ArrowRight size={16} className="text-blue-300" />
                        <div className="flex-1 h-px bg-blue-300" />
                      </div>
                      <div className="text-center">
                        <p className="text-blue-200 text-xs">BLOCK</p>
                        <p className="font-bold text-sm">{sel.blockName}</p>
                      </div>
                      <div className="flex-1 flex items-center gap-1">
                        <div className="flex-1 h-px bg-blue-300" />
                        <ArrowRight size={16} className="text-blue-300" />
                        <div className="flex-1 h-px bg-blue-300" />
                      </div>
                      <div className="text-center">
                        <p className="text-blue-200 text-xs">ROOM</p>
                        <p className="font-black text-lg">{sel.room?.roomNumber}</p>
                      </div>
                    </div>
                    {sel.room?.floor && (
                      <div className="mt-2 flex items-center gap-3 justify-center">
                        <span className="flex items-center gap-1 text-xs text-blue-200 bg-white/10 px-3 py-1 rounded-full">
                          ⬆ {sel.room.floor}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Body */}
                  <div className="p-5 bg-white">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                      {[
                        { label:"DATE",    value: fmtShort(sel.date) },
                        { label:"TIME",    value: `${sel.startTime} → ${sel.endTime}` },
                        { label:"DURATION",value: `${toMin(sel.endTime)-toMin(sel.startTime)} min` },
                        { label:"CAPACITY",value: `${sel.room?.capacity} seats` },
                        ...(sel.room?.floor ? [{ label:"FLOOR", value: sel.room.floor }] : []),
                      ].map(({ label, value }) => (
                        <div key={label}>
                          <p className="text-xs text-gray-400 font-bold uppercase tracking-widest">{label}</p>
                          <p className="font-bold text-gray-800 mt-0.5">{value}</p>
                        </div>
                      ))}
                    </div>

                    <div className="border-t border-dashed my-4 relative">
                      <div className="absolute -left-6 -top-3 w-6 h-6 bg-slate-50 rounded-full border" />
                      <div className="absolute -right-6 -top-3 w-6 h-6 bg-slate-50 rounded-full border" />
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                      <div>
                        <p className="text-xs text-gray-400 font-bold uppercase tracking-widest">CLASS TITLE</p>
                        <p className="font-bold text-gray-800 mt-0.5 text-base">{sel.title}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-400 font-bold uppercase tracking-widest">COURSE</p>
                        <p className="font-bold text-gray-800 mt-0.5">{sel.courseCode} — {sel.courseName}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-400 font-bold uppercase tracking-widest">FACULTY</p>
                        <p className="font-bold text-gray-800 mt-0.5">{sel.teacherName || "—"}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-400 font-bold uppercase tracking-widest">DEVICE STATUS</p>
                        <p className="mt-0.5"><DeviceBadge device={sel.room?.device} /></p>
                      </div>
                    </div>

                    <div className="mt-4 flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-2.5">
                      <CheckCircle2 size={18} className="text-emerald-500" />
                      <span className="text-sm font-semibold text-emerald-700">All checks passed — ready to confirm</span>
                    </div>
                  </div>
                </div>

                <div className="flex justify-between pt-2">
                  <button onClick={() => setStep(3)} className="flex items-center gap-2 text-gray-500 hover:text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-50">
                    <ChevronLeft size={16} /> Back
                  </button>
                  <button onClick={handleBook} disabled={bookLoading}
                    className="flex items-center gap-2 bg-emerald-600 text-white px-8 py-3 rounded-xl hover:bg-emerald-700 disabled:bg-gray-200 font-bold text-base transition shadow-lg shadow-emerald-100">
                    {bookLoading ? <RefreshCw size={18} className="animate-spin" /> : <CheckCircle2 size={20} />}
                    {bookLoading ? "Booking..." : "Confirm Booking"}
                  </button>
                </div>
              </div>
            )}
          </div>
        )
      )}

      {/* ═══════════════════════════════ TAB: ALL BOOKINGS ══════════════════ */}
      {activeTab === "all" && (
        <div className="space-y-4">
          {/* Filter bar */}
          <div className="bg-white rounded-xl border p-4 flex flex-wrap gap-3 items-center">
            <div className="flex items-center gap-2 bg-gray-100 rounded-lg px-3 py-2 flex-1 min-w-[160px]">
              <Search size={15} className="text-gray-400" />
              <input value={filters.search} onChange={e => setFilters(f => ({ ...f, search:e.target.value }))}
                placeholder="Search class, teacher, course..."
                className="bg-transparent outline-none text-sm text-gray-700 w-full" />
            </div>
            <input value={filters.room} onChange={e => setFilters(f => ({ ...f, room:e.target.value }))}
              placeholder="Filter room (e.g. 202)"
              className="border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-400 w-36" />
            <select value={filters.status} onChange={e => setFilters(f => ({ ...f, status:e.target.value }))}
              className="border rounded-lg px-3 py-2 text-sm outline-none bg-white focus:ring-2 focus:ring-blue-400">
              <option value="">All Status</option>
              <option value="scheduled">Scheduled</option>
              <option value="live">Live</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
            </select>
            <button onClick={loadClasses} className="flex items-center gap-1.5 border rounded-lg px-3 py-2 text-sm text-gray-600 hover:bg-gray-50">
              <RefreshCw size={14} /> Refresh
            </button>
            <span className="text-sm text-gray-400 ml-auto">{filtered.length} bookings</span>
          </div>

          {classLoad ? (
            <div className="bg-white rounded-xl border p-12 text-center text-gray-400">Loading bookings...</div>
          ) : filtered.length === 0 ? (
            <div className="bg-white rounded-xl border p-12 text-center text-gray-400">No bookings found.</div>
          ) : (
            sortedDates.map(date => (
              <div key={date} className="bg-white rounded-xl border overflow-hidden">
                <div className="bg-gradient-to-r from-gray-50 to-white border-b px-5 py-3 flex items-center justify-between">
                  <h4 className="font-bold text-gray-700">{fmtDate(date)}</h4>
                  <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{byDate[date].length} booking{byDate[date].length!==1?"s":""}</span>
                </div>
                <div className="divide-y">
                  {byDate[date].map(cls => (
                    <div key={cls._id} className="px-5 py-4 flex items-center gap-4 hover:bg-gray-50 transition-all group">
                      <div className={`w-1.5 h-12 rounded-full flex-shrink-0
                        ${cls.status==="live" ? "bg-red-500" : cls.status==="completed" ? "bg-emerald-400" : cls.status==="cancelled" ? "bg-gray-300" : "bg-blue-400"}`} />
                      <div className="flex-1 min-w-0">
                        <p className="font-bold text-gray-800 truncate">{cls.title}</p>
                        <p className="text-xs text-gray-500 mt-0.5">{cls.courseCode||cls.course?.courseCode} · {cls.teacherName||cls.teacher?.name}</p>
                      </div>
                      <div className="hidden sm:flex items-center gap-1.5 bg-gray-100 rounded-lg px-2.5 py-1.5">
                        <Building2 size={12} className="text-gray-500" />
                        <span className="text-xs font-bold text-gray-700">{cls.roomNumber}</span>
                      </div>
                      <span className="text-xs text-gray-600 font-semibold whitespace-nowrap">{cls.startTime} – {cls.endTime}</span>
                      <span className={`text-xs font-bold px-2.5 py-1 rounded-full capitalize ${STATUS_STYLE[cls.status]||"bg-gray-100 text-gray-500"}`}>
                        {cls.status||"scheduled"}
                      </span>
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => handleGenerateQr(cls._id)} title="QR Code"
                          className="p-1.5 text-blue-500 hover:bg-blue-50 rounded-lg"><QrCode size={15} /></button>
                        <button onClick={() => navigate(`/attendance/${cls._id}`)} title="Attendance"
                          className="p-1.5 text-emerald-500 hover:bg-emerald-50 rounded-lg"><Users size={15} /></button>
                        <button onClick={() => handleDelete(cls._id)} title="Delete"
                          className="p-1.5 text-red-400 hover:bg-red-50 rounded-lg"><Trash2 size={15} /></button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* ═══════════════════════════════ TAB: UPLOAD TIMETABLE ══════════════ */}
      {activeTab === "upload" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left panel */}
          <div className="space-y-4">
            <div className="bg-white rounded-2xl border p-5 shadow-sm">
              <h3 className="font-bold text-gray-800 mb-1 flex items-center gap-2">
                <Download size={18} className="text-blue-600" /> CSV Template
              </h3>
              <p className="text-sm text-gray-500 mb-4">Download, fill in your schedule, upload to import in bulk.</p>
              <button onClick={downloadTemplate}
                className="w-full flex items-center justify-center gap-2 bg-blue-600 text-white py-3 rounded-xl hover:bg-blue-700 font-semibold text-sm shadow-sm">
                <Download size={16} /> Download Template
              </button>
            </div>

            <div className="bg-white rounded-2xl border p-5 shadow-sm">
              <h3 className="font-bold text-gray-800 mb-3 flex items-center gap-2">
                <FileText size={16} className="text-gray-500" /> Column Format
              </h3>
              <div className="space-y-2">
                {[
                  { col:"title",       req:true,  ex:"Calculus - Chapter 1" },
                  { col:"date",        req:true,  ex:"2026-04-15" },
                  { col:"startTime",   req:true,  ex:"09:00" },
                  { col:"endTime",     req:true,  ex:"10:30" },
                  { col:"roomNumber",  req:true,  ex:"202, 101, CF-01" },
                  { col:"courseCode",  req:false, ex:"m1, o1" },
                  { col:"teacherName", req:false, ex:"Rishi" },
                  { col:"courseName",  req:false, ex:"Mathematics" },
                ].map(({ col, req, ex }) => (
                  <div key={col} className="flex items-start gap-2 text-xs">
                    <code className="bg-gray-100 text-blue-700 px-1.5 py-0.5 rounded font-mono flex-shrink-0">{col}</code>
                    {req && <span className="text-red-400 font-bold flex-shrink-0">*</span>}
                    <span className="text-gray-400 italic">{ex}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4">
              <h4 className="text-sm font-bold text-amber-800 mb-2 flex items-center gap-2">
                <AlertTriangle size={14} /> Valid Room Numbers
              </h4>
              <div className="flex flex-wrap gap-1.5">
                {allRoomNumbers.map(rn => (
                  <code key={rn} className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded font-mono">{rn}</code>
                ))}
              </div>
            </div>
          </div>

          {/* Right panel */}
          <div className="lg:col-span-2 space-y-4">
            {/* Drop zone */}
            <div
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={e => { e.preventDefault(); setDragOver(false); handleFileSelect(e); }}
              onClick={() => fileRef.current?.click()}
              className={`border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer transition-all
                ${dragOver ? "border-blue-500 bg-blue-50 scale-[1.01]" : "border-gray-300 hover:border-blue-400 bg-white hover:bg-gray-50"}`}>
              <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleFileSelect} />
              <Upload size={36} className={`mx-auto mb-3 ${dragOver ? "text-blue-500" : "text-gray-300"}`} />
              {uploadFile ? (
                <div>
                  <p className="font-bold text-gray-700 text-lg">{uploadFile.name}</p>
                  <p className="text-gray-500 mt-1">{uploadRows.length} data rows detected</p>
                  <button onClick={e => { e.stopPropagation(); setUploadFile(null); setUploadRows([]); setReport(null); setImportResult(null); }}
                    className="mt-3 text-xs text-red-500 hover:text-red-700 underline">
                    Remove file
                  </button>
                </div>
              ) : (
                <div>
                  <p className="text-gray-600 font-semibold text-lg">Drop your CSV file here</p>
                  <p className="text-gray-400 text-sm mt-1">or click to browse files</p>
                </div>
              )}
            </div>

            {uploadFile && uploadRows.length > 0 && !report && (
              <button onClick={handleValidate} disabled={validateLoad}
                className="w-full flex items-center justify-center gap-2 bg-indigo-600 text-white py-3.5 rounded-2xl font-bold hover:bg-indigo-700 disabled:bg-gray-200 transition shadow-sm">
                {validateLoad ? <RefreshCw size={18} className="animate-spin" /> : <Activity size={18} />}
                {validateLoad ? "Validating..." : `Validate ${uploadRows.length} Rows`}
              </button>
            )}

            {/* Validation Report */}
            {report && (
              <div className="bg-white rounded-2xl border overflow-hidden shadow-sm">
                {/* Summary */}
                <div className="p-5 bg-gradient-to-r from-gray-50 to-white border-b">
                  <h3 className="font-bold text-gray-800 mb-3">Validation Report</h3>
                  <div className="grid grid-cols-4 gap-3">
                    {[
                      { label:"Total",         value:report.summary.total,     cls:"bg-gray-100 text-gray-700" },
                      { label:"✅ Valid",       value:report.summary.valid,     cls:"bg-emerald-100 text-emerald-700" },
                      { label:"⚠️ Conflict",   value:report.summary.conflicts, cls:"bg-amber-100 text-amber-700" },
                      { label:"❌ Error",       value:report.summary.errors,    cls:"bg-red-100 text-red-700" },
                    ].map(({ label, value, cls }) => (
                      <div key={label} className={`${cls} rounded-xl p-3 text-center`}>
                        <p className="text-3xl font-black">{value}</p>
                        <p className="text-xs font-bold mt-0.5">{label}</p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Detail table */}
                <div className="overflow-x-auto max-h-96 overflow-y-auto">
                  <table className="w-full text-sm min-w-[700px]">
                    <thead className="bg-gray-50 sticky top-0 border-b">
                      <tr>
                        {["Row","Title","Room","Date","Time","Status","Issues"].map(h => (
                          <th key={h} className="text-left px-4 py-2.5 text-xs font-bold text-gray-500 uppercase tracking-wider">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {report.rows.map(r => (
                        <tr key={r.rowNum}
                          className={r.status==="valid" ? "bg-white hover:bg-gray-50"
                            : r.status==="conflict"     ? "bg-amber-50 hover:bg-amber-100"
                            :                             "bg-red-50 hover:bg-red-100"}>
                          <td className="px-4 py-3 text-gray-400 font-mono text-xs font-bold">{r.rowNum}</td>
                          <td className="px-4 py-3 font-semibold text-gray-800 max-w-[160px] truncate" title={r.data?.title}>{r.data?.title||"—"}</td>
                          <td className="px-4 py-3">
                            <code className="bg-gray-100 text-gray-700 px-2 py-0.5 rounded text-xs font-mono">{r.data?.roomNumber||"—"}</code>
                            {r.roomName && <span className="text-xs text-gray-400 ml-1 hidden sm:inline">{r.roomName}</span>}
                          </td>
                          <td className="px-4 py-3 text-xs text-gray-600 whitespace-nowrap">{r.data?.date||"—"}</td>
                          <td className="px-4 py-3 text-xs text-gray-600 whitespace-nowrap">{r.data?.startTime}–{r.data?.endTime}</td>
                          <td className="px-4 py-3">
                            {r.status==="valid"    && <span className="flex items-center gap-1 text-xs text-emerald-600 font-bold"><CheckCircle size={13} /> Valid</span>}
                            {r.status==="conflict" && <span className="flex items-center gap-1 text-xs text-amber-600 font-bold"><AlertTriangle size={13} /> Conflict</span>}
                            {r.status==="error"    && <span className="flex items-center gap-1 text-xs text-red-600 font-bold"><XCircle size={13} /> Error</span>}
                          </td>
                          <td className="px-4 py-3 text-xs text-gray-500 max-w-[200px]">
                            {r.issues?.length ? r.issues.map((issue, i) => (
                              <div key={i} className="leading-tight">{issue}</div>
                            )) : <span className="text-emerald-500">—</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Import action */}
                {!importResult ? (
                  <div className="p-4 border-t bg-gray-50 flex items-center justify-between">
                    <p className="text-sm text-gray-600">
                      {report.summary.valid > 0
                        ? <span><strong className="text-emerald-600">{report.summary.valid}</strong> rows ready to import</span>
                        : <span className="text-gray-400">No valid rows to import</span>}
                    </p>
                    <button onClick={handleImport} disabled={report.summary.valid===0 || importLoad}
                      className="flex items-center gap-2 bg-emerald-600 text-white px-5 py-2.5 rounded-xl hover:bg-emerald-700 disabled:bg-gray-200 disabled:text-gray-400 font-bold text-sm transition shadow-sm">
                      {importLoad ? <RefreshCw size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}
                      {importLoad ? "Importing..." : `Import ${report.summary.valid} Valid Rows`}
                    </button>
                  </div>
                ) : (
                  <div className="p-5 border-t bg-emerald-50">
                    <div className="flex items-center gap-2 text-emerald-700 font-bold text-base">
                      <CheckCircle2 size={20} /> Import complete: {importResult.created} classes created
                      {importResult.failed > 0 && <span className="text-red-500 ml-1">, {importResult.failed} failed</span>}
                    </div>
                    {importResult.details?.failed?.length > 0 && (
                      <div className="mt-2 space-y-1">
                        {importResult.details.failed.map((f, i) => (
                          <p key={i} className="text-xs text-red-600">Row {f.rowNum} "{f.title}": {f.error}</p>
                        ))}
                      </div>
                    )}
                    <button
                      onClick={() => { setUploadFile(null); setUploadRows([]); setReport(null); setImportResult(null); setActiveTab("all"); loadClasses(); }}
                      className="mt-3 text-sm text-emerald-700 font-semibold underline">
                      View All Bookings →
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* QR Modal */}
      {qrModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-sm w-full text-center relative">
            <button onClick={() => setQrModal(null)} className="absolute top-4 right-4 text-gray-400 hover:text-gray-600"><X size={22} /></button>
            <h3 className="text-xl font-bold mb-1">Attendance QR</h3>
            <p className="text-gray-400 text-sm mb-4">Expires in {qrModal.expiresIn}s · Students scan to mark attendance</p>
            <img src={qrModal.qrCode} alt="QR Code" className="mx-auto w-56 h-56 border-4 border-gray-100 rounded-2xl" />
            <p className="text-xs text-gray-300 mt-3 break-all">{qrModal.qrData}</p>
          </div>
        </div>
      )}
    </div>
  );
}
