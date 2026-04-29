import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import {
  Tv, Wifi, WifiOff, CircleDot, Trash2, Play, Square, RefreshCw,
  Camera, Mic, Monitor, HardDrive, Cpu, MemoryStick, Battery, AlertTriangle,
  CheckCircle, XCircle, ChevronDown, ChevronUp, Clock, Signal,
  Terminal, Download, Power, RotateCcw, Loader2,
} from "lucide-react";
import api from "../services/api";

// v3.5.8 — bulk-action helper merged from Fleet.jsx (Fleet page deleted,
// Devices is now the single fleet-control surface). Multi-select +
// broadcast remote command across selected TVs.
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

// v3.7.0 — CPU sparkline. Reads `health.cpu.history` (oldest-first array
// of percent samples, 30s cadence on TV). Renders an inline SVG bar
// chart so admins can spot drift / spike patterns at a glance without
// drilling into a separate analytics page. Width auto-scales by
// container; height fixed at 14px to fit inside the device card row.
function CpuSparkline({ data, height = 14 }) {
  if (!Array.isArray(data) || data.length < 2) return null;
  const n = data.length;
  // Use a fixed virtual viewport (n × 4) so each sample is 4 units
  // wide regardless of container — SVG `preserveAspectRatio="none"`
  // stretches it to fill the available width.
  const w = n * 4;
  return (
    <svg
      className="w-full mt-0.5"
      viewBox={`0 0 ${w} ${height}`}
      preserveAspectRatio="none"
      style={{ height }}
      aria-label="cpu history"
    >
      {data.map((v, i) => {
        const h = Math.max(1, (Math.min(v, 100) / 100) * (height - 1));
        const fill = v >= 90 ? "#ef4444" : v >= 75 ? "#f59e0b" : "#10b981";
        return (
          <rect
            key={i}
            x={i * 4}
            y={height - h}
            width={3}
            height={h}
            fill={fill}
          />
        );
      })}
    </svg>
  );
}

