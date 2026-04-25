# LiveKit Migration Plan — LectureLens Smart-TV Recording

**Status:** Draft — pending sign-off
**Author:** Engineering
**Last updated:** 2026-04-25

---

## 1. Why we are doing this

The current pipeline encodes, muxes, segments, and uploads recordings **on the LG 55TR3DK Smart TV itself** (Cortex-A53, 4 GB RAM, Android 11). The TV is a recording device, not a workstation, and three problems keep recurring:

| Problem | Root cause |
|---|---|
| Video looks janky (~1.6 fps) | Software H.264 encoder is the only reliable codec on this SoC |
| Mid-class hangs (most recently the 45-min hang documented as I-026) | MediaProjection + GL compositor + UVC + foreground service all on one weak SoC |
| Audio sometimes never reaches the cloud | `audio.m4a` is a single one-shot upload at end of class |
| Long classes (>20 min) end early or merge with gaps | Segment rotation + rotation gaps + smoothing pass duplicates frames |

The Smart TV stack already includes 3-layer hang defence (HangMonitor, proactive refresh, watchdog), GL compositor, encrypted retry queues, OTA — and we still hit hardware limits. The TV simply cannot encode + mux + upload in real time without spending most of its budget on bookkeeping.

**Strategic shift:** move encoding and recording **off the TV**. Let the TV do exactly what its silicon can do — capture screen, camera, mic — and ship raw frames to a cloud service that does the heavy lifting.

The KIIT LMS / Univanta projects already run a self-hosted LiveKit server for online classes. Reusing that infrastructure for physical-classroom recording gives us:
- Hardware-accelerated WebRTC encode (or VP8/VP9 SW fallback) instead of MediaCodec H.264
- Server-side composite recording via LiveKit Egress — no merging, no smoothing pass on the TV or on Railway
- RTP packet-loss recovery → no more lost audio.m4a
- Existing ops surface (LiveKit VM is already monitored)

---

## 2. Existing assets we reuse

### 2.1 LiveKit server (already deployed)

| Item | Value |
|---|---|
| Hostname | `livekit.kiitdev.online` |
| Cloud | Azure VM, **B2ms** (2 vCPU, 8 GB RAM, 30 GB SSD), Central India |
| OS / runtime | Ubuntu 22.04, Docker, Nginx (SSL), Certbot |
| LiveKit version | latest stable, single-node (no Redis) |
| Capacity | 90–150 concurrent participants |
| WebSocket | `wss://livekit.kiitdev.online` (port 443 → 7880) |
| TURN/TLS | port 7881 |
| WebRTC media | UDP 50000–60000 |
| Cost | ~₹5,000/month |
| Setup guide | `/Users/dibyakantaacharya/ADMIN_PORTAL/LiveKit_VM_Setup_Guide.md` |

**Action items:** confirm VM is reachable from Railway and from the TV's network.

**[2026-04-25 update]** Connectivity verified:
- DNS for `livekit.kiitdev.online` resolves **directly to `20.193.239.201`** (Azure VM IP), **not** through Azure Front Door — UDP 50000–60000 path is clean. (Q4 from §8 RESOLVED.)
- API smoke test (RoomServiceClient.listRooms / createRoom / deleteRoom + AccessToken signing) passes end-to-end with the production credentials.
- Egress not yet deployed — covered in Phase 0b once VM SSH access is shared.

### 2.2 LiveKit Server SDK integration (already coded in KIIT LMS / Univanta)

| Asset | Path | What we reuse |
|---|---|---|
| `livekitService.js` | `ADMIN_PORTAL/KIIT_LMS_BACKEND/.../services/livekitService.js` | Token gen + `RoomServiceClient` create/delete/list — port verbatim |
| `CloudRecording` model | `Univanta/.../models/CloudRecording.js` | Egress lifecycle row schema — adapt fields to lectures |
| Webhook handler | `Univanta/.../services/exam/livekitRecordingWebhook.js` | `egress_started` / `egress_ended` event handler — adapt to lectures |
| `livekit-server-sdk` | `Univanta/.../node_modules/livekit-server-sdk` | npm package, already vetted |

