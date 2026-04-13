# LectureLens Recorder — Windows

Android APK ka Windows equivalent. Ek single `.exe` file — install karo, setup karo, bas.

## End User Experience (Classroom PC pe)

```
1. LectureLens-Recorder-Setup.exe download karo
2. Double-click → install ho jata hai
3. Setup screen khulta hai (sirf ek baar)
4. Enter karo:  Backend URL / Campus / Block / Floor / Room Number
5. "Complete Setup" → done
6. System tray mein icon aata hai 🎬
7. Automatically classes record hoti hain schedule ke hisaab se
8. Windows restart hone pe bhi auto-start hota hai
```

## Files

```
classroom-recorder-windows/
  main.js                    ← Electron main process (Android: RecorderForegroundService)
  preload.js                 ← Context bridge (Android: IPC between activities)
  src/
    store.js                 ← Encrypted config (Android: PreferencesManager)
    api.js                   ← Backend API client (Android: ApiService.kt)
    recorder.js              ← Recording logic (Android: MediaProjection)
    scheduler.js             ← Heartbeat + schedule polling
  renderer/
    setup.html               ← One-time setup UI (Android: SetupActivity)
    status.html              ← Status window (tray click pe)
    recorder-worker.html     ← Hidden MediaRecorder window
  assets/
    icon.ico                 ← App icon (generate with create-icon.js)
  build.bat                  ← Build script (Windows pe run karo)
  create-icon.js             ← Icon generator
```

## Build Kaise Karein (Developer Machine pe)

**Requirements:** Node.js 18+ installed on Windows

```bat
# Clone/copy this folder to a Windows machine, then:
build.bat

# Output:
# dist/LectureLens-Recorder-Setup.exe     ← Installer
# dist/LectureLens-Recorder-Portable.exe  ← No install needed
```

## Android APK vs Windows EXE Comparison

| Feature | Android APK | Windows EXE |
|---------|-------------|-------------|
| Single file | ✅ .apk | ✅ .exe |
| No extra install | ✅ | ✅ (Portable) / Installer |
| One-time setup | ✅ SetupActivity | ✅ setup.html |
| Auto-start on boot | ✅ BOOT_COMPLETED | ✅ setLoginItemSettings |
| Background service | ✅ ForegroundService | ✅ System Tray |
| Heartbeat | ✅ every 30s | ✅ every 30s |
| Auto-record on schedule | ✅ | ✅ |
| Screen recording | ✅ MediaProjection | ✅ desktopCapturer |
| Segment upload | ✅ | ✅ |

## Setup Fields (Same as Android)

| Field | Example | Required |
|-------|---------|----------|
| Backend URL | https://phisical-class.onrender.com/api | ✅ |
| Campus | KIIT Campus | ✅ |
| Block | Block 14 | ✅ |
| Floor | 2nd Floor | Optional |
| Room Number | 202 | ✅ (must match admin portal) |
| Display Name | Smart Class Room 1 | Optional |

## Tech Stack

- **Electron** — cross-platform desktop app framework
- **electron-store** — encrypted local storage (like Android SharedPreferences)
- **MediaRecorder API** — screen capture (like Android MediaProjection)
- **electron-builder** — packages into single .exe

## Reset Setup

Right-click tray icon → "Reset Setup" → app restarts with fresh setup screen.
