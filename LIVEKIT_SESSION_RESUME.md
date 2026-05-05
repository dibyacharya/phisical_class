# LiveKit Migration — Session Resume Notes
**Last session: 2026-04-25**
**Status: Foundation done + mic-only pipeline proved E2E. Screen + camera tracks deferred.**

---

## TL;DR — what works today

✅ **TV → LiveKit → Egress → Azure Blob** confirmed end-to-end (spike #5)
✅ MP4 file in Azure: `lms-storage/physical-class-recordings/2026-04-25/001/{recId}/full.mp4` (7.3 MB, video/mp4, valid)
✅ Backend webhook handler properly populates Recording.mergedVideoUrl (after commit `a3bba48`)
✅ Audio reliability problem **solved** — RTP transport replaces fragile audio.m4a one-shot upload

❌ Screen track via LiveKit — needs dual-consent flow (v3.2.5 work)
❌ USB camera via LiveKit — needs custom VideoCapturer (v3.3.0 work)

---

## Current production state (all systems)

| Component | State |
|---|---|
| **Azure VM** (`livekit.kiitdev.online`, `20.193.239.201`) | Running. livekit-server + egress + redis + caddy all healthy. |
| **Egress container** | Deployed in `/home/azureuser/livekit.kiitdev.online/`, restart-always. Tuned for B2ms (2 vCPU). |
| **livekit.yaml webhook** | Pointing to `https://lecturelens-api.draisol.com/api/classroom-recording/livekit-webhook` |
| **Railway backend** | Latest deploy is `a3bba48` — webhook enum fix + EncodedFileOutput shape fix |
| **Railway env vars** | `LIVEKIT_ENABLED=true`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `LIVEKIT_WS_URL` all set. Reuses existing `AZURE_STORAGE_CONNECTION_STRING`. |
| **Android APK on TV** | `v3.2.4-livekit-mic-stable` (versionCode 77). Mic-only LiveKit, screen via legacy. |
| **Device flag** | `useLiveKitPipeline=false` set at end of session for overnight safety. Real classes overnight will use legacy as before. |
| **Legacy pipeline** | Untouched and fully functional. All real classes record normally. |

**Safe to leave overnight.** Real classes will go via legacy as they did pre-spike. No experimental code in their path.

---

## Today's spike #1-#6 timeline (compressed)

| # | What we tried | Outcome | Fix shipped |
|---|---|---|---|
| 1 | v3.2.0 mic+screen (reusing legacy MediaProjection Intent) | Consent dialog loop on TV | v3.2.1: skip screen, mic-only |
| 2 | v3.2.1 mic-only | SDK auto-disconnect 250ms after join | Diagnose with v3.2.2 verbose logging + 5s settle window |
| 3 | v3.2.2 mic-only — early heartbeat | Same fail, captured root cause | confirmed it's an ICE settle timing issue |
| 4 | v3.2.2 mic-only — full attempt | TV connected 5m45s ✅. Audio published. Egress active full duration. Final upload failed with "permission denied". | Backend fix `ab7ae20`: EncodedFileOutput.output as protobuf oneof case/value with AzureBlobUpload |
| 5 | v3.2.2 mic-only with fixed backend | ✅ MP4 in Azure (7.3 MB). Backend marked failed because webhook misread enum=3 as failure. | Backend fix `a3bba48`: status normalization int↔string |
| 6 | v3.2.3 mic+screen (skipping legacy projection consume) | Regression — RTCPeerConnection ICE never converged. Stuck CONNECTING for 5s. | v3.2.4 reverted to v3.2.2 behaviour. Screen deferred. |

---

## Architecturally proven (don't redo this)

- LiveKit Server v1.x on B2ms VM is reachable from TV's LAN (UDP + TCP both work)
- TV's libwebrtc (Android SDK 2.7.0) connects in ~600ms when MediaProjection is alive in process
- Mic publish via WebRTC works — `audio/red` Opus track with AGC/AEC/NS
- Egress's Chrome composite recorder produces valid MP4 to Azure when given correct Output config
- Webhook delivery from livekit-server to Railway works reliably (1-2s latency)
- All backend code paths exercised: findOrCreateSession, livekit-webhook, admin-watch-token, triggerMerge

---

## Next session — start here

### Priority 1: v3.2.5 — Screen share with dual-consent flow (~2-3 hrs)

The 55TR3DK SoC needs a legacy MediaProjection alive in process for libwebrtc ICE to converge. Spike #6 confirmed this. Solution:

1. **New activity:** `LiveKitProjectionRequestActivity.kt` — cousin of existing ProjectionRenewActivity but stores Intent in a separate `liveKitProjectionData` field
2. **Order of operations** in `RecorderForegroundService.startRecording`:
   ```
   if (useLiveKitPipeline) {
     ensure legacy projection alive (existing flow)  ← keeps system happy
     request fresh Intent via LiveKitProjectionRequestActivity
     await liveKitProjectionData
     pass to startLiveKitRecording → LiveKitPipeline.start
     LiveKit's setScreenShareEnabled consumes the FRESH Intent (not the spent legacy one)
   }
   ```
3. **AutoInstallService** auto-taps both consents in sequence (already proven works)
4. Test: 5-min class with screen + mic published

Files to write/modify:
- `app/src/main/java/in/lecturelens/recorder/ui/LiveKitProjectionRequestActivity.kt` (NEW, ~80 lines)
- `service/RecorderForegroundService.kt` — wire the dual-consent flow into `startRecording`
- `service/LiveKitPipeline.kt` — already accepts mpData, no change needed

### Priority 2: v3.3.0 — USB camera as 3rd LiveKit track (~3-4 hrs)

The Lumens VC-TR1 is a UVC USB camera. Currently we read it via `HiddenCameraCapture.kt` (custom Camera2 + UVCAndroid bridge). LiveKit's default CameraCapturer wraps Camera2 which silently drops frames on this SoC.

Plan:
1. Implement a custom `LiveKitVideoCapturer` that wraps `HiddenCameraCapture`
2. Each captured YUV frame → `VideoCapturer.CapturerObserver.onFrameCaptured(VideoFrame)`
3. Publish as a `LocalVideoTrack` named "camera"
4. Egress composite layout already supports multiple video tracks — picks active speaker

Files to write/modify:
- `app/src/main/java/in/lecturelens/recorder/livekit/UvcVideoCapturer.kt` (NEW, ~150 lines)
- `service/LiveKitPipeline.kt` — add third track publish

### Priority 3: 1-hour stability test (~1 hr)

Once v3.2.5 + v3.3.0 work in 5-min smoke tests, run a 1-hour real class on Room 001 TV. Verify:
- No mid-class disconnect
- No memory leak (heap < 200 MB)
- Final MP4 plays back end-to-end
- Audio + screen + camera all visible
- Webhook delivers cleanly at end

### Priority 4: Phase 4 — Pilot + admin Watch-Live UI

- Run 5 real classes on Room 001 with v3.3.0
- Compare against same-period legacy recordings for quality
- Add "Watch Live" button to admin portal Recordings.jsx
- Document operator runbook

### Priority 5: Phase 5 — Cutover

- Flip default `useLiveKitPipeline=true` in PreferencesManager
- OTA push to all production TVs
- After 7 production days clean, delete legacy code:
  - `gl/PipCompositor.kt`, `gl/EncoderInputSurface.kt`
  - `service/RecorderForegroundService.kt` MediaCodec sections
  - `utils/segmentMerger.js` smoothing pass
  - `models/Recording.js` segments[] + audioUrl fields

---

## Open questions / decisions for next session

1. **MediaProjection dual-consent UX** — when AutoInstallService runs both consents, will the user see two flashes? Acceptable? Test on actual TV.

2. **Egress concurrent capacity** — current B2ms (2 vCPU) handles 1 class. If we need 2+ concurrent recordings later, upgrade to B4ms (~₹5k/mo extra) OR run a separate Egress on a different VM.

3. **Camera track resolution** — at 720p15 the SoC + uplink is comfortable. If we want 1080p later, need to test bandwidth + Egress CPU headroom.

4. **Watch-Live UI** — admin portal already has Recordings.jsx. We add a "Watch Live" button that opens a modal embedding `@livekit/components-react` PreJoinPage + Room view. Build this when we hit Phase 4.

5. **Recording rfbhj (failed spike #6)** — currently in DB with mergeStatus=failed. Either backfill (manually set mergedVideoUrl to its actual Azure file) or just delete. Cosmetic.

---

## Reference: keys, URLs, IDs

| What | Where |
|---|---|
| LiveKit server | `wss://livekit.kiitdev.online` (Azure VM `20.193.239.201`) |
| LiveKit API key | `APICCWntMDct29C` (set in Railway env, on VM `livekit.yaml`) |
| LiveKit API secret | (in Railway env, on VM — not in this doc) |
| Azure storage | `stgkiitlmsdev` account, `lms-storage` container, prefix `physical-class-recordings/` |
| Pilot TV | `dev_82455415385a97d9` — LG 55TR3DK in Room 001 |
| VM SSH | `azureuser@20.193.239.201` with `~/Downloads/vm-livekit_key.pem` |
| Backend repo | `https://github.com/dibyacharya/phisical_class.git` (Railway watches `main`) |
| Latest backend commit | `a3bba48` — webhook enum normalization |
| Latest APK | `3.2.4-livekit-mic-stable` (versionCode 77) |

---

## To resume: just open this file and pick up at "Priority 1"

```bash
cd "/Users/dibyakantaacharya/ADMIN_PORTAL_with_phisical class/lecture-capture-system"
cat LIVEKIT_SESSION_RESUME.md
```

Tomorrow's first 5 minutes:
1. Verify TV heartbeat alive + on v3.2.4
2. Toggle `useLiveKitPipeline=true` via remote command (should already be False at session end)
3. Start writing `LiveKitProjectionRequestActivity.kt`
