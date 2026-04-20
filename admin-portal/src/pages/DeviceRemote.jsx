import { useState, useEffect, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import api from "../services/api";
import {
  ArrowLeft, RefreshCw, Terminal, Camera, Volume2, VolumeX,
  RotateCcw, Trash2, FileText, Power, Square, Image,
  CheckCircle2, XCircle, Clock, AlertTriangle, Loader2, Bell,
} from "lucide-react";

export default function DeviceRemote() {
  const { deviceId } = useParams();
  const [device, setDevice] = useState(null);
  const [thumbnails, setThumbnails] = useState([]);
  const [commands, setCommands] = useState([]);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [activeTab, setActiveTab] = useState("live"); // live | commands | logs
  const [expandedLog, setExpandedLog] = useState(null);
  const [selectedThumb, setSelectedThumb] = useState(null);

  const fetchData = useCallback(async () => {
    try {
      const [devRes, thumbRes, cmdRes, logRes] = await Promise.all([
        api.get("/classroom-recording/devices").then(r =>
          r.data?.find(d => d.deviceId === deviceId)
        ),
        api.get(`/remote/thumbnails/${deviceId}?limit=24`),
        api.get(`/remote/commands/${deviceId}?limit=30`),
        api.get(`/remote/logs/${deviceId}?limit=10`),
      ]);
      setDevice(devRes);
      setThumbnails(thumbRes.data || []);
      setCommands(cmdRes.data || []);
      setLogs(logRes.data || []);
    } catch (err) {
      console.error("Fetch error:", err);
    } finally {
      setLoading(false);
    }
  }, [deviceId]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000); // refresh every 30s
    return () => clearInterval(interval);
  }, [fetchData]);

  const sendCommand = async (command, params = {}) => {
    setSending(true);
    try {
      await api.post("/remote/command", { deviceId, command, params });
      // Refresh commands list
      setTimeout(fetchData, 1000);
    } catch (err) {
      alert("Failed to send command: " + (err.response?.data?.error || err.message));
    } finally {
      setSending(false);
    }
  };

  const confirmAndSend = (command, label) => {
    if (window.confirm(`Are you sure you want to ${label}?`)) {
      sendCommand(command);
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

  const isOnline = device?.lastHeartbeat &&
    (Date.now() - new Date(device.lastHeartbeat).getTime()) < 5 * 60 * 1000;

  const latestThumb = thumbnails[0];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link to="/devices" className="p-2 hover:bg-slate-100 rounded-lg">
            <ArrowLeft size={20} />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-3">
              {device?.name || deviceId}
              <span className={`w-3 h-3 rounded-full ${isOnline ? "bg-green-500" : "bg-red-500"}`} />
            </h1>
            <p className="text-slate-500 text-sm">
              Room: {device?.roomNumber || "—"} · {device?.roomName || ""} ·
              {isOnline ? " Online" : " Offline"} ·
              {device?.isRecording ? " Recording" : " Idle"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Link
            to={`/analytics?device=${deviceId}`}
            className="px-4 py-2 border rounded-lg text-sm hover:bg-slate-50"
          >
            View Analytics
          </Link>
          <button
            onClick={fetchData}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            <RefreshCw size={16} /> Refresh
          </button>
        </div>
      </div>

      {/* Outdated APK Warning */}
      {device && !device.appVersionCode && (
        <div className="bg-amber-50 border border-amber-300 rounded-xl p-4 flex items-start gap-3">
          <AlertTriangle className="text-amber-600 mt-0.5 shrink-0" size={20} />
          <div>
            <h4 className="font-semibold text-amber-800">Device running outdated APK</h4>
            <p className="text-sm text-amber-700 mt-1">
              This device is running an old version that does not support remote commands.
              Commands will be delivered but won't execute. Please update the APK manually:
            </p>
            <ol className="text-sm text-amber-700 mt-2 space-y-1 list-decimal ml-4">
              <li>Go to <Link to="/app-update" className="underline font-medium">App Updates</Link> and download the latest APK</li>
              <li>Transfer the APK to the device via USB or network share</li>
              <li>Install the APK on the device (Settings &gt; Security &gt; Allow unknown sources)</li>
              <li>Once updated, remote commands will work automatically</li>
            </ol>
          </div>
        </div>
      )}

      {/* Remote Control Panel */}
      <div className="bg-white rounded-xl border p-5">
        <h3 className="font-semibold text-slate-700 mb-4 flex items-center gap-2">
          <Terminal size={18} /> Remote Control
          {sending && <Loader2 size={16} className="animate-spin text-blue-500" />}
        </h3>
        <div className="flex flex-wrap gap-3">
          <CmdButton
            icon={Camera}
            label="Capture Screenshot"
            color="blue"
            onClick={() => sendCommand("capture_screenshot")}
            disabled={sending || !isOnline}
          />
          <CmdButton
            icon={Bell}
            label="Play Sound"
            color="green"
            onClick={() => sendCommand("play_sound")}
            disabled={sending || !isOnline}
          />
          <CmdButton
            icon={FileText}
            label="Pull Logs"
            color="purple"
            onClick={() => sendCommand("pull_logs")}
            disabled={sending || !isOnline}
          />
          <CmdButton
            icon={Trash2}
            label="Clear Storage"
            color="yellow"
            onClick={() => confirmAndSend("clear_storage", "clear old recordings from this device")}
            disabled={sending || !isOnline}
          />
          <CmdButton
            icon={Square}
            label="Force Stop Recording"
            color="orange"
            onClick={() => confirmAndSend("force_stop", "force stop the current recording")}
            disabled={sending || !isOnline || !device?.isRecording}
          />
          <CmdButton
            icon={RotateCcw}
            label="Restart App"
            color="red"
            onClick={() => confirmAndSend("restart_app", "restart the recorder app")}
            disabled={sending || !isOnline}
          />
          <CmdButton
            icon={Power}
            label="Reboot Device"
            color="red"
            onClick={() => confirmAndSend("reboot", "reboot this Smart TV (requires Device Owner)")}
            disabled={sending || !isOnline}
          />
        </div>
        {!isOnline && (
          <p className="text-sm text-yellow-600 mt-3 flex items-center gap-1">
            <AlertTriangle size={14} /> Device is offline. Commands will be queued and executed when it comes back online.
          </p>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-slate-100 rounded-lg p-1">
        {[
          { key: "live", label: "Live Preview", icon: Image },
          { key: "commands", label: `Commands (${commands.length})`, icon: Terminal },
          { key: "logs", label: `Logs (${logs.length})`, icon: FileText },
        ].map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors
              ${activeTab === key ? "bg-white shadow text-slate-800" : "text-slate-500 hover:text-slate-700"}`}
          >
            <Icon size={16} /> {label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === "live" && (
        <div className="space-y-6">
          {/* Latest Thumbnail + Audio Level */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Main Preview */}
            <div className="lg:col-span-2 bg-black rounded-xl overflow-hidden relative">
              {latestThumb ? (
                <>
                  <img
                    src={`data:image/jpeg;base64,${latestThumb.imageData}`}
                    alt="Recording preview"
                    className="w-full object-contain"
                  />
                  <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-4">
                    <div className="flex items-center justify-between text-white text-sm">
                      <span>{new Date(latestThumb.timestamp).toLocaleString("en-IN")}</span>
                      <AudioBadge level={latestThumb.audioLevel} />
                    </div>
                  </div>
                </>
              ) : (
                <div className="flex items-center justify-center h-64 text-slate-500">
                  <div className="text-center">
                    <Camera className="mx-auto mb-2 text-slate-600" size={48} />
                    <p>No screenshots available</p>
                    <p className="text-xs mt-1">Thumbnails are captured every 5 min during recording</p>
                  </div>
                </div>
              )}
            </div>

            {/* Health Sidebar */}
            <div className="space-y-4">
              <div className="bg-white rounded-xl border p-4">
                <h4 className="font-medium text-slate-700 mb-3">Current Health</h4>
                <div className="space-y-2 text-sm">
                  <HealthRow label="Camera" ok={device?.health?.camera?.ok} />
                  <HealthRow label="Mic" ok={device?.health?.mic?.ok} />
                  <HealthRow label="Screen" ok={device?.health?.screen?.ok} />
                  <div className="flex justify-between">
                    <span className="text-slate-500">CPU</span>
                    <span className="font-medium">{device?.health?.cpu?.usagePercent ?? "—"}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">RAM</span>
                    <span className="font-medium">{device?.health?.ram?.usedPercent ?? "—"}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Disk</span>
                    <span className="font-medium">{device?.health?.disk?.usedPercent ?? "—"}% ({device?.health?.disk?.freeGB?.toFixed(1) ?? "—"} GB free)</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">WiFi</span>
                    <span className="font-medium">{device?.health?.network?.wifiSignal ?? "—"} dBm</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Audio Level</span>
                    <AudioBadge level={device?.health?.recording?.audioLevelDb ?? latestThumb?.audioLevel} />
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Uptime</span>
                    <span className="font-medium">{formatUptime(device?.health?.serviceUptime)}</span>
                  </div>
                </div>
              </div>

              {device?.health?.alerts?.length > 0 && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-4">
                  <h4 className="font-medium text-red-700 mb-2">Alerts</h4>
                  {device.health.alerts.slice(0, 5).map((a, i) => (
                    <p key={i} className="text-xs text-red-600 mb-1">{a.type}: {a.message}</p>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Thumbnail History Grid */}
          {thumbnails.length > 1 && (
            <div className="bg-white rounded-xl border p-5">
              <h3 className="font-semibold text-slate-700 mb-4">Screenshot History</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
                {thumbnails.map((t, i) => (
                  <div
                    key={i}
                    className="relative cursor-pointer group rounded-lg overflow-hidden border hover:border-blue-400 transition-colors"
                    onClick={() => setSelectedThumb(selectedThumb === i ? null : i)}
                  >
                    <img
                      src={`data:image/jpeg;base64,${t.imageData}`}
                      alt={`Screenshot ${i + 1}`}
                      className="w-full aspect-video object-cover"
                    />
                    <div className="absolute bottom-0 left-0 right-0 bg-black/60 px-2 py-1">
                      <p className="text-[10px] text-white">
                        {new Date(t.timestamp).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
                      </p>
                      <AudioBadge level={t.audioLevel} mini />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Expanded Thumbnail Modal */}
          {selectedThumb !== null && thumbnails[selectedThumb] && (
            <div
              className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-8"
              onClick={() => setSelectedThumb(null)}
            >
              <div className="max-w-4xl w-full" onClick={e => e.stopPropagation()}>
                <img
                  src={`data:image/jpeg;base64,${thumbnails[selectedThumb].imageData}`}
                  alt="Full screenshot"
                  className="w-full rounded-lg"
                />
                <div className="mt-3 text-white text-center text-sm">
                  {new Date(thumbnails[selectedThumb].timestamp).toLocaleString("en-IN")}
                  {" · "}
                  Audio: {thumbnails[selectedThumb].audioLevel != null
                    ? `${thumbnails[selectedThumb].audioLevel.toFixed(1)} dB`
                    : "N/A"}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === "commands" && (
        <div className="bg-white rounded-xl border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-slate-600">Command</th>
                  <th className="px-4 py-3 text-left font-medium text-slate-600">Status</th>
                  <th className="px-4 py-3 text-left font-medium text-slate-600">Result</th>
                  <th className="px-4 py-3 text-left font-medium text-slate-600">Issued By</th>
                  <th className="px-4 py-3 text-left font-medium text-slate-600">Time</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {commands.map((c, i) => (
                  <tr key={i} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-mono text-xs">{c.command}</td>
                    <td className="px-4 py-3"><StatusBadge status={c.status} /></td>
                    <td className="px-4 py-3 text-xs text-slate-600 max-w-xs truncate">{c.result || "—"}</td>
                    <td className="px-4 py-3 text-slate-600">{c.issuedBy || "—"}</td>
                    <td className="px-4 py-3 text-xs text-slate-500">{new Date(c.issuedAt).toLocaleString("en-IN")}</td>
                  </tr>
                ))}
                {commands.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-slate-400">No commands sent yet</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === "logs" && (
        <div className="space-y-4">
          {logs.map((log, i) => (
            <div key={i} className="bg-white rounded-xl border overflow-hidden">
              <div
                className="px-5 py-3 flex items-center justify-between cursor-pointer hover:bg-slate-50"
                onClick={() => setExpandedLog(expandedLog === i ? null : i)}
              >
                <div className="flex items-center gap-3">
                  <FileText size={16} className="text-slate-500" />
                  <div>
                    <span className="font-medium text-sm">{log.lineCount || "?"} lines</span>
                    <span className="text-xs text-slate-400 ml-2">
                      {log.trigger === "crash" ? "Crash" : log.trigger === "error" ? "Error" : "Manual"}
                    </span>
                  </div>
                </div>
                <span className="text-xs text-slate-500">{new Date(log.timestamp).toLocaleString("en-IN")}</span>
              </div>
              {expandedLog === i && (
                <div className="border-t">
                  <pre className="p-4 text-xs font-mono bg-slate-900 text-green-400 overflow-x-auto max-h-96 overflow-y-auto whitespace-pre-wrap">
                    {log.logText}
                  </pre>
                </div>
              )}
            </div>
          ))}
          {logs.length === 0 && (
            <div className="bg-white rounded-xl border p-8 text-center text-slate-400">
              <FileText className="mx-auto mb-2" size={32} />
              <p>No logs available. Click "Pull Logs" to fetch device logs.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// SUB-COMPONENTS
// ════════════════════════════════════════════════════════════════════

function CmdButton({ icon: Icon, label, color, onClick, disabled }) {
  const colorMap = {
    blue: "bg-blue-600 hover:bg-blue-700",
    green: "bg-emerald-600 hover:bg-emerald-700",
    purple: "bg-purple-600 hover:bg-purple-700",
    yellow: "bg-yellow-600 hover:bg-yellow-700",
    orange: "bg-orange-600 hover:bg-orange-700",
    red: "bg-red-600 hover:bg-red-700",
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center gap-2 px-4 py-2.5 text-white text-sm font-medium rounded-lg transition-colors
        ${disabled ? "opacity-50 cursor-not-allowed bg-slate-400" : colorMap[color] || colorMap.blue}`}
    >
      <Icon size={16} /> {label}
    </button>
  );
}

function StatusBadge({ status }) {
  const map = {
    pending: { color: "bg-yellow-100 text-yellow-700", icon: Clock },
    acknowledged: { color: "bg-blue-100 text-blue-700", icon: RefreshCw },
    completed: { color: "bg-green-100 text-green-700", icon: CheckCircle2 },
    failed: { color: "bg-red-100 text-red-700", icon: XCircle },
  };
  const s = map[status] || map.pending;
  const Icon = s.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${s.color}`}>
      <Icon size={12} /> {status}
    </span>
  );
}

function AudioBadge({ level, mini }) {
  if (level == null) return <span className="text-xs text-slate-400">—</span>;
  const db = parseFloat(level);
  let color, Icon, label;
  if (db > -20) { color = "text-green-500"; Icon = Volume2; label = "Loud"; }
  else if (db > -40) { color = "text-green-400"; Icon = Volume2; label = "Good"; }
  else if (db > -60) { color = "text-yellow-500"; Icon = Volume2; label = "Low"; }
  else { color = "text-red-500"; Icon = VolumeX; label = "Silent"; }

  if (mini) {
    return <span className={`text-[10px] ${color}`}>{db.toFixed(0)}dB</span>;
  }
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium ${color}`}>
      <Icon size={14} /> {db.toFixed(1)}dB ({label})
    </span>
  );
}

function HealthRow({ label, ok }) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-slate-500">{label}</span>
      {ok === true ? (
        <span className="text-green-600 flex items-center gap-1 text-xs font-medium">
          <CheckCircle2 size={14} /> OK
        </span>
      ) : ok === false ? (
        <span className="text-red-600 flex items-center gap-1 text-xs font-medium">
          <XCircle size={14} /> Failed
        </span>
      ) : (
        <span className="text-slate-400 text-xs">Unknown</span>
      )}
    </div>
  );
}

function formatUptime(seconds) {
  if (!seconds) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
