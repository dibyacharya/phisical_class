/**
 * scheduler.js — Heartbeat + schedule polling + auto-record trigger
 * Mirrors Android RecorderForegroundService logic.
 */
const api     = require("./api");
const store   = require("./store");

let _heartbeatTimer = null;
let _onSchedule     = null;   // callback(scheduleItems)
let _onForceStop    = null;   // callback()
let _onStatus       = null;   // callback(statusText)

const HEARTBEAT_INTERVAL_MS = 30_000; // 30 seconds

function notify(msg) {
  if (_onStatus) _onStatus(msg);
  console.log("[Scheduler]", msg);
}

/**
 * Start heartbeat loop.
 * @param {object} opts
 * @param {function} opts.onSchedule   - called with schedule array
 * @param {function} opts.onForceStop  - called if server says stop
 * @param {function} opts.onStatus     - called with status string
 * @param {function} opts.getHealth    - async fn returning health snapshot
 * @param {function} opts.isRecording  - fn returning bool
 */
function start({ onSchedule, onForceStop, onStatus, getHealth, isRecording } = {}) {
  _onSchedule  = onSchedule  || (() => {});
  _onForceStop = onForceStop || (() => {});
  _onStatus    = onStatus    || (() => {});

  stop(); // clear any existing timer
  _beat({ getHealth, isRecording }); // immediate first beat
  _heartbeatTimer = setInterval(() => _beat({ getHealth, isRecording }), HEARTBEAT_INTERVAL_MS);
  notify("Heartbeat started");
}

function stop() {
  if (_heartbeatTimer) { clearInterval(_heartbeatTimer); _heartbeatTimer = null; }
}

async function _beat({ getHealth, isRecording } = {}) {
  const deviceId = store.get("deviceId");
  if (!deviceId) { notify("No deviceId — skipping heartbeat"); return; }

  try {
    const health  = getHealth   ? await getHealth()   : {};
    const recNow  = isRecording ? await isRecording() : false;

    const result = await api.heartbeat(deviceId, {
      isOnline:    true,
      isRecording: recNow,
      health,
      timestamp:   new Date().toISOString(),
    });

    if (result.forceStop) { _onForceStop(); }
    if (result.schedule)  { _onSchedule(result.schedule); }

    notify(`Heartbeat OK · ${result.schedule?.length ?? 0} classes scheduled`);
  } catch (err) {
    notify(`Heartbeat error: ${err.message}`);
  }
}

module.exports = { start, stop };
