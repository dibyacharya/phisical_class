/**
 * main.js — LectureLens Recorder (Windows) — Electron main process
 *
 * Android APK equivalent:
 *   SetupActivity       → openSetup()
 *   RecorderForeground  → initService() + scheduler + recorder
 *   PreferencesManager  → store (electron-store, encrypted)
 *
 * Flow:
 *   1. App starts → check if setup done
 *   2. No  → show setup window (one-time, like Android first-run)
 *   3. Yes → init API, start heartbeat, show system tray icon
 *   4. Auto-start on Windows login (like Android boot receiver)
 *   5. Schedule-based auto recording
 */

const {
  app, BrowserWindow, Tray, Menu, ipcMain,
  desktopCapturer, nativeImage,
} = require("electron");
const path  = require("path");
const os    = require("os");
const fs    = require("fs");

const store     = require("./src/store");
const api       = require("./src/api");
const scheduler = require("./src/scheduler");
const recorder  = require("./src/recorder");

// Single instance lock — only one copy running at a time (like Android service)
if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }
app.on("second-instance", () => { openStatus(); });

// ── Window refs ───────────────────────────────────────────────────────────────
let setupWindow    = null;
let statusWindow   = null;
let recorderWindow = null;
let tray           = null;

// ─────────────────────────────────────────────────────────────────────────────
// App ready
// ─────────────────────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  // Auto-start with Windows (like Android BOOT_COMPLETED)
  app.setLoginItemSettings({
    openAtLogin: true,
    openAsHidden: true,   // start minimised to tray
  });

  if (store.get("isSetupComplete")) {
    initService();
  } else {
    openSetup();
  }
});

// Stay alive even when all windows closed (live in tray)
app.on("window-all-closed", (e) => e.preventDefault());

// ─────────────────────────────────────────────────────────────────────────────
// Setup window — one-time wizard (like Android SetupActivity)
// ─────────────────────────────────────────────────────────────────────────────
function openSetup() {
  if (setupWindow && !setupWindow.isDestroyed()) { setupWindow.focus(); return; }

  setupWindow = new BrowserWindow({
    width:     500,
    height:    620,
    resizable: false,
    title:     "LectureLens Recorder — Setup",
    icon:      iconPath(),
    webPreferences: {
      preload:          path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration:  false,
    },
  });
  setupWindow.setMenuBarVisibility(false);
  setupWindow.loadFile(path.join(__dirname, "renderer", "setup.html"));
  setupWindow.on("closed", () => { setupWindow = null; });
}

// ─────────────────────────────────────────────────────────────────────────────
// Status window — opened from tray click
// ─────────────────────────────────────────────────────────────────────────────
function openStatus() {
  if (statusWindow && !statusWindow.isDestroyed()) { statusWindow.show(); statusWindow.focus(); return; }

  statusWindow = new BrowserWindow({
    width:     420,
    height:    580,
    resizable: false,
    title:     "LectureLens Recorder",
    icon:      iconPath(),
    webPreferences: {
      preload:          path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration:  false,
    },
  });
  statusWindow.setMenuBarVisibility(false);
  statusWindow.loadFile(path.join(__dirname, "renderer", "status.html"));
  statusWindow.on("closed", () => { statusWindow = null; });
}

// ─────────────────────────────────────────────────────────────────────────────
// Hidden recorder window — runs MediaRecorder (like Android MediaProjection)
// ─────────────────────────────────────────────────────────────────────────────
function createRecorderWindow() {
  if (recorderWindow && !recorderWindow.isDestroyed()) return;

  recorderWindow = new BrowserWindow({
    width:  1,
    height: 1,
    show:   false,
    webPreferences: {
      preload:              path.join(__dirname, "preload.js"),
      contextIsolation:     true,
      nodeIntegration:      false,
    },
  });
  recorderWindow.loadFile(path.join(__dirname, "renderer", "recorder-worker.html"));
  recorderWindow.on("closed", () => { recorderWindow = null; });
}

// ─────────────────────────────────────────────────────────────────────────────
// Init service — called after setup complete or on app start if already set up
// ─────────────────────────────────────────────────────────────────────────────
function initService() {
  api.init(store.get("apiUrl"), store.get("deviceId"), store.get("authToken"));
  createRecorderWindow();
  setupTray();

  let currentSchedule = [];

  scheduler.start({
    onStatus: (msg) => {
      broadcastTo(statusWindow, "status:update", msg);
      tray?.setToolTip(`LectureLens Recorder\n${recorder.isRecording() ? "🔴 RECORDING" : "🟢 Ready"}\n${msg}`);
      updateTrayMenu();
    },
    onSchedule: (schedule) => {
      currentSchedule = schedule;
      broadcastTo(statusWindow, "schedule:update", schedule);
      checkAutoRecord(schedule);
    },
    onForceStop: () => {
      if (recorder.isRecording()) {
        recorder.stopRecording({ recorderWindow });
        broadcastTo(statusWindow, "status:update", "Recording stopped by server");
      }
    },
    getHealth:   () => recorder.getHealth(),
    isRecording: () => recorder.isRecording(),
  });

  // Auto-record check every minute
  setInterval(() => checkAutoRecord(currentSchedule), 60_000);
}

