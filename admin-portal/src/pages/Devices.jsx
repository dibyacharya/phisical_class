import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import {
  Tv, Wifi, WifiOff, CircleDot, Trash2, Play, Square, RefreshCw,
  Camera, Mic, Monitor, HardDrive, Cpu, Battery, AlertTriangle,
  CheckCircle, XCircle, ChevronDown, ChevronUp, Clock, Signal,
  Terminal, Download,
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

function HardwareIcon({ ok, Icon, label, tooltip }) {
  const color = ok === true ? "text-green-600 bg-green-50" : ok === false ? "text-red-600 bg-red-50" : "text-gray-400 bg-gray-50";
  const Ring = ok === true ? CheckCircle : ok === false ? XCircle : null;
  return (
    <div className="flex flex-col items-center gap-1" title={tooltip || label}>
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

/**
 * v3.3.30 — derive REAL peripheral state from heartbeat fields, not the
 * stale h.camera/mic/screen.ok flags the TV used to populate (which were
 * wrong on multiple devices today: all-green icons even when USB mic was
 * unplugged + uvcState=NO_DRIVER).
 *
 * Returns { cameraOk, micOk, screenOk } where each is:
 *   true  → green (peripheral detected + functional, with evidence)
 *   false → red (peripheral NOT detected — actionable)
 *   null  → gray (state unknown, e.g. device offline)
 *
 * Tooltips explain WHY a peripheral is in its current state — so admin
 * can see "USB mic not plugged in (micLabel='System default mic')" not
 * just a red icon.
 */
function deriveHardwareState(device, h) {
  // Offline override — don't trust any heartbeat field, mark all gray.
  if (!device.isOnline) {
    return {
      cameraOk: null,
      micOk: null,
      screenOk: null,
      cameraTooltip: "Device offline — last heartbeat too stale to know peripheral state",
      micTooltip: "Device offline — last heartbeat too stale to know peripheral state",
      screenTooltip: "Device offline — last heartbeat too stale to know peripheral state",
    };
  }

  const rec = h.recording || {};

  // ── CAMERA ──
  // USB camera is OK when the libuvc driver has an OPEN state and at
  // least one supported size. NO_DRIVER / empty sizes = camera not
  // physically connected (common cause: cable unplugged).
  const uvcState = rec.uvcState || "";
  const uvcSizes = rec.uvcSupportedSizes || "";
  let cameraOk = null;
  let cameraTooltip = "";
  if (uvcState === "NO_DRIVER" || uvcState === "FAILED") {
    cameraOk = false;
    cameraTooltip = `USB camera not detected (uvcState=${uvcState || "unknown"}). Check the USB cable on the TV.`;
  } else if (uvcState === "OPEN" || (uvcSizes && uvcSizes.length > 0)) {
    cameraOk = true;
    const selected = rec.uvcSelectedSize || "?";
    cameraTooltip = `USB camera detected. Resolution: ${selected}. Sizes available: ${(uvcSizes || "").split(",").length}`;
  } else {
    // Fall back to TV-reported flag if uvc fields aren't populated
    cameraOk = h.camera?.ok ?? null;
    cameraTooltip = "Camera state unknown (heartbeat doesn't carry uvc fields).";
  }

  // ── MIC ──
  // USB mic is OK when (a) micLabel is NOT "System default mic" (which
  // means a USB-named device is bound), AND (b) audioLevelDb shows
  // recent non-silent activity OR we're not currently recording (idle
  // mic legitimately reads -90 dB).
  const micLabel = rec.micLabel || "";
  const audioDb = typeof rec.audioLevelDb === "number" ? rec.audioLevelDb : -90;
  const isRecording = device.isRecording === true;
  let micOk = null;
  let micTooltip = "";
  if (!micLabel) {
    micOk = h.mic?.ok ?? null;
    micTooltip = "Mic state unknown (heartbeat doesn't carry mic fields).";
  } else if (micLabel === "System default mic" || micLabel.toLowerCase().includes("default")) {
    micOk = false;
    micTooltip = `USB mic not connected — TV fell back to "${micLabel}" which has no input on signage TVs. Plug in the USB-Audio mic.`;
  } else if (isRecording && audioDb <= -80) {
    // USB mic IS bound by name, but we're recording and getting digital
    // silence — could be muted or cable issue. Show as warning.
    micOk = false;
    micTooltip = `USB mic "${micLabel}" bound but capturing digital silence (${audioDb} dB). Mic muted? Cable issue?`;
  } else {
    micOk = true;
    micTooltip = `USB mic: ${micLabel}${isRecording ? ` (level ${audioDb} dB)` : ""}`;
  }

  // ── SCREEN ──
  // For LiveKit-pipeline TVs (v3.3.29+ default), screen is OK if
  // accessibility is enabled (so projection consent will auto-grant when
  // recording starts) AND the device is online. The legacy
  // projectionActive flag is permanently false in LiveKit mode and
  // shouldn't drive the icon. While actively recording, also require
  // livekitConnectionState=CONNECTED.
  const livekitEnabled = rec.livekitEnabled === true;
  const livekitConn = rec.livekitConnectionState || "";
  const accessibilityEnabled = rec.accessibilityEnabled === true;
  let screenOk = null;
  let screenTooltip = "";
  if (livekitEnabled) {
    if (isRecording) {
      if (livekitConn === "CONNECTED" || livekitConn === "RECONNECTING") {
        screenOk = true;
        screenTooltip = `Screen capture active via LiveKit (connection: ${livekitConn})`;
      } else {
        screenOk = false;
        screenTooltip = `Recording attempted but LiveKit connection: ${livekitConn || "unknown"}. Possible network firewall blocking WebRTC UDP.`;
      }
    } else {
      // Idle on LiveKit — accessibility must be enabled for auto-tap to
      // grant consent at recording start.
      if (accessibilityEnabled) {
        screenOk = true;
        screenTooltip = "Screen capture ready (LiveKit mode, accessibility enabled — consent will auto-grant at recording start).";
      } else {
        screenOk = false;
        screenTooltip = "AccessibilityService not enabled — projection consent dialog won't auto-tap. Recording will stall at the consent gate.";
      }
    }
  } else {
    // Legacy pipeline — projectionActive is the actual signal.
    if (rec.projectionActive === true) {
      screenOk = true;
      screenTooltip = "Screen capture granted (legacy MediaProjection).";
    } else if (rec.projectionActive === false) {
      screenOk = false;
      screenTooltip = "MediaProjection consent missing on legacy-pipeline TV. Tap 'Start now' on the TV consent dialog.";
    } else {
      screenOk = h.screen?.ok ?? null;
      screenTooltip = "Screen state unknown (heartbeat doesn't carry projection fields).";
    }
  }

  return { cameraOk, micOk, screenOk, cameraTooltip, micTooltip, screenTooltip };
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
            {/* v3.1.10 — "Recording" badge must reflect ACTUAL capture state,
                not just "findOrCreateSession was called." The top-level
                device.isRecording flag is set the moment the device opens a
                session with the backend, BEFORE the MediaCodec pipeline
                succeeds. If the device hits the no-projection gate or the
                encoder fails, that flag stays true but h.recording.isRecording
                stays false and no segments upload. An admin looking at a
                Recording badge while the TV is actually idle was today's
                "backend jhoot bol raha hai" bug report.

                Real logic:
                  capture-live = top.isRecording AND health.recording.isRecording
                  stuck        = top.isRecording AND NOT health.recording.isRecording
                  idle         = NOT top.isRecording */}
            {(() => {
              const topRec = device.isRecording;
              const healthRec = h.recording?.isRecording;
              const segIdx = h.recording?.segmentIndex || 0;
              if (topRec && healthRec) {
                return (
                  <span className="flex items-center gap-1 text-xs text-red-700 bg-red-50 px-2 py-0.5 rounded-full border border-red-200 animate-pulse">
                    <CircleDot size={10} /> Recording · seg {segIdx}
                  </span>
                );
              }
              if (topRec && !healthRec) {
                return (
                  <span className="flex items-center gap-1 text-xs text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-300" title="Backend opened a recording session, but the device's capture pipeline never actually started (no segments). Usually means MediaProjection consent is missing, or the encoder failed.">
                    <AlertTriangle size={10} /> Session open, capture stuck
                  </span>
                );
              }
              return null;
            })()}
            {/* v3.1.8 zero-touch recovery indicators. Call these out at the top
                level so an admin can see "can this TV record right now?" at
                a glance, instead of having to drill into the expanded view
                or cross-reference telemetry. */}
            {/* v3.3.29 — only show "No screen capture permission" when the
                device is NOT on LiveKit. The heartbeat field
                `projectionActive` reflects the LEGACY MediaProjection state.
                In LiveKit-only mode (default since v3.3.29), the legacy
                MP is deliberately not maintained — `projectionActive` is
                permanently false even though everything is healthy. The
                actual LiveKit projection is acquired on-demand at recording
                start via setScreenShareEnabled and isn't surfaced in this
                field. So we gate the badge on `livekitEnabled === false`
                (legacy-pipeline TV) — those are the only ones where this
                badge is actionable. The earlier v3.3.28 attempt to gate
                on `videoPipeline !== "livekit"` was incomplete because
                an IDLE TV reports videoPipeline="legacy_direct" by default
                (the field only flips to "livekit" while a recording is
                actively running). */}
            {h.recording?.projectionActive === false &&
             h.recording?.livekitEnabled === false && (
              <span
                className="flex items-center gap-1 text-xs text-red-700 bg-red-50 px-2 py-0.5 rounded-full border border-red-300"
                title="MediaProjection consent has not been granted on this device. Until a human (or the AutoInstallService) taps 'Start now' on the consent dialog on the TV, every scheduled recording will fail at the projection gate. Top-level isRecording can still be true here because the backend session was created before the pipeline hit this gate."
              >
                <XCircle size={10} /> No screen capture permission
              </span>
            )}
            {h.recording?.projectionActive === true && h.recording?.accessibilityEnabled === false && (
              <span
                className="flex items-center gap-1 text-xs text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200"
                title="Screen capture is granted right now, but the AutoInstall accessibility service is NOT enabled. The device will not self-heal after the next shutdown / OTA install — a human will need to tap 'Start now' again. Enable it in Settings → Accessibility on the TV."
              >
                <AlertTriangle size={10} /> Accessibility off (not self-healing)
              </span>
            )}
            {hasCritical && (
              <span className="flex items-center gap-1 text-xs text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">
                <AlertTriangle size={10} /> Alert
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

          {/* Room + IP */}
          <p className="text-sm text-gray-500">
            Room {device.roomNumber || device.roomId}
            {device.floor ? ` · ${device.floor}` : ""}
            {device.ipAddress ? ` · ${device.ipAddress}` : ""}
            {device.deviceModel ? ` · ${device.deviceModel}` : ""}
          </p>

          {/* Hardware quick status — v3.3.30: derived from heartbeat reality
              (uvcState, micLabel, audioLevelDb, livekitConnectionState,
               accessibilityEnabled) instead of trusting stale h.camera.ok
              flags that were wrong on multiple devices. Icons are GRAY when
              device is offline (state unknown) — never green based on a
              cached flag from minutes ago. */}
          {(() => {
            const { cameraOk, micOk, screenOk, cameraTooltip, micTooltip, screenTooltip } = deriveHardwareState(device, h);
            return (
              <div className="flex items-center gap-4 mt-2">
                <HardwareIcon ok={cameraOk} Icon={Camera} label="Camera" tooltip={cameraTooltip} />
                <HardwareIcon ok={micOk} Icon={Mic} label="Mic" tooltip={micTooltip} />
                <HardwareIcon ok={screenOk} Icon={Monitor} label="Screen" tooltip={screenTooltip} />
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
            );
          })()}

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
            <Link to={`/device/${device.deviceId}/remote`}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-purple-50 text-purple-600 hover:bg-purple-100 transition">
              <Terminal size={12} /> Remote
            </Link>
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

          {/* CPU / Battery / Version */}
          <div>
            <p className="font-medium text-gray-600 mb-1.5 flex items-center gap-1"><Cpu size={12} /> System</p>
            <div className="space-y-1 text-gray-500">
              <p>App: {device.appVersionName ? (
                <span className="text-gray-700 font-medium">v{device.appVersionName} <span className="text-gray-400">(code {device.appVersionCode})</span></span>
              ) : (
                <span className="text-red-600 font-medium">Outdated — update required</span>
              )}</p>
              {device.deviceModel && <p>Model: <span className="text-gray-700">{device.deviceModel}</span></p>}
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
    try {
      await api.post(`/classroom-recording/devices/${deviceId}/force-start`);
      fetchDevices();
    } catch (err) {
      alert("Force start failed: " + (err.response?.data?.error || err.message));
    }
  };
  const handleForceStop = async (deviceId) => {
    try {
      await api.post(`/classroom-recording/devices/${deviceId}/force-stop`);
      fetchDevices();
    } catch (err) {
      alert("Force stop failed: " + (err.response?.data?.error || err.message));
    }
  };
  const handleDelete = async (id) => {
    if (!confirm("Delete this device?")) return;
    try {
      await api.delete(`/classroom-recording/devices/${id}`);
      fetchDevices();
    } catch (err) {
      alert("Delete failed: " + (err.response?.data?.error || err.message));
    }
  };

  const online = devices.filter(isOnline);
  // v3.1.10: "Recording" count means "actually capturing frames RIGHT NOW",
  // not just "has an open backend session." The difference matters — a
  // session can be open while the device's pipeline is stuck at the
  // MediaProjection gate. Before this change the top stat said "Recording: 1"
  // while the TV was visibly idle, which was a genuine "UI is lying to me"
  // moment for admins today.
  const recording = devices.filter(
    (d) => d.isRecording && d.health?.recording?.isRecording
  );
  const recordingStuck = devices.filter(
    (d) => d.isRecording && d.health?.recording?.isRecording === false
  );
  const noProjection = devices.filter(
    (d) => d.health?.recording?.projectionActive === false && isOnline(d)
  );
  const outdated = devices.filter((d) => !d.appVersionCode);
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
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
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
          <div>
            <p className="text-xs text-gray-500">Recording</p>
            <p className="text-xl font-bold text-gray-800">{recording.length}</p>
            {(recordingStuck.length > 0 || noProjection.length > 0) && (
              <p className="text-[10px] text-amber-700 mt-0.5" title="Capture pipelines stuck or no screen-capture permission — admin should act">
                {recordingStuck.length > 0 && `${recordingStuck.length} stuck`}
                {recordingStuck.length > 0 && noProjection.length > 0 && " · "}
                {noProjection.length > 0 && `${noProjection.length} no-perm`}
              </p>
            )}
          </div>
        </div>
        {outdated.length > 0 && (
          <Link to="/app-update" className={`rounded-xl shadow-sm border p-4 flex items-center gap-3 bg-red-50 border-red-200 hover:bg-red-100 transition-colors`}>
            <div className="bg-red-100 p-2.5 rounded-lg">
              <Download size={20} className="text-red-600" />
            </div>
            <div>
              <p className="text-xs text-gray-500">Outdated</p>
              <p className="text-xl font-bold text-red-700">{outdated.length}</p>
            </div>
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
