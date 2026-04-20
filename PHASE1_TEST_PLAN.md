# Phase 1 Test Plan — LectureLens v2.4.0-draisol

**Goal:** Validate that the Smart TV (55TR3DK) records classes reliably with
audible start/stop announcements, USB mic routing, and optional clean PiP-free
recording via the GL compositor. At the end of this plan the system should be
**beta-ready** for single-room/single-teacher daily use.

**Time required:** ~45 minutes end-to-end.

---

## Pre-requisites

- [ ] Smart TV powered on, connected to WiFi, facing the classroom
- [ ] `LectureLens-v2.4.0-draisol.apk` on your laptop (Desktop)
- [ ] ADB working (`adb devices` shows the TV)
- [ ] Admin portal open: https://lecturelens-admin.draisol.com
- [ ] (Optional) Sennheiser/Rode/any USB mic to plug in
- [ ] Backend version is v2.3.0 or later:
      `curl -s https://lecturelens-api.draisol.com/api/app/latest | jq`

---

## Step 1 — Install v2.4.0 on the TV

```bash
adb install -r "$HOME/Desktop/LectureLens-v2.4.0-draisol.apk"
```

**Success criteria:**
- `adb` prints `Success`
- On TV, the LectureLens app icon still works — no crash on launch
- In admin portal → Devices → the TV shows **v2.4.0-draisol (code 21)**
- Device stays **Online** for at least 2 consecutive heartbeats

If install fails ("Can't install as this user"), switch to the primary Android
user on the TV first. If ADB refuses, check USB debugging / Wireless Debugging
is enabled on the TV.

---

## Step 2 — Verify Chime is Audible (CORE FIX)

Open **admin portal → Devices → (TV) → Remote**. Scroll to the new
**Diagnostics** panel.

- [ ] Click **Test Chime (start)** → TV should play a 3-tone ascending chime (~700 ms)
- [ ] Click **Test Chime (stop)**  → TV should play a 3-tone descending chime

**Pass:** You hear both chimes clearly in the classroom.
**Fail:** Nothing audible — check TV volume is not muted; if still silent,
press the "Play Sound" button as a sanity check (it uses the system notification
ringtone and confirms the speaker path works at all).

**Why it matters:** Before v2.2.0 we relied on TextToSpeech which silently fails
on minimal ROMs. The chime path uses `AudioTrack` — much more reliable.

---

## Step 3 — Verify Mic Selection (USB vs Built-in)

### 3a. Without USB mic

- [ ] Ensure no USB mic is plugged into the TV
- [ ] In Diagnostics panel, verify mic badge shows **"Mic: Built-in mic"** (gray chip)
- [ ] Click **Test Mic (3s sample)**
- [ ] Wait ~5 seconds, then open the **Commands** tab below
- [ ] Latest `test_mic` row's **Result** column should read something like:
      `Mic OK — device: Built-in mic, peak: -20.0 dB, rms: -35.0 dB, samples: 132300`

### 3b. With USB mic (if you have one)

- [ ] Plug in Sennheiser / Rode / any USB mic to the TV's USB port
- [ ] Wait ~10 seconds, then hit **Refresh** on the admin portal
- [ ] Mic badge should now show **"Mic: Sennheiser (USB device)"** or similar — with a **green chip** and USB icon
- [ ] Click **Test Mic** again → result should now include `device: Sennheiser...` (or whatever your USB mic reports)

### 3c. Hot-swap during recording (ambitious but worth it)

- [ ] Schedule a 5-min test class (see Step 5)
- [ ] Halfway through, plug/unplug the USB mic
- [ ] `adb logcat -s RecorderService:I AudioDeviceSelector:I` should show
      `Mic changed mid-recording: <new device>` without dropping audio

**Pass:** Badge updates to reflect the plugged-in device; mic name changes in the test result.

**Why it matters:** Before v2.2.0 the app hardcoded `MIC` without preferredDevice
— USB mics were ignored.

