# Morning Runbook — LectureLens Smart TV Setup

**Purpose:** Step-by-step for the first 30 minutes after powering on the Smart TV in the morning.
**Audience:** Admin / Operator at the classroom.
**Estimated time:** 10 minutes hands-on, 20 minutes watching.

---

## Pre-flight (before touching the TV)

Check these from your laptop / phone in browser:

1. Open https://lecturelens-admin.draisol.com — log in with admin credentials
2. Navigate to **Devices** page
3. **Expected state:** Smart TV - Room 001 shows as **OFFLINE** (that's fine — TV is off)

If device already shows ONLINE, someone powered on the TV ahead of you — skip to Step 3 below.

---

## Step 1 — Power on the TV

1. Press the TV's physical power button OR use remote
2. Wait for the home screen to fully load (~30 sec)
3. **Do nothing on the TV yet** — the LectureLens app auto-starts via BootReceiver

---

## Step 2 — Wait for Heartbeat (2 min)

Open admin portal → Devices → Smart TV - Room 001

Watch the card for these transitions:

```
T+0:30  Offline (green dot still grey)
T+1:00  ↓
T+1:30  Online (green dot) — first heartbeat landed
T+2:00  Version badge shows v2.5.0-draisol (current installed version)
```

**If no heartbeat within 3 min:**
- WiFi issue on TV → check TV's WiFi settings
- App not auto-started → open app launcher on TV, tap LectureLens

---

## Step 3 — Let OTA Auto-Upgrade Happen (2-3 min)

The device heartbeat will tell the server "I'm on v2.5.0" and server will respond
with "v2.5.1 is available". Because accessibility is enabled on this TV (verified
yesterday), install happens silently.

**Watch the version badge in admin portal:**

```
T+2:30  v2.5.0-draisol  (still)
T+3:00  v2.5.0-draisol  (downloading in background — no visible change)
T+3:30  v2.5.0-draisol  (installing — service briefly pauses)
T+4:00  v2.5.1-draisol  ✓ UPGRADED
```

**If stuck at v2.5.0 for 5+ minutes:**
- TV might be asking for manual install tap — look at TV screen
- OR accessibility was disabled — re-enable via:
  TV Settings → Accessibility → LectureLens Auto-Install → ON
- Last-resort manual install via ADB:
  ```bash
  adb install -r "$HOME/Desktop/LectureLens-v2.5.1-draisol.apk"
  ```

---

## Step 4 — Verify Full Health

After the version shows v2.5.1-draisol, navigate to **Fleet Dashboard**
(/fleet) and click the Smart TV card. You should see:

| Indicator | Expected Value |
|-----------|----------------|
| Health score | ≥ 80 (green) |
| Camera | ✓ OK |
| Mic | ✓ OK |
| Screen | ✓ OK |
| Disk | free space > 5 GB |
| Mic label | Built-in mic (or USB mic if plugged in) |
| Chime engine | OK |
| Video pipeline | legacy_direct (default) |

Red flags:
- Health score < 50 → investigate alerts panel on device detail page
- Camera/Mic/Screen not OK → Pull Logs + inspect
- Disk < 2 GB free → trigger Clear Storage via bulk command

---

## Step 5 — Pre-class Smoke Test (optional but recommended)

Before the actual class, issue these test commands from admin portal
→ Smart TV → Remote Control → Diagnostics panel:

1. **Test Chime (start)** — device should play 3 ascending tones audibly in the room
2. **Test Chime (stop)** — device plays descending tones
3. **Test Mic (3s sample)** — wait 5 sec, then check the `test_mic` row's
   Result column: should say "Mic OK — device: ..., peak: -XX dB, samples: ..."
4. **Capture Screenshot** — thumbnail should appear in Live Preview tab
5. **Pull Logs** — logcat uploads to Logs tab within 10 sec

All 5 should show `completed` status in the command history.

---

## Step 6 — Schedule the Class

Navigate to **Booking** → pick a course + date + time.

Important:
- **Duration ≥ 5 minutes** (avoid 1-min classes — they can fall outside the
  heartbeat tick window even with our 90-sec catch-up logic)
- **Start time ≥ 3 minutes from now** (so the device has at least one
  schedule check to pick it up)
- Assign to **Smart TV - Room 001**

---

## Step 7 — Monitor the Recording

During class time, go to admin portal → Devices → Smart TV - Room 001:

- `isRecording: true` — recording active
- Notification on TV says "Recording: [class title]"
- You should hear the start chime on the TV when recording begins

When class ends:
- You should hear the stop chime
- Recording moves from status "recording" → "completed" in admin portal
- File appears in Recordings page
- Click Play — video should play cleanly (v2.5.1 has monotonic PTS fix, so
  no RGB-noise corruption)

---

## Common Issues + Fixes

### Issue: Recording stuck at "recording" for > 5 min after class end

**Root cause:** Device service died mid-recording or network interrupted.

**Fix:** Admin portal → Recordings → click "Force Stop" on the stuck row.
Or use the **"Fix Stuck"** button in the header to bulk-clean all stuck ones.

### Issue: Video playback shows RGB noise / corruption

**Root cause:** v2.5.0 or older has the duplicate-DTS bug. v2.5.1 fixes it.

**Fix:** Ensure device is on v2.5.1-draisol (check version badge). If
still on v2.5.0 re-run Step 3. If video file itself is corrupt, it can be
remuxed with:
```bash
ffmpeg -fflags +genpts -i broken.mp4 -c copy fixed.mp4
```

### Issue: Install prompt keeps reappearing every 15 min

**Root cause:** OTA cooldown exists but install never succeeds. Probably
permission issue on TV.

**Fix:** TV → Settings → Apps → Special app access → Install unknown apps
→ LectureLens → Allow. Then bulk upload APK via ADB.

### Issue: Admin portal shows device as "Outdated" even though version badge says latest

**Root cause:** `appVersionCode` got out of sync from a QA test using 99999.

**Fix:** Wait for the next real heartbeat (≤ 2 min). The device will report
its true version and overwrite the bad state.

### Issue: Chime not audible in classroom

**Root cause:** TV volume too low, OR chime engine failed (rare on v2.5+).

**Fix:** Turn TV volume to 70%+. Click "Test Chime (start)" in Diagnostics
panel. If still no sound, check Fleet Dashboard health card — chime engine
status will show MISSING.

---

## 911 — Escalation

If nothing works and class is about to start:

1. **Power-cycle the TV** (power off 10 sec, power on) — clears most state issues
2. **Re-install APK via ADB** — bypasses all OTA complications:
   ```bash
   adb install -r "$HOME/Desktop/LectureLens-v2.5.1-draisol.apk"
   ```
3. **Open the LectureLens app manually** on TV and grant all permissions
   walked through in Setup wizard (4 steps)
4. Schedule a force-start recording via admin portal → Smart TV → Remote → Force Start

---

## Success Criteria for the Day

By end of Step 7, you should have:

- [x] Device on v2.5.1-draisol (code 23)
- [x] Health score ≥ 80
- [x] All 5 smoke-test commands returned `completed`
- [x] At least one full class recording completed successfully
- [x] Video playback works cleanly (no RGB noise / ghosting)

If all 5 boxes checked, the system is pilot-ready for the day. Good luck!
