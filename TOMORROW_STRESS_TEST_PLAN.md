# Multi-Room Concurrent Recording Stress Test — Tomorrow's Production Validation

## Goal

All deployed Smart-TVs (Room 001, 006, 008, 009, 010, 013, 015) record **1-hour classes
simultaneously** with each TV's browser playing YouTube content. Every recording must
contain:

- Real moving screen content (the YouTube video, not a frozen frame and not LectureLens UI)
- Audio with `mean_volume > -50 dB`
- Camera tile (Lumens VC-TR1 USB camera)
- All three tracks for the entire 60-minute duration

The deliverable is a system that survives back-to-back classes throughout the day with no
human intervention between recordings.

## User-reported core insight (Apr 28, 2026)

> "Humara app install karne se pehele sab kuch ache se chalta he. Once humara application
> chalta he ta kya kya sab access le leta he ta kisika access nehi mil raha he."

Translation: before the app installs, the TV's browser audio and camera work normally;
after the LectureLens app starts, the browser loses access. This is a **resource-isolation
bug** — our app is monopolising USB peripherals or system audio mode in ways the rest of
the TV can't recover from.

Hypotheses to research (Phase 4 below):

1. `AudioManager.MODE_IN_COMMUNICATION` set during recording routes ALL audio (including
   browser playback) through the comms path. If that path doesn't include the TV speaker,
   the user hears silence even though the browser is playing.
2. `AudioManager.setCommunicationDevice(usbMic)` may persist after the recording ends
   (we never clear it). Browser-side audio output is then misrouted.
3. Camera2 holds an exclusive lock on the USB Lumens. Any browser feature that wants the
   camera is denied until our app releases it. Even after recording stops, the lock may
   linger if Camera2 capture session isn't fully closed.
4. The single-USB Lumens VC-TR1 multiplexes camera + mic on one USB endpoint. Opening the
   audio interface and the camera interface concurrently on the same device may exceed the
   USB bandwidth budget on this TV's USB controller, causing one or both to fail silently.

## Phase 0 — Pre-flight checklist (today, before sleep)

| Check | Owner | Pass criteria |
|---|---|---|
| v3.4.1 OTA active | Engineering | All TVs report `appVersionCode=113` in heartbeat |
| All TVs online | Engineering | `lastHeartbeat < 90s` for every TV in the fleet |
| USB peripherals plugged in | User | Each TV reports `hardware.hasUsbCamera=true && hasUsbMic=true` |
| LiveKit cluster healthy | Engineering | All 4 docker containers `Up`, websocket reachable, sample room create+destroy succeeds |
| Mongo headroom | Engineering | `< 400 MB` used (from 512 MB cap), `/api/app/free-mongo-quota` recently run |
| Backend Recording.pipeline default | Engineering | New Recording docs default to `pipeline: "livekit"` (verified in v3.3.33 commit) |

## Phase 1 — Validate v3.4.1 cold-boot anchor

The v3.4.0 → v3.4.1 hotfix restores BootReceiver's activity launch. This must
be validated **on a real cold boot** (not just OTA install).

### Test case 1.1: Cold-boot service anchor

```
Steps:
1. Confirm Room 006 on v3.4.1 (vc=113) and online
2. Power-cycle the TV physically (off button, wait 5s, on)
3. Wait 90s
4. Query /api/classroom-recording/devices

Pass criteria:
- TV is online (lastHeartbeat < 90s after power-on)
- appVersionCode == 113
- health.recording.livekitEnabled == true
- No service-process crash report in the heartbeat
```

### Test case 1.2: Activity-foregrounding fix verified

```
Steps:
1. Verify TV is online (Test 1.1 passed)
2. Open browser on TV, navigate to YouTube, start a video
3. Schedule a 3-minute test class on Room 006 starting +2 min
4. After class ends, ffprobe the resulting MP4

Pass criteria:
- File size > 5 MB
- Duration > 150s
- Frame YAVG sampled at 5 timestamps shows variance > 20 (i.e. NOT stuck at one value)
- Audio mean_volume > -50 dB
```

## Phase 2 — Test automation harness

A single command must run the full validation suite against any TV. Outputs a
pass/fail report per check.

```bash
./scripts/validate-tv.sh <deviceId> <test-class-id>
```

Internal checks (each fails the suite if criterion missed):

1. **Heartbeat freshness** — `lastHeartbeat` < 90 seconds.
2. **Pipeline state during recording** — `videoPipeline == "livekit"` and
   `livekitConnectionState == "CONNECTED"` mid-recording.