---

## Step 4 — GL Compositor with Hidden Camera PiP

This is the **user's original complaint**: PiP circle on TV looks awkward.
v2.4.0 finally resolves it the right way: the PiP appears in the recorded
video but **not on the TV screen** (camera feed is routed through a hidden
Camera2 session straight into the GL compositor — no window, no overlay).

### 4a. Baseline (legacy mode — both TV and recording show PiP)

- [ ] Diagnostics panel shows `GL flag: OFF`, `Pipeline: Legacy (PiP visible on TV)`
- [ ] Schedule a 5-min class (or use Force Start — see Step 5)
- [ ] During recording, you SHOULD see the small circular camera PiP in the
      bottom-right corner of the TV screen. ← this is the old, awkward behaviour.
- [ ] Recording video also has PiP (legacy mode = PiP in both places).

### 4b. GL Compositor mode (PiP in recording, NOT on TV)

- [ ] Click **Enable GL Compositor** in Diagnostics panel
- [ ] Badge flips to `GL flag: ON`
- [ ] Stop the current recording (Force Stop) if one is running
- [ ] Start a NEW recording (next scheduled class, or Force Start)
- [ ] Diagnostics now shows `Pipeline: GL Compositor (clean)` and the
      new `GL Camera PiP` health field should be `true`
- [ ] **During recording, the TV screen has NO PiP circle visible** ← core fix
- [ ] **Recorded MP4 DOES have the PiP circle** in the bottom-right
      (hidden Camera2 session writes frames straight into the GL compositor's
      camera texture, compositor masks them to a circle, encoder outputs the
      composited frame)
- [ ] Open Recordings → play the new recording → confirm PiP visible in video

### 4c. Fallback — camera open failure

If Camera2 fails (permission revoked, hardware busy, etc.), recording must
still complete. Test this:

- [ ] Revoke the CAMERA runtime permission from LectureLens (App info → Permissions → Camera → Deny)
- [ ] Schedule a class in GL mode
- [ ] Diagnostics should show `GL Camera PiP: false` but `Pipeline: GL Compositor (clean)` still true
- [ ] Recording completes with clean screen and NO PiP (graceful screen-only)
- [ ] Re-grant CAMERA permission before proceeding to Step 5

### 4d. Fallback — GPU init failure

- [ ] If the TV's GPU can't handle GL, Diagnostics shows `GL init error: <reason>`
- [ ] Recording automatically falls back to Legacy mode — **never breaks**
- [ ] Pipeline badge shows `Legacy (PiP visible on TV)` even with flag ON

**Pass:** With GL enabled, TV screen is clean during recording AND the recorded
video contains the PiP circle.

**Pitfall:** the hidden camera uses the same permission grant as the overlay
camera (CAMERA). If you run 4b without the permission, `GL Camera PiP` will
be `false` and the recording will be screen-only with a black area where
the PiP would have been. Expected — this is the graceful fallback.

---

## Step 5 — Schedule a Real Recording

Now test the full end-to-end flow with the fixes in place.

- [ ] In admin portal → Schedule Class → Create a **5-minute test class**
      in Room 001 starting 3 minutes from now
- [ ] **Without touching anything else**, watch the TV and the admin portal
- [ ] At class start time:
  - Chime plays (Step 2 validates this works)
  - TV notification changes to "Recording: <class title>"
  - admin portal → Devices → TV shows **isRecording: true**
- [ ] Wait for the class to end (5 min)
- [ ] At class end:
  - Chime plays (descending this time)
  - Recording notification goes back to Idle
  - In admin portal → Recordings, the new recording appears with status
    `completed` (or `uploading` briefly) — NOT stuck at `recording`
- [ ] Click Play on the recording → audio + video both play correctly
  - Duration matches (~5 min + ~2 min buffer)
  - Audio is from the selected mic (USB if plugged in)
  - Multi-segment if > 5 min (Segment 1/2 overlay visible)

