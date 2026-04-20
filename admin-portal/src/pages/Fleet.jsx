import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Activity, AlertTriangle, CheckCircle2, CircleDot, Layers, Loader2,
  Mic, Power, RefreshCw, RotateCcw, Terminal, Trash2, Tv, Usb, Wifi, WifiOff,
} from "lucide-react";
import api from "../services/api";

/**
 * Fleet Dashboard — single-screen view of every device in the deployment.
 *
 * Designed for pilot (2–5 classrooms) scaling up to institutional rollout.
 * Highlights:
 *   - Sorted critical → warning → healthy so issues are at the top
 *   - Inline health score + last heartbeat age
 *   - Mic type + video pipeline badges at a glance
 *   - Multi-select + bulk remote actions (reboot / clear / restart / pull-logs)
 */
export default function Fleet() {
  const [overview, setOverview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(new Set());
  const [lastBroadcast, setLastBroadcast] = useState(null);
  const [broadcasting, setBroadcasting] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const res = await api.get("/analytics/fleet-overview");
      setOverview(res.data);
    } catch (err) {
      console.error("Fleet fetch error:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const iv = setInterval(fetchData, 15_000);
    return () => clearInterval(iv);
  }, [fetchData]);

  const toggleSelection = (deviceId) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(deviceId)) next.delete(deviceId);
      else next.add(deviceId);
      return next;
    });
  };

  const selectAllVisible = () => {
    if (!overview) return;
    setSelected(new Set(overview.devices.map((d) => d.deviceId)));
  };
  const clearSelection = () => setSelected(new Set());

  const selectedArray = useMemo(() => Array.from(selected), [selected]);
  const selectedCount = selectedArray.length;

  // Issue a broadcast command across the selected devices
  const broadcast = async (command, label, { confirm, params } = {}) => {
    if (selectedCount === 0) return alert("Select at least one device first");
    if (confirm && !window.confirm(`${label} — applies to ${selectedCount} device(s). Continue?`)) return;
    setBroadcasting(true);
    try {
      const res = await api.post("/remote/broadcast", {
        deviceIds: selectedArray,
        command,
        params: params || {},
      });
      setLastBroadcast({ command, label, ...res.data });
    } catch (err) {
      alert("Broadcast failed: " + (err.response?.data?.error || err.message));
    } finally {
      setBroadcasting(false);
    }
  };

  if (loading || !overview) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-500">
        <Loader2 className="animate-spin mr-3" size={24} /> Loading fleet…
      </div>
    );
  }

  const { total, online, offline, recording, healthy, warning, critical, devices } = overview;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold text-indigo-500 tracking-wider uppercase">Operations</p>
          <h1 className="text-2xl font-bold text-slate-800">Fleet Dashboard</h1>
          <p className="text-sm text-slate-500 mt-1">
            Live status across all classroom devices — auto-refresh every 15 s
          </p>
        </div>
        <button
          onClick={fetchData}
          className="flex items-center gap-2 px-4 py-2 bg-white border rounded-lg text-sm text-slate-600 hover:bg-slate-50"
        >
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        <Stat icon={Tv} label="Total" value={total} color="slate" />
        <Stat icon={Wifi} label="Online" value={online} color="emerald" />
        <Stat icon={WifiOff} label="Offline" value={offline} color="slate" />
        <Stat icon={CircleDot} label="Recording" value={recording} color="red" />
        <Stat icon={CheckCircle2} label="Healthy" value={healthy} color="emerald" />
        <Stat icon={AlertTriangle} label={`Warn/Crit`} value={warning + critical} color={critical > 0 ? "red" : "amber"} />
      </div>

      {/* Bulk action bar */}
      <div className="bg-white rounded-xl border p-4 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 text-sm">
          <span className="font-medium text-slate-700">
            {selectedCount} selected
          </span>
          <button className="text-xs text-indigo-600 hover:underline" onClick={selectAllVisible} disabled={!devices.length}>
            Select all
          </button>
          {selectedCount > 0 && (
            <button className="text-xs text-slate-500 hover:underline" onClick={clearSelection}>
              Clear
            </button>
          )}
        </div>

        <div className="flex-1" />

        <BulkButton icon={Terminal} label="Pull Logs" color="purple" disabled={selectedCount === 0 || broadcasting}
          onClick={() => broadcast("pull_logs", "Pull logs")} />
        <BulkButton icon={Trash2} label="Clear Storage" color="yellow" disabled={selectedCount === 0 || broadcasting}
          onClick={() => broadcast("clear_storage", "Clear storage", { confirm: true })} />
        <BulkButton icon={RotateCcw} label="Restart App" color="orange" disabled={selectedCount === 0 || broadcasting}
          onClick={() => broadcast("restart_app", "Restart app", { confirm: true })} />
        <BulkButton icon={Power} label="Reboot" color="red" disabled={selectedCount === 0 || broadcasting}
          onClick={() => broadcast("reboot", "Reboot devices", { confirm: true })} />

        {broadcasting && <Loader2 size={16} className="animate-spin text-blue-500" />}
      </div>

      {lastBroadcast && (
        <div className={`rounded-xl p-3 border text-sm ${
          lastBroadcast.failCount === 0
            ? "bg-emerald-50 border-emerald-200 text-emerald-800"
            : "bg-amber-50 border-amber-200 text-amber-800"
        }`}>
          <strong>{lastBroadcast.label}:</strong>{" "}
          {lastBroadcast.okCount}/{lastBroadcast.targetCount} queued successfully
          {lastBroadcast.failCount > 0 && ` (${lastBroadcast.failCount} failed)`}
        </div>
      )}

      {/* Device grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {devices.map((d) => (
          <DeviceCard
            key={d.deviceId}
            device={d}
            selected={selected.has(d.deviceId)}
            onToggle={() => toggleSelection(d.deviceId)}
          />
        ))}
      </div>

      {devices.length === 0 && (
        <div className="bg-white rounded-xl border p-12 text-center text-slate-400">
          No devices registered yet.
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────

function Stat({ icon: Icon, label, value, color }) {
  const palette = {
    slate: "text-slate-600 bg-slate-50",
    emerald: "text-emerald-600 bg-emerald-50",
    red: "text-red-600 bg-red-50",
    amber: "text-amber-600 bg-amber-50",
    blue: "text-blue-600 bg-blue-50",
  };
  return (
    <div className="bg-white rounded-xl border p-4 flex items-center gap-3">
      <div className={`p-2 rounded-lg ${palette[color] || palette.slate}`}>
        <Icon size={18} />
      </div>
      <div>
        <p className="text-xs text-slate-500">{label}</p>
        <p className="text-xl font-bold text-slate-800">{value}</p>
      </div>
    </div>
  );
}

function BulkButton({ icon: Icon, label, color, onClick, disabled }) {
  const palette = {
    purple: "bg-purple-50 text-purple-700 hover:bg-purple-100 border-purple-200",
    yellow: "bg-yellow-50 text-yellow-700 hover:bg-yellow-100 border-yellow-200",
    orange: "bg-orange-50 text-orange-700 hover:bg-orange-100 border-orange-200",
    red: "bg-red-50 text-red-700 hover:bg-red-100 border-red-200",
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium border transition
        ${disabled ? "opacity-40 cursor-not-allowed bg-slate-50 text-slate-400 border-slate-200" : palette[color] || palette.purple}`}
    >
      <Icon size={12} /> {label}
    </button>
  );
}

function DeviceCard({ device, selected, onToggle }) {
  const statusBg = {
    healthy: "border-emerald-200 bg-emerald-50/40",
    warning: "border-amber-300 bg-amber-50/40",
    critical: "border-red-300 bg-red-50/40",
  }[device.status];
  const scoreColor = device.status === "healthy" ? "text-emerald-700"
    : device.status === "warning" ? "text-amber-700" : "text-red-700";

  const lastHeartbeatAge = device.lastHeartbeat
    ? Math.floor((Date.now() - new Date(device.lastHeartbeat).getTime()) / 1000)
    : null;

  const isUsbMic = (device.micLabel || "").toLowerCase().includes("usb");
  const usingGl = device.videoPipeline === "gl_compositor";

  return (
    <div className={`rounded-xl border p-4 relative ${statusBg || "border-slate-200 bg-white"}`}>
      <div className="flex items-start gap-3">
        <label className="pt-1 cursor-pointer">
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggle}
            className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
          />
        </label>

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="font-semibold text-slate-800 truncate">
                <Link to={`/device/${device.deviceId}/remote`} className="hover:underline">
                  {device.name}
                </Link>
              </h3>
              <p className="text-xs text-slate-500 truncate">
                Room {device.roomNumber || "—"} · {device.roomName || ""}
              </p>
            </div>
            <div className={`text-right shrink-0 ${scoreColor}`}>
              <div className="text-2xl font-bold leading-none">{device.healthScore}</div>
              <div className="text-[10px] uppercase tracking-wider font-medium">{device.status}</div>
            </div>
          </div>

          {/* Status chips */}
          <div className="flex flex-wrap gap-1.5 mt-2">
            <Chip
              icon={device.isOnline ? Wifi : WifiOff}
              label={device.isOnline ? `Online ${lastHeartbeatAge ?? "?"}s` : "Offline"}
              color={device.isOnline ? "emerald" : "slate"}
            />
            {device.isRecording && <Chip icon={CircleDot} label="Recording" color="red" />}
            {device.appVersionName && (
              <Chip label={`v${device.appVersionName}`} color="slate" />
            )}
            {device.micLabel && (
              <Chip
                icon={isUsbMic ? Usb : Mic}
                label={isUsbMic ? "USB mic" : "Built-in mic"}
                color={isUsbMic ? "emerald" : "slate"}
              />
            )}
            {device.videoPipeline && (
              <Chip
                icon={Layers}
                label={usingGl ? "GL compositor" : "Legacy"}
                color={usingGl ? "indigo" : "slate"}
              />
            )}
            {device.glCameraPiP === true && (
              <Chip label="PiP active" color="indigo" />
            )}
          </div>

          {device.lastRecordingError && (
            <div className="mt-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1 truncate">
              <AlertTriangle size={11} className="inline mr-1" />
              {device.lastRecordingError}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Chip({ icon: Icon, label, color }) {
  const palette = {
    emerald: "bg-emerald-100 text-emerald-700 border-emerald-200",
    slate: "bg-slate-100 text-slate-600 border-slate-200",
    red: "bg-red-100 text-red-700 border-red-200",
    indigo: "bg-indigo-100 text-indigo-700 border-indigo-200",
    amber: "bg-amber-100 text-amber-700 border-amber-200",
  };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border ${palette[color] || palette.slate}`}>
      {Icon && <Icon size={10} />}
      {label}
    </span>
  );
}
