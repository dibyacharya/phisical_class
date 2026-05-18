import { useState, useEffect, useCallback, useMemo } from "react";
import { Link } from "react-router-dom";
import {
  Cpu, Wifi, WifiOff, CircleDot, Trash2, Square, RefreshCw,
  Camera, Mic, Monitor, HardDrive, MemoryStick, AlertTriangle,
  ChevronDown, ChevronUp, Clock, Signal, Terminal, Download,
  Power, FileText, Radio, MapPin, Pencil, X,
} from "lucide-react";
import { winDevices } from "../../services/windowsApi";
import WindowsLiveWatchModal from "../../components/WindowsLiveWatchModal";

// ── helpers ──────────────────────────────────────────────────────────────────
// Visual layout mirrors the Android Devices page (src/pages/Devices.jsx) so the
// admin portal looks identical across the TV and Mini-PC fleets. Wired to the
// Windows API + Windows health fields.

const fmtTime = (iso) =>
  iso ? new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "–";

function UsageBar({ value, warn = 75, danger = 90 }) {
  if (value == null) return <span className="text-xs text-gray-400">–</span>;
  const color = value >= danger ? "bg-red-500" : value >= warn ? "bg-yellow-400" : "bg-green-500";
  return (
    <div className="flex items-center gap-2 min-w-0">
      <div className="flex-1 bg-gray-100 rounded-full h-1.5 min-w-0">
        <div className={`${color} h-1.5 rounded-full`} style={{ width: `${Math.min(value, 100)}%` }} />
      </div>
      <span className="text-xs text-gray-600 shrink-0">{value}%</span>
    </div>
  );
}

