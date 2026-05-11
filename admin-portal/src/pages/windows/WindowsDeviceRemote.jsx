import { useState, useEffect, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import {
  ArrowLeft, RefreshCw, Terminal, Camera, FileText, Power, Trash2,
  HardDrive, Activity, Image as ImageIcon, Radio, AlertTriangle,
  CheckCircle2, XCircle, Cpu, MemoryStick, Wifi, Clock, Loader2,
  Download, ZapOff, Zap,
} from "lucide-react";
import { winDevices, winDiagnostics } from "../../services/windowsApi";
import WindowsLiveWatchModal from "../../components/WindowsLiveWatchModal";
import { usePersistedState } from "../../hooks/usePersistedState";

/**
 * Per-device control panel for the Windows fleet. Mirrors the structure
 * of the Android DeviceRemote.jsx but uses v2.1.0 capabilities:
 *
 *   Overview tab  — health (CPU/RAM/disk/network), DiskGovernor + LiveWatch
 *                   state, current recording info.
 *   Live tab      — embedded LiveWatchModal trigger + thumbnail of last
 *                   uploaded screenshot.
 *   Commands tab  — issue remote commands (pull_logs, capture_screenshot,
 *                   restart_service, force_record, run_disk_cleanup,
 *                   disable/enable_live_watch) + history of past commands.
 *   Diagnostics tab — list of uploaded logs/screenshots with download links.
 */
export default function WindowsDeviceRemote() {
  const { deviceId } = useParams();
  const [device, setDevice] = useState(null);
  const [commands, setCommands] = useState([]);
  const [diagnostics, setDiagnostics] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [activeTab, setActiveTab] = usePersistedState(
    "overview",
    "win_deviceremote_tab"
  );
  const [liveWatchOpen, setLiveWatchOpen] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const [devList, cmds, diag] = await Promise.all([
        winDevices.list().catch(() => ({ devices: [] })),
        winDevices.listCommands(deviceId).catch(() => []),
        winDiagnostics.listForDevice(deviceId).catch(() => ({ uploads: [] })),
      ]);
      setDevice((devList.devices || []).find((d) => d.deviceId === deviceId) || null);
      setCommands(Array.isArray(cmds) ? cmds : cmds.commands || []);
      setDiagnostics(diag.uploads || []);
    } catch (err) {
      console.error("WindowsDeviceRemote fetchData:", err);
    } finally {
      setLoading(false);
    }
  }, [deviceId]);

  useEffect(() => {
    fetchData();
    const t = setInterval(fetchData, 20000);
    return () => clearInterval(t);
  }, [fetchData]);

  const sendCommand = async (command, params = {}, confirmLabel) => {
    if (confirmLabel && !window.confirm(`Are you sure you want to ${confirmLabel}?`)) return;
    setSending(true);
    try {
      await winDevices.issueCommand(deviceId, command, params);
      setTimeout(fetchData, 1500);
    } catch (err) {
      alert("Failed to send command: " + (err.message || "unknown"));
    } finally {
      setSending(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="animate-spin text-blue-500" size={32} />
        <span className="ml-3 text-slate-500">Loading device...</span>
      </div>
    );
  }

  if (!device) {
    return (
      <div className="p-6">
        <Link to="/windows/devices" className="text-blue-600 hover:underline">
          ← Back to Windows Devices
        </Link>
        <p className="mt-4 text-slate-500">Device not found.</p>
      </div>
    );
  }

  const isOnline =
    device.lastHeartbeat &&
    Date.now() - new Date(device.lastHeartbeat).getTime() < 5 * 60 * 1000;
  const health = device.health || {};
  const liveWatch = health.liveWatch || {};
  const diskGov = health.diskGovernor || {};
  const recording = health.recording || {};
  const canWatchLive =
    liveWatch.state === "Connected" && recording.isRecording;
  const latestScreenshot = diagnostics.find((d) => d.kind === "screenshot");

  const tabs = [
    { id: "overview", label: "Overview", icon: Activity },
    { id: "live", label: "Live & Camera", icon: Radio },
    { id: "commands", label: "Commands", icon: Terminal },
    { id: "diagnostics", label: "Diagnostics", icon: FileText },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link to="/windows/devices" className="p-2 hover:bg-slate-100 rounded-lg">
            <ArrowLeft size={20} />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-3">
              {device.name || deviceId}
              <span
                className={`w-3 h-3 rounded-full ${isOnline ? "bg-green-500" : "bg-red-500"}`}
                title={isOnline ? "Online" : "Offline"}
              />
            </h1>
            <p className="text-sm text-slate-500">
              Room {device.roomNumber} · {device.deviceId.substring(0, 18)}... · v{device.appVersionName || "?"}
            </p>
          </div>
        </div>
        <button
          onClick={fetchData}
          className="p-2 hover:bg-slate-100 rounded-lg"
          title="Refresh"
        >
          <RefreshCw size={18} />
        </button>
      </div>

      {/* State banner */}
      <div className="flex flex-wrap gap-2">
        <StateBadge label={isOnline ? "Online" : "Offline"} ok={isOnline} />
        <StateBadge
          label={recording.isRecording ? "Recording" : "Idle"}
          ok={recording.isRecording}
          neutral={!recording.isRecording}
        />
        {diskGov.state && diskGov.state !== "Normal" && (
          <StateBadge
            label={`Disk: ${diskGov.state}`}
            warning={diskGov.state === "Warn"}
            danger={diskGov.state === "HardStop"}
          />
        )}
        {liveWatch.state && liveWatch.state !== "Idle" && (
          <StateBadge
            label={`Live: ${liveWatch.state}`}
            ok={liveWatch.state === "Connected"}
            warning={liveWatch.state === "Reconnecting"}
            danger={liveWatch.state === "Failed"}
          />
        )}
      </div>

      {/* Tabs */}
      <div className="border-b border-slate-200 flex gap-1 overflow-x-auto">
        {tabs.map((t) => {
          const Icon = t.icon;
          const active = activeTab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={`px-4 py-2 flex items-center gap-2 text-sm font-medium border-b-2 transition ${
                active
                  ? "border-blue-500 text-blue-600"
                  : "border-transparent text-slate-500 hover:text-slate-800"
              }`}
            >
              <Icon size={16} />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Tab bodies */}
      {activeTab === "overview" && <OverviewTab device={device} />}

      {activeTab === "live" && (
        <LiveTab
          canWatchLive={canWatchLive}
          liveWatch={liveWatch}
          latestScreenshot={latestScreenshot}
          onWatchLive={() => setLiveWatchOpen(true)}
          onCapture={() => sendCommand("capture_screenshot")}
          sending={sending}
        />
      )}

      {activeTab === "commands" && (
        <CommandsTab
          commands={commands}
          sending={sending}
          onSend={sendCommand}
          recording={recording}
          liveWatch={liveWatch}
          diskGov={diskGov}
        />
      )}

      {activeTab === "diagnostics" && (
        <DiagnosticsTab diagnostics={diagnostics} onPullLogs={() => sendCommand("pull_logs")} sending={sending} />
      )}

      {liveWatchOpen && (
        <WindowsLiveWatchModal
          deviceId={device.deviceId}
          title={device.name || `Room ${device.roomNumber}`}
          onClose={() => setLiveWatchOpen(false)}
        />
      )}
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────

function StateBadge({ label, ok, warning, danger, neutral }) {
  let cls = "bg-slate-100 text-slate-700 border-slate-200";
  if (ok) cls = "bg-green-100 text-green-800 border-green-200";
  else if (warning) cls = "bg-yellow-100 text-yellow-800 border-yellow-200";
  else if (danger) cls = "bg-red-100 text-red-800 border-red-200";
  else if (neutral) cls = "bg-slate-100 text-slate-600 border-slate-200";
  return (
    <span className={`px-3 py-1 text-xs font-medium rounded-full border ${cls}`}>
      {label}
    </span>
  );
}

function OverviewTab({ device }) {
  const h = device.health || {};
  const cpu = h.cpu || {};
  const ram = h.ram || {};
  const disk = h.disk || {};
  const net = h.network || {};
  const rec = h.recording || {};
  const diskGov = h.diskGovernor || {};

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Card title="Hardware Health" icon={Cpu}>
        <MetricRow icon={Cpu} label="CPU" value={`${cpu.usagePercent ?? "?"}% · peak60s ${cpu.peak60s ?? "?"}%`} />
        {cpu.temperature && <MetricRow icon={Cpu} label="CPU Temp" value={`${cpu.temperature}°C`} />}
        <MetricRow icon={MemoryStick} label="RAM" value={`${ram.freeGB?.toFixed(1) ?? "?"} GB free · ${ram.usedPercent ?? "?"}% used`} />
        <MetricRow icon={HardDrive} label="Disk" value={`${disk.freeGB?.toFixed(1) ?? "?"} GB free / ${disk.totalGB?.toFixed(0) ?? "?"} GB`} />
        <MetricRow icon={Wifi} label="Network" value={`${net.ipAddress || "?"} · ${net.linkSpeedMbps ?? "?"} Mbps · ${net.interfaceType || "?"}`} />
      </Card>

      <Card title="Capture & Recording" icon={Activity}>
        <MetricRow
          icon={rec.isRecording ? Activity : Clock}
          label="State"
          value={rec.isRecording ? `Recording ${rec.currentClassId || ""}` : "Idle"}
        />
        <MetricRow icon={FileText} label="Chunks written" value={`${rec.chunksWritten ?? 0}`} />
        <MetricRow icon={Download} label="Uploaded" value={`${rec.chunksUploaded ?? 0}`} />
        <MetricRow icon={Clock} label="Pending upload" value={`${rec.chunksPending ?? 0}`} />
        {rec.lastError && (
          <div className="text-xs text-red-700 bg-red-50 border border-red-100 rounded p-2 mt-2">
            Last error: {rec.lastError}
          </div>
        )}
      </Card>

      <Card title="Disk Governor" icon={HardDrive}>
        <MetricRow
          icon={HardDrive}
          label="State"
          value={diskGov.state || "Normal"}
          warn={diskGov.state === "Warn"}
          danger={diskGov.state === "HardStop"}
        />
        <MetricRow
          icon={HardDrive}
          label="Free space"
          value={diskGov.freeBytes ? `${(diskGov.freeBytes / 1e9).toFixed(2)} GB` : "?"}
        />
        <MetricRow icon={Clock} label="Last cleanup" value={diskGov.lastCleanupAt ? new Date(diskGov.lastCleanupAt).toLocaleString() : "—"} />
        <MetricRow icon={Trash2} label="Last cleanup purged" value={`${diskGov.lastCleanupPurgedCount || 0} recordings · ${diskGov.lastCleanupFreedBytes ? (diskGov.lastCleanupFreedBytes / 1e9).toFixed(1) : 0} GB`} />
      </Card>

      <Card title="Identity & Version" icon={CheckCircle2}>
        <MetricRow icon={CheckCircle2} label="Device ID" value={device.deviceId} />
        <MetricRow icon={CheckCircle2} label="Auth bound" value={device.licenseTier || "—"} />
        <MetricRow icon={Download} label="App version" value={`${device.appVersionName || "?"} (vc=${device.appVersionCode || "?"})`} />
        <MetricRow icon={Clock} label="Last heartbeat" value={device.lastHeartbeat ? new Date(device.lastHeartbeat).toLocaleString() : "Never"} />
      </Card>
    </div>
  );
}

function LiveTab({ canWatchLive, liveWatch, latestScreenshot, onWatchLive, onCapture, sending }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Card title="Live Watch" icon={Radio}>
        {canWatchLive ? (
          <button
            onClick={onWatchLive}
            className="w-full px-4 py-3 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium flex items-center justify-center gap-2"
          >
            <Radio size={18} className="animate-pulse" />
            Watch Live Now
          </button>
        ) : (
          <div className="text-sm text-slate-500 bg-slate-50 border border-slate-200 rounded p-3">
            Live watch becomes available when this device is actively recording
            a class. Current state: <strong>{liveWatch.state || "Idle"}</strong>.
            {liveWatch.lastError && (
              <div className="mt-2 text-xs text-red-700">Last error: {liveWatch.lastError}</div>
            )}
          </div>
        )}

        <div className="mt-3 text-xs text-slate-500 space-y-1">
          <div>Room: <span className="font-mono">{liveWatch.roomName || "—"}</span></div>
          <div>Reconnects: {liveWatch.reconnectCount ?? 0}</div>
          {liveWatch.connectedAt && (
            <div>Connected at: {new Date(liveWatch.connectedAt).toLocaleString()}</div>
          )}
        </div>
      </Card>

      <Card title="Screenshot Capture" icon={Camera}>
        <button
          onClick={onCapture}
          disabled={sending}
          className="w-full px-4 py-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg font-medium flex items-center justify-center gap-2"
        >
          <Camera size={18} />
          {sending ? "Sending..." : "Capture Screenshot Now"}
        </button>

        <div className="mt-4">
          <div className="text-xs font-medium text-slate-700 mb-2">Latest screenshot</div>
          {latestScreenshot ? (
            <a
              href={latestScreenshot.url}
              target="_blank"
              rel="noopener noreferrer"
              className="block border border-slate-200 rounded-lg overflow-hidden hover:shadow"
            >
              <img
                src={latestScreenshot.url}
                alt="Latest screenshot"
                className="w-full h-48 object-contain bg-slate-100"
              />
              <div className="text-[11px] text-slate-500 p-2 border-t border-slate-200">
                {new Date(latestScreenshot.capturedAt || latestScreenshot.createdAt).toLocaleString()} · {(latestScreenshot.sizeBytes / 1024).toFixed(0)} KB
              </div>
            </a>
          ) : (
            <div className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded p-3">
              No screenshots captured yet. Click "Capture Screenshot Now" to take one.
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

function CommandsTab({ commands, sending, onSend, recording, liveWatch, diskGov }) {
  const allCommands = [
    {
      id: "pull_logs",
      label: "Pull Logs",
      icon: FileText,
      desc: "Zip the last 5 MB of device logs and upload for review.",
    },
    {
      id: "capture_screenshot",
      label: "Capture Screenshot",
      icon: Camera,
      desc: "Grab one frame from the primary display.",
    },
    {
      id: "restart_service",
      label: "Restart Service",
      icon: Power,
      desc: "Gracefully restart the recorder service (recording continues on next boot).",
      confirm: "restart the recorder service",
    },
    {
      id: "run_disk_cleanup",
      label: "Run Disk Cleanup",
      icon: Trash2,
      desc: "Purge uploaded recordings older than the retention window.",
      disabled: diskGov.state === "HardStop",
    },
    {
      id: "force_record",
      label: "Force Record (Bypass Disk Hard-Stop)",
      icon: AlertTriangle,
      desc: "One-shot bypass for the next class if the disk is full. Use sparingly.",
      confirm: "ARM the force-record bypass for the next class",
      danger: true,
    },
    {
      id: "disable_live_watch",
      label: "Disable Live Watch",
      icon: ZapOff,
      desc: "Stop publishing the live stream until re-enabled.",
      disabled: liveWatch.state === "Idle" || liveWatch.state === "Disabled",
    },
    {
      id: "enable_live_watch",
      label: "Enable Live Watch",
      icon: Zap,
      desc: "Resume publishing live (will start with next recording).",
    },
    {
      id: "stop_recording",
      label: "Stop Recording",
      icon: XCircle,
      desc: "Force-stop the active recording (admin override).",
      confirm: "force-stop the active recording",
      danger: true,
      disabled: !recording.isRecording,
    },
  ];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Card title="Issue Remote Command" icon={Terminal}>
        <div className="space-y-2">
          {allCommands.map((c) => {
            const Icon = c.icon;
            const dis = c.disabled || sending;
            const colorCls = c.danger
              ? "border-red-200 hover:bg-red-50 text-red-800"
              : "border-slate-200 hover:bg-slate-50 text-slate-800";
            return (
              <button
                key={c.id}
                onClick={() => onSend(c.id, {}, c.confirm)}
                disabled={dis}
                className={`w-full text-left px-3 py-2 border rounded-lg flex items-start gap-3 transition disabled:opacity-40 disabled:cursor-not-allowed ${colorCls}`}
              >
                <Icon size={18} className="mt-0.5 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">{c.label}</div>
                  <div className="text-[11px] text-slate-500 mt-0.5">{c.desc}</div>
                </div>
              </button>
            );
          })}
        </div>
      </Card>

      <Card title="Command History" icon={Clock}>
        {commands.length === 0 ? (
          <div className="text-xs text-slate-500">No commands issued yet.</div>
        ) : (
          <div className="space-y-2 max-h-[500px] overflow-y-auto">
            {commands.slice(0, 30).map((cmd) => {
              const status = (cmd.status || "pending").toLowerCase();
              const ok = status === "delivered" || status === "completed" || status === "acknowledged";
              const failed = status === "failed";
              return (
                <div
                  key={cmd._id || cmd.id || JSON.stringify(cmd)}
                  className="text-xs border border-slate-200 rounded-lg p-2"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-slate-800">{cmd.command}</span>
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] ${
                        ok
                          ? "bg-green-100 text-green-700"
                          : failed
                          ? "bg-red-100 text-red-700"
                          : "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {status}
                    </span>
                  </div>
                  <div className="text-[10px] text-slate-500 mt-1">
                    {cmd.createdAt ? new Date(cmd.createdAt).toLocaleString() : "?"}
                  </div>
                  {cmd.result && (
                    <div className="text-[10px] text-slate-600 mt-1 font-mono break-all">
                      {typeof cmd.result === "string" ? cmd.result : JSON.stringify(cmd.result)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}

function DiagnosticsTab({ diagnostics, onPullLogs, sending }) {
  return (
    <Card title="Diagnostics Uploads (7-day retention)" icon={FileText}>
      <button
        onClick={onPullLogs}
        disabled={sending}
        className="mb-4 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium flex items-center gap-2"
      >
        <Download size={16} />
        {sending ? "Sending..." : "Pull Latest Logs Now"}
      </button>

      {diagnostics.length === 0 ? (
        <div className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded p-3">
          No diagnostic artifacts yet. Use "Pull Logs" or "Capture Screenshot"
          in the Commands tab to request one — they'll appear here within ~10 seconds.
        </div>
      ) : (
        <div className="space-y-2">
          {diagnostics.map((d) => (
            <div
              key={d.id}
              className="border border-slate-200 rounded-lg p-3 flex items-center gap-3"
            >
              {d.kind === "screenshot" ? (
                <ImageIcon size={18} className="text-blue-500 flex-shrink-0" />
              ) : (
                <FileText size={18} className="text-purple-500 flex-shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-slate-800 truncate">{d.filename}</div>
                <div className="text-[11px] text-slate-500">
                  {new Date(d.capturedAt || d.createdAt).toLocaleString()} ·{" "}
                  {(d.sizeBytes / 1024).toFixed(1)} KB · {d.kind}
                </div>
              </div>
              <a
                href={d.url}
                target="_blank"
                rel="noopener noreferrer"
                download
                className="text-blue-600 hover:underline text-xs flex items-center gap-1"
              >
                <Download size={14} />
                Download
              </a>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

// ── Building blocks ────────────────────────────────────────

function Card({ title, icon: Icon, children }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-3 text-slate-700 font-medium text-sm">
        {Icon && <Icon size={16} />}
        {title}
      </div>
      {children}
    </div>
  );
}

function MetricRow({ icon: Icon, label, value, warn, danger }) {
  const cls = danger
    ? "text-red-700"
    : warn
    ? "text-yellow-700"
    : "text-slate-700";
  return (
    <div className="flex items-center justify-between py-1 text-sm">
      <span className="text-slate-500 flex items-center gap-2">
        {Icon && <Icon size={14} className="text-slate-400" />}
        {label}
      </span>
      <span className={`font-medium text-right max-w-[60%] truncate ${cls}`}>{value}</span>
    </div>
  );
}