// v3.7.0 — Thermal tier badge. Surfaces governor state to the operator
// when the TV is being protected. NORMAL tier is intentionally suppressed
// upstream — only WATCH / THROTTLE / COOL / ABORT render here.
function ThermalBadge({ tier, action }) {
  const palette = {
    WATCH:    "bg-blue-50 text-blue-700 border-blue-200",
    THROTTLE: "bg-yellow-50 text-yellow-700 border-yellow-200",
    COOL:     "bg-orange-50 text-orange-700 border-orange-200",
    ABORT:    "bg-red-50 text-red-700 border-red-200",
  };
  const label = {
    WATCH:    "WATCH — CPU sustained high",
    THROTTLE: "THROTTLE — camera paused to cool",
    COOL:     "COOL — camera dropped to protect recording",
    ABORT:    "ABORT — recording stopped (thermal)",
  }[tier] || `${tier}`;
  return (
    <div className={`mt-2 px-2 py-1 rounded text-[10px] font-medium border ${palette[tier] || "bg-gray-50 border-gray-200 text-gray-600"}`}>
      <div className="flex items-center gap-1">
        <span>{label}</span>
        {action && action !== "idle" && (
          <span className="ml-auto text-[9px] opacity-70 truncate">{action}</span>
        )}
      </div>
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
 * v3.4.3 — derive peripheral state from heartbeat fields with the
 * RIGHT semantics for LiveKit-only TVs.
 *
 * The earlier version of this function had a fallback branch that used
 * v2.x-era fields like `uvcState` and `micLabel`-reading-system-default.
 * Those gave misleading "broken" indicators for LiveKit-active TVs:
 * uvcState=NO_DRIVER is the expected steady state when Camera2-with-deviceId
 * is the publish path (v3.3.24+), not a failure. micLabel reads the
 * system default input device, not what LiveKit's WebRTC AudioRecord
 * is actually capturing.
 *
 * v3.4.3 cleanup: the fallback is removed entirely. Every TV in the
 * fleet is on LiveKit since v3.3.26; the LiveKit-active branch covers
 * them. If a TV reports unexpected pre-LiveKit telemetry, the function
 * now returns null state with an "unknown" tooltip — never legacy
 * indicators.
 *
 * NEW SEMANTICS:
 *   - When LiveKit is actively connected (recording in progress and
 *     livekitConnectionState=CONNECTED): trust LiveKit's tracks. All
 *     green — LiveKit only stays connected if it's actually publishing.
 *   - When idle on LiveKit-pipeline TV: GRAY (state unknown — we
 *     can't know peripheral state without a recording).
 *   - When recording but LiveKit DISCONNECTED: actually broken. Red.
 *   - When device offline: ALL gray.
 *
 * This way, Watch Live and Devices page can no longer disagree.
 */
function deriveHardwareState(device, h) {
  // Offline override — don't trust any heartbeat field.
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
  const livekitEnabled = rec.livekitEnabled === true;
  const livekitConn = rec.livekitConnectionState || "";
  const accessibilityEnabled = rec.accessibilityEnabled === true;
  const isRecording = device.isRecording === true;
  const livekitActive = livekitConn === "CONNECTED" || livekitConn === "RECONNECTING";

  // ── LIVEKIT-PIPELINE TV BRANCH (v3.3.29+ default) ─────────────────
  if (livekitEnabled) {
    // v3.3.30 — INDEPENDENT peripheral detection.
    //
    // Camera + mic state come from the TV's heartbeat fields h.camera
    // and h.mic, which v3.3.30 populates by enumerating actual USB
    // devices (UsbManager / Camera2 LENS_FACING_EXTERNAL / AudioManager
    // GET_DEVICES_INPUTS for TYPE_USB_*). This works regardless of
    // whether a recording is active — peripheral hardware presence is
    // reported at all times.
    //
    // Earlier versions of this function relied on LiveKit recording
    // state to know if camera/mic were "ok". That was wrong: hardware
    // presence is independent of recording activity. Now the dashboard
    // can show accurate ✓/❌ for every TV at every moment.
    const cameraInfo = h.camera || {};
    const micInfo = h.mic || {};

    let cameraOk = null;
    let cameraTooltip = "";
    if (cameraInfo.ok === true) {
      cameraOk = true;
      cameraTooltip = `Camera detected: ${cameraInfo.name || "USB camera"}${cameraInfo.type ? ` (${cameraInfo.type})` : ""}`;
    } else if (cameraInfo.ok === false) {
      cameraOk = false;
      cameraTooltip = cameraInfo.error || "USB camera not detected. Plug in the camera cable on the TV.";
    }

    let micOk = null;
    let micTooltip = "";
    if (micInfo.ok === true) {
      micOk = true;
      micTooltip = `Mic detected: ${micInfo.name || "USB mic"}${micInfo.type ? ` (${micInfo.type})` : ""}`;
    } else if (micInfo.ok === false) {
      micOk = false;
      micTooltip = micInfo.error || "USB mic not detected. Plug in the mic cable on the TV.";
    }

    // Screen icon: derived from LiveKit + accessibility state (these
    // ARE LiveKit-coupled because the screen capture path depends on
    // MediaProjection consent which is LiveKit's flow).
    let screenOk = null;
    let screenTooltip = "";
    if (isRecording && livekitActive) {
      screenOk = true;
      screenTooltip = "Screen publishing via LiveKit (visible in Watch Live).";
    } else if (isRecording && !livekitActive) {
      screenOk = false;
      screenTooltip = `Recording active but LiveKit disconnected (state: ${livekitConn || "unknown"}). Network blocking WebRTC?`;
    } else if (accessibilityEnabled) {
      screenOk = true;
      screenTooltip = "Screen capture ready (LiveKit mode, accessibility enabled — consent will auto-grant at recording start).";
    } else {
      screenOk = false;
      screenTooltip = "AccessibilityService not enabled — projection consent dialog won't auto-tap. Recording will stall at the consent gate.";
    }

    return { cameraOk, micOk, screenOk, cameraTooltip, micTooltip, screenTooltip };
  }

  // v3.4.3 — Legacy-pipeline branch removed. Every TV in production has
  // been on LiveKit-only mode since v3.3.26; the early-return above
  // (livekitEnabled === true) covers them all. The old fallback used
  // legacy uvc* fields and "Screen capture granted (legacy MediaProjection)"
  // tooltips which were misleading and never legitimately fired. Removing
  // the dead branch ensures stale-cache reads of livekitEnabled never
  // surface legacy-only diagnostic strings to users.
  //
  // If a TV ever needs to be put back on a pre-LiveKit pipeline (which
  // shouldn't happen — there is no such build path active), the LiveKit
  // branch's null-tolerant returns will simply show "unknown" state
  // instead of misleading legacy chips.
  return {
    cameraOk: null,
    micOk: null,
    screenOk: null,
    cameraTooltip: "Hardware state unknown (TV not reporting LiveKit telemetry).",
    micTooltip: "Hardware state unknown (TV not reporting LiveKit telemetry).",
    screenTooltip: "Hardware state unknown (TV not reporting LiveKit telemetry).",
  };
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

function DeviceCard({ device, onForceStart, onForceStop, onDelete, isSelected, onToggleSelect }) {
  const [expanded, setExpanded] = useState(false);
  const online = isOnline(device);
  const h = device.health || {};
  const hasAlerts = (h.alerts || []).length > 0;
  const hasCritical = h.camera?.ok === false || h.mic?.ok === false || h.screen?.ok === false || h.disk?.usedPercent >= 90;

  return (
    <div className={`border rounded-xl bg-white shadow-sm overflow-hidden transition-all ${hasCritical ? "border-red-200" : "border-gray-100"}`}>
      {/* Main row */}
      <div className="p-4 flex items-start gap-4">
        {/* v3.5.8 — multi-select checkbox (merged from Fleet). Lets the
            admin pick a subset of TVs for a bulk command (Pull Logs,
            Restart App, Reboot, Clear Storage). */}
        <label className="pt-3 cursor-pointer shrink-0">
          <input
            type="checkbox"
            checked={!!isSelected}
            onChange={() => onToggleSelect && onToggleSelect(device.deviceId)}
            className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
          />
        </label>
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

              // v3.3.30 — OFFLINE OVERRIDE.
              //
              // If the device went offline while a recording was in
              // flight, the backend's `device.isRecording=true` is STALE
              // (the TV never got a chance to send a "recording stopped"
              // heartbeat — it just stopped heartbeating). Showing
              // "Recording · seg N" is wrong because the TV physically
              // can't be recording when it's not online. Instead surface
              // a clear "stuck (offline)" state so admin knows to either
              // restart the TV or force-stop the recording session in
              // the backend.
              if (!device.isOnline && topRec) {
                return (
                  <span className="flex items-center gap-1 text-xs text-gray-600 bg-gray-100 px-2 py-0.5 rounded-full border border-gray-300" title="Backend still has a recording session marked active for this device, but the TV stopped sending heartbeats. The device went offline mid-recording or never gracefully ended the session. Use the Stop button to clean up the stale session.">
                    <AlertTriangle size={10} /> Recording stuck (TV offline)
                  </span>
                );
              }

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
            {/* v3.4.3 — REMOVED legacy "No screen capture permission" chip.
                The previous implementation gated on
                `projectionActive === false && livekitEnabled === false`.
                Every TV in production has been on LiveKit-only mode since
                v3.3.26, so livekitEnabled is always true and the chip
                never legitimately fires. But there were intermittent
                race-condition reports where the chip flickered onto
                screen briefly during OTA-install windows when
                livekitEnabled briefly read false from a stale cache,
                confusing users into thinking the TV had lost screen
                permission when it hadn't. LiveKit-only mode acquires
                MediaProjection per-recording via the (transparent +
                auto-tapped) LiveKitProjectionRequestActivity, so a
                "permission lost" badge between recordings is misleading
                regardless. Removed entirely.

                AccessibilityService warning kept since the
                AutoInstallService's accessibility binding is still
                load-bearing for the per-recording auto-tap. */}
            {h.recording?.accessibilityEnabled === false && (
              <span
                className="flex items-center gap-1 text-xs text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200"
                title="The AutoInstall accessibility service is NOT enabled. Without it, the per-recording MediaProjection consent dialog won't auto-tap and recordings will stall at the projection gate. Enable it in Settings → Accessibility on the TV."
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
                {/* v3.6.3: CPU added alongside RAM/Disk so 96%-CPU runaway is visible at a glance.
                    v3.7.0: also show 5-min peak + sparkline + cpu temperature when reported. */}
                {h.cpu?.usagePercent != null && (
                  <div className="mb-1">
                    <div className="flex items-center gap-1 mb-0.5">
                      <Cpu size={11} className="text-gray-400" />
                      <span className="text-[10px] text-gray-500">CPU</span>
                      {h.cpu.peak5min != null && h.cpu.peak5min > h.cpu.usagePercent && (
                        <span className="text-[10px] text-gray-400 ml-auto">peak {h.cpu.peak5min}% / 5min</span>
                      )}
                      {h.cpu.temperature != null && (
                        <span className={`text-[10px] ml-2 font-medium ${h.cpu.temperature >= 75 ? "text-red-600" : h.cpu.temperature >= 65 ? "text-yellow-600" : "text-gray-400"}`}>
                          {h.cpu.temperature.toFixed(0)}&#176;C
                        </span>
                      )}
                    </div>
                    <UsageBar value={h.cpu.usagePercent} />
                    {Array.isArray(h.cpu.history) && h.cpu.history.length >= 3 && (
                      <CpuSparkline data={h.cpu.history} />
                    )}
                  </div>
                )}
                {/* v3.7.0 — thermal-governor tier badge. Surfaces ONLY when
                    governor is active and NOT in NORMAL state, so the
                    fleet-wide view is clean for healthy TVs but instantly
                    visible when a TV's recording is being protected. */}
                {h.thermal?.tier && h.thermal.tier !== "NORMAL" && (
                  <ThermalBadge tier={h.thermal.tier} action={h.thermal.action} />
                )}
                {h.ram?.usedPercent != null && (
                  <div className="mb-1">
                    <div className="flex items-center gap-1 mb-0.5">
                      <MemoryStick size={11} className="text-gray-400" />
                      <span className="text-[10px] text-gray-500">RAM</span>
                    </div>
                    <UsageBar value={h.ram.usedPercent} />
                  </div>
                )}
                {h.disk?.usedPercent != null && (
                  <div>
                    <div className="flex items-center gap-1 mb-0.5">
                      <HardDrive size={11} className="text-gray-400" />
                      <span className="text-[10px] text-gray-500">Disk</span>
                      {h.disk.freeGB != null && <span className="text-[10px] text-gray-400 ml-auto">{h.disk.freeGB} GB free</span>}
                    </div>
                    <UsageBar value={h.disk.usedPercent} />
                  </div>
                )}
              </div>
            </div>
            );
          })()}

          {/* Alerts — v3.3.30: only show when device is online. Latency
              alerts in particular are live measurements (heartbeat HTTP RTT)
              that are meaningless on an offline TV — they're frozen at
              whatever value was reported when the device last
              heartbeated, often minutes/hours ago. Hide to prevent
              admin from chasing a stale "High latency: 2515ms" warning
              on a TV that's been off for an hour. */}
          {hasAlerts && device.isOnline && <div className="mt-2"><AlertBadge alerts={h.alerts} /></div>}
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

  // v3.5.8 — multi-select + broadcast (merged from Fleet page).
  const [selected, setSelected] = useState(new Set());
  const [broadcasting, setBroadcasting] = useState(false);
  const [lastBroadcast, setLastBroadcast] = useState(null);

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

  const toggleSelection = (deviceId) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(deviceId)) next.delete(deviceId);
      else next.add(deviceId);
      return next;
    });
  };
  const selectAllVisible = () => setSelected(new Set(devices.map((d) => d.deviceId)));
  const clearSelection = () => setSelected(new Set());
  const selectedCount = selected.size;
  const selectedArray = [...selected];

  // Broadcast a remote command to every selected device. Uses the same
  // /api/remote/broadcast endpoint that Fleet used.
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

      {/* v3.5.8 — Bulk action bar (merged from Fleet). Lets admin
          select multiple TVs and fire one remote command across all of
          them in parallel. Each command is queued per-device and the TV
          picks it up on its next heartbeat. */}
      <div className="bg-white rounded-xl border p-4 mb-6 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 text-sm">
          <span className="font-medium text-slate-700">{selectedCount} selected</span>
          <button className="text-xs text-indigo-600 hover:underline"
            onClick={selectAllVisible}
            disabled={!devices.length}
          >
            Select all
          </button>
          {selectedCount > 0 && (
            <button className="text-xs text-slate-500 hover:underline" onClick={clearSelection}>
              Clear
            </button>
          )}
        </div>
        <div className="flex-1" />
        <BulkButton icon={Terminal} label="Pull Logs" color="purple"
          disabled={selectedCount === 0 || broadcasting}
          onClick={() => broadcast("pull_logs", "Pull logs")} />
        <BulkButton icon={Trash2} label="Clear Storage" color="yellow"
          disabled={selectedCount === 0 || broadcasting}
          onClick={() => broadcast("clear_storage", "Clear storage", { confirm: true })} />
        <BulkButton icon={RotateCcw} label="Restart App" color="orange"
          disabled={selectedCount === 0 || broadcasting}
          onClick={() => broadcast("restart_app", "Restart app", { confirm: true })} />
        <BulkButton icon={Power} label="Reboot" color="red"
          disabled={selectedCount === 0 || broadcasting}
          onClick={() => broadcast("reboot", "Reboot devices", { confirm: true })} />
        {broadcasting && <Loader2 size={16} className="animate-spin text-blue-500" />}
      </div>
      {lastBroadcast && (
        <div className="mb-4 text-xs text-slate-600 bg-slate-50 border rounded-lg p-2">
          Last broadcast: <strong>{lastBroadcast.label}</strong> →{" "}
          {lastBroadcast.queued || lastBroadcast.deviceCount || "?"} device(s) queued.
        </div>
      )}

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
              isSelected={selected.has(device.deviceId)}
              onToggleSelect={toggleSelection}
            />
          ))}
        </div>
      )}
    </div>
  );
}
