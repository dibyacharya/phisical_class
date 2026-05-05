# IT Team Network Investigation Brief

**To:** Campus IT Team
**From:** D&R AI Solutions / LectureLens Engineering
**Date:** 2026-04-30
**Subject:** Network connectivity issue blocking recording on Room 014 (and likely other Block A rooms)
**Urgency:** Blocking — class recording cannot start on affected rooms

---

## One-line summary

Room 014's signage TV is running and healthy, but **all real-time recording attempts fail because WebRTC connections to our cloud cannot establish through this room's network path**. We've confirmed the device, software, and hardware are working correctly. The issue is at the network layer.

---

## What we observe (symptoms)

1. **Recording attempts fail with error:** `"LiveKit failed: unknown"`
2. **Class status auto-flips to "completed"** before the recording can engage
3. **No video is captured, no MP4 is produced**
4. **Heartbeats from device to backend show consistent 2.7–3.3 second round-trip latency** (normal should be < 100 ms)
5. **Issue reproduces every time** — already failed 3 attempts on Room 014 today

---

## Specific affected device

| Field | Value |
|---|---|
| Room | Campus 25 — Block A — Ground Floor — Room 014 |
| Device ID | `dev_4e9aad921710f260` |
| Hardware | LG 55TR3DK Smart Signage TV (Droidlogic SoC, Android 11) |
| Reported IP address | **`192.168.0.1`** ← suspect (see below) |
| Reported MAC | `ANDROID-e63c669d1e3d682d` |
| App version | v3.7.3 (latest) |

---

## Reported network info from device (raw)

```json
{
  "ipAddress": "192.168.154.1",
  "network": {
    "wifiSignal": -127,
    "latencyMs": 2900-3300,
    "ssid": "<unknown ssid>"
  }
}
```

---

## The IP address discrepancy

**Your team confirmed Room 014 is on campus 10.x Ethernet.**
**Our device, however, reports its IP as `192.168.154.1`.**

This is impossible if it's truly on campus 10.x — and the **same `192.168.154.1` is reported by all our v3.7.x devices** (Rooms 008, 009, 010, 011 in Block A as well). Multiple devices cannot have identical IPs on a real network.

**Two possible explanations:**

A. **Our app is reading the wrong network interface** (likely a known cosmetic bug in v3.7.x, will fix in next release). The device IS on Ethernet 10.x, but the app misreports the IP.

B. **The TVs are actually NOT on campus 10.x** — perhaps connected through a USB tethering interface, an isolated VLAN, or a router that NATs them into a 192.168.154.x range.

**Either way**, the actual network traffic from these devices is going through a path that has **3-second consistent latency**, which makes WebRTC media connections unreliable.

---

## Why this matters — WebRTC requires low latency

Our recording system uses WebRTC over LiveKit. WebRTC requires:
- **<500 ms round-trip latency** for ICE candidate exchange
- **Open UDP ports** in 50000–60000 range
- **STUN/TURN server reachability**

With 3-second latency, the WebRTC handshake times out before completion. Result: `"LiveKit failed: unknown"` error.

---

## Comparison — Room 006 (working) vs Room 014 (failing)

| Attribute | Room 006 (recording works) | Room 014 (recording fails) |
|---|---|---|
| TV model | LG 55TR3DK | LG 55TR3DK (identical) |
| App version | v3.7.3-cycling-camera | v3.7.3-cycling-camera (identical) |
| Camera | Lumens VC-TR1 | Lumens VC-TR1 (identical) |
| Mic | Extron DMP Plus | Extron DMP Plus (identical) |
| **Reported IP** | **10.20.16.55** (real campus subnet) | **192.168.154.1** (anomalous) |
| **Network latency** | Mostly normal | **2.7–3.3 sec consistent** |
| **Recording status** | **Successful 1-hour recording yesterday** | **All attempts fail** |

The hardware and software are identical. **The only differentiator is the network path.**

---

## What we need IT team to investigate / verify

### Priority 1 — Verify network path

For Room 014's signage TV (and the other affected Block A rooms 008, 009, 010, 011):

- [ ] **Which physical switch port** is the TV's Ethernet plugged into?
- [ ] **Which VLAN** does that port assign? Is it the same VLAN as Room 006?
- [ ] **Run a speed test** from a laptop connected to the same Ethernet port — measure latency to `lecturelens-api.draisol.com` (our backend)
- [ ] **Compare latency** between Room 014's port vs Room 006's port
- [ ] **Run `traceroute` from the room** to identify any unusual hops or slow segments

### Priority 2 — WebRTC traffic compatibility

Our recording uses LiveKit Cloud which requires:

- [ ] **TCP 443** (HTTPS for signaling) — outbound
- [ ] **UDP 50000–60000** (WebRTC media) — outbound, ideally bidirectional via STUN
- [ ] **STUN/TURN servers** at `*.livekit.cloud` reachable

Please verify these are not blocked or rate-limited at:
- The room's switch/router
- Any campus firewall
- Internet gateway

### Priority 3 — Network DHCP / routing audit

- [ ] **DHCP lease** for Room 014 TV — is it getting a 10.x address or 192.168.x?
- [ ] **Default gateway** — does `192.168.154.1` show up anywhere as a gateway in your network configuration?
- [ ] **NAT rules** — is there any double-NAT happening for this VLAN?

---

## What we have already done (so you don't repeat)

| Action | Result |
|---|---|
| Verified device hardware (camera, mic, screen) | All detected and healthy |
| Verified app version (v3.7.3, latest) | Confirmed |
| Restarted app remotely | No effect on issue |
| Power-cycled TV completely | No effect on issue |
| Verified service uptime after restart | Clean (2-9 min uptime confirmed) |
| Verified disk, RAM, CPU all healthy | No resource issues |
| Verified backend cloud is responding | Yes, but with high latency |
| Tested same setup on Room 006 (different network port) | **Recording works perfectly** |

---

## How to verify a fix

After IT changes, we can re-test:
1. Schedule a 5-minute test recording on Room 014
2. We will check the heartbeat data to verify:
   - `latencyMs` drops below 200 ms
   - `ipAddress` reports a 10.x address (or stays as 192.x if it's a cosmetic bug, but latency must drop)
3. Recording must produce an MP4 file with no errors

---

## Contact

For technical questions or live diagnostics:
- D&R AI Solutions Engineering Team
- Reference this brief and device ID `dev_4e9aad921710f260`

We can be on a call to walk through the network test and verify the fix in real-time.

---

## Appendix — Latest error log from device

```
Timestamp:  2026-04-30T11:38:45Z
Error:      "LiveKit failed: unknown"
Context:    Recording attempt for class "Testing A014" (id 69f33ebd49870ea9eb804b0e)
            Class status auto-flipped to "completed" before recording could engage
Network:    latency 2,927 ms at 11:35:42, 3,281 ms at 11:35:05
Pipeline:   Never engaged — segmentIndex=0, livekit=DISCONNECTED throughout
```

This log can be reproduced any time by attempting to schedule a class on Room 014.
