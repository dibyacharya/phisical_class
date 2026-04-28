# LectureLens Recording — State Machine & Lifecycle

The single source of truth for what camera, screen and mic do at every moment.
If reality on a TV doesn't match this document, the TV is broken.

## Concepts (canonical names — used everywhere)

| Concept | Field name | Where it lives | Values |
|---|---|---|---|
| Is the TV's process alive | `device.isOnline` | Backend (computed: lastHeartbeat < 5min) | true / false |
| Is recording in progress (TV-side ground truth) | `health.recording.isRecording` | TV heartbeat → backend | true / false |
| Pipeline currently running | `health.recording.videoPipeline` | TV heartbeat | "livekit" / "none" |
| LiveKit Room state | `health.recording.livekitConnectionState` | TV heartbeat | "DISCONNECTED" / "CONNECTING" / "CONNECTED" / "RECONNECTING" |
| USB camera detected at hardware level | `health.camera.ok` | TV heartbeat (from `checkCamera()`) | true / false |
| USB camera name | `health.camera.name` | TV heartbeat | string |
| USB mic detected at hardware level | `health.mic.ok` | TV heartbeat (from `checkMic()`) | true / false |
| USB mic name | `health.mic.name` | TV heartbeat | string |
| USB mic actually bound to WebRTC | `health.recording.usbMicBoundOk` | TV heartbeat | true / false |
| Live audio amplitude (during recording) | `health.recording.audioLevelDb` | TV heartbeat | dB number |
| AutoInstall accessibility service ready | `health.recording.accessibilityEnabled` | TV heartbeat | true / false |
| Last failure cause | `health.recording.lastError` | TV heartbeat | string ("" if none) |
| App version | `device.appVersionName` / `device.appVersionCode` | Backend | string / number |

## Hardware ownership map

Each USB peripheral has exactly ONE owner at any moment. The owner is the
process that has opened the kernel-level handle on the USB device endpoint.

### USB Lumens VC-TR1 (camera + mic combo device)

| State | Camera owner | Mic owner | Browser audio output |
|---|---|---|---|
| TV freshly booted, idle | TV system / no app | TV system / no app | TV speaker (normal) |
| LectureLens service alive, idle | TV system / no app | TV system / no app | TV speaker (normal) |
| Recording in progress | LiveKit Camera2Capturer (our process) | LiveKit WebRtcAudioRecord (our process) | **MUST stay TV speaker** (ours never grabs output) |
| Recording stopped, service still alive | TV system / no app | TV system / no app | TV speaker (normal) |

If reality on a TV deviates from this — e.g. camera shows "busy" in another
app while we're idle — we leaked something.

### MediaProjection (screen capture)

| State | Token holder |
|---|---|
| TV freshly booted, idle | none (no token exists) |
| LectureLens service alive, idle | none (we acquire on-demand only) |
| Recording in progress | LiveKit's internal MediaProjection (acquired via `LiveKitProjectionRequestActivity` + auto-tap) |
| Recording stopped | none (token invalidated by Android when `room.disconnect()` runs) |

There is NO persistent screen-capture permission. Each recording acquires
its own token. Browser screen sharing is unaffected because Android grants a
separate token per requester.

## State transitions — happy path

### 1. TV cold boot → ready-to-record

```
[Off] → power on → [Booting]
        Android boot
        → BOOT_COMPLETED broadcast
        → BootReceiver fires
        → starts RecorderForegroundService
        → launches SetupActivity (anchor, see below)
        → SetupActivity sees setupComplete=true
        → moveTaskToBack(true) + finish()
        → service heartbeat thread starts
        → first heartbeat → backend marks online + offers OTA
        → schedule scan begins
        → [Idle, ready]
```

Hardware state during transition:
- Camera: not touched until a recording starts
- Mic: not touched until a recording starts
- Screen: TV displays whatever the user has on it (browser, HDMI, etc.)
- Audio: `AudioManager.mode` = `MODE_NORMAL`, no comm device override