function HardwareIcon({ ok, Icon, label, tooltip }) {
  const cls = ok === true ? "text-green-600" : ok === false ? "text-red-500" : "text-gray-400";
  return (
    <div className="flex items-center gap-1" title={tooltip || label}>
      <Icon size={13} className={cls} />
      <span className={`text-xs ${cls}`}>{label}</span>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function WindowsDevices() {
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [liveWatchTarget, setLiveWatchTarget] = useState(null);
  const [editTarget, setEditTarget] = useState(null);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      setError("");
      const data = await winDevices.list();
      setDevices(data.devices || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [load]);

  const sendCommand = async (deviceId, command) => {
    try {
      await winDevices.issueCommand(deviceId, command, {});
      alert(`Command "${command}" queued.`);
    } catch (e) {
      alert(`Failed: ${e.message}`);
    }
  };

  const forceStopRecording = async (d) => {
    const label = d.name || `Room ${d.roomNumber}`;
    if (!confirm(
      `Force-stop the current recording on "${label}"?\n\n` +
      `The recording ends immediately. Captured chunks go through the normal ` +
      `post-process + upload pipeline. Result appears in Windows → Recordings ` +
      `within 1-2 minutes.\n\nContinue?`
    )) return;
    try {
      await winDevices.issueCommand(d.deviceId, "stop_recording", {});
      alert("Stop command queued. Device picks it up on next heartbeat (~30s).");
      setTimeout(load, 35_000);
    } catch (e) {
      alert(`Failed: ${e.message}`);
    }
  };

  const deleteDevice = async (d) => {
    const label = d.name || `Room ${d.roomNumber}`;
    if (!confirm(
      `Delete "${label}" (${d.deviceId.substring(0, 18)}...) from the database?\n\n` +
      `This does NOT uninstall the recorder — the .exe keeps running and will ` +
      `re-register on the next heartbeat. To fully decommission: delete here, ` +
      `then uninstall via Settings → Apps on the device.\n\nContinue?`
    )) return;
    try {
      await winDevices.deregister(d._id);
      alert(`"${label}" deleted from the database.`);
      load();
    } catch (e) {
      alert(`Failed to delete: ${e.message}`);
    }
  };

  // ── Fleet stats (mirrors Android Devices stat cards) ──────────────────────
  const online = devices.filter((d) => d.isOnline);
  const recording = devices.filter((d) => d.health?.recording?.isRecording);
  const outdated = devices.filter((d) => !d.appVersionCode);
  const alerts = devices.filter((d) => {
    const disk = d.health?.diskGovernor?.state;
    return !d.isOnline || (disk && disk !== "Normal");
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-800">Windows Devices</h2>
        <button
          onClick={load}
          className="flex items-center gap-2 text-sm text-blue-600 hover:text-blue-800"
        >
          <RefreshCw size={16} className={refreshing ? "animate-spin" : ""} /> Refresh
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3 mb-4 flex items-center gap-2">
          <AlertTriangle size={16} /> {error}
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        <div className="bg-white rounded-xl shadow-sm border p-4 flex items-center gap-3">
          <div className="bg-blue-100 p-2.5 rounded-lg"><Cpu size={20} className="text-blue-600" /></div>
          <div><p className="text-xs text-gray-500">Total</p><p className="text-xl font-bold text-gray-800">{devices.length}</p></div>
        </div>
        <div className="bg-white rounded-xl shadow-sm border p-4 flex items-center gap-3">
          <div className="bg-green-100 p-2.5 rounded-lg"><Wifi size={20} className="text-green-600" /></div>
          <div><p className="text-xs text-gray-500">Online</p><p className="text-xl font-bold text-gray-800">{online.length}</p></div>
        </div>
        <div className="bg-white rounded-xl shadow-sm border p-4 flex items-center gap-3">
          <div className="bg-red-100 p-2.5 rounded-lg"><CircleDot size={20} className="text-red-600" /></div>
          <div><p className="text-xs text-gray-500">Recording</p><p className="text-xl font-bold text-gray-800">{recording.length}</p></div>
        </div>
        {outdated.length > 0 && (
          <Link to="/windows/app-update" className="rounded-xl shadow-sm border p-4 flex items-center gap-3 bg-red-50 border-red-200 hover:bg-red-100 transition-colors">
            <div className="bg-red-100 p-2.5 rounded-lg"><Download size={20} className="text-red-600" /></div>
            <div><p className="text-xs text-gray-500">Outdated</p><p className="text-xl font-bold text-red-700">{outdated.length}</p></div>
          </Link>
        )}
        <div className={`rounded-xl shadow-sm border p-4 flex items-center gap-3 ${alerts.length > 0 ? "bg-amber-50 border-amber-200" : "bg-white"}`}>
          <div className={`p-2.5 rounded-lg ${alerts.length > 0 ? "bg-amber-100" : "bg-gray-100"}`}>
            <AlertTriangle size={20} className={alerts.length > 0 ? "text-amber-600" : "text-gray-400"} />
          </div>
          <div>
            <p className="text-xs text-gray-500">Alerts</p>
            <p className={`text-xl font-bold ${alerts.length > 0 ? "text-amber-700" : "text-gray-800"}`}>{alerts.length}</p>
          </div>
        </div>
      </div>

      {/* Setup info */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-6">
        <h4 className="font-medium text-blue-800 mb-1">Setup New Device</h4>
        <p className="text-sm text-blue-600">
          Install <strong>LectureLens-Setup.exe</strong> on the classroom Mini PC and complete
          the wizard (License Key + Room). After install, set Windows Sound Output to{" "}
          <code className="bg-blue-100 px-1.5 py-0.5 rounded text-xs">HDMI / Intel Display Audio</code>.
          The service auto-configures everything else and registers automatically.
        </p>
      </div>

      {/* Device cards */}
      {loading ? (
        <div className="p-12 text-center text-gray-400">Loading...</div>
      ) : devices.length === 0 ? (
        <div className="p-12 text-center text-gray-400 bg-white rounded-xl border">
          <Cpu size={48} className="mx-auto mb-3 opacity-50" />
          <p>No Windows devices registered yet.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {devices.map((device) => (
            <DeviceCard
              key={device._id}
              device={device}
              onForceStop={() => forceStopRecording(device)}
              onDelete={() => deleteDevice(device)}
              onEdit={() => setEditTarget(device)}
              onCommand={(cmd) => sendCommand(device.deviceId, cmd)}
              onWatchLive={() =>
                setLiveWatchTarget({
                  deviceId: device.deviceId,
                  title: device.name || `Room ${device.roomNumber}`,
                })
              }
            />
          ))}
        </div>
      )}

      {liveWatchTarget && (
        <WindowsLiveWatchModal
          deviceId={liveWatchTarget.deviceId}
          title={liveWatchTarget.title}
          onClose={() => setLiveWatchTarget(null)}
        />
      )}

      {editTarget && (
        <EditLocationModal
          device={editTarget}
          onClose={() => setEditTarget(null)}
          onSaved={() => { setEditTarget(null); load(); }}
        />
      )}
    </div>
  );
}

// ── Edit device location modal ────────────────────────────────────────────────
// Lets an admin fill in / correct a device's Campus · Block · Floor · Room
// from the portal. Needed because devices that registered via the v2.3.8
// auto-recovery path come up with those fields empty; also covers a Mini PC
// being physically moved. Writes via PATCH /api/windows/devices/:id.

// Module-level so its identity is stable across renders — defining an input
// wrapper inside the modal's render would remount the <input> every keystroke
// and drop focus.
function LocField({ label, value, onChange, placeholder }) {
  return (
    <div>
      <label className="text-xs font-medium text-gray-500 mb-1 block">{label}</label>
      <input
        type="text"
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
      />
    </div>
  );
}

function EditLocationModal({ device, onClose, onSaved }) {
  const [form, setForm] = useState({
    name: device.name || "",
    campus: device.campus || "",
    block: device.block || "",
    floor: device.floor || "",
    roomNumber: device.roomNumber || "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const save = async () => {
    if (!form.roomNumber.trim()) {
      setError("Room number is required.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await winDevices.update(device._id, {
        name: form.name.trim(),
        campus: form.campus.trim(),
        block: form.block.trim(),
        floor: form.floor.trim(),
        roomNumber: form.roomNumber.trim(),
      });
      onSaved();
    } catch (e) {
      setError(e.message || "Update failed");
      setSaving(false);
    }
  };

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl w-full max-w-md shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b">
          <h3 className="font-semibold text-gray-800 flex items-center gap-2">
            <MapPin size={16} className="text-blue-600" /> Edit Device Location
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={20} />
          </button>
        </div>
        <div className="p-5 space-y-3">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg p-2">{error}</div>
          )}
          <LocField label="Device Name" value={form.name} onChange={set("name")} placeholder="Smart PC - Room 001" />
          <div className="grid grid-cols-2 gap-3">
            <LocField label="Campus" value={form.campus} onChange={set("campus")} placeholder="Main Campus" />
            <LocField label="Block" value={form.block} onChange={set("block")} placeholder="A" />
            <LocField label="Floor" value={form.floor} onChange={set("floor")} placeholder="1" />
            <LocField label="Room Number" value={form.roomNumber} onChange={set("roomNumber")} placeholder="001" />
          </div>
          <p className="text-[11px] text-gray-400">
            Shown across Devices, Recordings and Booking. This only updates the admin
            portal record — it does not change anything on the device itself.
          </p>
        </div>
        <div className="flex justify-end gap-2 px-5 py-3 border-t bg-gray-50">
          <button onClick={onClose}
            className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition">
            Cancel
          </button>
          <button onClick={save} disabled={saving}
            className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition disabled:opacity-50">
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Device row card (mirrors Android Devices.jsx DeviceCard) ──────────────────

function DeviceCard({ device, onForceStop, onDelete, onEdit, onCommand, onWatchLive }) {
  const [expanded, setExpanded] = useState(false);
  const online = device.isOnline;
  const h = device.health || {};
  const hw = device.detectedHardware;
  const isRecording = h.recording?.isRecording;
  const disk = h.diskGovernor?.state;
  const live = h.liveWatch?.state;
  const mic = h.mic; // v2.3.14 mic level probe: { name, audioLevelDbfs, status }
  const canLive = live === "Connected" && isRecording;
  const hasCritical = !online || (disk && disk !== "Normal");

  // Windows health: CPU reports usagePercent; RAM/Disk report freeGB.
  const cameraOk = hw?.cameras?.length ? true : online ? false : null;
  const micOk = hw?.microphones?.length ? true : online ? false : null;

  return (
    <div className={`border rounded-xl bg-white shadow-sm overflow-hidden transition-all ${hasCritical ? "border-red-200" : "border-gray-100"}`}>
      {/* Main row */}
      <div className="p-4 flex items-start gap-4">
        {/* Icon */}
        <div className={`p-3 rounded-lg shrink-0 ${online ? "bg-green-100" : "bg-gray-100"}`}>
          <Cpu size={24} className={online ? "text-green-600" : "text-gray-400"} />
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          {/* Name + badges */}
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <p className="font-semibold text-gray-800 truncate">
              {device.name || `Room ${device.roomNumber}`}
            </p>
            {online ? (
              <span className="flex items-center gap-1 text-xs text-green-700 bg-green-50 px-2 py-0.5 rounded-full border border-green-200">
                <Wifi size={10} /> Online
              </span>
            ) : (
              <span className="flex items-center gap-1 text-xs text-gray-500 bg-gray-50 px-2 py-0.5 rounded-full border border-gray-200">
                <WifiOff size={10} /> Offline
              </span>
            )}
            {isRecording && (
              <span className="flex items-center gap-1 text-xs text-red-700 bg-red-50 px-2 py-0.5 rounded-full border border-red-200 animate-pulse">
                <CircleDot size={10} /> Recording
              </span>
            )}
            {live && live !== "Idle" && (
              <span className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border ${
                live === "Connected"
                  ? "text-red-700 bg-red-50 border-red-200"
                  : live === "Failed"
                  ? "text-red-700 bg-red-50 border-red-200"
                  : "text-slate-600 bg-slate-50 border-slate-200"
              }`}>
                <Radio size={10} /> Live: {live}
              </span>
            )}
            {disk && disk !== "Normal" && (
              <span className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border ${
                disk === "HardStop"
                  ? "text-red-700 bg-red-50 border-red-200"
                  : "text-amber-700 bg-amber-50 border-amber-200"
              }`}>
                <AlertTriangle size={10} /> Disk: {disk}
              </span>
            )}
            {mic?.status && mic.status !== "unknown" && (
              <span
                title={`Mic: ${mic.name || "unknown"}${
                  mic.audioLevelDbfs != null ? `  ·  peak ${mic.audioLevelDbfs.toFixed(1)} dB` : ""
                }`}
                className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border ${
                  mic.status === "good"
                    ? "text-green-700 bg-green-50 border-green-200"
                    : mic.status === "low"
                    ? "text-amber-700 bg-amber-50 border-amber-200"
                    : "text-red-700 bg-red-50 border-red-200"
                }`}>
                <Mic size={10} />
                {mic.status === "good" ? "Mic Good" : mic.status === "low" ? "Mic Low" : "No Mic Signal"}
                {mic.audioLevelDbfs != null ? ` ${Math.round(mic.audioLevelDbfs)} dB` : ""}
              </span>
            )}
            {device.licenseTier && (
              <span className="flex items-center gap-1 text-xs text-violet-700 bg-violet-50 px-2 py-0.5 rounded-full border border-violet-200 uppercase">
                {device.licenseTier}
              </span>
            )}
            {device.appVersionName ? (
              <span className="flex items-center gap-1 text-xs text-slate-600 bg-slate-50 px-2 py-0.5 rounded-full border border-slate-200">
                v{device.appVersionName}
              </span>
            ) : (
              <span className="flex items-center gap-1 text-xs text-red-700 bg-red-50 px-2 py-0.5 rounded-full border border-red-200">
                <Download size={10} /> Outdated
              </span>
            )}
          </div>

          {/* Location hierarchy: Campus · Block · Floor · Room */}
          <p className="text-sm text-gray-600 truncate flex items-center gap-1">
            <MapPin size={12} className="text-gray-400 shrink-0" />
            {[
              device.campus,
              device.block,
              device.floor && `Floor ${device.floor}`,
              `Room ${device.roomNumber || "–"}`,
            ].filter(Boolean).join("  ·  ")}
          </p>
          {/* Network + device id */}
          <p className="text-xs text-gray-400 truncate">
            {device.ipAddress ? `${device.ipAddress}  ·  ` : ""}
            <span className="font-mono">{device.deviceId}</span>
          </p>

          {/* Hardware quick status */}
          <div className="flex items-center gap-4 mt-2">
            <HardwareIcon ok={cameraOk} Icon={Camera} label="Camera"
              tooltip={hw?.cameras?.join(", ") || "No camera detected"} />
            <HardwareIcon ok={micOk} Icon={Mic} label="Mic"
              tooltip={hw?.microphones?.join(", ") || "No microphone detected"} />
            <HardwareIcon ok={online ? true : null} Icon={Monitor} label="Screen"
              tooltip={hw?.displays?.[0]
                ? `${hw.displays[0].width}x${hw.displays[0].height}`
                : "gdigrab desktop capture"} />
            <div className="flex-1 min-w-0">
              {h.cpu?.usagePercent != null && (
                <div className="mb-1">
                  <div className="flex items-center gap-1 mb-0.5">
                    <Cpu size={11} className="text-gray-400" />
                    <span className="text-[10px] text-gray-500">CPU</span>
                  </div>
                  <UsageBar value={h.cpu.usagePercent} />
                </div>
              )}
              <div className="flex items-center gap-4 text-[11px] text-gray-500">
                {h.ram?.freeGB != null && (
                  <span className="flex items-center gap-1">
                    <MemoryStick size={11} className="text-gray-400" />
                    RAM {h.ram.freeGB.toFixed(1)} GB free
                  </span>
                )}
                {h.disk?.freeGB != null && (
                  <span className="flex items-center gap-1">
                    <HardDrive size={11} className="text-gray-400" />
                    Disk {h.disk.freeGB.toFixed(1)} GB free
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-col items-end gap-2 shrink-0">
          <div className="flex items-center gap-1">
            {isRecording && (
              <button onClick={onForceStop}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-red-50 text-red-600 hover:bg-red-100 transition">
                <Square size={12} /> Stop
              </button>
            )}
            {canLive && (
              <button onClick={onWatchLive}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-red-600 text-white hover:bg-red-700 transition">
                <Radio size={12} className="animate-pulse" /> Watch Live
              </button>
            )}
            <Link to={`/windows/devices/${device.deviceId}/remote`}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-purple-50 text-purple-600 hover:bg-purple-100 transition">
              <Terminal size={12} /> Remote
            </Link>
            <button onClick={onEdit}
              className="p-2 text-blue-400 hover:bg-blue-50 rounded-lg transition" title="Edit location">
              <Pencil size={14} />
            </button>
            <button onClick={onDelete}
              className="p-2 text-red-400 hover:bg-red-50 rounded-lg transition" title="Delete device">
              <Trash2 size={14} />
            </button>
            <button onClick={() => setExpanded(!expanded)}
              className="p-2 text-gray-400 hover:bg-gray-100 rounded-lg transition">
              {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
          </div>
          {device.lastHeartbeat && (
            <span className="text-[10px] text-gray-400 flex items-center gap-1">
              <Clock size={9} /> Heartbeat: {fmtTime(device.lastHeartbeat)}
            </span>
          )}
        </div>
      </div>

      {/* Expanded detail panel */}
      {expanded && (
        <div className="border-t bg-gray-50 p-4 grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
          {/* Identity */}
          <div>
            <p className="font-medium text-gray-600 mb-1.5 flex items-center gap-1"><Signal size={12} /> Identity</p>
            <div className="space-y-1 text-gray-500">
              <p>Campus: <span className="text-gray-700">{device.campus || "–"}</span></p>
              <p>Block: <span className="text-gray-700">{device.block || "–"}</span></p>
              <p>Floor: <span className="text-gray-700">{device.floor || "–"}</span></p>
              <p>Room: <span className="text-gray-700">{device.roomNumber || "–"}</span></p>
              <p>License: <span className="text-gray-700">{device.licenseTier || "–"} ({device.licenseStatus || "?"})</span></p>
              <p>App: <span className="text-gray-700">{device.appVersionName || "?"} (vc={device.appVersionCode || "?"})</span></p>
              <p>Heartbeat: <span className="text-gray-700">{device.lastHeartbeat ? new Date(device.lastHeartbeat).toLocaleString() : "Never"}</span></p>
            </div>
          </div>

          {/* Hardware inventory */}
          <div>
            <p className="font-medium text-gray-600 mb-1.5 flex items-center gap-1"><Cpu size={12} /> Hardware</p>
            <div className="space-y-1 text-gray-500">
              {hw ? (
                <>
                  <p>CPU: <span className="text-gray-700">{hw.cpuModel || "?"}</span></p>
                  <p>RAM: <span className="text-gray-700">{hw.ramGB ? `${hw.ramGB} GB` : "?"}</span></p>
                  <p>Cameras: <span className="text-gray-700">{(hw.cameras || []).join(", ") || "None"}</span></p>
                  <p>Mics: <span className="text-gray-700">{(hw.microphones || []).join(", ") || "None"}</span></p>
                  {hw.displays?.[0] && (
                    <p>Display: <span className="text-gray-700">
                      {hw.displays[0].width}x{hw.displays[0].height} @ {hw.displays[0].refreshRate}Hz
                    </span></p>
                  )}
                </>
              ) : (
                <p className="text-gray-400">No hardware snapshot</p>
              )}
            </div>
          </div>

          {/* Disk Governor */}
          <div>
            <p className="font-medium text-gray-600 mb-1.5 flex items-center gap-1"><HardDrive size={12} /> Disk Governor</p>
            <div className="space-y-1 text-gray-500">
              {h.diskGovernor ? (
                <>
                  <p>State: <span className={h.diskGovernor.state === "Normal" ? "text-green-600" : "text-amber-600 font-medium"}>{h.diskGovernor.state}</span></p>
                  <p>Free: <span className="text-gray-700">{h.diskGovernor.freeBytes ? `${(h.diskGovernor.freeBytes / 1e9).toFixed(2)} GB` : "–"}</span></p>
                  <p>Last cleanup: <span className="text-gray-700">{h.diskGovernor.lastCleanupAt ? fmtTime(h.diskGovernor.lastCleanupAt) : "–"}</span></p>
                </>
              ) : (
                <p className="text-gray-400">No data</p>
              )}
            </div>
          </div>

          {/* Microphone — v2.3.14 level probe */}
          <div>
            <p className="font-medium text-gray-600 mb-1.5 flex items-center gap-1"><Mic size={12} /> Microphone</p>
            <div className="space-y-1 text-gray-500">
              {mic?.status && mic.status !== "unknown" ? (
                <>
                  <p>Selected: <span className="text-gray-700">{mic.name || "–"}</span></p>
                  <p>Level: <span className={
                    mic.status === "good" ? "text-green-600 font-medium"
                      : mic.status === "low" ? "text-amber-600 font-medium"
                      : "text-red-600 font-medium"
                  }>
                    {mic.audioLevelDbfs != null ? `${mic.audioLevelDbfs.toFixed(1)} dB peak  ·  ` : ""}
                    {mic.status === "good" ? "Good" : mic.status === "low" ? "Low" : "No signal"}
                  </span></p>
                  {mic.error && <p className="text-red-500">{mic.error}</p>}
                </>
              ) : (
                <p className="text-gray-400">Not probed yet</p>
              )}
            </div>
          </div>

          {/* Live Watch + actions */}
          <div>
            <p className="font-medium text-gray-600 mb-1.5 flex items-center gap-1"><Radio size={12} /> Live Watch</p>
            <div className="space-y-1 text-gray-500 mb-2">
              <p>State: <span className="text-gray-700">{h.liveWatch?.state || "Idle"}</span></p>
              {h.liveWatch?.roomName && <p>Room: <span className="text-gray-700">{h.liveWatch.roomName}</span></p>}
              <p>Reconnects: <span className="text-gray-700">{h.liveWatch?.reconnectCount ?? 0}</span></p>
            </div>
            <div className="flex flex-wrap gap-1 pt-2 border-t border-gray-200">
              <button onClick={() => onCommand("pull_logs")}
                className="flex items-center gap-1 px-2 py-1 rounded text-[11px] text-slate-600 hover:bg-slate-100" title="Pull logs">
                <FileText size={11} /> Logs
              </button>
              <button onClick={() => onCommand("capture_screenshot")}
                className="flex items-center gap-1 px-2 py-1 rounded text-[11px] text-slate-600 hover:bg-slate-100" title="Screenshot">
                <Camera size={11} /> Screenshot
              </button>
              <button onClick={() => onCommand("restart_service")}
                className="flex items-center gap-1 px-2 py-1 rounded text-[11px] text-slate-600 hover:bg-slate-100" title="Restart service">
                <Power size={11} /> Restart
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
