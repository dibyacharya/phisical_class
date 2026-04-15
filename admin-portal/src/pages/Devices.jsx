import { useState, useEffect } from "react";
import {
  Tv, Wifi, WifiOff, CircleDot, Trash2, Play, Square, RefreshCw,
  Camera, Mic, Monitor, HardDrive, Cpu, Battery, AlertTriangle,
  CheckCircle, XCircle, ChevronDown, ChevronUp, Clock, Signal,
} from "lucide-react";
import api from "../services/api";

// ── helpers ──────────────────────────────────────────────────────────────────

const isOnline = (device) => {
  if (!device.lastHeartbeat) return false;
  return Date.now() - new Date(device.lastHeartbeat).getTime() < 5 * 60 * 1000;
};

const fmtTime = (iso) => iso ? new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "–";
const fmtUptime = (sec) => {
  if (!sec) return "–";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
};

function UsageBar({ value, warn = 75, danger = 90, label }) {
  if (value == null) return <span className="text-xs text-gray-400">–</span>;
  const color = value >= danger ? "bg-red-500" : value >= warn ? "bg-yellow-400" : "bg-green-500";
  return (
    <div className="flex items-center gap-2 min-w-0">
      <div className="flex-1 bg-gray-100 rounded-full h-1.5 min-w-0">
        <div className={`${color} h-1.5 rounded-full`} style={{ width: `${Math.min(value, 100)}%` }} />
      </div>
      <span className="text-xs text-gray-600 shrink-0">{value}%</span>
      {label && <span className="text-xs text-gray-400 shrink-0">{label}</span>}
    </div>
  );
}

function HardwareIcon({ ok, Icon, label }) {
  const color = ok === true ? "text-green-600 bg-green-50" : ok === false ? "text-red-600 bg-red-50" : "text-gray-400 bg-gray-50";
  const Ring = ok === true ? CheckCircle : ok === false ? XCircle : null;
  return (
    <div className="flex flex-col items-center gap-1" title={label}>
      <div className={`relative p-2 rounded-lg ${color}`}>
        <Icon size={18} />
        {Ring && (
          <Ring size={10} className={`absolute -bottom-1 -right-1 ${ok ? "text-green-500" : "text-red-500"} bg-white rounded-full`} />
        )}
      </div>
      <span className="text-[10px] text-gray-500">{label}</span>
    </div>
  );
}

function AlertBadge({ alerts }) {
  const active = (alerts || []).slice(0, 3);
  if (active.length === 0) return null;
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {active.map((a, i) => (
        <span key={i} className="inline-flex items-center gap-1 text-[10px] bg-amber-50 text-amber-700 border border-amber-200 px-1.5 py-0.5 rounded-full">
          <AlertTriangle size={9} />
          {a.message?.substring(0, 40)}{a.message?.length > 40 ? "…" : ""}
        </span>
      ))}
    </div>
  );
}