**Token grants (reused as-is for the TV publisher):**
```js
{
  roomJoin: true,
  room: roomName,
  canPublish: true,    // TV publishes
  canSubscribe: false, // TV doesn't watch others — saves bandwidth
  canPublishData: true,
  roomAdmin: true,     // TV controls the room (kick, mute)
  roomRecord: true,    // TV can request server-side recording
}
```

### 2.3 Frontend client SDK pattern (reference only)

`livekit-client@2.17.2` + `@livekit/components-react@2.9.20` are wired into the LMS — we don't reuse the React UI; we use the **Android SDK** instead. But the connection / publish patterns map 1:1.

### 2.4 What is **NOT** yet deployed (gaps to fill)

| Gap | Plan |
|---|---|
| LiveKit **Egress** server (separate Docker container) | Deploy on the same VM in Phase 0 |
| Egress **trigger code** (`EgressClient.startRoomCompositeEgress`) | Implement in Phase 1 — Univanta has webhook-receiver but not the trigger |
| Azure storage credentials wired into Egress | Set up during Phase 0 — Egress writes directly to Azure Blob, no TV/Railway hop |
| Webhook receiver in lecture-capture-system backend | Port from Univanta in Phase 1 |
| LiveKit Android SDK in `classroom-recorder-android` | Add dependency in Phase 2 |

---

## 3. Target architecture

### 3.1 Data flow (post-migration)

```
                     ┌──────────────────────────────────────┐
                     │          Smart TV (publisher)        │
                     │                                      │
                     │  MediaProjection ─┐                  │
                     │  USB Camera ──────┼─→ LiveKit SDK    │
                     │  AudioRecord ─────┘   Android        │
                     │         (raw frames, no encoding mux)│
                     └────────────────┬─────────────────────┘
                                      │ WebRTC (RTP/UDP)
                                      ▼
              ┌──────────────────────────────────────────┐
              │  LiveKit Server  (livekit.dev.kiitdev.   │
              │  online — Azure B2ms, single-node)       │
              └────────┬─────────────────────────┬───────┘
                       │ control plane           │ media plane
                       │                         ▼
                       │           ┌────────────────────────────┐
                       │           │  LiveKit Egress (Docker)   │
                       │           │  Composite recording:      │
                       │           │   - screen as main         │
                       │           │   - camera as PiP overlay  │
                       │           │   - audio mixed in         │
                       │           │  Output: MP4 (H.264 + AAC) │
                       │           └────────────┬───────────────┘
                       │                        │ direct upload
                       │                        ▼
                       │        ┌──────────────────────────────┐
                       │        │  Azure Blob Storage          │
                       │        │  physical-class-recordings/  │
                       │        │   {date}/{room}/{recId}/full │
                       │        └──────────────────────────────┘
                       │                        │
                       │                        │ webhook on egress_ended
                       ▼                        ▼
        ┌──────────────────────────────────────────────────────┐
        │ lecture-capture-system backend (Railway)              │
        │                                                      │
        │   POST /api/classroom-recording/recordings/session   │
        │     → creates LiveKit room + issues TV publisher     │
        │       token + starts Egress                          │
        │                                                      │
        │   POST /api/classroom-recording/livekit-webhook      │
        │     → handles egress_started / egress_ended;         │
        │       writes Recording.mergedVideoFile = blob URL    │
        │                                                      │
        │   Existing endpoints (heartbeat, health, attendance) │
        │   STAY — they don't touch the recording pipeline.    │
        └──────────────────────────────────────────────────────┘
                                     │
                                     ▼
                     React Admin Portal (unchanged URL)
```

### 3.2 Why this works

**TV side becomes radically simpler:**

| Before | After |
|---|---|
| MediaCodec H.264 encoder | Removed — WebRTC Android does encode |
| GL compositor + ImageReader bridge | Removed — composite happens server-side |
| Segment muxer + 5-min rotation | Removed — Egress writes one continuous file |
| Separate `audio.m4a` muxer + retry queue | Removed — audio is just an RTP track |
| HTTP segment uploads | Removed — WebRTC RTP is the upload |
| Backend smoothing pass (`fps=15` filter) | Removed — Egress encodes at constant fps |
| `pendingUpload` / `pendingAudioUpload` prefs | Removed |
| `HangMonitor` / proactive refresh / watchdog | **Kept** — still needed for foreground service supervision |

