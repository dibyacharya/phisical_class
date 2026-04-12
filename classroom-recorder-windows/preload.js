/**
 * preload.js — Safely exposes APIs from main → renderer via contextBridge
 */
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  // ── Store ─────────────────────────────────────────────────────────────────
  getStore:      (key)          => ipcRenderer.invoke("store:get",       key),
  setStore:      (key, value)   => ipcRenderer.invoke("store:set",       key, value),

  // ── Device registration + setup completion ────────────────────────────────
  registerDevice: (payload)     => ipcRenderer.invoke("device:register", payload),
  setupComplete:  ()            => ipcRenderer.send("setup:complete"),

  // ── Recording control ─────────────────────────────────────────────────────
  startRecording: (meetingId)   => ipcRenderer.invoke("recorder:start",  meetingId),
  stopRecording:  ()            => ipcRenderer.invoke("recorder:stop"),
  getState:       ()            => ipcRenderer.invoke("recorder:getState"),

  // ── Segment upload (renderer sends ArrayBuffer) ───────────────────────────
  uploadSegment:  (buf, meta)   => ipcRenderer.invoke("recorder:uploadSegment", buf, meta),

  // ── Screen sources for desktopCapturer ────────────────────────────────────
  getScreenSources: ()          => ipcRenderer.invoke("recorder:getSources"),

  // ── One-way messages from main → renderer ─────────────────────────────────
  onStatus:      (cb) => { ipcRenderer.removeAllListeners("status:update");  ipcRenderer.on("status:update",   (_e, msg)  => cb(msg));  },
  onSchedule:    (cb) => { ipcRenderer.removeAllListeners("schedule:update"); ipcRenderer.on("schedule:update", (_e, data) => cb(data)); },
  onRecordStart: (cb) => { ipcRenderer.removeAllListeners("recorder:start");  ipcRenderer.on("recorder:start",  (_e, data) => cb(data)); },
  onRecordStop:  (cb) => { ipcRenderer.removeAllListeners("recorder:stop");   ipcRenderer.on("recorder:stop",   ()         => cb());     },
});
