/**
 * api.js — Backend API client (mirrors Android ApiService.kt)
 * All endpoints identical to the Android APK.
 */
const fetch    = require("node-fetch");
const FormData = require("form-data");
const fs       = require("fs");

let _baseUrl   = "http://localhost:5020/api";
let _deviceId  = "";
let _authToken = "";

function init(baseUrl, deviceId, authToken) {
  _baseUrl   = baseUrl.replace(/\/$/, "");
  _deviceId  = deviceId;
  _authToken = authToken;
}

function headers(extra = {}) {
  return {
    "Content-Type": "application/json",
    ...((_authToken) ? { "Authorization": `Bearer ${_authToken}` } : {}),
    ...extra,
  };
}

async function post(path, body) {
  const res = await fetch(`${_baseUrl}${path}`, {
    method:  "POST",
    headers: headers(),
    body:    JSON.stringify(body),
    timeout: 15000,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  return res.json();
}

// ── Device registration ──────────────────────────────────────────────────────
async function registerDevice(payload) {
  return post("/classroom-recording/devices/register", payload);
}

// ── Heartbeat ────────────────────────────────────────────────────────────────
async function heartbeat(deviceId, body) {
  return post(`/classroom-recording/devices/${deviceId}/heartbeat`, body);
}

// ── Find or create recording session ─────────────────────────────────────────
async function findOrCreateSession(body) {
  return post("/classroom-recording/recordings/session", body);
}

// ── Upload segment ────────────────────────────────────────────────────────────
async function uploadSegment(recordingId, segmentPath, meta) {
  const form = new FormData();
  form.append("video", fs.createReadStream(segmentPath), {
    filename:    `segment_${meta.segmentIndex}.webm`,
    contentType: "video/webm",
  });
  form.append("segmentIndex", String(meta.segmentIndex));
  form.append("source",       meta.source       || "screen");
  form.append("startTime",    meta.startTime    || "");
  form.append("endTime",      meta.endTime      || "");
  form.append("duration",     String(meta.duration || 0));

  const res = await fetch(
    `${_baseUrl}/classroom-recording/recordings/${recordingId}/segment-upload`,
    {
      method:  "POST",
      headers: {
        ...(_authToken ? { Authorization: `Bearer ${_authToken}` } : {}),
        ...form.getHeaders(),
      },
      body:    form,
      timeout: 60000,
    }
  );
  if (!res.ok) throw new Error(`Upload HTTP ${res.status}`);
  return res.json();
}

// ── Merge trigger ─────────────────────────────────────────────────────────────
async function triggerMerge(recordingId) {
  return post(`/classroom-recording/recordings/${recordingId}/merge`, {});
}

// ── Update active source ──────────────────────────────────────────────────────
async function updateActiveSource(recordingId, source) {
  return post(`/classroom-recording/recordings/${recordingId}/active-source`, { source });
}

// ── Health report ─────────────────────────────────────────────────────────────
async function healthReport(deviceId, body) {
  return post(`/classroom-recording/devices/${deviceId}/health-report`, body);
}

module.exports = { init, registerDevice, heartbeat, findOrCreateSession, uploadSegment, triggerMerge, updateActiveSource, healthReport };