End state observable from backend:
```
device.isOnline = true
device.appVersionName = "3.4.3-..."
health.camera.ok = true (if Lumens plugged in)
health.mic.ok = true (if Lumens plugged in)
health.recording.videoPipeline = "none"
health.recording.livekitConnectionState = "DISCONNECTED"
health.recording.isRecording = false
health.recording.audioLevelDb = -90 (no AudioRecord open)
health.recording.accessibilityEnabled = true
```

### 2. Idle → recording start

```
[Idle] → class start time hits in schedule scan
        → RecorderForegroundService.startRecording(meeting)
        → POST /api/classroom-recording/recordings/session
        → backend creates Recording doc + LiveKit room + Egress
        → backend returns LiveKit envelope (wsUrl, token, roomName)
        → service launches LiveKitProjectionRequestActivity (transparent)
        → AccessibilityService auto-taps "Start now" on consent dialog
        → consent granted, Intent passed back to service
        → service calls LiveKitPipeline.start(envelope, mpIntent)
        → pipeline:
            • detects USB mic, sets AudioManager.mode = MODE_IN_COMMUNICATION
            • setCommunicationDevice(usbMic) (Android 12+)
            • LiveKit.create() → Room.connect() (CONNECTING → CONNECTED)
            • setMicrophoneEnabled(true) → mic track published
            • setScreenShareEnabled(true, mpIntent) → screen track published
            • createVideoTrack(camera, deviceId='0') + publishVideoTrack → camera track published
            • bindUsbMicToLiveKit() → AudioRecord routed to USB mic
        → [Recording]
```

Hardware state during transition:
- Camera: opened by LiveKit Camera2Capturer (our process owns it)
- Mic: opened by LiveKit WebRtcAudioRecord (our process owns it)
- Screen: MediaProjection active, capturing TV display
- Audio mode: MODE_IN_COMMUNICATION

End state observable from backend:
```
device.isRecording = true
health.recording.isRecording = true
health.recording.videoPipeline = "livekit"
health.recording.livekitConnectionState = "CONNECTED"
health.recording.usbMicBoundOk = true (verify loop confirmed routedDevice)
health.recording.audioLevelDb > -50 (real audio flowing)
```

### 3. Recording → stop (class end / force-stop / class deleted)

```
[Recording] → end time hits OR force-stop OR class deleted
            → RecorderForegroundService.stopCurrentRecording()
            → liveKitPipeline.stop():
                • cameraTrack.stopCapture() — releases Camera2 device immediately
                • cameraTrack.dispose() — releases libwebrtc native resources
                • room.disconnect() — unpublishes mic + screen tracks
                • room.release() — releases JavaAudioDeviceModule + AudioRecord
                                  + MediaProjection-backed screen capturer
                • AudioManager.clearCommunicationDevice() — releases USB-mic comm route
                • AudioManager.mode = MODE_NORMAL — restores TV's default audio routing
                • scope.cancel() — cancels event-listener coroutine
            → liveKitPipeline = null
            → isRecording = false
            → backend webhook fires → recording doc marked completed
            → [Idle, ready for next class]
```

Hardware state during transition:
- Camera: released within ~50ms of stop()
- Mic: released within ~50ms of stop()
- Screen: MediaProjection token invalidated by Android
- Audio mode: MODE_NORMAL, comm device cleared

End state observable from backend (~5s after stop() returns):
```
device.isRecording = false
health.recording.isRecording = false
health.recording.videoPipeline = "none"
health.recording.livekitConnectionState = "DISCONNECTED"
health.recording.audioLevelDb = -90
```

**Browser audio + camera should work normally on the TV at this point.**
If they don't, the recording leaked.

### 4. Idle → recording 2 (back-to-back)

Identical to transition 2 (Idle → recording start). Each recording starts
from a clean slate:
- Fresh MediaProjection consent (no caching across recordings)
- Fresh LiveKit Room (each recording creates a new room)
- Fresh Camera2 + AudioRecord (LiveKit creates them per Room)

The state machine has no "warm" or "stale" intermediate state — every
recording is independent.

## State transitions — failure paths

### MediaProjection consent timeout (auto-tap fails)

```
[Idle] → start triggered
       → LiveKitProjectionRequestActivity dialog shown
       → AutoInstallService can't find / can't tap "Start now"
       → 15s timeout fires
       → activity sends RESULT_CANCELED back to service
       → pipeline.start() runs without screen track (mic + camera only)
       → [Recording — degraded]
```

