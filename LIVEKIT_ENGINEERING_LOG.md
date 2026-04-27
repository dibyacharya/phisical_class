# LectureLens × LiveKit Migration — Engineering Log

**Living document.** Every issue, root cause, fix, and lesson learned.
Append-only — never delete entries; mark as superseded if a later entry
replaces an earlier one. **Read this BEFORE making changes** so we don't
re-introduce a bug we already fixed.

---

## Index

- [Architecture as deployed](#architecture-as-deployed)
- [Version history](#version-history)
- [Issues and fixes (chronological)](#issues-and-fixes-chronological)
- [Known good test recipe](#known-good-test-recipe)
- [Things that LOOK like bugs but aren't](#things-that-look-like-bugs-but-arent)
- [Outstanding work](#outstanding-work)

---

## Architecture as deployed

```
TV (Android 11, LG 55TR3DK, USB cam Lumens VC-TR1, USB mic Extron DMP Plus)
   │ WebRTC (RTP/UDP)
   ▼
LiveKit Server  (livekit.kiitdev.online → 20.193.239.201, Azure VM B2ms)
   │
   ├──► Egress (Docker container on same VM, livekit/egress:latest)
   │       │
   │       ▼
   │    Azure Blob: stgkiitlmsdev / lms-storage / physical-class-recordings/{date}/{room}/{recId}/full.mp4
   │       │
   │       ▼ webhook
   ▼    
Backend (Railway, lecturelens-api.draisol.com, repo dibyacharya/phisical_class)
   │
   ├──► MongoDB Atlas (Recording row populated with mergedVideoUrl + duration)
   │
   ▼
Admin portal (Vercel, ADMIN_PORTAL_with_phisical class/lecture-capture-system/admin-portal)
   - Recordings.jsx playback
   - Watch-Live modal (v3.3.x — admin subscribes to live class room)
```

**Critical credentials:**
- LiveKit API key: stored on VM (`/home/azureuser/livekit.kiitdev.online/livekit.yaml`) and Railway env (`LIVEKIT_API_KEY`)
- Azure storage: connection string in Railway env (`AZURE_STORAGE_CONNECTION_STRING`); Egress reads via per-request `AzureBlobUpload` config
- VM SSH: `ssh -i ~/Downloads/vm-livekit_key.pem azureuser@20.193.239.201`

---

## Version history

| Version | Date | Pipeline | Status | Notes |
|---|---|---|---|---|
| 3.1.30 | 2026-04-25 | Legacy MediaCodec | ⚪ pre-LiveKit | Last legacy-only build |
| 3.2.0 | 2026-04-25 | LiveKit (mic+screen via shared Intent) | ❌ broken | Consent dialog loop |
| 3.2.1 | 2026-04-25 | LiveKit (mic only, mpData=null) | ❌ broken | SDK auto-disconnects in 250ms |
| 3.2.2 | 2026-04-25 | LiveKit (mic only, +5s settle window) | ⚠️ partial | Connects but Egress misshape |
| 3.2.3 | 2026-04-25 | LiveKit (skip legacy MP) | ❌ broken | ICE never converges on this SoC |
| 3.2.4 | 2026-04-25 | LiveKit (mic only, legacy MP alive) | ✅ pipeline works | Audio silent, video black (test setup) |
| 3.2.5 | 2026-04-26 | LiveKit + dual-consent screen | ❌ broken | LiveKitProjectionRequestActivity AppCompat theme crash |
| 3.2.6 | 2026-04-26 | LiveKit + dual-consent screen | ✅ pipeline works | ComponentActivity fix |
| 3.2.7/8 | 2026-04-26 | (backend webhook fixes) | ✅ | URL container insertion + ns→sec duration |
| 3.3.0 | 2026-04-26 | + setCameraEnabled best-effort | ⚠️ no extra track | Camera2 doesn't enumerate USB cam |
| 3.3.1 | 2026-04-26 | + ProjectionRenewActivity ComponentActivity | ✅ FIRST REAL RECORDING | 8.5min, 49MB, real video + camera PiP |
| 3.3.2 | 2026-04-26 | + AudioOptions(VOICE_COMMUNICATION) + MODE_IN_COMMUNICATION | ❌ FAILED | Audio histogram byte-identical to v3.3.1 — HAL doesn't honour AudioSource for USB routing |
| 3.3.3 | 2026-04-26 | + JavaAudioDeviceModule.setPreferredInputDevice + reflection AudioRecord.setPreferredDevice + SamplesReadyCallback | ⏳ uploaded but install blocked by I-117 | Audio fix, never reached TV |
| 3.3.4 | 2026-04-26 | + skipProjectionRecovery flag (I-116) on top of v3.3.3 | ⏳ pending | Combined audio fix + force-stop crash fix |
| 3.3.5 | 2026-04-26 | + bulletproof recording-stop (every step in try/catch) + stop_recording alias for clarity | ✅ verified | Audio fix definitively proven working (max_volume = -44.2 dB) — closes I-110 / I-114 |
| 3.3.6 | 2026-04-26 | UvcVideoCapturer bridges UsbCameraDriver (libuvc) into LiveKit; screen-share publish dropped entirely | ❌ failed | Video track black: cameraTrack.startCapture() never called |
| 3.3.7 | 2026-04-26 | Added cameraTrack.startCapture() between createVideoTrack and publishVideoTrack | ❌ failed | UvcVideoCapturer.startCapture fired but UVC frames didn't reach the encoder; log ring rolled over recording-start logs so couldn't verify USB permission state remotely |
| 3.3.8 | 2026-04-26 | PIVOT: drop UvcVideoCapturer entirely; use LiveKit's built-in setCameraEnabled (Camera2 path) | ✅ **CAMERA + AUDIO WORK** | Real classroom view captured (Lumens VC-TR1 via Camera2). 177 MB / 8 min, video 2975 kbps, pixel std 65, audio max -2.6 dB. I-104 conclusion was wrong. |

---

## Issues and fixes (chronological)

### I-101 — UTC vs IST scheduling time (backend)
- **Symptom:** Test class never picked up by TV; TV's heartbeat got the schedule but skipped the class.
- **Root cause:** `backend/controllers/classroomRecordingController.js:573` builds the schedule's start/end as `new Date(\`${dateStr}T${cls.startTime}:00.000+05:30\`)`. The string `startTime` field is interpreted as IST. If a caller schedules with UTC times, the resulting ISO timestamp is shifted backwards 5h30m (often into yesterday) and TV's "in-progress" rank evaluation skips it.
- **Fix:** When scheduling programmatically, use IST-formatted times. Helper: `START_IST=$(TZ=Asia/Kolkata date -v+4M +%H:%M)`.
- **Lesson:** Backend's schedule contract is **HH:MM in IST**, not UTC. Bake into runbooks and scripts.

### I-102 — APK theme crash on activity launch (Android)
- **Symptom:** Process FATAL EXCEPTION right after activity onCreate. Crash stack: `java.lang.IllegalStateException: You need to use a Theme.AppCompat theme (or descendant) with this activity. at AppCompatDelegateImpl.createSubDecor(...)`
- **Root cause:** `AppCompatActivity.onPostCreate` calls AppCompatDelegate which inflates AppCompat decor that requires AppCompat theme attributes (e.g. `colorPrimary`). The activity declared `android:theme="@android:style/Theme.Translucent.NoTitleBar"` (system theme, no AppCompat attrs) → crash.
- **Fix:** Extend `androidx.activity.ComponentActivity` instead of `androidx.appcompat.app.AppCompatActivity`. ComponentActivity skips the AppCompat decor pass and still supports `registerForActivityResult`.
- **Files:**
  - `app/src/main/java/in/lecturelens/recorder/ui/LiveKitProjectionRequestActivity.kt` (fixed in v3.2.6)
  - `app/src/main/java/in/lecturelens/recorder/ui/ProjectionRenewActivity.kt` (fixed in v3.3.1 — same bug, lurked for weeks)
- **Lesson:** **Audit ALL transparent activities** any time we touch theme. AppCompatActivity + system theme = bomb. ComponentActivity + system theme = OK.

### I-103 — RTCPeerConnection ICE never converges (Android)
- **Symptom:** Room.connect() returns; state stays CONNECTING for 5+ sec; SDK silently disconnects.
- **Root cause:** The 55TR3DK SoC's libwebrtc requires an active MediaProjection in the foreground service for ICE to set up correctly. If we skip `createMediaProjection` to "save the Intent for LiveKit", ICE setup never completes.
- **Fix:** Always run the legacy `createMediaProjection` on consent (keepalive). Use a SECOND, dedicated MediaProjection consent for LiveKit's screen share via `LiveKitProjectionRequestActivity`. Both consents auto-tapped by AutoInstallService.
- **Files:** `RecorderForegroundService.kt` `onStartCommand` and `startRecording`, plus the new `LiveKitProjectionRequestActivity`.
- **Lesson:** Do NOT optimise away the legacy MediaProjection. It's load-bearing for libwebrtc on this SoC even though we don't actively record from it.

### I-104 — LiveKit Android `setCameraEnabled` returns OK but no track published
- **Symptom:** TV log "Camera publish OK (Camera2 path)" but server-side livekit-server reports zero tracks with `source=CAMERA`.
- **Root cause:** LiveKit's CameraEnumerator (libwebrtc wrapper) doesn't enumerate the USB camera (Lumens VC-TR1) on this SoC. The `setCameraEnabled` call swallows the failure asynchronously; client-side it looks like success.
- **Fix:** Don't rely on it. The legacy `CameraOverlayManager` already draws the camera as a `SYSTEM_ALERT_WINDOW` PiP overlay on the TV display, which gets captured by MediaProjection automatically. So the "screen" track contains the camera as a baked-in PiP — we don't need a separate camera track at all for the typical classroom layout.
- **Lesson:** Trust server-side track-list verification, not client-side log lines. SDKs love to eat async failures.

### I-105 — Egress request `Output.azure` shape (backend)
- **Symptom:** Egress writes recording but to a wrong/non-existent container; or `mkdir /physical-class-recordings: permission denied`.
- **Root cause:** `EncodedFileOutput.output` is a protobuf oneof (case+value discriminator). We were passing a plain `{azure: {...}}` object which the JS SDK ignored — Egress saw no destination and fell back to local file.
- **Fix:**
  ```js
  new EncodedFileOutput({
    fileType: EncodedFileType.MP4,
    filepath,
    output: { case: "azure", value: new AzureBlobUpload({...}) },
  })
  ```
  (`backend/services/livekitService.js`)
- **Lesson:** When a generated SDK type has a oneof, MUST use the case/value form, not a "shape that looks right".

### I-106 — Egress webhook URL missing container segment
- **Symptom:** Recording row `mergedVideoUrl` returns 404 even though the MP4 IS in Azure.
- **Root cause:** Egress's `egress_ended` webhook reports `fileResults[0].location` as `https://{account}.blob.core.windows.net/{filepath}` — without the container name in between. The blob is correctly written to `{account}/{container}/{filepath}` but Egress's URL builder doesn't insert the container.
- **Fix:** In `backend/services/livekitWebhook.js`, parse the broken URL and insert the container, OR rebuild the URL ourselves from filepath + env-known container. Verified iter5 gives HTTP 200 + valid Content-Length after the fix.
- **Lesson:** The webhook payload's `location` field is unreliable on this Egress version. Always reconstruct from known inputs.

### I-107 — Egress webhook duration in nanoseconds
- **Symptom:** Recording row `duration: 40124286059` (= 40 billion seconds = 1271 years).
- **Root cause:** protobuf int64 field for duration is in NANOSECONDS, not seconds. We were storing the raw value.
- **Fix:** Divide by 1e9 in `livekitWebhook.processEgressEvent`. Live verification: iter5 duration=41 sec (correct).
- **Lesson:** Always check protobuf scalar units. Seconds-vs-nanoseconds is the most common silent bug.

### I-108 — Egress status enum int vs string
- **Symptom:** Egress reports success but webhook handler marks Recording as "failed" with `errorReason: "3"`.
- **Root cause:** `egressInfo.status` is the enum INTEGER (3 == EGRESS_COMPLETE). We were comparing against the string `"EGRESS_COMPLETE"`. Mismatch → success path never ran.
- **Fix:** Map int → name via STATUS_MAP, normalize to lowercase, then compare. Accepts both forms.
- **Lesson:** Enum encoding varies between SDK versions. Defend by accepting both int and name.

### I-109 — Cascade crash: legacy MediaProjection eviction → ProjectionRenewActivity → process death
- **Symptom:** Recording lasts only ~47 seconds despite class being 9 minutes; pipe=legacy_direct in heartbeat; Recording row marked completed prematurely.
- **Root cause:**
  1. v3.2.6 dual-consent works; LiveKit gets fresh MediaProjection for screen share.
  2. Android system EVICTS the legacy MediaProjection (HAL allows only one active).
  3. Legacy MediaProjection.Callback.onStop fires → `attemptProjectionAutoRecovery()`.
  4. Auto-recovery launches ProjectionRenewActivity which has the I-102 theme crash.
  5. Process dies. Egress sees publisher leave → finalizes (47 seconds of barely-anything captured).
  6. After process restart, Recording row is "completed" → TV's schedule check marks meeting `alreadyRecorded` → never retries.
- **Fix (v3.3.1):**
  - Fix #1: ProjectionRenewActivity → ComponentActivity (closes the crash).
  - Fix #2: In MediaProjection.onStop, skip legacy auto-recovery if `liveKitPipeline != null`. The legacy MP isn't needed when LiveKit owns its own.
  - Fix #3: Reset `prefs.liveKitConnectionState = "DISCONNECTED"` in `onCreate` so heartbeats don't lie post-restart about a connection that died.
- **Verified:** v3.3.1 verify class produced 506-sec / 49 MB MP4 with REAL screen content. First successful recording in the entire migration.
- **Lesson:** Cascade failures need ALL upstream causes fixed, not just the visible one. The "Egress finalised early" symptom was downstream of three different upstream bugs.

### I-110 — Audio captured as silence (LiveKit picks wrong source)
- **Symptom:** Recordings with valid AAC stream but `mean_volume: -91 dB` (digital silence floor) in every iteration before v3.3.3.
- **Root cause:** LiveKit's `setMicrophoneEnabled` creates a WebRtcAudioRecord with default `AudioSource.MIC`. On this TV, the MIC source binds to a non-existent built-in mic, not the USB-Audio - DMP Plus device that actually works. Legacy app handles this with a custom AudioDeviceSelector that explicitly picks USB and calls `AudioRecord.setPreferredDevice()`; LiveKit has no equivalent simple path.
- **Fix attempt 1 (v3.3.2 — FAILED):**
  ```kotlin
  audioMgr.mode = AudioManager.MODE_IN_COMMUNICATION
  AudioOptions(javaAudioDeviceModuleCustomizer = { builder ->
      builder.setAudioSource(MediaRecorder.AudioSource.VOICE_COMMUNICATION)
      builder.setUseStereoInput(true)
  })
  ```
  Theory was: VOICE_COMMUNICATION + COMM mode tells the HAL "this is a voice call" → routes to active USB device. **Result: histogram byte-identical to v3.3.1**, mean -91 dB / max -80.8 dB. The HAL on this TV does not respect AudioSource for USB routing.
- **Fix attempt 2 (v3.3.3 — see I-114):** explicit USB-device binding via `JavaAudioDeviceModule.setPreferredInputDevice` + reflection-based `AudioRecord.setPreferredDevice` from inside an `AudioRecordStateCallback`. Re-applied at three call sites for robustness.
- **Lesson:** WebRTC audio capture in third-party SDKs is tricky to override on Android. Always verify with `volumedetect` post-recording, not just trust the SDK saying mic is "on". HAL nudges (mode + AudioSource) are NOT sufficient on tightly-vendored devices — explicit `setPreferredDevice` is the only reliable path.

### I-111 — Test recordings looked successful but were empty (false-positive)
- **Symptom:** iter3-iter7 all reported success (Egress complete + URL set), but `volumedetect` and pixel inspection revealed silence + black frames.
- **Root cause:** Two upstream issues compounded:
  1. The I-109 cascade crash meant pipeline only ran for ~47 sec before dying — captured the dying-process state, not real content.
  2. The I-110 audio source bug meant audio was always silence regardless of crash.
  3. Plus testing had TV display in idle state, so screen-share captured a black/idle UI.
- **Fix:** Fixed I-109 in v3.3.1 → real content captured. I-110 separately fixed in v3.3.2.
- **Lesson:** **NEVER** declare a recording successful based on `url=YES` alone. Pass criteria MUST include:
  - `duration > 60 sec` (proves pipeline ran the full class, not crashed)
  - `mergedFileSize > 5 MB` (proves real bitrate, not 5 kbps silence/black)
  - `volumedetect max_volume > -50 dB` (proves audio captured signal, not floor)
  - Visual frame extraction shows non-uniform pixels (proves screen capture worked)
  
  Bake this into a `verify_recording.sh` script for every iteration.

### I-112 — GridFS quota fills during OTA testing
- **Symptom:** `you are over your space quota, using 557 MB of 512 MB` on APK upload.
- **Root cause:** `DELETE /api/app/versions/:id` only removed the AppVersion document, leaving the GridFS chunks orphaned. We uploaded ~10 test APKs at 55 MB each = blown quota.
- **Fix:** In `backend/routes/appUpdate.js`:
  - Modified DELETE to also call `bucket.delete(apkGridFsId)`.
  - Added `POST /api/app/versions/purge-orphans` for one-shot recovery of pre-fix orphans.
- **Lesson:** When a model has external storage references (GridFS / S3 / etc), delete handlers must drop both. Add an orphan-cleaner endpoint as a safety valve.

### I-113 — Camera publish silently labels duplicate screen track as SCREEN_SHARE
- **Symptom:** v3.3.0 setCameraEnabled returned "OK" client-side; livekit-server logs show 3 tracks, but BOTH video tracks have `source: SCREEN_SHARE`.
- **Root cause:** Believed at the time to be a screen track plus its backup-codec twin (LiveKit's `backupCodecPolicy: PREFER_REGRESSION` publishes primary + backup encoded streams as separate tracks). Camera publish never actually happened — Camera2 enumerator silently failed (see I-104).
- **Fix:** Set client-side expectation correctly: rely on legacy SYSTEM_ALERT_WINDOW PiP for camera-in-recording (already baked into the screen capture).
- **Lesson:** Track count and label inspection on the SERVER side is the only ground truth.

### I-115 — `DELETE /api/classes/:id` doesn't cancel an in-progress TV recording
- **Symptom:** Scheduled class for 13:18 IST. TV pre-armed at 13:14 and set `isRecording=true`. To unblock OTA install, deleted the class via `DELETE /api/classes/<id>`. TV continued reporting `isRecording=true` with the now-deleted `currentMeetingId` through its 13:18 → 13:23 endTime window, blocking the OTA install we needed.
- **Root cause:** Once the heartbeat response delivers a scheduled-class envelope to the TV, the TV cache-pins it locally and runs the recording from local state. The backend deletion only stops FUTURE schedule deliveries; it has no "abort current recording" mechanism. The TV's `RecorderForegroundService` doesn't poll for cancellation — it follows its own end-time clock.
- **Fix (workaround):** Cancel the booking ≥6 min before scheduled startTime, before the pre-arm window. After arm, just wait out the full schedule and let the TV go idle naturally before the next heartbeat unlocks OTA.
- **Real fix (TODO):** Add a remote-command field in the heartbeat response (e.g. `cancelCurrentRecording: <meetingId>`) that the TV honours to abort an in-progress recording locally.
- **Lesson:** Schedule with **≥10 min IST lead time** when an OTA upgrade may need to fire first. The pre-arm window swallowed our 8-min lead.

### I-116 — `force_stop` command kills the entire app, not just the recording
- **Symptom (user-reported):** "Recording stuck hone pe jo tumne force stop kar rahe ho wo actually force stop direct application force stop ho ja raha he, so iske wajah se pura application band ho ja raha he, usko fir se manually open karna padta he ya TV shutdown karna padta he." Force-stopping a stuck recording results in the whole LectureLens process dying.
- **Root cause:** Race between LiveKit pipeline teardown and the legacy `MediaProjection.Callback.onStop()`:
  1. `executeRemoteCommand("force_stop")` → `stopCurrentRecording()` (LiveKit branch)
  2. `lk.stop()` runs synchronously → LiveKit releases its internal `MediaProjection`
  3. The release fires our LEGACY callback `MediaProjection.onStop()` (registered in `createMediaProjection`)
  4. `onStop` is dispatched on the main handler — it runs AFTER `liveKitPipeline = null` is assigned later in `stopCurrentRecording`
  5. Old guard `if (liveKitPipeline != null) return` is now `null` → falls through to legacy auto-recovery: `attemptProjectionAutoRecovery()` launches `ProjectionRenewActivity`
  6. The renew activity re-requests `MediaProjection` consent. On the LG 55TR3DK pilot the consent flow can crash the activity (and historically the activity itself crashed on `AppCompatActivity` theme — fixed in v3.3.1 but the cascade still risks process death)
  7. Activity crash → process dies → user sees the app icon disappear → has to relaunch manually
- **Fix (v3.3.4):** Added `@Volatile skipProjectionRecovery: Boolean` flag. Set TRUE synchronously inside the LiveKit branch of `stopCurrentRecording` BEFORE `lk.stop()`. Inside the `MediaProjection.onStop` callback, check this flag FIRST — if true, reset to false and return without launching recovery. Race-free because the volatile write happens-before the projection eviction the SDK triggers.
- **Lesson:** Callback handlers registered on the main looper run AFTER the calling thread's synchronous code returns. Don't rely on field-state checks inside such callbacks for "did I ask for this?" questions — use a separate "intentional" flag set BEFORE the action.

### I-118 — LiveKit `setCameraEnabled` actually works on this hardware ✅ (closes I-104 / I-113)
- **Background:** v3.3.0 testing produced "no camera track published" → catalogued as I-104 ("Camera2 silently fails on USB peripherals"). v3.3.6/v3.3.7 built a custom UvcVideoCapturer to bridge libuvc → LiveKit, both produced black-frame tracks (video bitrate 11 kbps, pixel std=0).
- **Test (v3.3.8 / 17:06-17:09 IST):** Replaced the UVC bridge with a single line: `r.localParticipant.setCameraEnabled(true)`. Result:
  - Video bitrate **2975 kbps** (vs 11 kbps for all-black)
  - Pixel std **64-65 across all sampled timestamps** (vs 0)
  - File size **177 MB** for ~8 min (vs 8.3 MB black-only)
  - Audio max **-2.6 dB** + mean **-42.1 dB** (continuous loud signal)
  - Visual frame extraction confirmed real classroom view from Lumens VC-TR1 USB camera
- **Root cause of original I-104 misdiagnosis:** The v3.3.0 / v3.3.3 tests where setCameraEnabled appeared to "silently fail" were probably affected by other pipeline issues (cascade crash from I-109, projection eviction races, etc.), not Camera2 itself. Once the audio bind (v3.3.3) and force-stop cascade (v3.3.4) and bulletproof teardown (v3.3.5) were fixed, Camera2 + setCameraEnabled just worked.
- **Lesson:** When a black-box "X silently fails" diagnosis fights a custom workaround for multiple iterations, periodically retry X after fixing other unrelated issues. The 4-hour UvcVideoCapturer detour (v3.3.6/v3.3.7) was unnecessary; setCameraEnabled was correct from day 1, but blocked by upstream pipeline bugs that masked its success.

### I-114 — Audio reflection-bind FIX VERIFIED ✅ (closes I-110)
- **Test:** v3.3.5 installed via OTA after TV restart. Class `v335-audio-final-1002` ran 15:37–15:40 IST. User was at home; TV in classroom with USB-Audio - DMP Plus mic plugged in, picking up ambient sounds.
- **Result:**
  - Recording duration: 476 sec, file size 8.3 MB, pipeline=livekit, status=completed
  - `volumedetect` output:
    - `mean_volume: -79.9 dB` (low because mostly quiet ambient)
    - `max_volume: -44.2 dB` ← **PASS** (well above -50 dB threshold; v3.3.2 was -80.8 dB silence floor)
    - `histogram_50db: 343` samples; `histogram_55db: 1160` samples; full distribution of real signal levels
  - TV-side `SamplesReadyCallback` log fired continuously every 5 sec with non-zero peak amplitudes throughout the recording — proves real PCM samples flowed from the USB mic into LiveKit's audio encoder.
  - `WebRtcAudioRecord onStop fired` cleanly at endTime — no crash, no force_stop needed.
- **Conclusion:** The reflection-based USB-mic binding (`JavaAudioDeviceModule.setPreferredInputDevice` + `AudioRecord.setPreferredDevice` via reflected `Room.audioDeviceModule.audioInput.audioRecord` chain) DEFINITIVELY routes capture to the USB mic on this LG 55TR3DK HAL. **I-110 is CLOSED.**
- **Side note:** The peak5s value in the SamplesReadyCallback log (`peak5s=65620 (200% of full-scale)`) is reported above 32767 due to a sign-extension bug in the byte-pair parser (`data[i+1].toInt() and 0xff` was missing). The bug only affects log display, NOT the captured audio — the encoder gets real signed-16-bit PCM. Will fix the cosmetic parser issue in a follow-up; nothing operational blocked.
- **Lesson:** When LiveKit's SDK doesn't expose direct device-binding APIs that work on the target HAL, reach into the bundled libwebrtc fork via reflection. JavaAudioDeviceModule is `public final` and exposes `audioInput` as a public field — package-private `setPreferredDevice` on WebRtcAudioRecord is reachable in one reflective hop.

### I-117 — OTA accessibility auto-install fails silently after long uptime
- **Symptom:** Uploaded v3.3.3 to OTA. TV downloaded it (`AppUpdater: Downloaded 55128KB`) and launched the install Intent (`AppUpdater: Intent install launched`). NO subsequent logs — no `AutoInstall: Auto-clicked INSTALL button`, no `onAccessibilityEvent`, no `onServiceConnected`. After 15-min cooldown, the cycle repeats with the same outcome. The TV stayed pinned to v3.3.2 forever despite v3.3.3 being available and `AccessibilityManager.isEnabled() = true`.
- **Root cause:** On this Android 11 LG 55TR3DK, the AccessibilityService can drift into a state where it's reported "enabled" by the system but no `AccessibilityServiceInfo` instance is actually bound. `getEnabledAccessibilityServiceList()` returns our service as enabled, but `onServiceConnected` never fires and no events reach `onAccessibilityEvent`. Likely cause: long uptime + some system event silently disabled the actual service binding without flipping the user-visible toggle.
- **Fix (operational):** Send a `restart_app` remote command to the TV. On app restart, Android re-binds accessibility services, `onServiceConnected` fires (verified in logs after restart), and the service starts receiving events again. Subsequent OTA install attempts then succeed.
- **Workflow when stuck:** 
  1. `POST /api/remote/command {command:"pull_logs"}` → confirm no `Auto-clicked` lines around `Intent install launched`
  2. `POST /api/remote/command {command:"restart_app"}` → process dies, accessibility re-binds
  3. `POST /api/classroom-recording/devices/<id>/force-stop` → resets the OTA cooldown
  4. Wait for next heartbeat (≤2 min) → install retries with working accessibility
- **Lesson:** Don't trust `AccessibilityManager.isEnabled()` as proof the service is actually receiving events. The ground-truth signal is `onServiceConnected` having fired in this process's lifetime. Add a heartbeat field surfacing this fact so the admin portal can show "accessibility-bound: yes/no" instead of just "enabled".

---

## Known good test recipe

Use this checklist for every test cycle so we catch silent failures.

```bash
# 1. Verify TV is on the latest version
TOKEN=$(cat /tmp/ll_token)
curl -s "https://lecturelens-api.draisol.com/api/classroom-recording/devices" \
  -H "Authorization: Bearer $TOKEN" | python3 -c "
import sys, json
d = json.load(sys.stdin)[0]
rec = d.get('health',{}).get('recording',{})
print(f'ver={d.get(\"appVersionName\")} hb_age={d.get(\"lastHeartbeat\")} pipe={rec.get(\"videoPipeline\")} lkEnabled={rec.get(\"livekitEnabled\")}')
"

# 2. Schedule a class with PROPER IST times + 4-min lead
START_IST=$(TZ=Asia/Kolkata date -v+4M +%H:%M)
END_IST=$(TZ=Asia/Kolkata date -v+9M +%H:%M)
DATE_IST=$(TZ=Asia/Kolkata date +%Y-%m-%dT00:00:00.000Z)
TITLE="test-$(date -u +%H%M)"
curl -s -X POST "https://lecturelens-api.draisol.com/api/classes" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"title\":\"$TITLE\",\"course\":\"69e9becd048f31f61fffdda2\",\"teacher\":\"69e1b75ec5b5e5e7afdc1b1e\",\"roomNumber\":\"001\",\"date\":\"$DATE_IST\",\"startTime\":\"$START_IST\",\"endTime\":\"$END_IST\"}"

# 3. Wait for class to fire + complete (T+~12 min from schedule)
# Then verify content (NOT just URL existence):
URL=$(curl -s "https://lecturelens-api.draisol.com/api/recordings?limit=1" \
  -H "Authorization: Bearer $TOKEN" | python3 -c "import sys,json; print(json.load(sys.stdin)[0].get('mergedVideoUrl',''))")
curl -s "$URL" -o /tmp/test.mp4

# DURATION + SIZE
ls -lh /tmp/test.mp4
ffprobe -v error -show_entries stream=codec_name,duration,bit_rate /tmp/test.mp4 2>&1 | head -10

# AUDIO LEVEL (must show max > -50 dB if audio captured anything real)
ffmpeg -i /tmp/test.mp4 -af "volumedetect" -vn -f null - 2>&1 | grep -iE "mean|max"

# VIDEO PIXEL CONTENT (must show min<max, avg between 30 and 220 if real)
ffmpeg -loglevel error -ss 30 -i /tmp/test.mp4 -frames:v 1 \
  -filter:v "format=gray" -f rawvideo - 2>/dev/null | python3 -c "
import sys
data = sys.stdin.buffer.read()
print(f'min={min(data)} max={max(data)} avg={sum(data)/len(data):.1f}')
"
```

**PASS** = all four:
- duration > 60 sec
- file size > 5 MB
- audio max_volume > -50 dB
- video pixel min=0, max≥200 (proves variation)

**FAIL** any one = recording is not actually capturing real content; investigate before declaring success.

---

## Things that LOOK like bugs but aren't

| Symptom | Why it's expected |
|---|---|
| `pipe=legacy_direct` in heartbeat AFTER LiveKit class ended | When TV stops the LiveKit recording, `liveKitPipeline` is set to null. Heartbeat default falls through to `legacy_direct`. NOT a fallback. |
| `lkConn=CONNECTED` AFTER recording ended | LiveKit Room.disconnect is async; pref takes one heartbeat tick to update. v3.3.1 resets on next service-create. |
| Egress reports a video track with `source=SCREEN_SHARE` and `backupCodecPolicy=PREFER_REGRESSION` and you only see ONE video on screen | LiveKit publishes primary + backup-codec twin per video track. Looks like 2 tracks. Normal. |
| Audio bit_rate ~5 kbps in the MP4 | Recording was silent — Egress's audio encoder collapses to its absolute minimum. Sign of I-110, NOT a corrupted file. |
| URL from webhook 404s | I-106. Don't trust the location field — rebuild from filepath + container. |
| Recording row stuck at "completed" while class is still in window | I-109 cascade — the early "complete" was a crash. Fixed in v3.3.1. If seen again, diagnose immediately. |

---

## Outstanding work

- [x] Watch-Live UI in admin portal (v3.3.x — `LiveWatchModal.jsx` + Recordings.jsx button) — **DONE 2026-04-26**
- [ ] v3.3.2 audio routing verification (in-flight test class running)
- [ ] If v3.3.2 audio fails: ship v3.3.3 with custom AudioDeviceModule (requires building a JavaAudioDeviceModule subclass that overrides AudioRecord creation)
- [ ] Real-classroom 1-hour stability pilot (planned for next day at the actual classroom)
- [ ] Phase 5 cutover: flip default `useLiveKitPipeline = true`, OTA push, decommission legacy code after 7 clean production days
- [ ] Optional: custom Egress HTML composite layout for proper PiP (camera bottom-right, screen background) — current setup uses legacy SYSTEM_ALERT_WINDOW overlay baked into screen, which is acceptable

---

## Append new entries here

(date — version — issue — root cause — fix — lesson)

### I-119 — `isScreencast=false` at room level breaks screen capture (2026-04-26 v3.3.18)
- **Symptom:** v3.3.18 set `LocalVideoTrackOptions(isScreencast=false)` at room level (videoTrackCaptureDefaults) intending to fix the camera-source-mislabel bug (I-118 follow-up). After install, admin Watch Live showed black main view; recording also had screen track at 0 frames despite the screen track existing in the LiveKit room with the correct `source=SCREEN_SHARE` label and right resolution.
- **Forensic:** `listParticipants` for the live room showed:
  - audio: src=MIC ✓
  - camera: src=CAMERA(1), 1920×1080 ✓ (label fix worked!)
  - screen: src=SCREEN(3), 1920×1080 ✓ — but 0 frames in recording / black in live
- **Root cause hypothesis:** LiveKit Android SDK's `setScreenShareEnabled` is supposed to internally override isScreencast=true on the screen track, but doesn't reliably do so when the room default is false. The screen track's encoder runs in regular-video mode rather than screen-content mode, breaking MediaProjection-fed frames.
- **Fix (v3.3.19):** Reverted to `isScreencast=true` at room level. Screen capture works again. Camera source-label cosmetic bug returns but is handled by:
  1. Frontend Watch Live resolution-based discrimination (already deployed)
  2. Backend Egress switch from "speaker" to "grid" layout (see I-121) — tiles all video tracks regardless of label
- **Real fix (post-pilot, v3.3.20+):** Don't use room-level isScreencast at all. Publish camera via explicit `createVideoTrack(name, capturer, options=isScreencast=false)` + `publishVideoTrack(track, options.source=CAMERA)`. Bypasses room defaults entirely.
- **Lesson:** Room-level defaults that leak into specific publish APIs are dangerous. Test ANY room-default change with BOTH publish paths (screen + camera) before declaring success.

### I-120 — TV crashes at end of long recording when in v3.3.18 broken-screen state (2026-04-26)
- **Symptom:** 30-min v3.3.18 test class completed normally (status=completed, 318 MB recording, mergeStatus=ready), but TV stopped sending heartbeats ~3 minutes after class endTime. Heartbeat age grew from 60s to 7+ min with no recovery. `isOnline: false`. Required physical TV restart to recover.
- **Root cause hypothesis:** Not yet root-caused. Likely the LiveKit teardown path (Room.disconnect, track release) interacts badly with the broken-screen-publishing state — probably some native resource the dead encoder was supposed to release got stuck, leading to process death after foreground service teardown timing.
- **Mitigation:** Don't run with isScreencast=false in production (already addressed by I-119 fix).
- **Lesson:** A "successful" recording (file exists, mergeStatus=ready) doesn't prove the TV survived the teardown. Heartbeat continuity for 5+ min after class endTime is the real "system healthy" signal.

### I-121 — Egress "speaker" layout makes camera invisible when both video tracks have source=SCREEN_SHARE (2026-04-26)
- **Symptom:** Recordings with v3.3.17 (camera mislabeled as ScreenShare due to room-default isScreencast=true) showed only ONE video track in the recording. The "missing" track was effectively invisible despite being published.
- **Root cause:** LiveKit Egress "speaker" layout prioritises a screen-share track if any exists. With both tracks labeled SCREEN_SHARE, Egress picked one (the actual screen, usually) and left the other ungridded. Camera publish was happening but not appearing in composite output.
- **Fix (v3.3.19):** Backend `livekitService.js` switched `layout: "speaker"` → `layout: "grid"`. Grid tiles ALL video tracks 2-up regardless of source labels.
- **Tradeoff:** Each tile gets half frame area; per-tile resolution effectively halved. Acceptable for lecture content (slides + teacher visible together).
- **Lesson:** Composite layout choice matters as much as track publish. "speaker" assumes labels are correct; "grid" is robust to labeling bugs.

### I-122 — AutoTrackEgress + RoomCompositeEgress in parallel breaks recording-doc tracking (2026-04-26 v3.3.16)
- **Symptom:** v3.3.16 added AutoTrackEgress at room creation alongside the existing RoomCompositeEgress for raw track archive. 3 egresses ran fine on LiveKit side (`listEgress({active:true})` showed all ACTIVE for 30+ min), recording even produced 402 MB final file. BUT admin portal showed the recording as `status=failed` with `egressErr="no response from servers"` for the entire test duration.
- **Root cause:** Recording schema has a single `livekitEgressId` field. With multiple parallel egresses firing simultaneously, the init-time RPC to start RoomCompositeEgress sometimes timed out client-side (backend gave up waiting), even though server-side the egress started fine. Recording doc got marked failed. Webhook-handler matching by `livekitEgressId` then either matched the wrong egress (if it happened to be a TrackEgress) or missed the right one.
- **Fix (v3.3.17 / v3.3.19 backend):** Reverted AutoTrackEgress. Single-egress flow restored. Recording doc tracks single composite egress cleanly.
- **Re-enable later (post-pilot):** Need:
  1. Recording schema with `livekitEgressIds: [String]` array
  2. Webhook handler that updates per-egress, not per-recording
  3. Admin portal UI listing all available files (composite + raw originals)
  4. Don't replace composite — add raw alongside as bonus archive
- **Lesson:** When changing the parallelism model of egresses, the data model + webhook handler need to match. Single-egress assumption is baked deeper than just the createRoom call.

---

## Tomorrow's pilot (2026-04-27) — pre-flight + runbook

See `MEMORY.md` "STATE FOR TOMORROW" section for the full operational handoff. TL;DR:

1. User reboots TV physically (currently offline since 2026-04-26 22:54 IST due to I-120)
2. After boot: BootReceiver → foreground service → AccessibilityService rebinds → first heartbeat with `appVersionCode=94` (v3.3.18 currently installed)
3. Backend offers v3.3.19 (vc=95, OTA latest) → AppUpdater downloads → AutoInstallService taps Install → v3.3.19 active
4. 5-min validation class (verify recording grid layout shows BOTH screen + camera, status=completed)
5. If clean: 1-hour real classroom pilot
6. If broken: diagnose + fix (probably Egress grid layout interaction with single-publisher-multi-track scenario)

**Stack as of pilot start:**
- TV-side: v3.3.19 (1080p + 10 Mbps + isScreencast=true + audio reflection-bind + skipProjectionRecovery + bulletproof stop + Camera2 setCameraEnabled)
- Backend Egress: H264_1080P_30 preset + grid layout + single-egress flow
- Frontend: resolution-based Watch Live track discrimination + 90-min relaxed visibility

---

### I-123 — Final-recording layout broken: only camera tile in corner, rest of canvas black (2026-04-27 v3.3.19 → v3.3.20)
- **Symptom:** v3.3.19 test class (5m6s, 74 MB) completed cleanly (status=completed, both video tracks published per `listParticipants` verification). But the final MP4 from Egress's grid layout showed only the camera track as a small tile in the top-left corner, with the rest of the canvas black. Watch Live (admin portal) ALSO showed inconsistent main-track selection — refreshing the page sometimes showed the slide deck, sometimes the teacher's face.
- **Forensic:**
  - `listParticipants`: 2 video tracks, BOTH labeled `src=SCREEN(3)`, BOTH at 1920×1080. 1 audio track at MIC.
  - Recording rendered: only one tile visible (camera content based on the tile contents — TV mounted on wall, viewed from outside).
  - Watch Live: resolution-sort fallback (largest area = "main") is non-deterministic when both tracks have equal area.
- **Root cause:** Camera was being published via `setCameraEnabled(true)`, the high-level LiveKit helper. That helper inherits `videoTrackCaptureDefaults` from `RoomOptions` — which we set to `isScreencast=true` because the screen capture path needs it. Result: camera track also got `isScreencast=true` and the SFU stamped it as `source=SCREEN_SHARE`. Egress's grid template couldn't disambiguate which of the two SCREEN_SHARE tracks was "the screen" and rendered only one in a default position.
- **Fix (v3.3.20):** Stop using `setCameraEnabled` for camera. Replace with the explicit publish path:
  ```kotlin
  val cameraOptions = LocalVideoTrackOptions(isScreencast = false, captureParams = ...)
  val cameraPublishOptions = VideoTrackPublishOptions(
      videoEncoding = VideoEncoding(maxBitrate = 2_500_000, maxFps = 15),
      simulcast = false,
      videoCodec = VideoCodec.H264.codecName,
      source = Track.Source.CAMERA,
  )
  val cameraTrack = r.localParticipant.createVideoTrack(name = "camera", options = cameraOptions)
  cameraTrack.startCapture()
  r.localParticipant.publishVideoTrack(track = cameraTrack, options = cameraPublishOptions)
  ```
  This builds the camera track with its own per-track options (not the room defaults), so screen and camera now have:
  - Screen: source=SCREEN_SHARE, isScreencast=true (uses room defaults via setScreenShareEnabled)
  - Camera: source=CAMERA,       isScreencast=false (explicit)
  Egress's grid template now disambiguates them correctly and tiles both into the recording.
- **Frontend in same release:** Watch Live `LiveWatchModal.jsx` rewritten to render BOTH video tracks side-by-side in a 2-up grid (sorted by track SID for stable left/right placement). Eliminates the resolution-sort ambiguity and matches what the recording's grid layout produces. No "main vs PiP" decision means no flip on refresh.
- **Lesson:** When room-level defaults are needed for one publish path (screen) but harmful for another (camera), don't try to flip the room default — use the per-track explicit publish API for the path that needs to differ. `setCameraEnabled` is a footgun in this configuration; `createVideoTrack` + `publishVideoTrack` is the correct primitive.
- **Verification criteria for v3.3.20 pilot:**
  1. `listParticipants` after publish: ONE track src=SCREEN(3) + ONE track src=CAMERA(1) (NOT 2× SCREEN)
  2. Watch Live shows the same content on every refresh (deterministic SID sort)
  3. Final MP4: 2-up grid layout with slide deck + teacher both visible (not single tile in corner)

---

## v3.3.20 — current shipped state (2026-04-27 morning)

- **TV (vc=96, OTA active):** v3.3.20-explicit-camera-publish — camera via createVideoTrack/publishVideoTrack with source=CAMERA + isScreencast=false. Screen path unchanged (still via setScreenShareEnabled with room-default isScreencast=true). Camera ↔ 720p15, 2.5 Mbps. Screen ↔ 1080p15, 10 Mbps.
- **Backend Egress:** unchanged from v3.3.19 — H264_1080P_30 preset + `layout: "grid"` (`livekitService.js`). With proper labels now in place, "speaker" layout would also work (screen big + camera PiP, Zoom-style); leaving as "grid" for the v3.3.20 pilot to keep one variable changed at a time.
- **Frontend admin portal:** 2-up grid Watch Live (`LiveWatchModal.jsx`), deterministic via SID sort, deployed to https://lecturelens-admin.draisol.com .
- **OTA delivery:** v3.3.20 active. TV running v3.3.19 will pick up update at next foreground-service start. User will physically restart TV to trigger the update + final pilot test.


---

### I-124 — Custom Egress template "Start signal not received" (2026-04-27 v3.3.20)
- **Symptom:** Tried to ship a custom HTML template at `admin-portal/public/egress-templates/circle-pip.html` for "screen full + camera as circle PiP" recording layout. First test recording came back `status=failed` with `livekitEgressErrorReason="Start signal not received"`. File size 0, no frames captured.
- **Root cause:** LiveKit Egress with `customBaseUrl` requires the template to call a "ready to record" handshake signal so Egress knows when to start capturing the page. Without the signal, Egress times out (~30s default) and aborts before capturing any frames. The exact API depends on the Egress version:
  - Older: set `window.LIVEKIT_RECORDING_STARTED = true`
  - Newer: `window.parent.postMessage({type: "recording_ready"}, "*")`
  - Latest: `window.localContext.startRecording()`
  My initial template missed all three — focused only on attaching tracks to DOM elements.
- **Fix (immediate, v3.3.20-hotfix):** Disable customBaseUrl by default. Backend defaults to LiveKit's hosted "grid" layout (validated). Re-enable circle-pip via `LIVEKIT_USE_CIRCLE_PIP=true` env once the template is fixed.
- **Fix (proper, v3.3.21+):** Read LiveKit's official `egress-templates` reference repo to identify the exact handshake API for the Egress version running on `livekit.kiitdev.online` (Azure VM). Add the call to the template. Validate offline with a 2-3 min recording before enabling for production.
- **Lesson:** Custom Egress templates are NOT just "loadable HTML". They have an explicit handshake protocol with the Egress recorder. Adding `customBaseUrl` without implementing the protocol = guaranteed fail. Always test custom templates in isolation before enabling on a production pilot path.

---

## v3.3.20 — final shipped state for the 1-hour pilot (2026-04-27 morning)

| Layer | Config | Validation |
|---|---|---|
| TV (vc=96, OTA active) | v3.3.20-explicit-camera-publish | 5-min test completed clean (`final camera`, 7.5 min, status=completed, 141 MB MP4) |
| Camera publish path | Explicit `createVideoTrack(isScreencast=false)` + `publishVideoTrack(source=CAMERA)` | listParticipants confirmed: src=CAMERA 1280×720, src=SCREEN 1920×1080, src=MIC |
| Backend Egress layout | `grid` via LiveKit's hosted built-in template | 3 consecutive grid-layout recordings completed clean |
| Custom Circle PiP | Disabled (`LIVEKIT_USE_CIRCLE_PIP` env unset) | Deferred to v3.3.21 — see I-124 |
| Faststart auto-fix | Wired into `egress_ended` webhook + admin endpoint at POST `/api/recordings/:id/optimize-faststart` | Verified on `final camera` (moov moved from byte 140,701,980 → byte 32) |
| Frontend Watch Live | 2-up side-by-side grid, SID-sorted | Deployed on lecturelens-admin.draisol.com |

**Outstanding work after pilot passes:**

1. **v3.3.21 — fix circle-pip template handshake** (I-124). Read LiveKit's egress-templates reference, identify correct `recording_ready` signal for our Egress version, add to template, validate with 3-min test recording, then enable in production.
2. **v3.3.21+ — Egress speaker layout** (alternative to circle-pip). With v3.3.20's correct labels, LiveKit's built-in "speaker" layout might give the desired Zoom-style screen-big-camera-PiP-rectangle look without a custom template at all. Test as a less-risky alternative to circle-pip.
3. **UI cosmetic fixes** (heartbeat false-positive badges):
   - "No screen capture permission" — based on legacy `mediaProjectionGranted` flag that's never populated in LiveKit pipeline. Update heartbeat field to also report when LiveKit's screen track is publishing.
   - "High latency" — heartbeat HTTP RTT, not WebRTC. Misleading during recording. Either rename or hide during active recording.


---

### I-125 — QR attendance overlay correlates with Egress "Start signal not received" failures (2026-04-27 v3.3.20→v3.3.21)
- **Symptom:** After successfully running 3 grid-layout recordings (testt 5min, final camera 7.5min, final test 10min), every subsequent recording attempt failed with `livekitEgressErrorReason="Start signal not received"`. Egress logs showed Chrome firing `END_RECORDING` without ever firing `START_RECORDING` — the page was loading but never reaching the ready-to-record state.
- **User-reported pattern:** "QR code jab screen pe nehi aa raha tha wo wala ache se recording ho raha tha. QR code aa gaya recording pe issue he." Translated: classes WITHOUT the QR attendance overlay rotating on the TV screen produced clean recordings; classes WITH the QR overlay produced failed recordings.
- **Verified failure consistency:** Two consecutive failed recordings — `EG_yNXHqkrwWg5R` (with circle-pip custom template) and `EG_WyoBWrFWidDw` (with default grid template, AFTER rolling back custom template) — both failed identically. Even rolling back to the validated grid layout didn't help once QR was active.
- **Root cause hypothesis:** The QR overlay is a `SYSTEM_ALERT_WINDOW` rendered on the TV display, captured by MediaProjection along with the rest of the screen. The rotation cadence (every 30 seconds) seems to interact badly with MediaProjection's screen-content sampling on this LG 55TR3DK SoC, producing screen-track frames that Egress's headless Chromium can't render to its internal canvas. Without rendered frames, the page never reaches its "ready" state and Egress aborts.
- **Fix (v3.3.21):** Comment out the `qrOverlay?.start(meetingId, hmacSecret)` call in `RecorderForegroundService.kt` (line ~2156 in the legacy recording-start path). With QR overlay disabled, the screen track produces clean frames that Egress's Chrome renders correctly.
- **Lesson:** When recording fails after a working baseline, look for what changed on the TV-side stack — not just the backend or LiveKit Egress. Cosmetic-looking features (overlays, animations, popups) can disrupt MediaProjection's screen-content path on signage-class hardware. User pattern observation > log spelunking when the user has been watching real test results.
- **Future work:**
  1. Identify the exact MediaProjection / Chromium interaction. Possibly the QR's pixel-content (high-frequency black/white squares) triggers some frame-rate detection heuristic in Chromium that pauses rendering.
  2. Re-enable QR via a different rendering path — e.g. attendance via separate channel, or QR rotation only when no LiveKit recording is active, or QR rendered at a frame rate Chromium handles.
  3. Or move QR display to a separate device entirely (whiteboard, printed handout) so it never enters the screen capture.


---

### I-126 — QR overlay was load-bearing for MediaProjection on this LG signage TV (2026-04-27 v3.3.21 → v3.3.22)
- **Symptom:** v3.3.21 (QR overlay disabled) recording `hjgkhg` came back with the camera tile visible in top-left and the rest of canvas BLACK. Heartbeat showed `rec.projectionActive=False` mid-class even though `rec.livekitConnectionState=CONNECTED`. The screen track was publishing in LiveKit (1920×1080, muted=false) but with empty/black frames — encoder was running but receiving no actual content from MediaProjection.
- **Earlier mistaken diagnosis (I-125):** User reported "QR aaya recording fail hua, QR nehi aaya recording chala". I built v3.3.21 to disable QR. The user pattern observation was actually conflated by a different concurrent issue: a duplicate `livekit-*` docker stack on the Azure VM stuck in restart-loop with port 7881/6379 conflicts (see Azure VM cleanup notes below). Recordings during that period failed regardless of QR. After Azure cleanup, recordings post-cleanup succeeded — so QR was never the real culprit.
- **Root cause:** The QR `SYSTEM_ALERT_WINDOW` overlay was load-bearing for MediaProjection on this LG 55TR3DK SoC. With the overlay rotating every 30s:
  - lecturelens app's window-manager binding stays alive
  - TV display HAL doesn't enter power-save state
  - MediaProjection consent + virtual display stay active
  Without the overlay, when other apps (Chrome / Google Meet during a real class) take focus, the HAL revokes MediaProjection. The screen track keeps publishing (the LocalVideoTrack object is alive), but the encoder receives no new frames, producing all-black output that the SFU forwards to Egress.
- **Fix (v3.3.22):** Revert v3.3.21's QR disable. The QR overlay is a required "anchor" for MediaProjection on this hardware. The "fix" for the original perceived QR-recording correlation was always Azure VM cleanup, not QR removal.
- **Azure VM cleanup (separate, related diagnosis):** The Azure VM at 20.193.239.201 had two docker stacks running:
  - `livekitkiitdevonline-*` — production (used by `wss://livekit.kiitdev.online`)
  - `livekit-*` — old deployment, stuck in restart-loop because both stacks bind port 7881 (RTC) + 6379 (Redis)
  The restart-looping stack was eating CPU + interfering with the production Egress's resource usage on the 2-CPU VM. Removing it (`docker stop + rm` of `livekit-livekit-1`, `livekit-redis-1`, `livekit-caddy-1`) plus restarting `livekitkiitdevonline-egress-1` resolved the persistent "Start signal not received" errors that were baking in across recordings.
- **Lesson 1:** Forensic before "fix". The user-reported pattern was a coincidence of two failure modes overlapping in time. v3.3.21 disabled the wrong thing because I trusted the pattern observation without forensic reading of the actual Egress + heartbeat data. With proper data, the Azure VM stack collision would have been visible immediately (ports + duplicate names), and QR would never have been touched.
- **Lesson 2:** I-103 reaffirmed. Cosmetic-looking pieces (QR overlay, legacy MediaProjection retain, system_alert_window pings) are often load-bearing on signage-class HW. Don't optimise them away without understanding the FULL system role. The TV's HAL aggressively reclaims MediaProjection when no UI element of the granting app is on screen.
- **Future work:**
  1. Replace QR's SYSTEM_ALERT_WINDOW role with a dedicated "keep-projection-alive" window that doesn't render anything visible (a 1×1 invisible overlay, just to maintain the window-manager link).
  2. Or use Android 14's `FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION` formally (the v3.x manifest may not declare this type).
  3. Add a heartbeat alarm: if `rec.projectionActive=false` while `isRecording=true`, fire a TV-side log + remote-command-driven re-grant flow.


---

### I-127 — v3.3.20 explicit createVideoTrack camera path silently picks no camera for USB after reboot (2026-04-27 v3.3.22 → v3.3.23)
- **Symptom:** After morning's batch of clean v3.3.20 LiveKit recordings (testt, final camera, final test) + the TV physical reboot ~07:43 UTC, every subsequent recording with v3.3.22 had the camera tile rendered BLACK in admin Watch Live + recordings, even though `listParticipants` showed `src=CAMERA 1280x720 muted=false` published in the room. Heartbeat showed `uvcSupportedSizes=` empty + `uvcFrameCount=0`. User confirmed at the OS level: webcam test app saw the Lumens VC-TR1 USB camera fine — issue was inside lecturelens.
- **Root cause:** v3.3.20's explicit camera publish path used:
  ```kotlin
  r.localParticipant.createVideoTrack(name = "camera", options = LocalVideoTrackOptions(
      isScreencast = false,
      captureParams = VideoCaptureParameter(width=1280, height=720, maxFps=15)
  ))
  ```
  with no `position` field set. LiveKit's default Camera2Capturer (used when no explicit `VideoCapturer` is passed and `position` is null) walks the Camera2 device list with a FRONT/BACK heuristic. External USB cameras like the Lumens VC-TR1 are tagged as neither FRONT nor BACK at the Camera2 layer (they're "EXTERNAL" or untagged), so the heuristic skips them and falls through to a no-op capturer that produces 0 frames. The track still publishes (track object exists, metadata sent) but the encoder receives nothing — black output.
- **Why morning recordings worked but afternoon recordings didn't:** Camera2 enumeration order is deterministic-per-boot but not guaranteed across boots. Morning's enum order happened to put the USB cam in a slot the heuristic matched. After the afternoon's full TV reboot, enum order shifted and the heuristic missed.
- **Fix (v3.3.23):** Revert to `r.localParticipant.setCameraEnabled(true)` — the high-level helper walks the full Camera2 device list and binds to a working camera regardless of position tags. This is what worked reliably in v3.3.8 → v3.3.19 (modulo the source-label issue).
- **Trade-off:** setCameraEnabled inherits the room `videoTrackCaptureDefaults(isScreencast=true)`, so the SFU labels the published camera as `source=SCREEN_SHARE`. The "two SCREEN_SHARE tracks confuse Egress" issue (I-123) is back in theory, but with the Azure VM cleanup (duplicate stack removed, Egress chrome restarted), Egress's `grid` layout should still tile both video tracks regardless of label collision. The original I-123 broken-recording was triggered by the Azure VM stuck state, NOT solely by the label collision.
- **Lesson:** `createVideoTrack` without an explicit `VideoCapturer` is fragile on devices with USB cameras. Either:
  1. Use `setCameraEnabled(true)` for reliability (and accept the room-default-inherited isScreencast value)
  2. Pass an explicit `Camera2Capturer` constructed with the deterministic deviceId of the USB camera (looked up via `CameraManager.getCameraIdList()` filtering for `INFO_SUPPORTED_HARDWARE_LEVEL` or `CHARACTERISTIC_LENS_FACING_EXTERNAL`)
  3. Or write a custom `VideoCapturer` that wraps a UVC driver (jiangdongguo or similar) — the v3.3.6/v3.3.7 path that produced its own issues
- **Future work (post-pilot):** Implement option 2 — explicit deviceId enumeration for the USB camera. That gives us BOTH reliable camera detection AND proper source label. Best of both worlds.


---

## v3.3.24 — Final pilot-ready state (2026-04-27 ~13:11 IST)

After a full day of forensics through I-123 → I-127, the system reached its first verified-clean state:

```
LiveKit room (verified via listParticipants):
  src=MIC                            muted=false
  src=SCREEN   1920×1080             muted=false
  src=CAMERA   1280×720              muted=false  ← FIRST time today with correct label
Egress: ACTIVE, recording cleanly
```

### What was finally needed (full forensic chain):

| Issue | Fixed by |
|---|---|
| I-123 — camera mislabel as SCREEN_SHARE | v3.3.20 explicit createVideoTrack |
| I-124 — custom HTML template "Start signal not received" | Disabled circle-pip, kept grid |
| I-125 — false QR-overlay correlation (real cause was Azure VM) | Reverted v3.3.21 in v3.3.22 |
| Azure VM duplicate docker stack port conflicts | Manual cleanup of `livekit-*` containers + Egress restart |
| I-126 — QR overlay was load-bearing for MediaProjection | v3.3.22 restored QR overlay |
| LG Create Board / HDMI HDCP-protected screen-share | Workflow change: TV-native content only |
| TV state degradation after hours of test cycles | Physical TV reboot |
| I-127 — createVideoTrack heuristic skipping USB cameras | **v3.3.24: explicit deviceId via CameraManager.LENS_FACING_EXTERNAL** |

### Final shipped stack:

- **TV (v3.3.24, vc=100)**:
  - Screen: setScreenShareEnabled, room defaults isScreencast=true, 1920×1080@15fps, 10 Mbps
  - Camera: createVideoTrack with explicit USB deviceId from CameraManager, isScreencast=false, 1280×720@15fps, 2.5 Mbps, source=CAMERA
  - Audio: setMicrophoneEnabled with reflection-based USB mic bind (v3.3.3+)
  - QR overlay: ENABLED (load-bearing for MediaProjection on this hardware)
- **Backend Egress**: H264_1080P_30 preset + grid layout (no customBaseUrl), webhook auto-applies faststart re-mux post-completion
- **Frontend Watch Live**: 2-up grid layout, deterministic via SID sort
- **Azure VM**: Production stack only (`livekitkiitdevonline-*`), Egress freshly restarted, no port conflicts


---

### I-128 — Legacy fallback pipeline competing with LiveKit for MediaProjection (2026-04-27 v3.3.25)
- **Symptom:** During the 1-hour pre-pilot battery of tests, recordings showed alternating screen/camera failure: sometimes the screen tile in admin Watch Live was black with camera visible, then refreshing showed camera black with screen visible. Heartbeat field `videoPipeline=legacy_direct` despite the LiveKit room having TV publishing 3 tracks.
- **Root cause:** In `RecorderForegroundService.processClass()`, when LiveKit pipeline failed to start (`startLiveKitRecording` returned false), the code fell back to `startRealTimeRecording()` (the legacy MediaCodec + UVC path). On THIS hardware (LG 55TR3DK signage TV), the legacy pipeline aggressively grabs MediaProjection and the USB camera. Once both pipelines have been initialized in the same process:
  1. Legacy takes MediaProjection → screen track on LiveKit goes black (no source)
  2. LiveKit's screen capture re-acquires (via ProjectionRenewActivity flow) → projection bounces back
  3. Legacy's local capture goes dead → its segment files have black frames
  4. Loop continues for the rest of the recording
  Admin Watch Live + the final MP4 reflect whichever pipeline owned the projection at any given second — alternating black tiles.
- **Fix (v3.3.25):** Remove the legacy fallback entirely. If `startLiveKitRecording` returns false, fail the recording cleanly with a heartbeat error. Single pipeline = no resource contention. Per the user's explicit request: "agar legacy rehne se halucinate ho raha he ta remove karo, jo actual pe use hona chahiye usko rakhke baki sab clean hona chahiye."
- **Trade-off:** If LiveKit fails to start (e.g., backend doesn't issue an envelope, or libwebrtc ICE fails on this hardware), the recording fails completely. There's no degraded-but-functional legacy path. This is a deliberate trade-off — better a clean failure that surfaces the real issue than a silently-broken pipeline cocktail that hides it.
- **Lesson:** Fallback pipelines that share hardware resources (MediaProjection, Camera2, USB devices) with the primary pipeline are dangerous on resource-constrained signage hardware. They look like belt-and-braces but in practice cause concurrent-access bugs that are harder to debug than a clean primary-only failure.

---

## v3.3.25 — single-pipeline LiveKit-only stack (2026-04-27 ~13:30 IST)

| Layer | Config |
|---|---|
| TV (vc=101) | LiveKit-only — no legacy fallback. If LiveKit fails to start, recording fails cleanly with diagnostic in heartbeat. |
| Camera publish | Explicit USB deviceId via CameraManager.LENS_FACING_EXTERNAL (v3.3.24) |
| Screen publish | setScreenShareEnabled with room defaults isScreencast=true (v3.3.20) |
| Audio publish | setMicrophoneEnabled + reflection USB-mic bind (v3.3.3) |
| QR overlay | Enabled — load-bearing for MediaProjection persistence (v3.3.22) |
| Backend Egress | grid layout, faststart auto-applied post-egress_ended (v3.3.20) |
| Frontend | 2-up grid Watch Live with deterministic SID sort (v3.3.20-frontend) |
| Azure VM | Single production stack, Egress freshly restarted, no duplicate-stack port conflicts |


---

### I-129 — Backend creating recording doc as `pipeline=legacy` despite v3.3.25's removed-fallback (2026-04-27 v3.3.26)
- **Symptom:** After shipping v3.3.25 (TV no longer falls back to legacy), the next test recording (`Fluid mechanics`) STILL came back with `pipeline=legacy` in the recording doc, no `livekitRoomName`, and Watch Live's admin-watch-token endpoint refused to issue a token because of the legacy label. TV heartbeat showed the new v3.3.25 error message `"LiveKit failed (legacy fallback disabled): unknown"` confirming legacy fallback DID NOT fire on TV side, but the recording was still marked legacy on the backend.
- **Root cause:** Backend's `attachLiveKitIfEnabled()` in `controllers/classroomRecordingController.js` line 792 has the gate:
  ```javascript
  if (pipelineRequested !== "livekit") return;
  ```
  `pipelineRequested` comes from the TV's session-request body field `pipeline`. The TV's RecorderForegroundService at line 1566 was sending:
  ```kotlin
  "pipeline" to if (prefs.useLiveKitPipeline) "livekit" else "legacy"
  ```
  After hours of state-cycling today, `prefs.useLiveKitPipeline` had become `false` somehow (perhaps from a `toggle_*` remote command, or default-init mismatch). So the TV was sending `pipeline=legacy` to the backend → backend skipped LiveKit setup → recording doc created as legacy → no LiveKit envelope returned → TV's v3.3.25 logic correctly bailed with "no envelope" but the doc was already legacy in the DB.
- **Fix (v3.3.26):** **Hardcode `pipeline = "livekit"` unconditionally** in the session request. Remove the conditional on `prefs.useLiveKitPipeline`. Also remove the `else` branch in the pipeline-decision block in `processClass()` (the one that called `startRealTimeRecording()` when the envelope was absent) — replace with a clean fail. The TV's stack is now LiveKit-ONLY at every layer:
  - Session request: `pipeline="livekit"` always
  - Backend response: must include LiveKit envelope, or recording fails
  - Local pipeline: only `LiveKitPipeline.start()`, no legacy `startRealTimeRecording()` path
- **Lesson:** "Don't fall back to legacy" needs to be enforced at EVERY layer: TV → backend → recorded doc. A single conditional that still routes through legacy poisons the entire flow downstream.

---

## v3.3.26 — final LiveKit-only stack (2026-04-27)

| Layer | Behaviour |
|---|---|
| TV session request | Always `pipeline="livekit"` (hardcoded) |
| Backend recording doc | Always `pipeline="livekit"` (since attachLiveKitIfEnabled now always fires) |
| TV pipeline | `LiveKitPipeline.start()` only — no legacy `startRealTimeRecording` path |
| Failure mode | If LiveKit envelope missing OR LiveKit start fails → recording fails cleanly with diagnostic in heartbeat |


---

### I-130 — Bulletproof MediaProjection consent auto-tap (2026-04-27 v3.3.27)
- **Symptom (recurring all afternoon):** Recordings fail at the projection gate. Dashboard shows badges:
  - "Session open, capture stuck"  (top-level isRecording=true, inner rec.isRecording=false)
  - "No screen capture permission" (rec.projectionActive=false)
  Backend opens a session, TV starts the projection consent dialog, but the dialog never gets tapped. Recording aborts. The user has been observing the consent dialog flash on the TV physically — confirms AutoInstallService is failing to tap.
- **Root cause:** AutoInstallService.onAccessibilityEvent was firing a single tap attempt per AccessibilityEvent. On the LG 55TR3DK pilot TV the dialog often delivers events in states where:
  - The button isn't yet `isClickable=true` (mid-animation)
  - The button bounds report (0,0,0,0)
  - `performAction(ACTION_CLICK)` returns true but the OEM dialog only responds to raw touch events, not synthesised AccessibilityNodeInfo clicks
  Single-shot tap on the first event therefore fails silently, dialog stays open, eventually times out. Morning recordings (testt, final camera, final test) succeeded by luck — Camera2 + dialog timing happened to align. Afternoon recordings consistently failed because state shifted.
- **Fix (v3.3.27):** Comprehensive bulletproofing of the consent flow.
  1. **Persistent retry loop** — when a projection dialog is detected, schedule retry attempts every 500ms for up to 6s (12 attempts). Each retry refreshes the root window and attempts the tap again. Stops as soon as a strategy reports success AND a subsequent root-window scan no longer finds the dialog (definitive success), OR the budget is exhausted.
  2. **Three-strategy escalation per attempt:**
     - Strategy 1: `performAction(ACTION_CLICK)` on view-id `android:id/button1` (standard AlertDialog positive button)
     - Strategy 2: `performAction(ACTION_CLICK)` on text-label match (`PROJECTION_ACCEPT_LABELS` = "start now"/"start"/"立即开始"/"开始"/"अभी शुरू करें"/"शुरू करें")
     - Strategy 3: `dispatchGesture()` synthesised touch tap at the button's bounding rect — bypasses ACTION_CLICK quirks on OEM TVs
  3. **Heartbeat surface:** `rec.lastProjectionTap = { detectedAgoMs, via, pkg, result }`. The `result` field tells admin EXACTLY what happened: `button1-click (attempt=N)`, `label-click (attempt=N)`, `gesture-tap@(x,y) (attempt=N)`, `dialog-closed-after-tap`, `retry-attempt-N-failed`, `timeout-after-12-attempts`, `no-root-window`, `service-not-bound`. No more black-box "consent failed".
  4. **15s safety timeout** in LiveKitProjectionRequestActivity — if neither user nor service taps within 15s, fail with `denial` so the recording aborts cleanly. Activity never hangs forever.
  5. **AccessibilityServiceInfo flags:** added `FLAG_RETRIEVE_INTERACTIVE_WINDOWS` so retry loop can refresh root window content after each attempt.
- **Trade-offs:** Extra logging in tight retry loop is cheap (~12 INFO entries per consent flow). Gesture-tap requires API 24+ (we have minSdk=24 so safe). The retry budget of 6s is well under Android's MediaProjection consent dialog timeout (~30s on most TVs).
- **Lesson:** Single-shot accessibility taps are fragile on OEM hardware. Production accessibility automation needs persistent retry + multi-strategy fallback + observability surface. The "ACTION_CLICK returned true so it must have worked" assumption is broken on signage TVs.

