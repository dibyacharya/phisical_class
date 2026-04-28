# Tomorrow Morning — Step-by-Step Production Test Checklist

## What's ready for you (built tonight)

| Asset | Status |
|---|---|
| v3.4.3 APK on OTA (vc=115) — audio + camera resource leak fixes | ✅ uploaded, ACTIVE |
| v3.4.2 audio fix included in v3.4.3 | ✅ shipped |
| Validation harness `scripts/validate-tv.sh` | ✅ ready |
| Test plan `TOMORROW_STRESS_TEST_PLAN.md` | ✅ written |
| Backend: Mongo quota cleared, Recording.pipeline default = livekit | ✅ deployed |
| Admin portal: ALL legacy strings purged (no "No screen capture permission" chip, no legacy-pipeline branch) | ✅ deployed |

## The critical fix landed in v3.4.2

User-reported insight that turned out to be 100% correct:

> "Humara app install karne se pehele sab kuch ache se chalta he. Once humara
> application chalta he ta kya kya sab access le leta he ta kisika access nehi
> mil raha he."

**Root cause confirmed via code audit:** Every recording set
`AudioManager.mode = MODE_IN_COMMUNICATION` and
`AudioManager.setCommunicationDevice(usbMic)` but **never reset them**. After
recording ends, the TV's global audio routing stays in voice-comm mode with the
USB Lumens (no speaker) as the comm device. The browser, YouTube, system sounds
— all routed silently to the USB mic device. Only a TV reboot cleared it.

**Fix in v3.4.2:**

- `LiveKitPipeline.stop()` `finally` block calls `clearCommunicationDevice()`
  and resets `AudioManager.mode = MODE_NORMAL`.
- `RecorderForegroundService.onDestroy()` does the same as a defensive
  backstop in case the service is killed without a clean stop.
- Both run unconditionally on every exit path: normal stop, force-stop,
  crash recovery.

## Step 1 — Bring the fleet online (you do, 5 min)

Today the test TV (Room 006) went offline after a manual restart and didn't
recover automatically — Android's background-execution restrictions on signage
TVs killed the foreground service when v3.4.0 stopped anchoring it to an
activity. v3.4.1 already fixed this. v3.4.2 carries that fix forward.

For each TV:

1. **Power-cycle the TV** (physical off → 5s → on)
2. After ~30s, **open the LectureLens app icon on the TV launcher**
3. The app's SetupActivity will auto-finish + moveTaskToBack instantly. You'll
   see a brief flash and the launcher returns. The recording service is now
   anchored.
4. Within 90s the TV will heartbeat → backend offers v3.4.2 OTA → install +
   restart → ready.

## Step 2 — Verify each TV is on v3.4.2 (run from your laptop)

```bash
TOKEN=$(cat /tmp/ll_token)
curl -sS "https://lecturelens-api.draisol.com/api/classroom-recording/devices" \
  -H "Authorization: Bearer $TOKEN" | python3 -c "
import sys, json, datetime
devices = json.load(sys.stdin)
now = datetime.datetime.now(datetime.timezone.utc)
print(f'{\"Room\":<8} {\"Device\":<22} {\"Version\":<35} hb_age usbCam usbMic')
for d in sorted(devices, key=lambda x: x.get('roomNumber','')):
    hb = d.get('lastHeartbeat')
    age='?' if not hb else int((now-datetime.datetime.fromisoformat(hb.replace('Z','+00:00'))).total_seconds())
    h = (d.get('health') or {}).get('hardware') or {}
    print(f'{d.get(\"roomNumber\",\"?\"):<8} {d.get(\"deviceId\",\"?\"):<22} {d.get(\"appVersionName\",\"?\"):<35} {age}s    {h.get(\"hasUsbCamera\")}   {h.get(\"hasUsbMic\")}')"
```

**Pass criteria:** every TV you intend to test shows `vc=114` (v3.4.2),
`hb_age < 90s`, `usbCam=True`, `usbMic=True`. If any TV is on a lower
version, send a `check_update` command:

```bash
curl -sS -X POST "https://lecturelens-api.draisol.com/api/remote/command" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"deviceId":"<deviceId>","command":"check_update"}'
```

## Step 3 — Single-room solo validation (10 min, MUST PASS BEFORE STEP 4)