function DeviceCard({ device, onForceStart, onForceStop, onDelete }) {
  const [expanded, setExpanded] = useState(false);
  const online = isOnline(device);
  const h = device.health || {};
  const hasAlerts = (h.alerts || []).length > 0;
  const hasCritical = h.camera?.ok === false || h.mic?.ok === false || h.screen?.ok === false || h.disk?.usedPercent >= 90;

  return (
    <div className={`border rounded-xl bg-white shadow-sm overflow-hidden transition-all ${hasCritical ? "border-red-200" : "border-gray-100"}`}>
      {/* Main row */}
      <div className="p-4 flex items-start gap-4">
        {/* Icon */}
        <div className={`p-3 rounded-lg shrink-0 ${online ? "bg-green-100" : "bg-gray-100"}`}>
          <Tv size={24} className={online ? "text-green-600" : "text-gray-400"} />
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          {/* Name + badges */}
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <p className="font-semibold text-gray-800 truncate">{device.name}</p>
            {online ? (
              <span className="flex items-center gap-1 text-xs text-green-700 bg-green-50 px-2 py-0.5 rounded-full border border-green-200">
                <Wifi size={10} /> Online
              </span>
            ) : (
              <span className="flex items-center gap-1 text-xs text-gray-500 bg-gray-50 px-2 py-0.5 rounded-full border border-gray-200">
                <WifiOff size={10} /> Offline
              </span>
            )}
            {device.isRecording && (
              <span className="flex items-center gap-1 text-xs text-red-700 bg-red-50 px-2 py-0.5 rounded-full border border-red-200 animate-pulse">
                <CircleDot size={10} /> Recording
              </span>
            )}
            {hasCritical && (
              <span className="flex items-center gap-1 text-xs text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">
                <AlertTriangle size={10} /> Alert
              </span>
            )}
          </div>

          {/* Room + IP */}
          <p className="text-sm text-gray-500">
            Room {device.roomNumber || device.roomId}
            {device.floor ? ` · ${device.floor}` : ""}
            {device.ipAddress ? ` · ${device.ipAddress}` : ""}
            {device.deviceModel ? ` · ${device.deviceModel}` : ""}
          </p>

          {/* Hardware quick status */}
          {h.updatedAt && (
            <div className="flex items-center gap-4 mt-2">
              <HardwareIcon ok={h.camera?.ok} Icon={Camera} label="Camera" />
              <HardwareIcon ok={h.mic?.ok} Icon={Mic} label="Mic" />
              <HardwareIcon ok={h.screen?.ok} Icon={Monitor} label="Screen" />
              <div className="flex-1 min-w-0">
                {h.disk?.usedPercent != null && (
                  <div className="mb-1">
                    <div className="flex items-center gap-1 mb-0.5">
                      <HardDrive size={11} className="text-gray-400" />
                      <span className="text-[10px] text-gray-500">Disk</span>
                      {h.disk.freeGB != null && <span className="text-[10px] text-gray-400 ml-auto">{h.disk.freeGB} GB free</span>}
                    </div>
                    <UsageBar value={h.disk.usedPercent} />
                  </div>
                )}
                {h.ram?.usedPercent != null && (
                  <div>
                    <div className="flex items-center gap-1 mb-0.5">
                      <Cpu size={11} className="text-gray-400" />
                      <span className="text-[10px] text-gray-500">RAM</span>
                    </div>
                    <UsageBar value={h.ram.usedPercent} />
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Alerts */}
          {hasAlerts && <div className="mt-2"><AlertBadge alerts={h.alerts} /></div>}
        </div>

        {/* Actions */}
        <div className="flex flex-col items-end gap-2 shrink-0">
          <div className="flex items-center gap-1">
            {device.isRecording ? (
              <button onClick={() => onForceStop(device.deviceId)}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-red-50 text-red-600 hover:bg-red-100 transition">
                <Square size={12} /> Stop
              </button>
            ) : (
              <button onClick={() => onForceStart(device.deviceId)}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-green-50 text-green-600 hover:bg-green-100 transition">
                <Play size={12} /> Start
              </button>
            )}
            <button onClick={() => onDelete(device._id)}
              className="p-2 text-red-400 hover:bg-red-50 rounded-lg transition">
              <Trash2 size={14} />
            </button>
            <button onClick={() => setExpanded(!expanded)}
              className="p-2 text-gray-400 hover:bg-gray-100 rounded-lg transition">
              {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
          </div>
          {h.updatedAt && (
            <span className="text-[10px] text-gray-400 flex items-center gap-1">
              <Clock size={9} /> Health: {fmtTime(h.updatedAt)}
            </span>
          )}
        </div>
      </div>

      {/* Expanded detail panel */}
      {expanded && (
        <div className="border-t bg-gray-50 p-4 grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
          {/* Network */}
          <div>
            <p className="font-medium text-gray-600 mb-1.5 flex items-center gap-1"><Signal size={12} /> Network</p>
            <div className="space-y-1 text-gray-500">
              {h.network?.ssid && <p>SSID: <span className="text-gray-700">{h.network.ssid}</span></p>}
              {h.network?.wifiSignal != null && (
                <p>Signal: <span className="text-gray-700">{h.network.wifiSignal}{device.deviceType === "android" ? " dBm" : "%"}</span></p>
              )}
              {h.network?.latencyMs != null && (
                <p>Latency: <span className={`font-medium ${h.network.latencyMs > 1000 ? "text-red-600" : "text-green-600"}`}>{h.network.latencyMs}ms</span></p>
              )}
            </div>
          </div>

          {/* CPU / Battery */}
          <div>
            <p className="font-medium text-gray-600 mb-1.5 flex items-center gap-1"><Cpu size={12} /> System</p>
            <div className="space-y-1 text-gray-500">
              {h.cpu?.usagePercent != null && (
                <div>
                  <p className="mb-0.5">CPU</p>
                  <UsageBar value={h.cpu.usagePercent} />
                </div>
              )}
              {h.battery?.level != null && (
                <p className="flex items-center gap-1">
                  <Battery size={10} />
                  {h.battery.level}% {h.battery.charging ? "(charging)" : ""}
                </p>
              )}
              {h.serviceUptime != null && (
                <p>Uptime: <span className="text-gray-700">{fmtUptime(h.serviceUptime)}</span></p>
              )}
            </div>
          </div>

          {/* Camera / Mic / Screen */}
          <div>
            <p className="font-medium text-gray-600 mb-1.5 flex items-center gap-1"><Camera size={12} /> Hardware</p>
            <div className="space-y-1 text-gray-500">
              <p className="flex items-center gap-1">
                <Camera size={10} />
                {h.camera?.ok === true ? <span className="text-green-600">{h.camera.name || "OK"}</span>
                  : h.camera?.ok === false ? <span className="text-red-600">{h.camera.error || "Not found"}</span>
                  : <span className="text-gray-400">Unknown</span>}
              </p>
              <p className="flex items-center gap-1">
                <Mic size={10} />
                {h.mic?.ok === true ? <span className="text-green-600">{h.mic.name || "OK"}</span>
                  : h.mic?.ok === false ? <span className="text-red-600">{h.mic.error || "Not found"}</span>
                  : <span className="text-gray-400">Unknown</span>}
              </p>
              <p className="flex items-center gap-1">
                <Monitor size={10} />
                {h.screen?.ok === true ? <span className="text-green-600">{h.screen.resolution || "OK"}</span>
                  : h.screen?.ok === false ? <span className="text-red-600">{h.screen.error || "Issue"}</span>
                  : <span className="text-gray-400">Unknown</span>}
              </p>
            </div>
          </div>

          {/* Recording stats + alerts log */}
          <div>
            <p className="font-medium text-gray-600 mb-1.5 flex items-center gap-1"><CircleDot size={12} /> Recording</p>
            <div className="space-y-1 text-gray-500">
              {h.recording?.frameDrop != null && <p>Frame drops: <span className={h.recording.frameDrop > 50 ? "text-red-600 font-medium" : "text-gray-700"}>{h.recording.frameDrop}</span></p>}
              {h.recording?.errorCount != null && <p>Errors: <span className={h.recording.errorCount > 0 ? "text-red-600 font-medium" : "text-gray-700"}>{h.recording.errorCount}</span></p>}
              {h.recording?.lastError && (
                <p className="text-red-500 truncate" title={h.recording.lastError}>
                  Last: {h.recording.lastError.substring(0, 50)}
                </p>
              )}
              {(!h.recording?.errorCount && !h.recording?.lastError) && (
                <p className="text-green-600">No errors</p>
              )}
            </div>
          </div>

          {/* Alert history */}
          {(h.alerts || []).length > 0 && (
            <div className="col-span-2 md:col-span-4 border-t pt-3">
              <p className="font-medium text-gray-600 mb-2 flex items-center gap-1"><AlertTriangle size={12} /> Recent Alerts</p>
              <div className="space-y-1">
                {h.alerts.slice(0, 5).map((a, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 px-2 py-1 rounded-lg">
                    <AlertTriangle size={10} className="shrink-0" />
                    <span className="font-medium capitalize">[{a.type}]</span>
                    <span className="flex-1">{a.message}</span>
                    <span className="text-gray-400 shrink-0">{fmtTime(a.time)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Devices() {
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchDevices = () => {
    api.get("/classroom-recording/devices")
      .then((r) => { setDevices(r.data); setLoading(false); })
      .catch(() => setLoading(false));
  };

  useEffect(() => {
    fetchDevices();
    const iv = setInterval(fetchDevices, 10000);
    return () => clearInterval(iv);
  }, []);

  const handleForceStart = async (deviceId) => {
    await api.post(`/classroom-recording/devices/${deviceId}/force-start`);
    fetchDevices();
  };
  const handleForceStop = async (deviceId) => {
    await api.post(`/classroom-recording/devices/${deviceId}/force-stop`);
    fetchDevices();
  };
  const handleDelete = async (id) => {
    if (!confirm("Delete this device?")) return;
    await api.delete(`/classroom-recording/devices/${id}`);
    fetchDevices();
  };

  const online = devices.filter(isOnline);
  const recording = devices.filter((d) => d.isRecording);
  const alerts = devices.filter((d) => {
    const h = d.health || {};
    return h.camera?.ok === false || h.mic?.ok === false || h.screen?.ok === false || (h.disk?.usedPercent >= 90);
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-800">Recording Devices</h2>
        <button onClick={fetchDevices}
          className="flex items-center gap-2 text-sm text-blue-600 hover:text-blue-800">
          <RefreshCw size={16} /> Refresh
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-xl shadow-sm border p-4 flex items-center gap-3">
          <div className="bg-blue-100 p-2.5 rounded-lg"><Tv size={20} className="text-blue-600" /></div>
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
          Install <strong>LectureLens-Recorder APK</strong> on Smart TV / Android, or run{" "}
          <code className="bg-blue-100 px-1.5 py-0.5 rounded text-xs">node recorder-service.js --setup</code> on Windows PC.
          API URL: <code className="bg-blue-100 px-1.5 py-0.5 rounded text-xs">http://&lt;server-ip&gt;:5020/api</code>
        </p>
      </div>

      {/* Device cards */}
      {loading ? (
        <div className="p-12 text-center text-gray-400">Loading...</div>
      ) : devices.length === 0 ? (
        <div className="p-12 text-center text-gray-400 bg-white rounded-xl border">
          <Tv size={48} className="mx-auto mb-3 opacity-50" />
          <p>No devices registered yet.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {devices.map((device) => (
            <DeviceCard
              key={device._id}
              device={device}
              onForceStart={handleForceStart}
              onForceStop={handleForceStop}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}