3. **LiveKit room state** — server-side query returns 3 published tracks with
   non-zero RTP packet counts.
4. **Audio level** — `audioLevelDb > -50 dB` mid-recording (live signal).
5. **Recording document** — `pipeline == "livekit"`, `mergeStatus == "ready"`,
   `fileSize > 1MB` after class ends.
6. **MP4 content (ffprobe)** — video stream present, audio stream present,
   duration ≥ 90% of scheduled.
7. **Audio reality (ffmpeg volumedetect)** — `mean_volume > -50 dB`.
8. **Video reality (frame variance)** — sample 5 frames at 10/25/50/75/90%,
   YAVG range > 20, YDIF aggregate > 0.

This harness is what runs against EVERY recording in tomorrow's stress test.

## Phase 3 — Single-room solo validation

```
Room: 006
Content on TV: YouTube via browser (something with constant motion + audio,
e.g. a music video)
Recording: 5 minutes
Expected: full pass on every check in Phase 2
```

If this fails: do not proceed to multi-room. Fix the single-room case first.

## Phase 4 — Resource isolation research

Investigation (today, before sleep):

1. Read `LiveKitPipeline.kt` `start()` — every call that touches `AudioManager.mode`
   or `setCommunicationDevice`. Verify these are RESET in `stop()`.
2. Read `RecorderForegroundService.kt` recording-end path — verify cleanup of
   audio mode + camera handles.
3. Test side-channel: open YouTube in browser → start a recording → DURING the
   recording, observe browser audio state on TV (is it audible? is the audio routed
   to USB mic device which has no speaker output?).
4. After recording ends → DOES browser audio recover?

Possible fixes (to be implemented in v3.4.2 if confirmed):

- Save the original `AudioManager.mode` before MODE_IN_COMMUNICATION; restore it
  in `LiveKitPipeline.stop()`.
- Call `AudioManager.clearCommunicationDevice()` (Android 12+) in `stop()`.
- Camera2: ensure CameraDevice.close() runs in finally block in pipeline teardown.

## Phase 5 — Multi-room concurrent stress test (TOMORROW)

```
Time: TBD (target: ~10:00 IST, after pre-flight at 09:30)
Scope: every TV in the fleet that is online and has USB peripherals
Per-TV setup: browser open with YouTube, video playing
Class schedule: same 1-hour window across all rooms
Monitoring: live dashboard showing 8 TVs in parallel
```

Real-time alarms during the test:

- TV heartbeat goes stale (> 120s) → pull logs immediately
- audioLevelDb stays ≤ -50 dB for > 60s → silent-audio alarm
- livekitConnectionState != CONNECTED for > 30s → connection-dropped alarm
- frameDrop or errorCount jumps → recording-degraded alarm

After all classes end, run validation harness against every recording. Pass criteria:

- 100% of recordings have audio mean_volume > -50 dB
- 100% of recordings have video YAVG variance > 20
- No recording is silent or frozen
- No TV crashed mid-recording (continuous heartbeat through entire class)

## Phase 6 — Final hardening

If anything in Phase 3 / 4 / 5 fails, fix → re-validate → repeat. Only ship as
"ready for tomorrow" once all checks pass on a representative TV.

## Outstanding open questions (to resolve via Phase 4 research)

1. Why was `egfve` recording (v3.3.32, second after install) PERFECT (audio -19.6 dB,
   moving video) but `news` (v3.3.34, first after install) FROZEN at YAVG=96?
2. Is the first-after-install silence a HAL warm-up issue (5 min then works) or a
   never-resolves-on-this-boot issue?
3. Does our `AudioManager.MODE_IN_COMMUNICATION` set BLOCK browser playback audio
   at the OS level, and if so does it persist after recording ends?
4. Does Camera2's lock on Lumens VC-TR1 prevent the audio sub-interface from
   working even when we're trying to use both at once?

## Build chain reliability for tomorrow

Today's session burned 5 hours on:

- v3.3.31 / v3.3.32 / v3.3.33 / v3.3.34 / v3.3.35 / v3.4.0 / v3.4.1 — version churn
- Multiple Mongo quota stalls
- Multiple TV reboots
- Multiple class-cancel cycles

For tomorrow this needs to be:
- ONE STABLE build
- Validated against the test harness
- Pushed as the active OTA before the test
- No mid-test changes
