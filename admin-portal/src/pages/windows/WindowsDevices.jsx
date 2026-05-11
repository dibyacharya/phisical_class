import { useEffect, useState, useCallback, useMemo } from "react";
import { Link } from "react-router-dom";
import {
  Cpu, RefreshCw, Search, Radio, AlertTriangle, FileText,
  Camera, Power, ChevronRight, Filter, Wifi, WifiOff, HardDrive,
  Video, X, Monitor, MemoryStick, Trash2,
} from "lucide-react";
import { winDevices } from "../../services/windowsApi";
import WindowsLiveWatchModal from "../../components/WindowsLiveWatchModal";

const FILTER_OPTIONS = [
  { id: "all", label: "All" },
  { id: "online", label: "Online" },
  { id: "recording", label: "Recording" },
  { id: "live", label: "Live now" },
  { id: "warning", label: "Disk warn / offline" },
];

export default function WindowsDevices() {
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [selected, setSelected] = useState(null);
  const [liveWatchTarget, setLiveWatchTarget] = useState(null);

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

  async function sendCommand(deviceId, command) {
    try {
      await winDevices.issueCommand(deviceId, command, {});
      alert(`Command "${command}" queued.`);
    } catch (e) {
      alert(`Failed: ${e.message}`);
    }
  }

  async function deleteDevice(d) {
    const label = d.name || `Room ${d.roomNumber}`;
    if (
      !confirm(
        `Delete "${label}" (${d.deviceId.substring(0, 18)}...) from the database?\n\n` +
        `This DOES NOT uninstall the recorder on the device — the .exe stays running. ` +
        `Next time the device heartbeats, it'll re-register automatically with the same ` +
        `license key + room number (if first-run.json or appsettings.json is still present).\n\n` +
        `To fully decommission a device: (1) Delete here, (2) Uninstall the recorder ` +
        `via Settings → Apps on the device.\n\nContinue?`
      )
    ) return;
    try {
      await winDevices.deregister(d._id);
      alert(`"${label}" deleted from the database.`);
      load();
    } catch (e) {
      alert(`Failed to delete: ${e.message}`);
    }
  }

  const filtered = useMemo(() => {
    return devices.filter((d) => {
      if (filter !== "all") {
        const liveState = d.health?.liveWatch?.state;
        const diskState = d.health?.diskGovernor?.state;
        if (filter === "online" && !d.isOnline) return false;
        if (filter === "recording" && !d.health?.recording?.isRecording) return false;
        if (filter === "live" && liveState !== "Connected") return false;
        if (filter === "warning") {
          const hasWarning =
            !d.isOnline ||
            (diskState && diskState !== "Normal");
          if (!hasWarning) return false;
        }
      }
      if (search.trim()) {
        const q = search.toLowerCase();
        const fields = [
          d.name, d.deviceId, d.roomNumber, d.licenseTier,
        ].filter(Boolean).map(String).map((v) => v.toLowerCase());
        if (!fields.some((f) => f.includes(q))) return false;
      }
      return true;
    });
  }, [devices, filter, search]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="animate-spin text-blue-500" size={32} />
        <span className="ml-3 text-slate-500">Loading Windows devices...</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Windows Devices</h1>
          <p className="text-sm text-slate-500">
            {filtered.length} of {devices.length} registered
          </p>
        </div>
        <button
          onClick={load}
          disabled={refreshing}
          className="p-2 hover:bg-slate-100 rounded-lg disabled:opacity-50"
          title="Refresh"
        >
          <RefreshCw size={18} className={refreshing ? "animate-spin" : ""} />
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded p-3 flex items-center gap-2">
          <AlertTriangle size={16} /> {error}
        </div>
      )}

      {/* Filters */}
      <div className="bg-white border border-slate-200 rounded-xl p-3 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search name, device id, room, tier..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-8 pr-2 py-1.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-blue-500"
          />
        </div>
        <div className="flex items-center gap-1 text-xs">
          <Filter size={12} className="text-slate-400" />
          {FILTER_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              onClick={() => setFilter(opt.id)}
              className={`px-2 py-1 rounded ${
                filter === opt.id
                  ? "bg-blue-100 text-blue-700"
                  : "text-slate-500 hover:bg-slate-100"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-10 text-center text-sm text-slate-400">
          {devices.length === 0
            ? "No Windows devices registered yet. Install the recorder on a Mini PC and complete the wizard."
            : "No devices match the current filters."}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((d) => (
            <DeviceCard
              key={d._id}
              d={d}
              onDetails={() => setSelected(d)}
              onWatchLive={() =>
                setLiveWatchTarget({
                  deviceId: d.deviceId,
                  title: d.name || `Room ${d.roomNumber}`,
                })
              }
              onCommand={(cmd) => sendCommand(d.deviceId, cmd)}
              onDelete={() => deleteDevice(d)}
            />
          ))}
        </div>
      )}

      {selected && (
        <DeviceDetailModal device={selected} onClose={() => setSelected(null)} />
      )}
      {liveWatchTarget && (
        <WindowsLiveWatchModal
          deviceId={liveWatchTarget.deviceId}
          title={liveWatchTarget.title}
          onClose={() => setLiveWatchTarget(null)}
        />
      )}
    </div>
  );
}

function DeviceCard({ d, onDetails, onWatchLive, onCommand, onDelete }) {
  const h = d.health || {};
  const live = h.liveWatch?.state;
  const disk = h.diskGovernor?.state;
  const isRecording = h.recording?.isRecording;
  const canLive = live === "Connected" && isRecording;

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 hover:shadow transition">
      <div className="flex items-center gap-3 mb-3">
        <div
          className={`w-10 h-10 rounded-lg flex items-center justify-center ${
            d.isOnline ? "bg-emerald-50 text-emerald-600" : "bg-slate-100 text-slate-400"
          }`}
        >
          <Cpu size={20} />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-slate-800 truncate">
            {d.name || `Room ${d.roomNumber}`}
          </h3>
          <p className="text-[11px] text-slate-500 font-mono truncate">
            {d.deviceId}
          </p>
        </div>
        <StatusBadge online={d.isOnline} recording={isRecording} />
      </div>

      {/* Health metrics row */}
      <div className="grid grid-cols-2 gap-2 mb-3 text-xs">
        <Metric icon={Cpu} label="CPU" value={h.cpu?.usagePercent != null ? `${h.cpu.usagePercent}%` : "—"} />
        <Metric icon={MemoryStick} label="RAM" value={h.ram?.freeGB != null ? `${h.ram.freeGB.toFixed(1)} GB` : "—"} />
        <Metric icon={HardDrive} label="Disk" value={h.disk?.freeGB != null ? `${h.disk.freeGB.toFixed(1)} GB` : "—"} />
        <Metric icon={Wifi} label="App" value={d.appVersionName || "—"} />
      </div>

      {/* Special-state badges */}
      <div className="flex flex-wrap gap-1 mb-3 min-h-[20px]">
        {disk && disk !== "Normal" && (
          <span
            className={`text-[10px] px-2 py-0.5 rounded-full ${
              disk === "HardStop"
                ? "bg-red-100 text-red-700"
                : "bg-amber-100 text-amber-700"
            }`}
          >
            Disk: {disk}
          </span>
        )}
        {live && live !== "Idle" && (
          <span
            className={`text-[10px] px-2 py-0.5 rounded-full ${
              live === "Connected"
                ? "bg-red-100 text-red-700"
                : live === "Failed"
                ? "bg-red-100 text-red-700"
                : "bg-slate-100 text-slate-600"
            }`}
          >
            Live: {live}
          </span>
        )}
        {d.licenseTier && (
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 uppercase">
            {d.licenseTier}
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-slate-100">
        <Link
          to={`/windows/devices/${d.deviceId}/remote`}
          className="text-xs px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded flex items-center gap-1"
        >
          Manage <ChevronRight size={12} />
        </Link>
        {canLive && (
          <button
            onClick={onWatchLive}
            className="text-xs px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded flex items-center gap-1"
          >
            <Radio size={12} className="animate-pulse" /> Watch Live
          </button>
        )}
        <button
          onClick={onDetails}
          className="text-xs px-3 py-1.5 border border-slate-300 hover:bg-slate-50 rounded"
        >
          Details
        </button>
        <button
          onClick={() => onCommand("pull_logs")}
          className="p-1.5 hover:bg-slate-100 rounded text-slate-500"
          title="Pull logs"
        >
          <FileText size={14} />
        </button>
        <button
          onClick={() => onCommand("capture_screenshot")}
          className="p-1.5 hover:bg-slate-100 rounded text-slate-500"
          title="Screenshot"
        >
          <Camera size={14} />
        </button>
        <button
          onClick={() => onCommand("restart_service")}
          className="p-1.5 hover:bg-slate-100 rounded text-slate-500"
          title="Restart service"
        >
          <Power size={14} />
        </button>
        <button
          onClick={onDelete}
          className="p-1.5 hover:bg-red-50 rounded text-red-500 ml-auto"
          title="Delete device from database"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}

function StatusBadge({ online, recording }) {
  if (recording) {
    return (
      <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-100 text-red-700 font-semibold flex items-center gap-1">
        <Radio size={10} className="animate-pulse" /> REC
      </span>
    );
  }
  if (online) {
    return (
      <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-semibold flex items-center gap-1">
        <Wifi size={10} /> Online
      </span>
    );
  }
  return (
    <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 font-semibold flex items-center gap-1">
      <WifiOff size={10} /> Offline
    </span>
  );
}

function Metric({ icon: Icon, label, value }) {
  return (
    <div className="flex items-center gap-1.5 text-slate-600">
      <Icon size={12} className="text-slate-400 flex-shrink-0" />
      <span className="text-slate-400 min-w-[28px]">{label}</span>
      <span className="font-medium truncate">{value}</span>
    </div>
  );
}

function DeviceDetailModal({ device, onClose }) {
  const hw = device.detectedHardware;
  const h = device.health || {};
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-white w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200">
          <div>
            <h2 className="font-semibold text-slate-800 text-sm">
              {device.name || `Room ${device.roomNumber}`}
            </h2>
            <p className="text-xs text-slate-500 font-mono">{device.deviceId}</p>
          </div>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-700">
            <X size={18} />
          </button>
        </div>
        <div className="p-5 space-y-4 overflow-y-auto">
          <DetailGroup title="Identity">
            <DetailRow label="Room" value={device.roomNumber} />
            <DetailRow label="License tier" value={device.licenseTier} />
            <DetailRow label="License status" value={device.licenseStatus} />
            <DetailRow label="App version" value={`${device.appVersionName} (vc=${device.appVersionCode})`} />
            <DetailRow label="Last heartbeat" value={device.lastHeartbeat ? new Date(device.lastHeartbeat).toLocaleString() : "Never"} />
          </DetailGroup>

          {hw && (
            <DetailGroup title="Hardware inventory (snapshot at install)">
              <DetailRow label="CPU" value={hw.cpuModel} />
              <DetailRow label="RAM" value={`${hw.ramGB} GB`} />
              <DetailRow label="Cameras" value={(hw.cameras || []).join(", ")} />
              <DetailRow label="Microphones" value={(hw.microphones || []).join(", ")} />
              <DetailRow label="Monitors" value={`${hw.monitorCount || 1}`} />
              {hw.displays?.[0] && (
                <DetailRow
                  label="Primary display"
                  value={`${hw.displays[0].name} · ${hw.displays[0].width}x${hw.displays[0].height} @ ${hw.displays[0].refreshRate}Hz`}
                />
              )}
            </DetailGroup>
          )}

          {h.diskGovernor && (
            <DetailGroup title="Disk Governor">
              <DetailRow label="State" value={h.diskGovernor.state} />
              <DetailRow
                label="Free space"
                value={h.diskGovernor.freeBytes ? `${(h.diskGovernor.freeBytes / 1e9).toFixed(2)} GB` : "—"}
              />
              <DetailRow
                label="Last cleanup"
                value={h.diskGovernor.lastCleanupAt ? new Date(h.diskGovernor.lastCleanupAt).toLocaleString() : "—"}
              />
            </DetailGroup>
          )}

          {h.liveWatch && (
            <DetailGroup title="Live watch">
              <DetailRow label="State" value={h.liveWatch.state || "Idle"} />
              <DetailRow label="Room" value={h.liveWatch.roomName} />
              <DetailRow label="Reconnects" value={String(h.liveWatch.reconnectCount ?? 0)} />
            </DetailGroup>
          )}
        </div>
        <div className="px-5 py-3 border-t border-slate-200 flex justify-end gap-2">
          <Link
            to={`/windows/devices/${device.deviceId}/remote`}
            className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg"
          >
            Open device console
          </Link>
        </div>
      </div>
    </div>
  );
}

function DetailGroup({ title, children }) {
  return (
    <div>
      <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
        {title}
      </h3>
      <div className="bg-slate-50 border border-slate-200 rounded-lg divide-y divide-slate-200">
        {children}
      </div>
    </div>
  );
}

function DetailRow({ label, value }) {
  return (
    <div className="flex items-center justify-between px-3 py-2 text-sm">
      <span className="text-slate-500 text-xs">{label}</span>
      <span className="font-medium text-slate-800 text-right max-w-[60%] truncate">
        {value || "—"}
      </span>
    </div>
  );
}