Recovery: auto-tap usually works on retry. If it persistently fails, admin
needs to verify accessibility service is enabled in TV Settings.

### LiveKit Room never reaches CONNECTED

```
[Idle] → start triggered
       → r.connect() returns
       → state stays CONNECTING for >5s OR transitions to DISCONNECTED
       → pipeline.start() returns false
       → recordingLastError set ("Room state after connect: CONNECTING")
       → liveKitPipeline = null
       → isRecording = false
       → [Idle, with error in heartbeat]
```

Backend observation:
```
device.isRecording = false
health.recording.lastError = "LiveKit failed: Room state after connect: ..."
```

Recovery: TV will retry on the next class. Backend should also mark the
recording as failed (currently relies on Egress timeout).

### Network blip during recording

```
[Recording] → ICE disconnect detected by SDK
            → state transitions to RECONNECTING
            → SDK auto-reconnects within seconds
            → state returns to CONNECTED
            → tracks resume publishing
            → [Recording, no human action needed]
```

If reconnect fails permanently, the SDK transitions to DISCONNECTED.
RecorderForegroundService observes via the event collector and surfaces
the cause in `lastError`.

## Auto-recovery mechanisms

### Service-level

- `serviceScope` is a `SupervisorJob` — coroutine failures don't cancel
  sibling work.
- `installCrashHandler()` writes the stack trace to disk. Next process
  boot reads + uploads it as `lastCrashReport` in heartbeat.
- `runInitialHardwareCheck()` verifies USB peripherals on service start.
- `startHangMonitor()` — if the heartbeat thread hangs >120s, the
  monitor logs.

### Recording-level (v3.5.1+ long-duration watchdog)

Long classes (1-hour, 2-hour) face fundamentally different failure
modes than short tests. The new `armRecordingWatchdog()` runs every
60s for the lifetime of EACH recording, polling pipeline state:

| Watchdog observation | Action |
|---|---|
| `livekitConnectionState == "DISCONNECTED"` for ≥120s | **STOP recording cleanly** — LiveKit pipeline is dead, libwebrtc on the LG signage SoC doesn't always recover. Force-stop now so backend can mark the recording failed; admin sees actionable error rather than a silent bad MP4. |
| `audioLevelDb ≤ -80 dB` while LK still CONNECTED | Log warning. Do NOT force-stop — silent audio is recoverable, screen + camera tracks may still be valid. The recording is degraded but not broken. |
| Frame drops accumulating | Logged in heartbeat; admin can see degradation in real time. |

The watchdog is intentionally CONSERVATIVE — it never restarts the
pipeline mid-recording (that would lose all SFU + Egress state and
break the final MP4). It surfaces issues for admins and only
force-stops on hard pipeline death.

### Resource cleanup between recordings

Each recording is independent (transition 4 above). State leaks between
recordings — once endemic in v3.3.x — are now fixed:
- v3.4.2: audio mode + comm device released in `LiveKitPipeline.stop()`
- v3.4.3: cameraTrack.stopCapture() + dispose() in stop(); failed-track
  cleanup before fallback in start()'s catch.

If the user observes a recording starting in a bad state (silent audio,
frozen video, no camera), it indicates a regression in the state machine
and should be reported with TV logs immediately.

## Long-duration class lifecycle (v3.5.1+ verified)

For continuous 60-120 minute classes:

```
[Idle] → [Recording start (transition 2)]
       ↓
       [Recording — armRecordingWatchdog ticking every 60s]
       ↓
   ──── Watchdog detects pipeline death? ──── YES ─→ stopCurrentRecording()
   ↓                                                  ↓
   NO                                                 [Idle, recording marked failed]
   ↓
   [Class scheduled end time hits]
   ↓
   [Recording end (transition 3)]
   ↓
   [Idle, ready for next class]
```

**Key reliability properties**:

- **No timeout limit on recording duration.** LiveKit publisher tokens
  are 4-hour TTL; recordings up to 4h work without re-auth. Beyond that
  the SDK auto-refreshes silently.
- **Heartbeat never breaks during recording.** `heartbeat()` runs on
  its own coroutine on `serviceScope`; a stuck pipeline doesn't block
  the heartbeat thread.