**Pass:** All bullets above.
**Fail at any step:** Use the `Pull Logs` button in admin portal to grab device
logcat, then share the output — the device now reports detailed health telemetry
including `lastGlInitError`, `chimeEngineOk`, `ttsEngineOk`, `micLabel`.

---

## Step 6 — Schedule Catch-up (short-class fix)

Before v2.2.0, very short classes (1-3 min) were sometimes missed because
the 30-second schedule check landed outside the 1-minute start window.
Now the check runs every 10 s, the window is 3 min, and missed classes
within 90 s of end time still get recorded.

- [ ] Schedule a **2-minute** class starting 1 minute from now
- [ ] DO NOT touch the TV
- [ ] Class should still record end-to-end

**Pass:** Recording appears in admin portal for that class.

---

## Step 7 — OTA Install-Loop Prevention

Before v2.2.0, if OTA install silently failed (user didn't tap Install), the
device would re-download and re-prompt every 2 min forever.

- [ ] Upload a v2.3.1 APK (bump version, don't change code) via admin portal
- [ ] On TV, when the Install prompt appears, **DISMISS it**
- [ ] Wait 4 minutes
- [ ] Device should NOT re-prompt you (cooldown is 15 minutes per version)
- [ ] Wait 16 min and it should re-offer once

**Pass:** Fewer install prompts. No infinite loop.

---

## Step 8 — Sign-off Checklist

Mark ALL of these as passed before declaring Phase 1 beta-ready.

- [ ] **Chime audible** at recording start and stop (Step 2)
- [ ] **USB mic auto-selected** when plugged in, falls back to built-in on unplug (Step 3)
- [ ] **GL compositor toggle** works — recording without on-TV PiP (Step 4)
- [ ] **Legacy fallback** when GL fails (check `lastGlInitError` in admin portal)
- [ ] **Full recording flow** end-to-end for a scheduled 5-min class (Step 5)
- [ ] **2-minute class** still gets recorded (Step 6)
- [ ] **OTA cooldown** prevents install-loop (Step 7)
- [ ] **No stuck recordings** in Recordings page (all `completed` or `failed`, none stuck at `recording`)
- [ ] **Device stays Online** for at least 30 consecutive minutes without drops

---

## Known Limitations (will be addressed in later phases)

### ✅ Phase 2 — SHIPPED in v2.4.0
- Camera-in-GL-frames landed via new `HiddenCameraCapture` class. GL mode
  now records the PiP while keeping the TV screen clean. Validated in Step 4.

### Phase 3
- **Native USB camera (Lumens):** Still requires CameraFi or similar bridge
  app. Native UVC support is a 5-7 week dedicated project (libusb JNI + UVC
  probe/commit protocol + per-SoC testing). Deferred.

### Phase 4
- **7-day continuous stability:** Not yet validated. Expect one of: memory
  leak, log file growth, thermal throttle, heartbeat drift. These surface
  only through soak testing.

### Phase 5
- **State-machine refactor:** Recording state today is scattered across
  multiple `@Volatile` flags. A formal FSM (IDLE → STARTING → RECORDING →
  STOPPING → UPLOADING → COMPLETED/FAILED) would eliminate a whole class of
  race conditions. Not urgent but worth doing before wide deployment.

---

## Escalation

If any Step fails and you can't figure out why:

1. In admin portal → Device Remote → click **Pull Logs**
2. Wait ~30 s, then click the **Logs** tab
3. Expand the latest log → copy the output
4. Paste here with a description of what you were trying to do

The logs now include every relevant diagnostic:
- `videoPipeline` — which path was used for the recording
- `glCompositorEnabled` — current flag state
- `glCameraPiP` — true if hidden Camera2 session is feeding frames into GL compositor
- `lastGlInitError` — why GL fell back (if it did)
- `micLabel` — which mic was actually selected
- `chimeEngineOk` / `ttsEngineOk` — announcement engine status