// ─────────────────────────────────────────────────────────────────────────────
// Auto-record: start/stop based on today's schedule
// ─────────────────────────────────────────────────────────────────────────────
function checkAutoRecord(schedule) {
  if (!schedule?.length) return;
  const now   = new Date();
  const hhmm  = now.toTimeString().slice(0, 5);
  const today = now.toISOString().slice(0, 10);

  for (const item of schedule) {
    const itemDate  = (item.start || "").slice(0, 10);
    if (itemDate !== today) continue;
    const startHHMM = (item.start || "").slice(11, 16);
    const endHHMM   = (item.end   || "").slice(11, 16);
    const isActive  = hhmm >= startHHMM && hhmm < endHHMM && !item.alreadyRecorded;

    if (isActive && !recorder.isRecording()) {
      recorder.startRecording(item.meetingId, { recorderWindow });
      broadcastTo(statusWindow, "status:update", `Auto-recording: ${item.title || item.meetingId}`);
    } else if (!isActive && recorder.isRecording()) {
      recorder.stopRecording({ recorderWindow });
      broadcastTo(statusWindow, "status:update", "Auto-recording stopped");
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// System Tray
// ─────────────────────────────────────────────────────────────────────────────
function setupTray() {
  const img = nativeImage.createFromPath(iconPath());
  tray = new Tray(img.isEmpty() ? nativeImage.createEmpty() : img);
  tray.setToolTip("LectureLens Recorder — Ready");
  tray.on("click",        openStatus);
  tray.on("double-click", openStatus);
  updateTrayMenu();
}

function updateTrayMenu() {
  const rec = recorder.isRecording();
  const menu = Menu.buildFromTemplate([
    { label: "LectureLens Recorder",  enabled: false },
    { label: `Status: ${rec ? "🔴 Recording" : "🟢 Standby"}`, enabled: false },
    { type: "separator" },
    { label: "Open Status Window",  click: openStatus },
    { type: "separator" },
    rec
      ? { label: "⏹ Stop Recording",   click: () => recorder.stopRecording({ recorderWindow }) }
      : { label: "▶ Manual Record…",   click: manualRecordDialog },
    { type: "separator" },
    {
      label: "Start with Windows",
      type: "checkbox",
      checked: app.getLoginItemSettings().openAtLogin,
      click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked, openAsHidden: true }),
    },
    { type: "separator" },
    { label: "Reset Setup",  click: resetSetup },
    { label: "Quit",         click: () => { scheduler.stop(); app.exit(0); } },
  ]);
  tray?.setContextMenu(menu);
}

function manualRecordDialog() {
  // Open status window and let user click Start
  openStatus();
}

function resetSetup() {
  store.clear();
  scheduler.stop();
  app.relaunch();
  app.exit(0);
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
function broadcastTo(win, channel, data) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, data);
}

function iconPath() {
  const p = path.join(__dirname, "assets", "icon.ico");
  return fs.existsSync(p) ? p : path.join(__dirname, "assets", "icon.png");
}

// ─────────────────────────────────────────────────────────────────────────────
// IPC Handlers
// ─────────────────────────────────────────────────────────────────────────────

// Store
ipcMain.handle("store:get",  (_e, key)        => store.get(key));
ipcMain.handle("store:set",  (_e, key, value) => { store.set(key, value); return true; });

// Device registration — called from setup.html
ipcMain.handle("device:register", async (_e, payload) => {
  try {
    api.init(payload.apiUrl, "", "");
    const result = await api.registerDevice(payload);
    const cfg    = result.setupConfig;
    if (!cfg?.deviceId) throw new Error("Registration failed: no setupConfig returned");

    // Persist — same as Android prefs.save()
    store.set("isSetupComplete", true);
    store.set("apiUrl",          payload.apiUrl);
    store.set("deviceId",        cfg.deviceId  || "");
    store.set("authToken",       cfg.authToken || "");
    store.set("campus",          payload.campus     || "");
    store.set("block",           payload.block      || "");
    store.set("floor",           payload.floor      || "");
    store.set("roomId",          payload.roomId     || "");
    store.set("roomName",        payload.roomName   || "");
    store.set("roomNumber",      payload.roomNumber || "");

    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// Setup complete signal from renderer
ipcMain.on("setup:complete", () => {
  setupWindow?.close();
  initService();
  // Show status window after short delay (let service init)
  setTimeout(openStatus, 800);
});

// Recording
ipcMain.handle("recorder:start",          (_e, mid) => recorder.startRecording(mid, { recorderWindow }));
ipcMain.handle("recorder:stop",           ()        => recorder.stopRecording({ recorderWindow }));
ipcMain.handle("recorder:getState",       ()        => recorder.getState());
ipcMain.handle("recorder:uploadSegment",  (_e, buf, meta) => recorder.uploadSegment(buf, meta));
ipcMain.handle("recorder:getSources",     async () => {
  const sources = await desktopCapturer.getSources({ types: ["screen"] });
  return sources.map(s => ({ id: s.id, name: s.name }));
});
