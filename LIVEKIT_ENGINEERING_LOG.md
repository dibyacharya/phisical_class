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
