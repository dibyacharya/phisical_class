/**
 * recorder.js — Screen + audio capture and segment upload (Main process side)
 * Uses Electron's desktopCapturer; actual MediaRecorder runs in renderer.
 * This module manages recording STATE; rendering is done via IPC with the hidden recorder window.
 */
const path  = require("path");
const fs    = require("fs");
const os    = require("os");
const api   = require("./api");
const store = require("./store");

const SEGMENT_DIR = path.join(os.tmpdir(), "educampus-segments");
if (!fs.existsSync(SEGMENT_DIR)) fs.mkdirSync(SEGMENT_DIR, { recursive: true });

let _state = {
  isRecording:  false,
  recordingId:  null,
  meetingId:    null,
  segmentIndex: 0,
  startTime:    null,
};

// ── Getters ──────────────────────────────────────────────────────────────────
function isRecording()  { return _state.isRecording;  }
function recordingId()  { return _state.recordingId;  }
function getState()     { return { ..._state };        }

// ── Start recording for a scheduled class ────────────────────────────────────
async function startRecording(meetingId, { recorderWindow } = {}) {
  if (_state.isRecording) return { ok: false, error: "Already recording" };

  try {
    // 1. Get/create session from backend
    const deviceId = store.get("deviceId");
    const session  = await api.findOrCreateSession({ deviceId, meetingId });
    const recId    = session.recordingId;
    if (!recId) throw new Error("No recordingId from server");

    _state = { isRecording: true, recordingId: recId, meetingId, segmentIndex: 0, startTime: new Date() };

    // 2. Tell renderer window to start recording
    if (recorderWindow && !recorderWindow.isDestroyed()) {
      recorderWindow.webContents.send("recorder:start", { recordingId: recId });
    }

    console.log("[Recorder] Started. recordingId:", recId);
    return { ok: true, recordingId: recId };
  } catch (err) {
    console.error("[Recorder] startRecording error:", err.message);
    return { ok: false, error: err.message };
  }
}

// ── Stop recording ────────────────────────────────────────────────────────────
async function stopRecording({ recorderWindow } = {}) {
  if (!_state.isRecording) return { ok: false, error: "Not recording" };
  const recId = _state.recordingId;

  _state.isRecording = false;

  // Tell renderer to stop
  if (recorderWindow && !recorderWindow.isDestroyed()) {
    recorderWindow.webContents.send("recorder:stop");
  }

  // Trigger merge on backend
  try {
    await api.triggerMerge(recId);
    console.log("[Recorder] Merge triggered for", recId);
  } catch (err) {
    console.error("[Recorder] merge error:", err.message);
  }

  _state = { isRecording: false, recordingId: null, meetingId: null, segmentIndex: 0, startTime: null };
  return { ok: true };
}

// ── Upload a completed segment (called from renderer via IPC) ─────────────────
async function uploadSegment(segmentBuffer, meta) {
  const recId = meta.recordingId || _state.recordingId;
  if (!recId) return { ok: false, error: "No active recordingId" };

  const idx      = _state.segmentIndex++;
  const segPath  = path.join(SEGMENT_DIR, `seg_${recId}_${idx}.webm`);

  // Write buffer to temp file
  fs.writeFileSync(segPath, Buffer.from(segmentBuffer));

  try {
    await api.uploadSegment(recId, segPath, {
      segmentIndex: idx,
      source:       "screen",
      startTime:    meta.startTime || new Date().toISOString(),
      endTime:      new Date().toISOString(),
      duration:     meta.duration  || 0,
    });
    fs.unlinkSync(segPath); // clean up
    console.log(`[Recorder] Segment ${idx} uploaded`);
    return { ok: true, segmentIndex: idx };
  } catch (err) {
    console.error(`[Recorder] Upload segment ${idx} error:`, err.message);
    return { ok: false, error: err.message };
  }
}

// ── Health snapshot ───────────────────────────────────────────────────────────
function getHealth() {
  const mem  = process.memoryUsage();
  const free = os.freemem();
  const total= os.totalmem();
  return {
    screen: { ok: true, resolution: `${1920}x${1080}` },
    disk:   { freeGB: 10, usedPercent: 50 },
    cpu:    { usagePercent: 0 },
    ram: {
      freeGB:      +(free / 1e9).toFixed(2),
      totalGB:     +(total / 1e9).toFixed(2),
      usedPercent: Math.round(((total - free) / total) * 100),
    },
    recording: _state.isRecording ? { status: "active", segmentCount: _state.segmentIndex } : null,
  };
}

module.exports = { isRecording, recordingId, getState, startRecording, stopRecording, uploadSegment, getHealth, SEGMENT_DIR };
