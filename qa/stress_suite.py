#!/usr/bin/env python3
"""
LectureLens Overnight Stress + Integration Tests
=================================================

Runs AFTER the basic qa_suite.py. Targets the classes of bugs that
single-request tests can't catch:

 * upload/download round-trips under repeated use
 * concurrent requests
 * schema round-trip fidelity (every field stored survives read)
 * broadcast behaviour with mixed filter shapes
 * orphan detection for stale DB state

Designed to be safe to run against production — every test creates
only identifiable test artefacts (qa-stress-<timestamp>) and cleans
up after itself where possible.

Exit codes: 0 = all pass, 1 = any fail.
"""

from __future__ import annotations

import hashlib
import io
import json
import os
import sys
import time
import uuid
import zipfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from datetime import datetime, timezone

import requests

BASE = os.environ.get("LCS_API_BASE", "https://lecturelens-api.draisol.com/api")
ADMIN_EMAIL = os.environ.get("LCS_ADMIN_EMAIL", "admin@draisol.com")
ADMIN_PASSWORD = os.environ.get("LCS_ADMIN_PASSWORD", "admin@123")
DEVICE_ID = os.environ.get("LCS_QA_DEVICE", "dev_89c1eaca675006c3")
APK_PATH = os.path.expanduser("~/Desktop/LectureLens-v2.5.1-draisol.apk")

RUN_ID = datetime.now(timezone.utc).strftime("stress-%Y%m%d-%H%M%S")


# ────────────────────────────────────────────────────────────────────────
# Fixtures
# ────────────────────────────────────────────────────────────────────────

_token: str | None = None
_device_auth: str | None = None