**Backend side stays mostly the same** — same Railway service, same Mongo, same Azure container, same admin portal. The only new endpoints are the LiveKit room creator and the Egress webhook receiver.

### 3.3 Data model changes

We add a small handful of fields to existing models — no new collections required for Phase 1 (we can introduce one later if we need richer egress lifecycle tracking).

```js
// Recording model (existing)  +
{
  ...,
  livekitRoomName: String,         // e.g., "phyclass-<recordingId>"
  livekitEgressId: String,         // UUID returned by EgressClient.startRoomCompositeEgress
  livekitEgressStatus: {           // mirrors CloudRecording.status from Univanta
    type: String,
    enum: ["pending","recording","processing","available","failed"],
    default: "pending",
  },
  livekitEgressStartedAt: Date,
  livekitEgressEndedAt: Date,
  livekitEgressErrorReason: String,
}
```

The existing `segments[]` / `audioFile` fields stay around for **backward compatibility during the parallel-run pilot** — we don't drop them until Phase 5.

---

## 4. Phased rollout

Each phase has a clear exit criterion. We do **not** start the next phase until the current one passes its criterion.

### Phase 0 — Infrastructure (1–2 days)

**Goal:** LiveKit server is reachable for media + Egress is recording test rooms to Azure Blob.

1. **Verify network path to LiveKit VM**
   - `nslookup livekit.kiitdev.online` (currently points at Azure Front Door)
   - Confirm: does the FD pass WebSocket + UDP 50000–60000? If not, set up a separate hostname (`livekit-edge.kiitdev.online`) that points directly at the VM public IP for media.
   - From the TV's actual classroom WiFi, run `iperf3` to the VM: must sustain ≥3 Mbps upload, <100 ms RTT, <2% packet loss for 60 minutes.
   - **Exit criterion:** TV → VM `iperf3` sustains 3 Mbps for 1 hour with no packet-loss spikes.

2. **Deploy LiveKit Egress on the same VM**
   - Egress runs in a separate container, talks to LiveKit over the in-VM `localhost`
   - Egress needs Azure Blob credentials (storage account name + key + container)
   - Container env (template):
     ```yaml
     EGRESS_CONFIG_BODY: |
       redis: {}    # not needed in single-node
       api_key: <from livekit.yaml>
       api_secret: <from livekit.yaml>
       storage:
         azure:
           account_name: lecturelens
           account_key: <existing key, same as backend>
           container_name: physical-class-recordings
       redis_health_port: 0
     ```
   - **Exit criterion:** From Railway backend, calling `EgressClient.startRoomCompositeEgress(testRoom)` produces a valid MP4 in Azure Blob within 30 seconds of `stopEgress`.