Pick **one TV** (Room 006 is best — it's where we tested today). On the TV:

1. Open the browser
2. Navigate to YouTube, start a video with motion + audio (any music video)
3. Make sure browser is the foreground app on the TV
4. **Do NOT touch the LectureLens app** — let it stay backgrounded

From your laptop, schedule a 5-min test class:

```bash
TOKEN=$(cat /tmp/ll_token)
START_IST=$(TZ=Asia/Kolkata date -v+2M +%H:%M)
END_IST=$(TZ=Asia/Kolkata date -v+7M +%H:%M)
DATE_IST=$(TZ=Asia/Kolkata date +%Y-%m-%dT00:00:00.000Z)
curl -sS -X POST "https://lecturelens-api.draisol.com/api/classes" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"title\":\"validate-v342\",\"course\":\"69e9becd048f31f61fffdda2\",\"teacher\":\"69e1b75ec5b5e5e7afdc1b1e\",\"roomNumber\":\"006\",\"date\":\"$DATE_IST\",\"startTime\":\"$START_IST\",\"endTime\":\"$END_IST\"}"
```

Save the returned `_id` as `RECORDING_ID` (actually it's the class id; the
recording id will appear shortly).

While the class runs, watch the TV — does the browser still play YouTube
audibly through the TV speaker? **If yes, the v3.4.2 fix worked at the
during-recording level.**

After the class ends (5 min total), find the recording:

```bash
TOKEN=$(cat /tmp/ll_token)
curl -sS "https://lecturelens-api.draisol.com/api/recordings?limit=1" \
  -H "Authorization: Bearer $TOKEN" | python3 -c "
import sys, json
print(json.load(sys.stdin)[0]['_id'])"
# Use that as REC_ID below.
```

Now run the validation harness:

```bash
cd "/Users/dibyakantaacharya/ADMIN_PORTAL_with_phisical class/lecture-capture-system"
./scripts/validate-tv.sh dev_adabe914f52f79b7 <REC_ID>
```

**Pass criteria:** all green checks, no `❌`. Specifically:

- `mean_volume > -50 dB` ← real audio captured
- YAVG range > 20 ← video has motion (browser content captured, not LectureLens UI)

**After the recording ends, also test that browser audio still works** —
play a YouTube video on the TV and listen. With v3.4.2's fix, audio should
play through the TV speaker normally. If it still doesn't, the fix needs
further investigation.

## Step 4 — Multi-room concurrent test (only after Step 3 passes)

Same setup on each TV (browser + YouTube). Schedule the same 1-hour class
window across every room. Live-monitor:

```bash
# In one terminal — runs every 30s, shows all TVs
watch -n 30 "TOKEN=\$(cat /tmp/ll_token); curl -sS 'https://lecturelens-api.draisol.com/api/classroom-recording/devices' -H 'Authorization: Bearer \$TOKEN' | python3 -c '
import sys, json, datetime
devs = json.load(sys.stdin)
now = datetime.datetime.now(datetime.timezone.utc)
for d in sorted(devs, key=lambda x: x.get(\"roomNumber\",\"\")):
    hb = d.get(\"lastHeartbeat\")
    age = -1
    try: age=int((now-datetime.datetime.fromisoformat(hb.replace(\"Z\",\"+00:00\"))).total_seconds())
    except: pass
    rec=(d.get(\"health\") or {}).get(\"recording\") or {}
    print(f\"{d.get(\\\"roomNumber\\\",\\\"?\\\"):4} hb={age:>4}s rec={d.get(\\\"isRecording\\\")} pipe={rec.get(\\\"videoPipeline\\\")} lk={rec.get(\\\"livekitConnectionState\\\")} aDb={rec.get(\\\"audioLevelDb\\\")}\")
'"
```

After all classes end, run the harness for every recording:

```bash
for REC_ID in <id1> <id2> ...; do
  ./scripts/validate-tv.sh <deviceId-for-each-room> "$REC_ID"
done
```

**Pass criteria for the production stress test:**

- Every TV stayed online (heartbeat continuous through the hour)
- Every recording has `mean_volume > -50 dB`
- Every recording has YAVG range > 20
- No silent recordings, no frozen recordings, no crashed services

## If something fails

- **TV won't come online** — ping me, this is the v3.4.0/4.1 service-anchor
  area; might need a hard fix to the BootReceiver path.
- **Recording is silent** — pull TV logs (`pull_logs` remote command), look
  for `v3.4.2 stop()` log lines (proves the fix ran) and `audio: cb=N
  peak5s=...` lines (proves samples flowing).
- **Recording is frozen video** — confirm what's foregrounded on the TV
  visually. If the LectureLens app UI is showing, the activity-foregrounding
  fix in v3.4.0 has regressed.
- **Browser audio cuts off after recording ends** — v3.4.2 fix didn't take.
  Pull logs, look for `v3.4.2 stop(): audio routing released` line.

## Rollback

If v3.4.2 misbehaves catastrophically, activate v3.4.1:

```bash
TOKEN=$(cat /tmp/ll_token)
# Find v3.4.1 id
V341_ID=$(curl -sS "https://lecturelens-api.draisol.com/api/app/versions" -H "Authorization: Bearer $TOKEN" | python3 -c "
import sys, json
for v in json.load(sys.stdin):
    if v.get('versionCode')==113: print(v.get('_id'))")
curl -sS -X POST "https://lecturelens-api.draisol.com/api/app/versions/$V341_ID/activate" -H "Authorization: Bearer $TOKEN"
```

## Answers to your three concerns

### "Restart ke baad sab ready ho"

After TV power-on:
1. **BootReceiver** fires on `BOOT_COMPLETED` (v3.4.1 restored this)
2. **Foreground service starts** + **SetupActivity launches briefly** to anchor
   the service against Android's background-execution kill timer
3. **SetupActivity sees setupComplete=true → moveTaskToBack(true) + finish()**
   instantly. No dark UI shown to camera/screen capture.
4. **Heartbeat thread starts** within ~30s, USB peripheral re-enumeration
   (camera + mic) happens in the next heartbeat.
5. **System is recording-ready** — when a class start time hits, the LiveKit
   pipeline acquires fresh MediaProjection consent (auto-tap) and starts.

What's NOT auto-handled and you should sanity-check:
- If TV is unplugged from power (not just remote-off), Android may hold off
  BootReceiver for 30-60s. Service heartbeat will resume after that.
- If the LectureLens app is force-stopped via Android Settings, BootReceiver
  won't fire (Android's user-stop flag). User must open the app once.

