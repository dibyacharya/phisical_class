# v2.6.0 Verification Runbook

**When to run this:** After sideloading `~/Desktop/LectureLens-v2.6.0-draisol.apk` on the Smart TV.
**Estimated time:** 10 minutes.
**Goal:** Confirm every v2.6.0 fix works end-to-end before handing the system over to teachers.

---

## What's in v2.6.0

| Feature | Where | How you verify |
|---------|-------|----------------|
| Video corruption fix | Android encoder | Test recording plays cleanly (no RGB noise) |
| USB hardware inspector | TV + admin portal | Notification bar text + Hardware Inventory panel |
| Log upload fix | Android AppLogRing | `pull_logs` command returns real log content |
| Segment merge | Backend (ffmpeg on Railway) | Recordings > 5 min show as ONE file, not segments |
| Single-file download | Admin portal | "Download" button gives one `.mp4` |
| Hardware alerts | Admin portal | Red banner when USB camera/mic missing |

### Known gap — USB camera streaming

This TV has no Camera2 UVC bridge (expected on commercial-display SoCs). The Lumens USB camera will appear in the **Hardware Inventory panel** (USB bus shows vendor/product IDs), but it won't stream into the recording — the PiP circle will remain black or not shown. **Full USB camera streaming lands in v2.7.0** with the saki4510t UVCCamera library. For v2.6.0 validation, focus on screen + audio recording quality.

---

## Step 1 — Install the APK

1. Transfer `LectureLens-v2.6.0-draisol.apk` to the TV (USB stick or network drop).
2. Open it on the TV — install will prompt, accept.
3. Open LectureLens from the launcher once after install (this kicks off the foreground service with the new encoder config).
4. **Check the TV notification bar.** v2.6.0 adds a startup hardware banner. Expect one of:
   - `Ready — camera:N mic inputs:M` → healthy state
   - `⚠ Missing: camera + mic — check USB cable` → hardware not detected, see Step 2
   - `USB camera detected — direct mode (no Camera2 bridge)` → expected on this TV, v2.7.0 will stream it

Screenshot the notification text if anything unexpected.

---

## Step 2 — Check admin portal Hardware Inventory

1. Open https://lecturelens-admin.draisol.com → Devices → Smart TV - Room 001 → Remote Control.
2. Scroll the right-side health sidebar until you see the **Hardware Inventory** panel (new in v2.6.0).
3. You should see three sections:
   - **Camera Mode** — one of the four statuses (green `✓ External via Camera2`, blue `USB direct mode`, amber `Internal only`, or red `✗ No camera detected`)
   - **USB Bus (N)** — raw enumeration. Plug-in Lumens should appear with vendor=`Lumens`, `hasVideo=true`
   - **Camera2 API (N)** — what Android API sees. Most likely empty on this commercial-display TV
   - **Audio Inputs (N)** — Sennheiser should appear as `USB_DEVICE` in blue

**Expected result** on a correctly-wired TV:
- USB Bus: ≥2 entries (Lumens + Sennheiser + hub/keyboard if any)
- Audio Inputs: at least `BUILTIN_MIC` + `USB_DEVICE` (Sennheiser)
- Camera2 API: 0 entries (that's OK for this SoC — v2.7.0 handles USB camera)

**Red flags:**
- USB Bus empty → USB port is dead or in "power-only" mode, try another port
- Sennheiser absent from Audio Inputs → mic cable / mic power issue

---

## Step 3 — Test video fix with a 2-minute recording

1. Admin portal → Booking → schedule a 3-minute class starting 3 minutes from now (assign to Smart TV - Room 001).
2. Open a classroom slide deck or browser tab on the TV so there's actual screen content to record.
3. Wait for recording to auto-start (device shows `Recording: [class title]` on notification bar, start chime plays).
4. After ~2 minutes, end the class early via admin portal → Devices → Remote → **Force Stop**.
5. Go to Recordings page → find the new recording → click the thumbnail to open the player.

**Expected:**
- Video plays cleanly, no RGB noise, text legible (this was broken in v2.5.0-v2.5.3)
- File size around 12–20 MB for 2 min (~800 kbps — matches encoder setting)
- Top-right shows `Single file (merged)` in green (merge happened automatically)
- Download button gives ONE `.mp4`, not a "Download All (2)" list

**Red flags:**
- RGB noise still present → encoder fix didn't take effect; verify app version (should be 2.6.0-draisol) via admin portal
- Status shows `2 segments · merging…` for > 30 sec → ffmpeg missing on Railway (check deploy log), or click **Merge segments** button to retry manually
- Status shows `2 segments · merge failed` → click **Retry merge** button

---

## Step 4 — Test log upload

1. Admin portal → Remote Control → Command panel → **Pull Logs** (or call the API directly).
2. Wait 30–60 seconds.
3. Command history should show `pull_logs` transition from `acknowledged` → `completed`.
4. Admin portal → Logs tab → latest entry should show:
   - `source: ring` (AppLogRing worked) — BEST
   - `source: shell` (logcat shell worked as fallback) — also fine
   - `source: placeholder` (ring empty, shell blocked) — only happens if you hit pull_logs immediately after boot, wait 2 min and retry

**Red flags:**
- Command stuck at `acknowledged` > 2 min → device crashed during upload, check `restart_app`

---

## Step 5 — Test long recording (segment merge proof)

1. Schedule a 7-minute class (assigns ≥2 segments at 5-min rotation).
2. Let it run full duration.
3. After recording ends (~30 seconds grace for merge), open the recording.

**Expected:**
- Recording player shows `Single file (merged)` in green
- Download gives one `.mp4` containing both segments seamlessly
- `duration` in recording metadata equals sum of segment durations (≈ 7 min)
- No visual glitch at the 5-min segment boundary (encoder formats match, concat is lossless)

If merge failed, click **Merge segments** button on the player footer — that re-runs it synchronously and surfaces any error.

---

## Success Criteria

Check all six to call v2.6.0 validated:

- [ ] Video playback clean (no RGB noise) on 2-min test recording
- [ ] File size proportional to bitrate (not 3× inflation seen in v2.5.x)
- [ ] Admin portal Hardware Inventory panel shows Lumens + Sennheiser in USB Bus list
- [ ] TV notification bar shows accurate hardware state
- [ ] `pull_logs` command returns non-empty log text via admin portal
- [ ] 7-min test recording plays as single merged file, download gives one `.mp4`

If all six pass, v2.6.0 is production-ready for the pilot. If any fail, note which and share the admin portal screenshot — failure mode usually tells us exactly which subsystem needs the next iteration.

---

## Rollback

If v2.6.0 misbehaves worse than v2.5.2-draisol (code 24), sideload this older APK to downgrade:
- `~/Desktop/LectureLens-v2.5.2-draisol.apk` (code 24)

Then admin portal → App Update → mark v2.5.2 active to stop the OTA loop pushing v2.6.0 back.

---

## v2.7.0 preview (for reference)

- **UVCCamera library (saki4510t)** — Lumens camera streams directly via USB protocol, bypassing Camera2. Teacher face appears in the PiP circle.
- **USB permission dialog** — prompts once on first camera connect, then persists.
- **Hot-plug support** — unplug and re-plug Lumens mid-class, it reconnects without restarting the app.

We ship v2.7.0 after v2.6.0 is proven stable for ~1 week in production.