- **Memory does not accumulate.** Each frame is published to libwebrtc
  via direct pointer; no Kotlin/Java buffering layer. The audio
  amplitude logger keeps a 5-second peak (constant memory).
- **Disk does not fill up.** No segments written to disk in LiveKit
  mode — every byte goes via WebRTC straight to LiveKit Egress.
  TVs only retain a small log buffer + the OTA APK download cache.
- **Resource cleanup on stop is deterministic.** v3.4.2 + v3.4.3 fixes
  guarantee the camera, mic, and audio routing are all released within
  ~50ms of `stopCurrentRecording()` returning. Browser regains
  hardware access immediately after recording ends.

## Watch Live (admin browser preview during recording)

While a recording is in progress, an admin can subscribe to the same
LiveKit room as a viewer — the page renders the TV's tracks live.

```
admin browser → LiveKit room (same room as Egress) → subscribes to TV's 3 tracks
              → renders screen + camera tiles in 2-up grid
              → plays audio
```

Watch Live is independent of Egress — it can succeed even if Egress
fails (and vice-versa). If Watch Live shows nothing while Egress is
producing a valid MP4, it's a frontend subscription bug, not a
recording failure.

## Variable naming reference (canonical → frontend display)

| Concept | TV heartbeat | Backend schema | Frontend reads | UI label |
|---|---|---|---|---|
| Pipeline running | `videoPipeline` | `health.recording.videoPipeline` | `recHealth.videoPipeline` | "LiveKit" / "Idle" / "Failed" |
| LiveKit Room state | `livekitConnectionState` | `health.recording.livekitConnectionState` | `rec.livekitConnectionState` | (chip color) |
| USB camera detected | `health.camera.ok` (from `checkCamera()`) | `health.camera.ok` | `cameraInfo.ok` | ✅ / ❌ |
| USB mic detected | `health.mic.ok` (from `checkMic()`) | `health.mic.ok` | `micInfo.ok` | ✅ / ❌ |
| Mic bound to WebRTC | `usbMicBoundOk` | `health.recording.usbMicBoundOk` | `recHealth.usbMicBoundOk` | (advanced view only) |
| Audio level live | `audioLevelDb` | `health.recording.audioLevelDb` | `recHealth.audioLevelDb` | dB number |
| Last error | `lastError` | `health.recording.lastError` | `recHealth.lastError` | red banner |
| Camera/mic name | `health.camera.name` / `health.mic.name` | same | `health.camera.name` / `health.mic.name` | tooltip |

The TV's `currentMicLabel` (in v3.3.33+) is sourced from `checkMic().name`
so `recording.micLabel` and `mic.name` always match. There is no other
canonical mic-label field.

## Observability checklist

To verify a TV is in the right state at any moment:

```bash
TOKEN=$(cat /tmp/ll_token)
curl -sS "https://lecturelens-api.draisol.com/api/classroom-recording/devices" \
  -H "Authorization: Bearer $TOKEN" | python3 -c "
import sys, json, datetime
devs = json.load(sys.stdin)
now = datetime.datetime.now(datetime.timezone.utc)
for d in devs:
    if d.get('roomNumber') != '<ROOM>': continue
    age = int((now - datetime.datetime.fromisoformat(d['lastHeartbeat'].replace('Z','+00:00'))).total_seconds())
    h = d.get('health') or {}; rec = h.get('recording') or {}
    print(f\"{d.get('appVersionName')} hb={age}s isRec={d.get('isRecording')}\")
    print(f\"  camera.ok={h.get('camera',{}).get('ok')} ({h.get('camera',{}).get('name')})\")
    print(f\"  mic.ok={h.get('mic',{}).get('ok')} ({h.get('mic',{}).get('name')})\")
    print(f\"  pipeline={rec.get('videoPipeline')} livekit={rec.get('livekitConnectionState')}\")
    print(f\"  usbMicBoundOk={rec.get('usbMicBoundOk')} audioLevelDb={rec.get('audioLevelDb')}\")
    print(f\"  lastError={rec.get('lastError')!r}\")
"
```

Run this between every state transition to confirm reality matches expected.