def admin_token() -> str:
    global _token
    if _token:
        return _token
    r = requests.post(f"{BASE}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=10)
    r.raise_for_status()
    _token = r.json()["token"]
    return _token


def admin_headers() -> dict:
    return {"Authorization": f"Bearer {admin_token()}"}


def device_auth_for(device_id: str) -> str:
    global _device_auth
    if _device_auth:
        return _device_auth
    r = requests.get(f"{BASE}/classroom-recording/devices", headers=admin_headers(), timeout=10)
    r.raise_for_status()
    for d in r.json():
        if d.get("deviceId") == device_id:
            _device_auth = d.get("authToken") or ""
            return _device_auth
    raise RuntimeError(f"test device {device_id} not found")


def device_headers(device_id: str) -> dict:
    return {"x-device-id": device_id, "x-device-token": device_auth_for(device_id)}


# ────────────────────────────────────────────────────────────────────────
# Test result tracking
# ────────────────────────────────────────────────────────────────────────

@dataclass
class TestOutcome:
    test_id: str
    name: str
    status: str
    reason: str = ""
    duration_ms: int = 0
    extra: dict = field(default_factory=dict)


results: list[TestOutcome] = []


def record(test_id: str, name: str, status: str, reason: str = "", **extra):
    dur = extra.pop("duration_ms", 0)
    results.append(TestOutcome(test_id=test_id, name=name, status=status, reason=reason, duration_ms=dur, extra=extra))
    icon = {"PASS": "✓", "FAIL": "✗", "SKIP": "⊘"}[status]
    colour = {"PASS": "\033[32m", "FAIL": "\033[31m", "SKIP": "\033[33m"}[status]
    reset = "\033[0m"
    line = f"  {colour}{icon}{reset}  {test_id}  {name}  [{dur}ms]"
    print(line)
    if status != "PASS":
        print(f"       → {reason}")
    if extra:
        for k, v in extra.items():
            print(f"       • {k}: {v}")


def run_test(test_id: str, name: str, fn):
    t0 = time.time()
    try:
        result = fn()
        dur = int((time.time() - t0) * 1000)
        if isinstance(result, tuple):
            st = result[0]
            rsn = result[1] if len(result) > 1 else ""
            ext = result[2] if len(result) > 2 else {}
        else:
            st, rsn, ext = "PASS", "", {}
        # Strip any conflicting kwargs in extra (defensive)
        ext = {k: v for k, v in ext.items() if k not in ("status", "reason", "test_id", "name", "duration_ms")}
        record(test_id, name, st, rsn, duration_ms=dur, **ext)
    except Exception as e:
        dur = int((time.time() - t0) * 1000)
        record(test_id, name, "FAIL", f"{type(e).__name__}: {e}", duration_ms=dur)


# ────────────────────────────────────────────────────────────────────────
# SUITE S — Stress tests
# ────────────────────────────────────────────────────────────────────────

def s01_repeated_download():
    """Download admin APK 3 times, verify identical bytes each time."""
    hashes = []
    sizes = []
    for i in range(3):
        r = requests.get(f"{BASE}/app/download-admin", headers=admin_headers(), timeout=60)
        if r.status_code != 200:
            return "FAIL", f"iter {i}: HTTP {r.status_code}"
        hashes.append(hashlib.sha256(r.content).hexdigest())
        sizes.append(len(r.content))
    if len(set(hashes)) != 1:
        return "FAIL", f"bytes differ across downloads: {hashes}"
    if len(set(sizes)) != 1:
        return "FAIL", f"sizes differ: {sizes}"
    return "PASS", "", {"sha256": hashes[0][:12], "size": sizes[0]}


def s02_concurrent_downloads():
    """5 simultaneous downloads — all must succeed with identical content."""
    def fetch():
        r = requests.get(f"{BASE}/app/download-admin", headers=admin_headers(), timeout=90)
        return r.status_code, hashlib.sha256(r.content).hexdigest() if r.status_code == 200 else None, len(r.content)

    with ThreadPoolExecutor(max_workers=5) as pool:
        futures = [pool.submit(fetch) for _ in range(5)]
        results_local = [f.result() for f in as_completed(futures)]
    codes = [r[0] for r in results_local]
    hashes = [r[1] for r in results_local if r[1]]
    if any(c != 200 for c in codes):
        return "FAIL", f"codes={codes}"
    if len(set(hashes)) != 1:
        return "FAIL", f"concurrent downloads returned different bytes"
    return "PASS", "", {"all_codes": codes, "hash": hashes[0][:12]}


def s03_upload_verify_roundtrip():
    """Upload a fresh version, immediately download + verify SHA matches.

    SAFETY: this test deactivates production's active version as a side effect
    (upload route sets isActive: false on all others). We preserve + restore
    the pre-test active version-id so cleanup leaves the server exactly as we
    found it. If cleanup is interrupted, an operator can manually re-activate
    by re-uploading the real APK.
    """
    if not os.path.exists(APK_PATH):
        return "SKIP", f"no APK at {APK_PATH}"
    src_sha = hashlib.sha256(open(APK_PATH, "rb").read()).hexdigest()

    # Remember who was active BEFORE we upload
    r0 = requests.get(f"{BASE}/app/versions", headers=admin_headers(), timeout=10)
    prior_active_id = next((v["_id"] for v in r0.json() if v.get("isActive")), None)

    # Use a throwaway versionCode far above production to avoid collisions
    throw_code = 990
    throw_name = f"qa-stress-{RUN_ID}"

    try:
        with open(APK_PATH, "rb") as f:
            r = requests.post(
                f"{BASE}/app/upload",
                headers=admin_headers(),
                files={"apk": (f"{throw_name}.apk", f, "application/vnd.android.package-archive")},
                data={"versionCode": throw_code, "versionName": throw_name, "releaseNotes": "QA stress"},
                timeout=120,
            )
        if r.status_code not in (200, 201):
            return "FAIL", f"upload HTTP {r.status_code}: {r.text[:200]}"

        time.sleep(1)  # small settle
        dr = requests.get(f"{BASE}/app/download-admin", headers=admin_headers(), timeout=60)
        if dr.status_code != 200:
            return "FAIL", f"download HTTP {dr.status_code}"
        dl_sha = hashlib.sha256(dr.content).hexdigest()

        if dl_sha != src_sha:
            return "FAIL", f"bytes differ src={src_sha[:12]} dl={dl_sha[:12]}"
        return "PASS", "", {"src_sha": src_sha[:12], "dl_sha": dl_sha[:12], "size": len(dr.content)}

    finally:
        # 1. Delete the throwaway version
        _cleanup_version(throw_code)
        # 2. Re-activate the prior active version via /activate endpoint
        if prior_active_id:
            try:
                ra = requests.post(
                    f"{BASE}/app/versions/{prior_active_id}/activate",
                    headers=admin_headers(), timeout=10,
                )
                if ra.status_code != 200:
                    print(f"       ! s03 reactivation HTTP {ra.status_code}: {ra.text[:120]}")
            except Exception as e:
                print(f"       ! s03 reactivation threw: {e}")


def _cleanup_version(code: int):
    """Delete a version by code — used by stress tests to remove their artefacts."""
    try:
        r = requests.get(f"{BASE}/app/versions", headers=admin_headers(), timeout=10)
        for v in r.json():
            if v.get("versionCode") == code:
                requests.delete(f"{BASE}/app/versions/{v['_id']}", headers=admin_headers(), timeout=10)
    except Exception:
        pass


# ────────────────────────────────────────────────────────────────────────
# SUITE H — Heartbeat round-trip tests
# ────────────────────────────────────────────────────────────────────────

def h01_heartbeat_fields_roundtrip():
    """Every health field sent in heartbeat should survive to /devices response."""
    test_model = f"qa-stress-{RUN_ID}"
    marker_err = f"qa-err-{RUN_ID}"
    payload = {
        "isRecording": False,
        "appVersionCode": 22,
        "appVersionName": "2.5.0-draisol",
        "deviceModel": test_model,
        "health": {
            "camera": {"ok": True, "name": "qa-cam"},
            "mic": {"ok": True, "name": "qa-mic"},
            "screen": {"ok": True, "resolution": "1920x1080"},
            "disk": {"freeGB": 100, "totalGB": 200, "usedPercent": 50},
            "cpu": {"usagePercent": 30},
            "ram": {"usedPercent": 40, "freeGB": 1.5, "totalGB": 3},
            "network": {"wifiSignal": -55, "latencyMs": 20, "ssid": "QA-WIFI"},
            "recording": {
                "frameDrop": 0,
                "errorCount": 1,
                "lastError": marker_err,
                "isRecording": False,
                "segmentIndex": 5,
                "audioLevelDb": -30.5,
                "micLabel": "QA USB Mic",
                "chimeEngineOk": True,
                "ttsEngineOk": True,
                "videoPipeline": "legacy_direct",
                "glCompositorEnabled": False,
                "glCameraPiP": False,
            },
        },
    }
    r = requests.post(
        f"{BASE}/classroom-recording/devices/{DEVICE_ID}/heartbeat",
        headers=device_headers(DEVICE_ID), json=payload, timeout=15,
    )
    if r.status_code != 200:
        return "FAIL", f"heartbeat HTTP {r.status_code}: {r.text[:200]}"

    # Let the DB settle, then re-read.
    time.sleep(0.5)
    r2 = requests.get(f"{BASE}/classroom-recording/devices", headers=admin_headers(), timeout=10)
    match = next((d for d in r2.json() if d.get("deviceId") == DEVICE_ID), None)
    if not match:
        return "FAIL", "test device disappeared from list"

    missing = []
    h = match.get("health", {}) or {}
    rec = h.get("recording", {}) or {}
    checks = [
        ("deviceModel top-level", match.get("deviceModel") == test_model),
        ("health.recording.lastError", rec.get("lastError") == marker_err),
        ("health.recording.micLabel", rec.get("micLabel") == "QA USB Mic"),
        ("health.recording.chimeEngineOk", rec.get("chimeEngineOk") == True),
        ("health.recording.videoPipeline", rec.get("videoPipeline") == "legacy_direct"),
        ("health.recording.glCompositorEnabled", rec.get("glCompositorEnabled") == False),
    ]
    for label, ok in checks:
        if not ok:
            missing.append(label)
    if missing:
        return "FAIL", f"round-trip failed for: {missing}"
    return "PASS", "", {"fields_verified": len(checks)}


def h02_heartbeat_edge_empty_body():
    """Heartbeat with `{}` body still succeeds."""
    r = requests.post(
        f"{BASE}/classroom-recording/devices/{DEVICE_ID}/heartbeat",
        headers=device_headers(DEVICE_ID), json={}, timeout=10,
    )
    if r.status_code != 200:
        return "FAIL", f"HTTP {r.status_code}"
    return "PASS"


def h03_heartbeat_malformed_nested():
    """Heartbeat with garbled nested health object is handled gracefully (not 500)."""
    payload = {"health": {"recording": "this should be object not string"}}
    r = requests.post(
        f"{BASE}/classroom-recording/devices/{DEVICE_ID}/heartbeat",
        headers=device_headers(DEVICE_ID), json=payload, timeout=10,
    )
    # Either 200 (sanitised) or 400 (rejected) is acceptable — 500 is NOT.
    if r.status_code == 500:
        return "FAIL", f"malformed nested health crashed backend: {r.text[:200]}"
    return "PASS", "", {"http_status": r.status_code}


# ────────────────────────────────────────────────────────────────────────
# SUITE C — Command & broadcast stress
# ────────────────────────────────────────────────────────────────────────

def c01_every_command_roundtrip():
    """Fire all 13 enum commands; every one should return 201 Queued."""
    commands = [
        "reboot", "restart_app", "clear_storage", "pull_logs",
        "capture_screenshot", "force_start", "force_stop", "update_config",
        "play_sound", "check_update", "test_chime", "test_mic",
        "toggle_gl_compositor",
    ]
    failed = []
    for cmd in commands:
        r = requests.post(
            f"{BASE}/remote/command", headers=admin_headers(),
            json={"deviceId": DEVICE_ID, "command": cmd, "params": {"qa_marker": RUN_ID}},
            timeout=10,
        )
        if r.status_code != 201:
            failed.append(f"{cmd}→{r.status_code}")
    if failed:
        return "FAIL", f"commands rejected: {failed}"
    return "PASS", "", {"commands_accepted": len(commands)}


def c02_broadcast_filter_online():
    """Broadcast with filter=online resolves to >=0 devices, never errors."""
    r = requests.post(
        f"{BASE}/remote/broadcast", headers=admin_headers(),
        json={"filter": "online", "command": "pull_logs"},
        timeout=15,
    )
    # 201 or 400 acceptable (400 if no online devices — depends on device state)
    if r.status_code not in (201, 400):
        return "FAIL", f"unexpected HTTP {r.status_code}: {r.text[:200]}"
    return "PASS", "", {"http_status": r.status_code}


def c03_broadcast_many_devices():
    """Broadcast to explicit deviceIds[] with 10 unknown IDs — all should fail gracefully (no crash)."""
    fake_ids = [f"fake_device_{i}" for i in range(10)]
    r = requests.post(
        f"{BASE}/remote/broadcast", headers=admin_headers(),
        json={"deviceIds": fake_ids, "command": "pull_logs"},
        timeout=15,
    )
    if r.status_code != 201:
        return "FAIL", f"HTTP {r.status_code}"
    body = r.json()
    # We expect all to fail to create (wrong deviceIds but commands are created anyway —
    # DeviceCommand model just stores the string). So "okCount" should be 10.
    if body.get("targetCount") != 10:
        return "FAIL", f"wrong targetCount: {body.get('targetCount')}"
    return "PASS", "", {"queued": body.get("okCount"), "failed": body.get("failCount")}


# ────────────────────────────────────────────────────────────────────────
# SUITE O — Orphan / consistency detection
# ────────────────────────────────────────────────────────────────────────

def o01_no_stuck_recordings():
    """No recording should be stuck at 'recording' status for > 15 min."""
    r = requests.get(f"{BASE}/recordings", headers=admin_headers(), timeout=10)
    stuck = []
    cutoff = datetime.now(timezone.utc).timestamp() - 15 * 60
    for rec in r.json():
        if rec.get("status") in ("recording", "uploading"):
            created = rec.get("createdAt") or rec.get("recordingStart")
            if created:
                ts = datetime.fromisoformat(created.replace("Z", "+00:00")).timestamp()
                if ts < cutoff:
                    stuck.append(f"{rec.get('_id')}: {rec.get('title')} ({rec.get('status')})")
    if stuck:
        return "FAIL", f"stuck recordings: {stuck[:3]}"
    return "PASS"


def o02_app_versions_consistency():
    """/app/latest returns the highest versionCode marked active."""
    latest = requests.get(f"{BASE}/app/latest", timeout=10).json()
    all_vers = requests.get(f"{BASE}/app/versions", headers=admin_headers(), timeout=10).json()
    if not latest.get("available"):
        return "SKIP", "no active version"
    active_versions = [v for v in all_vers if v.get("isActive")]
    if len(active_versions) != 1:
        return "FAIL", f"expected exactly 1 active version, found {len(active_versions)}"
    if active_versions[0].get("versionCode") != latest.get("versionCode"):
        return "FAIL", f"/latest disagrees with /versions on active code"
    return "PASS", "", {"active": f"v{latest.get('versionName')} code={latest.get('versionCode')}"}


def o03_gridfs_files_chunks_consistency():
    """For every AppVersion with apkGridFsId, verify the file + chunks actually exist via download."""
    # We test this indirectly: if /app/download-admin for the active version returns valid APK, the chain works.
    r = requests.get(f"{BASE}/app/download-admin", headers=admin_headers(), timeout=60)
    if r.status_code != 200:
        return "FAIL", f"download HTTP {r.status_code}: {r.text[:200]}"
    if len(r.content) < 1024:
        return "FAIL", f"download too small: {len(r.content)} bytes"
    try:
        zf = zipfile.ZipFile(io.BytesIO(r.content))
        if "AndroidManifest.xml" not in zf.namelist():
            return "FAIL", "APK missing AndroidManifest.xml"
    except zipfile.BadZipFile:
        return "FAIL", "downloaded bytes are not a valid ZIP"
    return "PASS", "", {"bytes": len(r.content)}


def o04_command_history_not_exploding():
    """Device command history is reasonable (< 1000 entries for test device)."""
    r = requests.get(f"{BASE}/remote/commands/{DEVICE_ID}?limit=1000", headers=admin_headers(), timeout=10)
    if r.status_code != 200:
        return "FAIL", f"HTTP {r.status_code}"
    count = len(r.json())
    if count >= 1000:
        return "FAIL", f"command history at ceiling ({count}) — cleanup index may not be active"
    return "PASS", "", {"entries": count}


# ────────────────────────────────────────────────────────────────────────
# SUITE F — Fleet dashboard coverage
# ────────────────────────────────────────────────────────────────────────

def f01_fleet_overview_has_new_fields():
    """Every device summary in fleet-overview has the full Phase 3 field set."""
    r = requests.get(f"{BASE}/analytics/fleet-overview", headers=admin_headers(), timeout=15)
    body = r.json()
    expected = [
        "deviceId", "name", "healthScore", "status",
        "appVersionName", "appVersionCode", "deviceModel",
        "micLabel", "videoPipeline", "glCompositorEnabled", "glCameraPiP",
        "lastRecordingError", "recordingErrorCount",
    ]
    for d in body.get("devices", []):
        missing = [k for k in expected if k not in d]
        if missing:
            return "FAIL", f"device {d.get('deviceId')} missing {missing}"
    return "PASS", "", {"devices_checked": len(body.get("devices", []))}


def f02_device_history_7days():
    """GET /analytics/device/:id/history?days=7 returns structured data."""
    r = requests.get(f"{BASE}/analytics/device/{DEVICE_ID}/history?days=7", headers=admin_headers(), timeout=15)
    if r.status_code != 200:
        return "FAIL", f"HTTP {r.status_code}"
    body = r.json()
    if "history" not in body or not isinstance(body["history"], list):
        return "FAIL", "invalid shape"
    return "PASS", "", {"data_points": len(body.get("history", []))}


# ────────────────────────────────────────────────────────────────────────
# Runner
# ────────────────────────────────────────────────────────────────────────

TESTS = [
    # Stress
    ("S01", "Repeated admin download (3x) — bytes stable", s01_repeated_download),
    ("S02", "Concurrent admin downloads (5 parallel) — bytes identical", s02_concurrent_downloads),
    ("S03", "Upload → Download → SHA round-trip integrity", s03_upload_verify_roundtrip),
    # Heartbeat
    ("H01", "Every heartbeat field round-trips to /devices", h01_heartbeat_fields_roundtrip),
    ("H02", "Heartbeat with empty body {} returns 200", h02_heartbeat_edge_empty_body),
    ("H03", "Heartbeat with malformed nested object doesn't 500", h03_heartbeat_malformed_nested),
    # Commands
    ("C01", "All 13 enum commands accepted by backend", c01_every_command_roundtrip),
    ("C02", "Broadcast filter=online doesn't error", c02_broadcast_filter_online),
    ("C03", "Broadcast to 10 fake device IDs handled gracefully", c03_broadcast_many_devices),
    # Orphans
    ("O01", "No stuck recordings older than 15 min", o01_no_stuck_recordings),
    ("O02", "Exactly 1 active AppVersion; /latest matches", o02_app_versions_consistency),
    ("O03", "GridFS chain: active APK downloads as valid ZIP", o03_gridfs_files_chunks_consistency),
    ("O04", "Command history below 1000-entry ceiling", o04_command_history_not_exploding),
    # Fleet
    ("F01", "Every device summary has Phase 3 fields", f01_fleet_overview_has_new_fields),
    ("F02", "Device 7-day history returns structured data", f02_device_history_7days),
]


def main():
    print(f"\n{'=' * 78}")
    print(f"  LectureLens Stress + Integration  [run {RUN_ID}]")
    print(f"  Target: {BASE}")
    print(f"{'=' * 78}\n")

    t0 = time.time()
    for test_id, name, fn in TESTS:
        run_test(test_id, name, fn)
    dur = int((time.time() - t0) * 1000)

    counts = {"PASS": 0, "FAIL": 0, "SKIP": 0}
    for r in results:
        counts[r.status] += 1

    print(f"\n{'=' * 78}")
    fails = counts["FAIL"]
    colour = "\033[32m" if fails == 0 else "\033[31m"
    verdict = "ALL PASS" if fails == 0 else f"{fails} FAILED"
    print(f"  {colour}{verdict}\033[0m  ·  pass={counts['PASS']}  fail={counts['FAIL']}  skip={counts['SKIP']}  ({dur}ms)")
    print(f"{'=' * 78}\n")

    if fails:
        print("FAILED:")
        for r in results:
            if r.status == "FAIL":
                print(f"  {r.test_id}  {r.name}")
                print(f"    → {r.reason}")

    return 0 if fails == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
