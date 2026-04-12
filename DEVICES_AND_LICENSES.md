# EduCampus — Device Recorders & License System
## Complete Technical Reference

> **Audience:** Developers working on this project in future.  
> **Last updated:** April 2026  
> **Covers:** License key system · Android APK · Windows EXE

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [License Key System](#2-license-key-system)
3. [Android APK Recorder](#3-android-apk-recorder)
4. [Windows EXE Recorder](#4-windows-exe-recorder)
5. [Backend Registration API](#5-backend-registration-api)
6. [Admin Portal — Licenses Page](#6-admin-portal--licenses-page)
7. [Common Flows (Step by Step)](#7-common-flows-step-by-step)
8. [Troubleshooting](#8-troubleshooting)
9. [File Map — Quick Reference](#9-file-map--quick-reference)

---

## 1. System Overview

```
┌─────────────────────────────────────────────────────┐
│                   ADMIN PORTAL                      │
│  (Vercel) → generate License Keys → share with tech │
└─────────────────────┬───────────────────────────────┘
                      │  EDUC-XXXX-XXXX-XXXX
                      ▼
          ┌───────────────────────┐
          │  Physical Classroom   │
          │                       │
          │  ┌─────────────────┐  │
          │  │  Smart TV/Tab   │  │  ← Android APK installed
          │  │  Android APK    │  │
          │  └────────┬────────┘  │
          │           │           │
          │  ┌─────────────────┐  │
          │  │  Classroom PC   │  │  ← Windows EXE installed
          │  │  Windows EXE    │  │
          │  └────────┬────────┘  │
          └───────────┼───────────┘
                      │  Register (licenseKey + macAddress)
                      ▼
┌─────────────────────────────────────────────────────┐
│              BACKEND (Render.com)                   │
│  /api/classroom-recording/devices/register          │
│  → validates license key                            │
│  → binds key to device MAC address (one-time)       │
│  → creates/updates ClassroomDevice                  │
│  → returns { deviceId, authToken }                  │
└─────────────────────┬───────────────────────────────┘
                      │  heartbeat every 30s
                      │  schedule polling
                      │  segment upload (WebM)
                      ▼
              MongoDB Atlas DB
```

**Key rule:** One license key = one physical device.  
Same APK/EXE copied to another device → registration rejected (HTTP 409).

---

## 2. License Key System

### 2.1 What is a License Key?

A one-time activation code of format:

```
EDUC-XXXX-XXXX-XXXX
```

- Prefix `EDUC-` always present
- 3 segments of 4 chars each
- Characters: `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`  
  (no ambiguous chars: no `0`, `O`, `1`, `I`)
- Example: `EDUC-K7MN-QR4P-W2YZ`

### 2.2 How Keys Are Generated

```
Admin Portal → /licenses page → "Generate Keys" button
  → POST /api/licenses
  → Backend creates License documents in MongoDB
  → Each document gets a random key via generateKey()
```

**Generate options:**
| Field | Description |
|-------|-------------|
| Label | Human-readable note (e.g. "Block 14 Room 202") — optional |
| Count | 1 to 100 keys at once |
| Expiry | Date after which key stops working — optional (blank = never expires) |

### 2.3 License States

| State | `isActive` | `isActivated` | Meaning |
|-------|-----------|---------------|---------|
| Available | `true` | `false` | Ready to use — not yet bound to any device |
| Activated | `true` | `true` | Bound to a device (deviceMac filled) |
| Revoked | `false` | any | Permanently disabled — device will stop working |
| Expired | `true` | `false` | `expiresAt` date has passed — cannot be used |

### 2.4 License Document Schema (MongoDB)

```
Collection: lcs_licenses

{
  key:         "EDUC-K7MN-QR4P-W2YZ",  // unique, uppercase
  label:       "Block 14 Room 202",      // admin's note
  isActive:    true,                     // false = revoked
  isActivated: false,                    // true = bound to a device
  activatedAt: Date,                     // when first activated
  deviceMac:   "AA:BB:CC:DD:EE:FF",     // bound device MAC
  deviceId:    "uuid-...",              // ClassroomDevice._id equivalent
  deviceModel: "Samsung Smart TV",      // model string from device
  roomNumber:  "202",
  campus:      "KIIT Campus",
  block:       "Block 14",
  createdBy:   ObjectId → LCS_User,     // admin who generated it
  expiresAt:   null,                    // or Date
  createdAt:   Date,
  updatedAt:   Date,
}
```

### 2.5 License API Endpoints

All admin endpoints require JWT token (`Authorization: Bearer <token>`).

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/licenses` | Admin | Generate 1–100 new keys |
| `GET` | `/api/licenses` | Admin | List all keys (sorted newest first) |
| `DELETE` | `/api/licenses/:id` | Admin | Revoke a key (sets `isActive: false`) |
| `POST` | `/api/licenses/:id/reset` | Admin | Unbind device, allow re-use on new device |
| `POST` | `/api/licenses/validate` | Public | Check if key is valid (used during device setup) |

**Generate request body:**
```json
{
  "label":     "Block 14 Room 202",
  "count":     5,
  "expiresAt": "2027-12-31"
}
```

**Validate request body:**
```json
{
  "key":        "EDUC-K7MN-QR4P-W2YZ",
  "macAddress": "AA:BB:CC:DD:EE:FF"
}
```

**Validate response:**
```json
{ "valid": true, "alreadyOwned": false, "licenseId": "...", "label": "Block 14 Room 202" }
```
or error codes:
- `404` — key not found or inactive
- `403` — key expired
- `409` — key already activated on another device

### 2.6 License Binding Logic (Backend)

```
Device tries to register →

  1. Find existing device by macAddress in DB
     ↓
     Existing device found?
       YES → Re-registration (e.g. app reset) → skip license check → update device info
       NO  → New device → license key REQUIRED
     ↓
  2. (New device only) Validate license key:
     - Key must exist in DB
     - isActive must be true
     - expiresAt must not have passed
     - If isActivated AND deviceMac ≠ current macAddress → REJECT (409)
     ↓
  3. Create ClassroomDevice in DB
     ↓
  4. Bind license: update License document with:
     - isActivated: true
     - activatedAt: now
     - deviceMac: macAddress
     - deviceId: device.deviceId
     - deviceModel, roomNumber, campus, block
```

### 2.7 When to Reset a License

Reset (via admin portal "Reset" button) is used when:
- Device was replaced (new hardware, same room)
- Device got corrupted/reformatted — need fresh setup
- Wrong device was accidentally activated

**Reset clears:** `isActivated`, `activatedAt`, `deviceMac`, `deviceId`, `deviceModel`, `roomNumber`, `campus`, `block`  
**Does NOT change:** `key`, `label`, `expiresAt`, `createdBy`

After reset, the same key can be used on the new device.

---

## 3. Android APK Recorder

### 3.1 What it does

- Runs as a **foreground service** on Android (Smart TV / tablet)
- Records **screen + microphone** using MediaProjection API
- Automatically starts recording when a scheduled class begins
- Sends video in **30-second segments** (WebM) to backend
- Sends **heartbeat every 2 minutes** with health stats
- Survives phone calls, sleep, reboots (via BOOT_COMPLETED receiver)
- Shows a **persistent notification** while running

### 3.2 Folder Structure

```
classroom-recorder-android/
├── app/src/main/
│   ├── java/in/educampus/recorder/
│   │   ├── RecorderApp.kt                    ← Application class
│   │   ├── ui/setup/
│   │   │   └── SetupActivity.kt              ← One-time setup wizard
│   │   ├── service/
│   │   │   └── RecorderForegroundService.kt  ← Main recording service
│   │   ├── data/
│   │   │   ├── local/PreferencesManager.kt   ← EncryptedSharedPreferences
│   │   │   └── remote/
│   │   │       ├── ApiClient.kt              ← Retrofit instance
│   │   │       └── ApiService.kt             ← API endpoint definitions
│   │   ├── overlay/
│   │   │   ├── CameraOverlayManager.kt       ← PiP camera overlay
│   │   │   └── QrOverlayManager.kt           ← QR code overlay
│   │   └── util/
│   │       └── DeviceInfoCollector.kt        ← MAC, IP, model, storage
│   └── res/layout/
│       └── activity_setup.xml                ← Setup screen UI
└── app/build.gradle.kts                      ← Dependencies
```

### 3.3 Tech Stack

| Component | Technology |
|-----------|-----------|
| Language | Kotlin |
| Screen recording | `MediaProjection` + `MediaRecorder` |
| Local storage | `EncryptedSharedPreferences` (AES-256-GCM) |
| HTTP client | Retrofit + OkHttp |
| Background service | `Service` (Foreground) |
| Boot auto-start | `BroadcastReceiver` (BOOT_COMPLETED) |
| Video format | H.264 video + AAC audio → MP4/WebM segments |

### 3.4 Recording Specs (Android)

```kotlin
VIDEO_WIDTH    = 848 px
VIDEO_HEIGHT   = 480 px
VIDEO_BITRATE  = 500,000 bps (500 kbps)
VIDEO_FPS      = 15 fps
AUDIO_SAMPLE_RATE = 44100 Hz
AUDIO_BIT_RATE    = 128,000 bps
AUDIO_CHANNELS    = 1 (mono)
```

### 3.5 Setup Screen Fields

End user (technician) fills this form ONCE when installing on a new device:

| Field | View ID | Required | Example |
|-------|---------|----------|---------|
| Backend URL | `etApiUrl` | ✅ | `https://phisical-class.onrender.com/api` |
| Campus Name | `etRoomId` | ✅ | `KIIT Campus` |
| Block Name | `etRoomName` | ✅ | `Block 14` |
| Floor | `etFloor` | Optional | `2nd Floor` |
| Room Number | `etRoomNumber` | ✅ | `202` |
| License Key | `etLicenseKey` | ✅ | `EDUC-K7MN-QR4P-W2YZ` |

> **Important:** Room Number must exactly match what's in the admin portal's Facility section.

### 3.6 Permission Flow (One-Time)

```
App launches (first time) →
  1. Camera + Mic + Notifications (runtime permission dialog)
  2. "Display over other apps" (system settings screen)
  3. Setup form shown
  4. User fills form + taps "Complete Setup"
  5. registerDevice() called → backend validates license
  6. Success → MediaProjection permission requested (screen capture dialog)
  7. Service starts → setup activity finishes
```

### 3.7 Data Stored on Device (EncryptedSharedPreferences)

```kotlin
// File: educampus_recorder_prefs (AES-256-GCM encrypted)

setup_complete  → Boolean    // Is first-time setup done?
api_url         → String     // Backend URL
device_id       → String     // UUID from backend after registration
auth_token      → String     // JWT from backend (for heartbeat/upload)
room_id         → String     // Campus name (used as roomId)
room_name       → String     // Full "Campus - Block - Floor - Room" string
floor           → String     // Floor number
room_number     → String     // Room number
camera_name     → String     // Selected camera
mic_name        → String     // Selected mic
```

### 3.8 Heartbeat (every 2 minutes)

```
POST /api/classroom-recording/devices/{deviceId}/heartbeat
{
  "isOnline": true,
  "isRecording": true/false,
  "health": {
    "screen": { "ok": true, "resolution": "848x480" },
    "disk": { "freeGB": 12.5, "usedPercent": 45 },
    "cpu": { "usagePercent": 30 },
    "ram": { "freeGB": 1.2, "totalGB": 4.0, "usedPercent": 70 }
  },
  "timestamp": "2026-04-12T10:30:00.000Z"
}
```

**Response from server:**
```json
{
  "forceStop": false,
  "schedule": [
    {
      "meetingId": "...",
      "title": "Mathematics I",
      "start": "2026-04-12T09:00:00.000Z",
      "end":   "2026-04-12T10:00:00.000Z"
    }
  ]
}
```

### 3.9 Schedule Check (every 30s)

```
Current time falls in a schedule window?
  YES + not already recording → start recording (findOrCreateSession)
  NO  + currently recording   → stop recording + trigger merge
```

### 3.10 Video Segment Upload

```
POST /api/classroom-recording/recordings/{recordingId}/segment-upload
Content-Type: multipart/form-data

video        → WebM file (30 seconds)
segmentIndex → 0, 1, 2, ...
source       → "screen"
startTime    → ISO timestamp
endTime      → ISO timestamp
duration     → seconds (30)
```

### 3.11 Building the APK

> **Requirements:** Android Studio on any OS, or `./gradlew` on Linux/Mac.

```bash
# 1. Open project in Android Studio
cd classroom-recorder-android
# Android Studio → Build → Generate Signed Bundle / APK

# OR via command line:
./gradlew assembleRelease

# Output:
# app/build/outputs/apk/release/app-release.apk
```

**Distribute:** Share `app-release.apk` to technician. Sideload on Smart TV via USB or local HTTP server.

---

## 4. Windows EXE Recorder

### 4.1 What it does

Exact equivalent of the Android APK, but for Windows classroom PCs:

- Electron-based desktop app packaged as a single `.exe`
- Runs in **system tray** (no visible window after setup)
- Records **screen + microphone** using `desktopCapturer` + `MediaRecorder`
- Auto-records from schedule, sends segments every 30 seconds
- **Auto-starts on Windows boot** (`setLoginItemSettings`)
- Single instance lock (can't run two copies simultaneously)
- Right-click tray → "Reset Setup" to wipe config and restart wizard

### 4.2 Folder Structure

```
classroom-recorder-windows/   (inside lecture-capture-system/)
├── main.js                   ← Electron main process
├── preload.js                ← contextBridge (IPC bridge to renderer)
├── src/
│   ├── store.js              ← electron-store (encrypted local config)
│   ├── api.js                ← HTTP client (mirrors Android ApiClient)
│   ├── recorder.js           ← Recording state management
│   └── scheduler.js          ← Heartbeat + schedule polling
├── renderer/
│   ├── setup.html            ← One-time setup wizard window
│   ├── status.html           ← Tray click → status window
│   └── recorder-worker.html  ← Hidden window running MediaRecorder
├── assets/
│   └── icon.ico              ← App icon
├── package.json              ← electron-builder config
├── build.bat                 ← Windows build script
└── create-icon.js            ← SVG icon generator (fallback)
```

### 4.3 Tech Stack

| Component | Technology |
|-----------|-----------|
| Framework | Electron 28 |
| Screen capture | `desktopCapturer` + `navigator.mediaDevices.getUserMedia` |
| Local storage | `electron-store` (AES encrypted at rest) |
| HTTP client | `node-fetch` + `form-data` |
| Background | System tray (no dock/taskbar entry) |
| Boot auto-start | `app.setLoginItemSettings({ openAtLogin: true })` |
| Packaging | `electron-builder` → NSIS installer + Portable exe |
| Single instance | `app.requestSingleInstanceLock()` |

### 4.4 Recording Specs (Windows)

```
Screen: desktopCapturer → "Entire Screen" (primary monitor)
Video: maxWidth 1920, maxHeight 1080, maxFrameRate 15
Audio: microphone (getUserMedia, separate stream)
Segments: 30 seconds each (30,000 ms)
Format: WebM (VP8/VP9 video + Opus audio)
Temp storage: OS temp dir → educampus-segments/
```

### 4.5 Setup Screen Fields

Same as Android — filled once by technician:

| Field | Input ID | Required | Example |
|-------|----------|----------|---------|
| Backend URL | `#apiUrl` | ✅ | `https://phisical-class.onrender.com/api` |
| Campus | `#campus` | ✅ | `KIIT Campus` |
| Block | `#block` | ✅ | `Block 14` |
| Floor | `#floor` | Optional | `2nd Floor` |
| Room Number | `#roomNumber` | ✅ | `202` |
| Display Name | `#roomName` | Optional | `Smart Class Room 1` |
| License Key | `#licenseKey` | ✅ | `EDUC-K7MN-QR4P-W2YZ` |

### 4.6 IPC Architecture (Electron)

```
renderer/setup.html
  └── window.electronAPI.registerDevice(payload)
        └── ipcRenderer.invoke("device:register", payload)
              └── ipcMain.handle("device:register") [main.js]
                    └── api.registerDevice(payload)  [src/api.js]
                          └── POST /api/classroom-recording/devices/register

renderer/setup.html (after success)
  └── window.electronAPI.setupComplete()
        └── ipcRenderer.send("setup:complete")
              └── ipcMain.on("setup:complete") [main.js]
                    └── setupWindow.close()
                    └── initService()         → starts heartbeat + tray
                    └── openStatus()          → shows status window

renderer/recorder-worker.html (hidden window)
  └── electronAPI.onRecordStart(cb)   → starts MediaRecorder
  └── electronAPI.uploadSegment(buf, meta) → main saves temp file → upload
  └── electronAPI.onRecordStop(cb)    → stops MediaRecorder
```

### 4.7 Data Stored on Machine (electron-store)

```
File: %APPDATA%/educampus-recorder/config.json  (encrypted)

isSetupComplete  → Boolean
apiUrl           → String
deviceId         → String  (UUID from backend)
authToken        → String  (JWT from backend)
campus           → String
block            → String
floor            → String
roomId           → String
roomName         → String
roomNumber       → String
```

**Encryption key** (hardcoded, not user-facing): `"educampus-recorder-2024-secure-key"`

### 4.8 System Tray Menu

Right-click on tray icon shows:

```
EduCampus Recorder
Status: 🔴 Recording  (or 🟢 Standby)
─────────────────────
Open Status Window
─────────────────────
⏹ Stop Recording   (if recording)
▶ Manual Record…    (if standby)
─────────────────────
☑ Start with Windows
─────────────────────
Reset Setup
Quit
```

### 4.9 Building the EXE

> **Requirements:** Node.js 18+ on a **Windows machine** (cross-compile won't work for NSIS installer).

```bat
:: On the Windows machine:
cd classroom-recorder-windows

:: Option A — use the build script (recommended):
build.bat

:: Option B — manually:
npm install
npm run build

:: Output in dist\ folder:
::   EduCampus-Recorder-Setup.exe     ← Installer (creates Start Menu shortcut)
::   EduCampus-Recorder-Portable.exe  ← No install needed, run anywhere
```

**electron-builder config** (from `package.json`):
```json
"win": {
  "target": [
    { "target": "nsis",     "arch": ["x64"] },
    { "target": "portable", "arch": ["x64"] }
  ]
}
```

**Final `.exe` size:** ~120–150 MB (includes bundled Node.js runtime).  
End users on classroom PCs do NOT need Node.js installed.

### 4.10 Reset Setup (Windows)

Right-click tray → "Reset Setup" calls:

```javascript
store.clear();        // wipe all config
scheduler.stop();     // stop heartbeat
app.relaunch();       // restart app
app.exit(0);          // quit current instance
```

On relaunch, setup wizard opens again. Technician must enter new license key (or admin must reset the old license in admin portal first).

---

## 5. Backend Registration API

### 5.1 Endpoint

```
POST /api/classroom-recording/devices/register
Content-Type: application/json
(No auth token needed — public endpoint)
```

### 5.2 Request Body

```json
{
  "name":        "Smart TV - Room 202",
  "licenseKey":  "EDUC-K7MN-QR4P-W2YZ",
  "macAddress":  "AA:BB:CC:DD:EE:FF",
  "campus":      "KIIT Campus",
  "block":       "Block 14",
  "floor":       "2nd Floor",
  "roomId":      "KIIT Campus",
  "roomName":    "KIIT Campus - Block 14 - 2nd Floor - Room 202",
  "roomNumber":  "202",
  "ipAddress":   "192.168.1.50",
  "deviceType":  "android",
  "deviceModel": "Samsung Smart TV",
  "osVersion":   "Android 11"
}
```

### 5.3 Success Response

```json
{
  "message": "Device registered successfully",
  "setupConfig": {
    "deviceId":  "uuid-...",
    "authToken": "eyJhbGci..."
  }
}
```

### 5.4 Error Responses

| HTTP | Error | Cause |
|------|-------|-------|
| 400 | `roomNumber required` | roomNumber and roomId both missing |
| 400 | `macAddress required` | macAddress not sent |
| 403 | `License key is required` | New device, no licenseKey in body |
| 404 | `Invalid license key` | Key doesn't exist or is revoked |
| 403 | `License key has expired` | expiresAt date passed |
| 409 | `Already activated on another device` | Key bound to different MAC |

### 5.5 What Happens After Registration

1. License document updated (`isActivated: true`, `deviceMac` saved)
2. `ClassroomDevice` document created in DB
3. `Room` document auto-created or updated in facility hierarchy
4. `authToken` (JWT) returned → device stores it → uses for all future API calls

---

## 6. Admin Portal — Licenses Page

**URL:** `https://admin-portal-two-gray.vercel.app/licenses`  
**File:** `admin-portal/src/pages/Licenses.jsx`

### 6.1 Features

| Feature | How |
|---------|-----|
| Generate keys | "Generate Keys" button → modal with label/count/expiry |
| View all keys | Table with key, label, status badge, device info, location |
| Copy key | Copy icon next to each key (clipboard API) |
| Filter | Status filter chips: All / Available / Activated / Revoked / Expired |
| Search | Search by key, label, device MAC, room number, campus, block |
| Revoke | Trash icon → confirm → `DELETE /api/licenses/:id` |
| Reset (unbind) | Refresh icon (shown on activated/revoked) → confirm → `POST /api/licenses/:id/reset` |
| Export | "Export CSV" → downloads CSV with all license data |
| Stats | 4 stat cards: Total / Available / Activated / Revoked |

### 6.2 Status Badges

```
🔵 Available   → isActive: true, isActivated: false
🟢 Activated   → isActive: true, isActivated: true
🔴 Revoked     → isActive: false
🟠 Expired     → expiresAt < now
```

### 6.3 Standard Workflow

```
1. Admin opens /licenses
2. Click "Generate Keys"
3. Fill label ("Block 14 Room 202"), count (1), expiry (optional)
4. Keys created → appear in table as "Available"
5. Copy the key (EDUC-XXXX-XXXX-XXXX)
6. Give key to technician via WhatsApp/email
7. Technician installs APK/EXE on device, enters key in setup form
8. Device registers → key turns "Activated" in admin portal
9. Admin can see which device/room the key is bound to
```

---

## 7. Common Flows (Step by Step)

### Flow A: New Classroom Setup (Android)

```
Admin:
  1. Go to /licenses → Generate Keys (label: "Block 14 Room 202")
  2. Copy key: EDUC-K7MN-QR4P-W2YZ
  3. Share with technician

Technician:
  4. Install EduCampus-Recorder.apk on Smart TV (sideload)
  5. Open app → permission dialogs → allow all
  6. Setup form appears:
     Backend URL: https://phisical-class.onrender.com/api
     Campus: KIIT Campus
     Block: Block 14
     Floor: 2nd Floor
     Room Number: 202
     License Key: EDUC-K7MN-QR4P-W2YZ
  7. Tap "Complete Setup"
  8. Screen capture permission dialog → allow
  9. App disappears, notification shows in status bar
  10. Done ✅

Admin (verify):
  11. Go to /licenses → key shows "Activated" with device MAC
  12. Go to /facility → room appears → device online
```

### Flow B: New Classroom Setup (Windows)

```
Admin:
  1. Generate fresh license key

Developer:
  2. On a Windows machine: cd classroom-recorder-windows && build.bat
  3. Share dist/EduCampus-Recorder-Setup.exe (or Portable.exe)

Technician:
  4. Run EduCampus-Recorder-Setup.exe on classroom PC → install
  5. App opens setup window:
     Backend URL: https://phisical-class.onrender.com/api
     Campus: KIIT Campus
     Block: Block 14
     Floor: 2nd Floor
     Room Number: 202
     License Key: EDUC-XXXX-XXXX-XXXX
  6. Click "Complete Setup →"
  7. Success screen shows for 2 seconds
  8. Tray icon appears 🎬 in system tray
  9. Done ✅ — starts automatically on next Windows boot

Admin (verify):
  10. License shows "Activated" in portal
```

### Flow C: Device Replacement (Same Room)

```
Old device died, new device needs same room.

Admin:
  1. Go to /licenses
  2. Find the activated key for that room
  3. Click "Reset" button → confirm
  4. Key goes back to "Available" state

Technician:
  5. Install APK/EXE on new device
  6. Enter SAME key during setup
  7. New device registers successfully
  8. License re-activates with new device's MAC

Note: If the old device ever comes back online and tries to heartbeat,
its authToken is still valid but it won't be able to re-register
(its MAC doesn't match the new binding — but heartbeats still work
since heartbeat uses deviceId+authToken, not the license key).
```

### Flow D: App Reset on Same Device (Re-registration)

```
Technician resets the app (tray → "Reset Setup")
  → store.clear() wipes config
  → App shows setup form again

When technician enters the SAME license key again:
  → Backend finds existing device by macAddress
  → isReRegistration = true → skips license check entirely
  → Updates device info, returns new authToken
  → Works fine ✅

When technician enters a DIFFERENT license key:
  → New key is validated normally
  → Old key remains "Activated" (not unbound automatically)
  → Admin should reset the old key manually if needed
```

---

## 8. Troubleshooting

### "Invalid license key" (404)

- Key doesn't exist → re-check for typos (EDUC-XXXX-XXXX-XXXX format)
- Key was revoked → admin must generate a new key
- Key is not uppercase → setup form auto-uppercases, but verify

### "License key already activated on another device" (409)

- Someone else used this key → admin needs to either:
  - Reset the license (unbind from old device) via admin portal
  - Generate a new key for this device

### "License key has expired" (403)

- Admin set an expiry date and it passed
- Admin needs to generate a new key with a later (or no) expiry

### "License key is required to register a new device" (403)

- Setup form was submitted without the license key field filled
- Or old APK/code that doesn't send `licenseKey` in payload
- Make sure app is latest version

### Windows EXE — tray icon not appearing

- Check Task Manager → EduCampus Recorder should be running
- If crash → open DevTools: main.js add `setupWindow.webContents.openDevTools()`
- electron-store permission issue → delete `%APPDATA%/educampus-recorder/`

### Android APK — app not auto-starting on boot

- Device has battery optimization enabled → disable for EduCampus app
- Check: Settings → Apps → EduCampus → Battery → Unrestricted

### Heartbeat failing / device shows offline in portal

- Backend URL changed → reset setup → re-enter correct URL
- JWT token expired → reset setup → re-register (same MAC = no new license needed)
- Backend is cold-starting (Render free tier) → wait 60s, it will retry

### Recording not starting for scheduled class

- Check room number exactly matches admin portal (case-sensitive)
- Class must be scheduled for today's date in the system
- Device must be online (heartbeat must be working)
- Class start time must be in the future (±1 minute tolerance)

---

## 9. File Map — Quick Reference

### Backend

| File | Purpose |
|------|---------|
| `backend/models/License.js` | Mongoose schema for license keys |
| `backend/routes/licenses.js` | 5 REST endpoints for license management |
| `backend/controllers/classroomRecordingController.js` | `registerDevice` — license validation + device creation |
| `backend/index.js` | `app.use("/api/licenses", ...)` mounted here |

### Admin Portal

| File | Purpose |
|------|---------|
| `admin-portal/src/pages/Licenses.jsx` | Full license management UI |
| `admin-portal/src/App.jsx` | Route: `/licenses → <Licenses />` |
| `admin-portal/src/components/Layout.jsx` | Nav item: "Licenses" with KeyRound icon |

### Android APK

| File | Purpose |
|------|---------|
| `classroom-recorder-android/app/src/main/res/layout/activity_setup.xml` | Setup form UI (includes `etLicenseKey` field) |
| `classroom-recorder-android/app/src/main/java/.../ui/setup/SetupActivity.kt` | Reads licenseKey, validates, sends in registerDevice payload |
| `classroom-recorder-android/app/src/main/java/.../data/local/PreferencesManager.kt` | Encrypted local storage |
| `classroom-recorder-android/app/src/main/java/.../service/RecorderForegroundService.kt` | Main recording service |

### Windows EXE

| File | Purpose |
|------|---------|
| `classroom-recorder-windows/main.js` | Electron main — tray, windows, IPC handlers, auto-start |
| `classroom-recorder-windows/preload.js` | contextBridge — exposes electronAPI to renderer |
| `classroom-recorder-windows/renderer/setup.html` | Setup form (includes `#licenseKey` field) |
| `classroom-recorder-windows/renderer/status.html` | Tray click status window |
| `classroom-recorder-windows/renderer/recorder-worker.html` | Hidden MediaRecorder window |
| `classroom-recorder-windows/src/store.js` | electron-store encrypted config |
| `classroom-recorder-windows/src/api.js` | HTTP client (node-fetch) |
| `classroom-recorder-windows/src/recorder.js` | Recording state + segment upload logic |
| `classroom-recorder-windows/src/scheduler.js` | Heartbeat loop + schedule polling |
| `classroom-recorder-windows/package.json` | electron-builder NSIS + portable config |
| `classroom-recorder-windows/build.bat` | One-click build script for Windows |

---

## Android vs Windows — Side-by-Side Comparison

| Feature | Android APK | Windows EXE |
|---------|-------------|-------------|
| Single distributable file | ✅ `.apk` | ✅ `.exe` (installer or portable) |
| One-time setup | ✅ SetupActivity | ✅ setup.html window |
| License key required | ✅ | ✅ |
| MAC address for device identity | ✅ hardware MAC | ✅ `WIN-` prefix + derived ID |
| Encrypted local storage | ✅ EncryptedSharedPreferences (AES-256-GCM) | ✅ electron-store (AES encrypted) |
| Background service | ✅ ForegroundService | ✅ System Tray process |
| Auto-start on boot | ✅ BOOT_COMPLETED receiver | ✅ `setLoginItemSettings` |
| Screen recording | ✅ MediaProjection | ✅ desktopCapturer + getUserMedia |
| Audio recording | ✅ AudioRecord | ✅ getUserMedia (mic) |
| Segment format | WebM / MP4 (30s) | WebM (30s) |
| Heartbeat interval | 2 minutes | 30 seconds |
| Schedule check interval | 30 seconds | 60 seconds |
| Camera overlay | ✅ PiP overlay | ❌ (screen only) |
| QR overlay | ✅ | ❌ |
| End-user needs Node.js? | N/A | ❌ (bundled in exe) |
| Build platform | Any (Android Studio) | Windows only (NSIS) |
| Build output size | ~5–10 MB APK | ~120–150 MB EXE |

---

*This document covers the complete device recorder + license system as of April 2026.*  
*For deployment (Render/Vercel), see `DEPLOYMENT.md`.*  
*For DB seeding and user management, see `DEPLOYMENT.md` → Seeding section.*