3. **Create webhook secret + Railway env**
   - Generate `LIVEKIT_EGRESS_WEBHOOK_SECRET` (32-byte random)
   - Add to Railway backend env: `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `LIVEKIT_WS_URL`, `LIVEKIT_EGRESS_WEBHOOK_SECRET`, `LIVEKIT_EGRESS_OUTPUT_PATH_TEMPLATE`
   - Add to LiveKit `livekit.yaml`:
     ```yaml
     webhook:
       api_key: <api_key>
       urls:
         - https://lecturelens-api.draisol.com/api/classroom-recording/livekit-webhook
     ```

### Phase 1 — Backend extension (3 days)

**Goal:** backend can create LiveKit rooms, hand out publisher tokens, start/stop egress, and ingest webhook events into the Recording model.

Files we touch in `lecture-capture-system/backend/`:

| File | Change |
|---|---|
| `package.json` | Add `livekit-server-sdk` |
| `services/livekitService.js` | **NEW** — port from KIIT_LMS, add `startEgress` + `stopEgress` |
| `services/livekitWebhook.js` | **NEW** — port from Univanta egress webhook, adapt to Recording model |
| `controllers/classroomRecordingController.js` | Modify `findOrCreateSession` and `triggerMerge` (see §4.1.1) |
| `routes/classroomRecording.js` | Add `POST /livekit-webhook` |
| `models/Recording.js` | Add the fields listed in §3.3 |
| `.env` (Railway) | Add LIVEKIT_* vars |

**Behaviour:**

- When the TV calls `POST /recordings/session` (existing endpoint) we now also:
  1. Create LiveKit room `phyclass-<recordingId>`
  2. Generate a 4-hour publisher token for the TV (identity = `deviceId`, role = teacher)
  3. Call `EgressClient.startRoomCompositeEgress` immediately — output path `physical-class-recordings/{date}/{room}/{recId}/full.mp4`
  4. Save `livekitRoomName`, `livekitEgressId`, `livekitEgressStatus="pending"` on Recording
  5. Return `{ recordingId, livekit: { wsUrl, token, roomName } }` in addition to the existing response

- When `egress_ended` webhook fires we set `Recording.mergedVideoFile = blobUrl`, `mergeStatus="ready"`, `livekitEgressStatus="available"`, and skip the existing ffmpeg merge/smoothing path.

- Existing routes (`heartbeat`, `health-report`, `register`, `force-stop`) are **unchanged** — heartbeat, health, OTA still work the same.

**Exit criterion:** with no Android changes yet, a Postman test calling `POST /recordings/session` followed by a manual stop and `egress_ended` webhook produces a Recording row whose `mergedVideoFile` URL plays back in the admin portal.

### Phase 2 — Android publisher (5 days)

**Goal:** the existing `classroom-recorder-android` app publishes screen + camera + mic to LiveKit instead of writing local segments.

Files we touch:

| File | Change |
|---|---|
| `app/build.gradle.kts` | Add `io.livekit:livekit-android:2.x` and `io.livekit:livekit-android-track-processors` |
| `service/RecorderForegroundService.kt` | Replace `startRealTimeRecording` body — see §4.2.1 |
| `data/network/ApiService.kt` + `Models.kt` | Add response field `livekit: { wsUrl, token, roomName }` |
| `gl/PipCompositor.kt`, `camera/HiddenCameraCapture.kt`, etc. | **Mark deprecated** — kept for legacy fallback during pilot |
| `data/local/PreferencesManager.kt` | Add `useLiveKitPipeline: Boolean` (default `false` until Phase 4 cutover) |

**Replacement pseudocode for `startRealTimeRecording`:**

```kotlin
private fun startLiveKitPipeline(session: SessionResponse) {
    // 1. Connect
    room = LiveKit.create(applicationContext)
    room.connect(session.livekit.wsUrl, session.livekit.token, ConnectOptions(autoSubscribe = false))

    // 2. Screen track (MediaProjection — already have permission)
    val screenTrack = LocalScreencastVideoTrack.createTrack(
        room, mediaProjectionData, ScreencastOptions(width = 1280, height = 720, fps = 15)
    )
    room.localParticipant.publishVideoTrack(screenTrack, name = "screen")

    // 3. Camera track (USB UVC via Camera2 — same source as today's PiP)
    val cameraTrack = LocalVideoTrack.createCameraTrack(
        room, CameraCaptureOptions(deviceId = uvcDeviceId, width = 1280, height = 720, fps = 15)
    )
    room.localParticipant.publishVideoTrack(cameraTrack, name = "camera")

    // 4. Mic track
    val audioTrack = LocalAudioTrack.createTrack(
        room, AudioCaptureOptions(deviceId = micDeviceId)
    )
    room.localParticipant.publishAudioTrack(audioTrack, name = "mic")

    // 5. Health → heartbeat
    healthRecording = HealthRecording(
        videoPipeline = "livekit",
        livekitRoom = session.livekit.roomName,
        livekitConnectionState = room.state.toString(),
        // … no more segIndex / pipelineMode / audioLevelDb (we get audio level from track stats)
    )
}
```

**What we keep on the TV:**
- Foreground service + boot receiver + scheduled-class alarm (kiosk lifecycle)
- HangMonitor + watchdog (now monitors LiveKit `room.state` instead of MediaCodec heartbeats)
- USB camera enumeration + mic selection
- Heartbeat → `lastHeartbeat`, `health.*`, `recording.livekitConnectionState`, `audioLevelDb` from track stats
- OTA install flow
- QR overlay for attendance (independent of recording pipeline)

**Exit criterion:** debug build on the LG 55TR3DK publishes 3 tracks for 60 minutes without disconnect; Egress recording playback shows screen + camera PiP + audible audio for the full 60 minutes.

### Phase 3 — Spike test (1–2 days, can overlap with Phase 2)

**Goal:** prove the TV can sustain a 1-hour publish before we commit to migration.

1. **Network**: at the actual classroom (LG 55TR3DK on its real WiFi), `iperf3 -t 3600 -c <vm>` — must hold ≥2 Mbps upload, <100 ms RTT, <2% loss.
2. **Minimal publisher** (mic + screen only, no camera): debug APK from Phase 2 runs for 60 min; Egress plays back cleanly.
3. **Full publisher** (mic + screen + camera): same test repeated.
4. **CPU/RAM headroom**: heartbeat reports must show `cpu < 75%`, `ram_used < 75%` for the entire hour.

**Exit criterion:** all four sub-tests pass in two consecutive runs. If any fails, we go back to Phase 2 (or earlier) — we do **not** ship to production.

### 4.6 — Live admin viewing (added 2026-04-25 after user request)

A core LiveKit benefit the legacy pipeline cannot provide: **admins can
watch a class live while it's recording.** The TV publishes; admins
subscribe to the same room. Egress recording is independent — admin
viewing has zero effect on what gets recorded.

**Backend (already implemented in Phase 1):**

- `POST /api/classroom-recording/recordings/:id/admin-watch-token` —
  admin-authenticated endpoint that returns a 2-hour subscriber token
  (`canPublish: false`, `canSubscribe: true`) plus the WebSocket URL and
  room name. Multiple admins can request tokens for the same room
  concurrently.

**Admin portal (Phase 4 add):**

- Recording detail page gets a "Watch live" button when
  `recording.pipeline === "livekit"` and `recording.status === "recording"`
- Button calls the endpoint above, then mounts the LiveKit React room
  component (`@livekit/components-react`) which already exists in the
  KIIT_LMS_FRONTEND we can crib from.

**What the admin sees:** screen feed + camera PiP + live audio at ~1-2 s
latency. Multiple admins watching → one extra subscriber per admin in the
LiveKit SFU; the TV's upstream load doesn't change.

This effectively turns the recording system into a real-time monitoring
system for free — useful for spot-checks ("is the class actually
happening?", "is the slide deck the right one?", "is the mic muted?")
that today require physically walking to the room.

### Phase 4 — Pilot (3 days)

**Goal:** one TV runs both pipelines in parallel, admins compare results.

- TV runs the new APK with `useLiveKitPipeline = true` for one TV (pushed via remote command, no force-OTA)
- The legacy MediaCodec path stays in the codebase as a kill-switch — flipping `useLiveKitPipeline = false` reverts within one heartbeat
- Pilot 5 real classes (mix of 30-min and 60-min) — compare:
  - Final MP4 plays smoothly (no jank)?
  - Audio present full duration?
  - Duration matches scheduled length within ±2 %?
  - No mid-class hangs?
  - Final file appears in admin portal within 5 min of class end?
- Document any new bugs in `LectureLens-Engineering-Plan.md` with I-### IDs

**Exit criterion:** 5/5 pilot classes pass on all checks above.

### Phase 5 — Cutover (1 day)

- Flip `useLiveKitPipeline = true` as default in `PreferencesManager`
- Push new APK as OTA to all production TVs
- After 1 week of clean runs, **delete** the legacy MediaCodec code paths:
  - `gl/PipCompositor.kt`
  - `gl/EncoderInputSurface.kt`
  - `screen/SegmentMuxer.kt` (and friends)
  - `audio/AudioMuxer.kt`
  - Backend: `utils/segmentMerger.js`, `utils/audioMerger.js`, smoothing pass
- Drop the deprecated fields (`segments[]`, `audioFile`, `pendingUpload`, `pendingAudioUpload`) from Recording model and PreferencesManager

---

## 5. Risks & mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Azure FD does not pass UDP — WebRTC fails | Medium | Blocker | Phase 0 verification; bypass FD with split DNS for media |
| LG TV's WebRTC encoder hits the same bug as MediaCodec H.264 | Low | Quality regression | LiveKit Android SDK falls back to VP8/VP9 SW encoder; still much faster than 1.6 fps |
| TV's classroom WiFi cannot sustain 2 Mbps for 1 hour | Medium | Stream drops | Phase 0 `iperf3`; if it fails, recommend wired Ethernet to the TV before we proceed |
| Egress server crashes mid-class | Low | Lose that one class | Egress auto-restart in Docker; webhook will fire `egress_ended` with `errorReason`; admin sees `failed` in portal — re-record next session |
| LiveKit VM scheduled maintenance | Low | All classes during the window fail | Coordinate maintenance with school timetable; document a fallback ("if LiveKit down, legacy path is one toggle away" — until Phase 5) |
| `livekit-server-sdk` major version differs between KIIT and Univanta | Low | Code port fails | Pin to the version Univanta uses (it's newer) — both repos vetted |
| Cost overrun | Low | Budget | Self-hosted Egress, no per-minute fees; the existing VM has spare CPU |

---

## 6. Cost

| Component | Monthly cost |
|---|---|
| LiveKit VM (B2ms) | ~₹5,000 (already paid by LMS — shared) |
| Egress add-on CPU on same VM | ~0 — VM has spare cycles for 1–2 concurrent egress |
| Azure Blob storage | Same as today (we're already storing recordings here) |
| Railway backend | Unchanged |
| **Net new cost** | **~₹0** for the pilot scale (1–5 rooms) |

If we scale beyond ~5 concurrent classes we may need a second Egress VM (~₹3,000/month additional). That's a Phase-6 problem, not a Phase-0 problem.

---

## 7. Rollback plan

At every phase boundary the legacy pipeline still works:

- **During Phase 1**: backend has new routes but TV still uses old code → no behaviour change
- **During Phase 2**: APK gates LiveKit behind `useLiveKitPipeline` pref (default `false`) → no behaviour change
- **During Phase 4 pilot**: remote command can flip the pref off in one heartbeat
- **After Phase 5 cutover**: tag a `pre-livekit-cutover` git tag on `classroom-recorder-android` and the backend so we can roll back via OTA if a regression appears in week 1

We do **not** delete legacy code until at least 7 production days post-cutover.

---

## 8. Open questions for the user

Before kicking off Phase 0 we need to confirm:

1. **LiveKit credentials** — where are `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` stored today? They are not in the local `.env` files we found; presumably in the LMS production environment. We need them on Railway.
2. **VM admin access** — who can SSH into the LiveKit VM to deploy the Egress container? Need that contact for Phase 0.
3. **Azure Blob container** — reuse the existing `physical-class-recordings` container, or create a new `livekit-egress-recordings` container? (Recommend reuse — simplifies admin portal playback URL logic.)
4. **DNS / Front Door** — does the LMS team prefer we add a new direct-VM hostname for LiveKit edge, or change the existing FD profile to bypass for `*.livekit.*`?
5. **Pilot TV choice** — proceed with the existing 55TR3DK (Room 001) or use a spare unit? (Recommend the same TV — we want to prove the worst-case hardware works.)

---

## 9. Implementation kickoff checklist

When the user signs off, the very first concrete actions are:

- [ ] Get LiveKit credentials from VM admin → save to Railway `lecturelens-backend` env
- [ ] Run network test from Room 001 TV to LiveKit VM (1-hour iperf3)
- [ ] Deploy LiveKit Egress container on the VM
- [ ] Smoke-test Egress with `lk egress test-room` from a laptop
- [ ] Phase 1 PR opened against `classroom-recorder-backend` branch `feature/livekit-egress`
- [ ] Phase 2 PR opened against `classroom-recorder-android` branch `feature/livekit-publisher`

---

**End of plan.** Awaiting sign-off — please review §8 (Open questions) and reply with answers, then we start Phase 0.