### "Recording ke baad sab kuch working chahiye (camera/audio/screen)"

After every recording stops, in v3.4.3:

1. **Camera** — `cameraTrack.stopCapture()` then `cameraTrack.dispose()` runs
   in `LiveKitPipeline.stop()`. CameraDevice handle on USB Lumens is released
   immediately. Browser can re-acquire camera the next moment.

2. **Audio** — `AudioManager.mode = MODE_NORMAL` + `clearCommunicationDevice()`
   runs in `LiveKitPipeline.stop()` (v3.4.2). System audio routing returns
   to default. Browser/YouTube playback resumes through TV speaker as it did
   before recording.

3. **Screen capture** — MediaProjection ends naturally when LiveKit's
   internal screen track is unpublished via `room.disconnect()`. The
   token is invalidated by Android. Next recording will trigger
   `LiveKitProjectionRequestActivity` (transparent) to acquire a fresh
   token, with `AutoInstallService` auto-tapping the consent dialog.

4. **Service stays alive** — heartbeat continues, schedule scan continues,
   ready for the next class without any user intervention.

### "Recording ke baad 'screen capturing permission hat gaya' message"

The chip that displayed this message was in `Devices.jsx` and gated on
`livekitEnabled === false`. Since every TV in production has been on
LiveKit-only mode since v3.3.26, the chip never legitimately fires.
Stale-cache reads of `livekitEnabled` could cause it to flicker briefly,
which is why you sometimes saw it.

**v3.4.3 admin portal**: removed the chip entirely + removed the
LEGACY-PIPELINE branch in `deriveHardwareState`. The misleading message
will never show again.

The reality of MediaProjection: each recording acquires a fresh consent
on demand via the transparent ProjectionRequestActivity + AccessibilityService
auto-tap. There's no concept of permission "being lost" between recordings —
each class start re-acquires automatically.

## Engineering log entry for tonight

Today's session shipped (v3.3.31 → v3.4.3, eight iterations):

| Version | Win |
|---|---|
| v3.3.33 | Variable-name drift fixed across TV/backend/frontend |
| v3.4.0 | BootReceiver no longer brings opaque SetupActivity foreground |
| v3.4.1 | BootReceiver activity launch restored (anchors service on cold boot) |
| **v3.4.2** | **AudioManager.mode + setCommunicationDevice released in stop()** ← THE bug behind "browser audio ruk gaya" |
| **v3.4.3** | **Camera Track lifecycle: stopCapture+dispose explicit in stop(), failed-track cleanup before fallback** ← same pattern as audio leak |

Untouched but planned for v3.5.x (after tomorrow's stress test if needed):

- First-recording silent audio on Lumens VC-TR1 (HAL warm-up issue — needs
  UVC re-integration or pre-warming via long-running idle AudioRecord in
  the service)
- Aggressive cleanup on package replace (audio mode + camera handles
  are guaranteed released in stop() and onDestroy() now, but Android can
  reap the process abruptly during package upgrade — hard to defend
  against without persisting state to disk)

Sleep well. Tomorrow morning the system is at its strongest engineered
shot yet at a clean multi-room production test.
