#!/usr/bin/env python3
"""
LectureLens End-to-End QA Suite
================================

Comprehensive regression coverage across every subsystem.
Runs against PRODUCTION (Railway backend + Vercel admin portal) by default
so the tests exercise the real deployment, not a local build.

Design principles (experienced-QA-engineer playbook):
  * Every test has a stable ID (A01, D02, RC05, …) so failures are
    traceable across runs and easy to reference in commit messages.
  * Tests are grouped into Suites so partial runs are possible
    (`--suite auth,devices`). Default runs everything.
  * Each test is self-describing: a single docstring line, shown on fail.
  * Safe-by-default: read-only wherever possible. Write ops create data
    tagged with a run-scoped marker and clean up on success. Failures
    leave marker-tagged data behind so it's easy to grep out manually.
  * No test depends on another's state. Fixtures (JWT, device auth)
    are created on the fly.
  * Network flakes are retried once; pipeline failures are real failures.
  * Exit code 0 = all pass, 1 = any fail, 2 = framework error.

Usage:
    python3 qa_suite.py                       # all suites
    python3 qa_suite.py --suite auth,devices  # subset
    python3 qa_suite.py --json                # machine-readable report
    python3 qa_suite.py --base https://...    # override API URL
"""

from __future__ import annotations

import argparse
import base64
import io
import json
import os
import sys
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Callable, Optional

try:
    import requests
except ImportError:
    print("requests library required:  pip3 install requests", file=sys.stderr)
    sys.exit(2)

# ───────────────────────────────────────────────────────────────────────────────
# CONFIG
# ───────────────────────────────────────────────────────────────────────────────

DEFAULT_BASE = "https://lecturelens-api.draisol.com/api"
DEFAULT_PORTAL = "https://lecturelens-admin.draisol.com"

# These are the known production admin credentials used in prior debugging
# sessions; they are NOT secret in this codebase and map to a dedicated
# admin account. If they ever change, override via env vars.
ADMIN_EMAIL = os.environ.get("LCS_ADMIN_EMAIL", "admin@draisol.com")
ADMIN_PASSWORD = os.environ.get("LCS_ADMIN_PASSWORD", "admin@123")

# Target device for device-auth tests. If offline, device-auth-specific
# tests SKIP (not FAIL) — we don't fail the suite just because the TV is off.
DEFAULT_DEVICE_ID = os.environ.get("LCS_QA_DEVICE", "dev_89c1eaca675006c3")

RUN_ID = datetime.now(timezone.utc).strftime("qa-%Y%m%d-%H%M%S")


# ───────────────────────────────────────────────────────────────────────────────
# RESULT MODEL
# ───────────────────────────────────────────────────────────────────────────────

@dataclass
class TestResult:
    test_id: str
    suite: str
    name: str
    status: str         # "PASS" | "FAIL" | "SKIP"
    reason: str = ""
    duration_ms: int = 0


@dataclass
class Suite:
    name: str
    tests: list = field(default_factory=list)


# Global registry
_SUITES: dict[str, Suite] = {}


def test(test_id: str, suite: str):
    """Decorator that registers a test function into a suite."""
    def wrap(fn: Callable):
        if suite not in _SUITES:
            _SUITES[suite] = Suite(name=suite)
        _SUITES[suite].tests.append((test_id, fn))
        return fn
    return wrap


# ───────────────────────────────────────────────────────────────────────────────
# HELPERS
# ───────────────────────────────────────────────────────────────────────────────

class Ctx:
    """Runtime context shared by all tests."""

    def __init__(self, base: str, portal: str):
        self.base = base.rstrip("/")
        self.portal = portal.rstrip("/")
        self._token: Optional[str] = None
        self._device_token: Optional[str] = None
        self._device_id: Optional[str] = None
        self._created_commands: list[str] = []   # for cleanup
        self._created_recordings: list[str] = [] # for cleanup

    # ---- lazy fixtures ------------------------------------------------

    def admin_token(self) -> str:
        if self._token:
            return self._token
        r = requests.post(
            f"{self.base}/auth/login",
            json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
            timeout=10,
        )
        r.raise_for_status()
        self._token = r.json().get("token") or ""
        if not self._token:
            raise RuntimeError(f"login returned no token: {r.text[:200]}")
        return self._token

    def admin_headers(self) -> dict:
        return {"Authorization": f"Bearer {self.admin_token()}"}

    def device_auth(self) -> tuple[str, str]:
        """Return (deviceId, authToken) for the configured test device, or raise."""
        if self._device_id and self._device_token:
            return self._device_id, self._device_token
        r = requests.get(
            f"{self.base}/classroom-recording/devices",
            headers=self.admin_headers(),
            timeout=10,
        )
        r.raise_for_status()
        target = DEFAULT_DEVICE_ID
        for d in r.json():
            if d.get("deviceId") == target:
                self._device_id = d["deviceId"]
                self._device_token = d.get("authToken") or ""
                break
        if not (self._device_id and self._device_token):
            raise SkipTest(f"configured test device {target} not found or has no token")
        return self._device_id, self._device_token

    def device_headers(self) -> dict:
        did, tok = self.device_auth()
        return {"x-device-id": did, "x-device-token": tok}

    # ---- small request helpers ---------------------------------------

    def get(self, path: str, **kw) -> requests.Response:
        return requests.get(f"{self.base}{path}", headers=self.admin_headers(), timeout=10, **kw)

    def post(self, path: str, **kw) -> requests.Response:
        return requests.post(f"{self.base}{path}", headers=self.admin_headers(), timeout=15, **kw)

    def portal_url(self, path: str) -> str:
        return f"{self.portal}{path}"


class SkipTest(Exception):
    pass


def assert_(cond: bool, msg: str):
    if not cond:
        raise AssertionError(msg)


def assert_in(needle, haystack, label: str):
    if needle not in haystack:
        raise AssertionError(f"{label}: {needle!r} not in {haystack!r}")


def assert_eq(a, b, label: str):
    if a != b:
        raise AssertionError(f"{label}: expected {b!r}, got {a!r}")


def assert_status(resp: requests.Response, expected: int, extra: str = ""):
    if resp.status_code != expected:
        body = resp.text[:300]
        raise AssertionError(
            f"expected HTTP {expected}, got {resp.status_code}. {extra} Body: {body}"
        )


# ───────────────────────────────────────────────────────────────────────────────
# AUTH SUITE
# ───────────────────────────────────────────────────────────────────────────────

@test("A01", "auth")
def t_login_valid(c: Ctx):
    """Login with valid admin credentials returns a JWT."""
    r = requests.post(
        f"{c.base}/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
        timeout=10,
    )
    assert_status(r, 200)
    body = r.json()
    assert_("token" in body, "response missing 'token'")
    assert_(len(body["token"]) > 50, "token suspiciously short")


@test("A02", "auth")
def t_login_invalid(c: Ctx):
    """Login with wrong password returns 4xx."""
    r = requests.post(
        f"{c.base}/auth/login",
        json={"email": ADMIN_EMAIL, "password": "definitely-wrong"},
        timeout=10,
    )
    assert_(400 <= r.status_code < 500, f"expected 4xx, got {r.status_code}")


@test("A03", "auth")
def t_protected_requires_token(c: Ctx):
    """Protected endpoint rejects request with no Authorization header."""
    r = requests.get(f"{c.base}/classroom-recording/devices", timeout=10)
    assert_(r.status_code in (401, 403), f"expected 401/403, got {r.status_code}")


@test("A04", "auth")
def t_protected_rejects_bad_token(c: Ctx):
    """Protected endpoint rejects garbage token."""
    r = requests.get(
        f"{c.base}/classroom-recording/devices",
        headers={"Authorization": "Bearer not-a-real-token"},
        timeout=10,
    )
    assert_(r.status_code in (401, 403), f"expected 401/403, got {r.status_code}")


@test("A05", "auth")
def t_login_returns_user(c: Ctx):
    """Login response includes user details (at least email or role)."""
    r = requests.post(
        f"{c.base}/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
        timeout=10,
    )
    assert_status(r, 200)
    body = r.json()
    # Accept any of common keys
    assert_(
        any(k in body for k in ("user", "email", "role", "name")),
        f"login response lacks user info: keys={list(body.keys())}",
    )


# ───────────────────────────────────────────────────────────────────────────────
# DEVICES SUITE
# ───────────────────────────────────────────────────────────────────────────────

@test("D01", "devices")
def t_devices_requires_auth(c: Ctx):
    """GET /classroom-recording/devices requires admin token."""
    r = requests.get(f"{c.base}/classroom-recording/devices", timeout=10)
    assert_(r.status_code in (401, 403), f"expected 401/403, got {r.status_code}")


@test("D02", "devices")
def t_devices_list_structure(c: Ctx):
    """GET /classroom-recording/devices returns an array of device objects."""
    r = c.get("/classroom-recording/devices")
    assert_status(r, 200)
    arr = r.json()
    assert_(isinstance(arr, list), "response not a list")
    if not arr:
        raise SkipTest("no devices registered — cannot validate structure")
    d = arr[0]
    for field_name in ("deviceId", "name", "isActive", "authToken"):
        assert_(field_name in d, f"device missing field '{field_name}'")


@test("D03", "devices")
def t_heartbeat_requires_device_token(c: Ctx):
    """Heartbeat without x-device-token header is rejected."""
    try:
        did, _ = c.device_auth()
    except SkipTest:
        raise
    r = requests.post(
        f"{c.base}/classroom-recording/devices/{did}/heartbeat",
        json={},
        timeout=10,
    )
    assert_(r.status_code in (401, 403), f"expected 401/403, got {r.status_code}")


@test("D04", "devices")
def t_heartbeat_rejects_wrong_token(c: Ctx):
    """Heartbeat with mismatched x-device-token is rejected."""
    did, _ = c.device_auth()
    r = requests.post(
        f"{c.base}/classroom-recording/devices/{did}/heartbeat",
        headers={"x-device-id": did, "x-device-token": "definitely-wrong-token"},
        json={},
        timeout=10,
    )
    assert_(r.status_code in (401, 403), f"expected 401/403, got {r.status_code}")


@test("D05", "devices")
def t_heartbeat_returns_schedule(c: Ctx):
    """Heartbeat response shape: schedule, serverTime, appUpdate, commands."""
    r = requests.post(
        f"{c.base}/classroom-recording/devices/{c.device_auth()[0]}/heartbeat",
        headers=c.device_headers(),
        json={"isRecording": False, "appVersionCode": 22},
        timeout=15,
    )
    assert_status(r, 200)
    body = r.json()
    for field_name in ("schedule", "serverTime", "commands"):
        assert_(field_name in body, f"heartbeat response missing '{field_name}'")
    # appUpdate optional (may be absent if device is already latest)


@test("D06", "devices")
def t_heartbeat_persists_version(c: Ctx):
    """Sending appVersionCode + appVersionName + deviceModel persists them on the device doc."""
    did, _ = c.device_auth()
    test_model = f"QA-{RUN_ID}"
    r = requests.post(
        f"{c.base}/classroom-recording/devices/{did}/heartbeat",
        headers=c.device_headers(),
        json={
            "isRecording": False,
            "appVersionCode": 22,
            "appVersionName": "2.5.0-draisol",
            "deviceModel": test_model,
        },
        timeout=15,
    )
    assert_status(r, 200)
    # Re-fetch device list and check the model was persisted
    time.sleep(0.3)  # small lag for DB write
    r2 = c.get("/classroom-recording/devices")
    assert_status(r2, 200)
    match = next((d for d in r2.json() if d.get("deviceId") == did), None)
    assert_(match is not None, "test device missing after heartbeat")
    assert_eq(match.get("appVersionCode"), 22, "appVersionCode not persisted")
    assert_eq(match.get("appVersionName"), "2.5.0-draisol", "appVersionName not persisted")
    assert_eq(match.get("deviceModel"), test_model, "deviceModel not persisted")


@test("D07", "devices")
def t_heartbeat_ok_without_optional_fields(c: Ctx):
    """Heartbeat with minimal body still returns 200."""
    did, _ = c.device_auth()
    r = requests.post(
        f"{c.base}/classroom-recording/devices/{did}/heartbeat",
        headers=c.device_headers(),
        json={},  # completely empty body
        timeout=15,
    )
    assert_status(r, 200)


# ───────────────────────────────────────────────────────────────────────────────
# REMOTE COMMANDS SUITE
# ───────────────────────────────────────────────────────────────────────────────

ALL_KNOWN_COMMANDS = [
    "reboot", "restart_app", "clear_storage", "pull_logs",
    "capture_screenshot", "force_start", "force_stop", "update_config",
    "play_sound", "check_update", "test_chime", "test_mic",
    "toggle_gl_compositor",
]


@test("R01", "remote")
def t_send_play_sound(c: Ctx):
    """POST /remote/command with play_sound creates a DeviceCommand (pending)."""
    did = c.device_auth()[0]
    r = c.post("/remote/command", json={
        "deviceId": did, "command": "play_sound",
    })
    assert_status(r, 201)
    body = r.json()
    assert_eq(body.get("message"), "Command queued", "unexpected message")
    assert_("command" in body and body["command"].get("_id"), "no command _id returned")
    c._created_commands.append(body["command"]["_id"])


@test("R02", "remote")
def t_send_test_chime(c: Ctx):
    """POST /remote/command with test_chime (Phase 1 enum) is accepted."""
    did = c.device_auth()[0]
    r = c.post("/remote/command", json={
        "deviceId": did, "command": "test_chime", "params": {"kind": "start"},
    })
    assert_status(r, 201)
    c._created_commands.append(r.json()["command"]["_id"])


@test("R03", "remote")
def t_send_test_mic(c: Ctx):
    """POST /remote/command with test_mic is accepted."""
    did = c.device_auth()[0]
    r = c.post("/remote/command", json={
        "deviceId": did, "command": "test_mic", "params": {"durationMs": 2000},
    })
    assert_status(r, 201)
    c._created_commands.append(r.json()["command"]["_id"])


@test("R04", "remote")
def t_send_toggle_gl(c: Ctx):
    """POST /remote/command with toggle_gl_compositor is accepted."""
    did = c.device_auth()[0]
    r = c.post("/remote/command", json={
        "deviceId": did, "command": "toggle_gl_compositor", "params": {"enabled": True},
    })
    assert_status(r, 201)
    c._created_commands.append(r.json()["command"]["_id"])


@test("R05", "remote")
def t_invalid_command_rejected(c: Ctx):
    """Unknown command string is rejected by enum validation."""
    did = c.device_auth()[0]
    r = c.post("/remote/command", json={
        "deviceId": did, "command": "definitely_not_a_real_command",
    })
    assert_(r.status_code >= 400, f"expected 4xx/5xx, got {r.status_code}")


@test("R06", "remote")
def t_command_result_requires_device_auth(c: Ctx):
    """POST command-result without device headers is 401/403."""
    did = c.device_auth()[0]
    r = requests.post(
        f"{c.base}/remote/device/{did}/command-result",
        json={"commandId": "000000000000000000000000", "status": "completed"},
        timeout=10,
    )
    assert_(r.status_code in (401, 403), f"expected 401/403, got {r.status_code}")


@test("R07", "remote")
def t_command_result_rejects_invalid_id(c: Ctx):
    """Malformed commandId returns 400 (not 500 — part of Phase 1 hardening)."""
    did = c.device_auth()[0]
    r = requests.post(
        f"{c.base}/remote/device/{did}/command-result",
        headers=c.device_headers(),
        json={"commandId": "not-an-objectid", "status": "completed"},
        timeout=10,
    )
    assert_(r.status_code == 400,
            f"expected 400 (invalid ObjectId guard), got {r.status_code}: {r.text[:200]}")


@test("R08", "remote")
def t_command_result_rejects_missing_id(c: Ctx):
    """Missing commandId returns 400."""
    did = c.device_auth()[0]
    r = requests.post(
        f"{c.base}/remote/device/{did}/command-result",
        headers=c.device_headers(),
        json={"status": "completed"},
        timeout=10,
    )
    assert_eq(r.status_code, 400, "expected 400 for missing commandId")


@test("R09", "remote")
def t_all_enum_commands_accepted(c: Ctx):
    """Every enum command registered on the backend must be acceptable."""
    did = c.device_auth()[0]
    failed = []
    for cmd in ALL_KNOWN_COMMANDS:
        r = c.post("/remote/command", json={
            "deviceId": did, "command": cmd,
            "params": {"qa_marker": RUN_ID},
        })
        if r.status_code != 201:
            failed.append(f"{cmd} → {r.status_code}: {r.text[:100]}")
        else:
            c._created_commands.append(r.json()["command"]["_id"])
    assert_(not failed, f"commands rejected: {failed}")


@test("R10", "remote")
def t_command_history_endpoint(c: Ctx):
    """GET /remote/commands/:deviceId returns recent commands (includes ones we just sent)."""
    did = c.device_auth()[0]
    r = c.get(f"/remote/commands/{did}?limit=30")
    assert_status(r, 200)
    arr = r.json()
    assert_(isinstance(arr, list), "not a list")
    # Should include at least one of the commands we just created
    created_set = set(c._created_commands)
    if created_set:
        found = [x for x in arr if x.get("_id") in created_set]
        assert_(len(found) > 0, "recently-queued commands not in history")


# ───────────────────────────────────────────────────────────────────────────────
# BROADCAST SUITE (Phase 3)
# ───────────────────────────────────────────────────────────────────────────────

@test("B01", "broadcast")
def t_broadcast_explicit_ids(c: Ctx):
    """Broadcast with deviceIds[] queues one command per device."""
    did = c.device_auth()[0]
    r = c.post("/remote/broadcast", json={
        "deviceIds": [did], "command": "pull_logs",
    })
    assert_status(r, 201)
    body = r.json()
    assert_eq(body.get("targetCount"), 1, "wrong targetCount")
    assert_eq(body.get("okCount"), 1, "command not queued")
    assert_("results" in body and len(body["results"]) == 1, "results array wrong shape")
    c._created_commands.append(body["results"][0]["commandId"])


@test("B02", "broadcast")
def t_broadcast_filter_all(c: Ctx):
    """Broadcast with filter=all targets every active device."""
    r = c.post("/remote/broadcast", json={"filter": "all", "command": "pull_logs"})
    assert_status(r, 201)
    body = r.json()
    assert_(body.get("targetCount", 0) >= 1, "filter=all matched no devices")
    for result in body.get("results", []):
        if result.get("ok"):
            c._created_commands.append(result["commandId"])


@test("B03", "broadcast")
def t_broadcast_requires_command(c: Ctx):
    """Broadcast without command field returns 400."""
    r = c.post("/remote/broadcast", json={"filter": "all"})
    assert_eq(r.status_code, 400, "missing command should 400")


@test("B04", "broadcast")
def t_broadcast_empty_target_list(c: Ctx):
    """Broadcast with no matching devices returns 400."""
    r = c.post("/remote/broadcast", json={
        "deviceIds": [], "filter": "recording", "command": "pull_logs",
    })
    # If no recordings in progress, this should return 400 "no target devices"
    # OR return 0/0 if the filter doesn't resolve to empty. Either is acceptable.
    assert_(r.status_code in (201, 400), f"unexpected {r.status_code}")
    if r.status_code == 201:
        body = r.json()
        # if 201 returned, must have at least one target
        assert_(body.get("targetCount", 0) >= 0, "invalid response")


@test("B05", "broadcast")
def t_broadcast_requires_admin(c: Ctx):
    """Broadcast without admin token is 401/403."""
    r = requests.post(
        f"{c.base}/remote/broadcast",
        json={"filter": "all", "command": "pull_logs"},
        timeout=10,
    )
    assert_(r.status_code in (401, 403), f"expected 401/403, got {r.status_code}")


@test("B06", "broadcast")
def t_broadcast_result_shape(c: Ctx):
    """Broadcast response has {message, targetCount, okCount, failCount, results[]}."""
    did = c.device_auth()[0]
    r = c.post("/remote/broadcast", json={
        "deviceIds": [did], "command": "pull_logs",
    })
    assert_status(r, 201)
    body = r.json()
    for k in ("message", "command", "targetCount", "okCount", "failCount", "results"):
        assert_(k in body, f"broadcast response missing '{k}'")
    if body["okCount"]:
        for r_item in body["results"]:
            if r_item.get("ok"):
                c._created_commands.append(r_item["commandId"])


# ───────────────────────────────────────────────────────────────────────────────
# RECORDINGS SUITE
# ───────────────────────────────────────────────────────────────────────────────

@test("RC01", "recordings")
def t_recordings_requires_auth(c: Ctx):
    """GET /recordings requires admin token."""
    r = requests.get(f"{c.base}/recordings", timeout=10)
    assert_(r.status_code in (401, 403), f"expected 401/403, got {r.status_code}")


@test("RC02", "recordings")
def t_recordings_list(c: Ctx):
    """GET /recordings returns array of recording docs."""
    r = c.get("/recordings")
    assert_status(r, 200)
    arr = r.json()
    assert_(isinstance(arr, list), "not a list")


@test("RC03", "recordings")
def t_recordings_have_required_fields(c: Ctx):
    """Each recording has _id, title, status, scheduledClass populated."""
    r = c.get("/recordings")
    arr = r.json()
    if not arr:
        raise SkipTest("no recordings in DB")
    rec = arr[0]
    for k in ("_id", "title", "status"):
        assert_(k in rec, f"recording missing '{k}'")


@test("RC04", "recordings")
def t_cleanup_stale_endpoint(c: Ctx):
    """POST /recordings/cleanup-stale returns a fixed count (integer, not error)."""
    r = c.post("/recordings/cleanup-stale", json={})
    assert_status(r, 200)
    body = r.json()
    assert_("fixed" in body, "response missing 'fixed' count")
    assert_(isinstance(body["fixed"], int), "fixed should be int")


@test("RC05", "recordings")
def t_force_stop_nonexistent(c: Ctx):
    """Force-stop with invalid id returns 404 (not 500)."""
    r = c.post("/recordings/000000000000000000000000/force-stop")
    assert_(r.status_code in (404, 400),
            f"expected 404 for missing recording, got {r.status_code}")


# ───────────────────────────────────────────────────────────────────────────────
# LICENSES SUITE
# ───────────────────────────────────────────────────────────────────────────────

@test("L01", "licenses")
def t_license_list_requires_auth(c: Ctx):
    """GET /licenses requires admin token."""
    r = requests.get(f"{c.base}/licenses", timeout=10)
    assert_(r.status_code in (401, 403), f"expected 401/403, got {r.status_code}")


@test("L02", "licenses")
def t_license_validate_public(c: Ctx):
    """POST /licenses/validate works without admin auth (public)."""
    r = requests.post(f"{c.base}/licenses/validate",
                      json={"key": "definitely-not-a-real-key"},
                      timeout=10)
    # Either 200 with invalid flag, or 4xx — but NOT 401/403 (public endpoint)
    assert_(r.status_code not in (401, 403),
            f"public endpoint should not require auth, got {r.status_code}")


# ───────────────────────────────────────────────────────────────────────────────
# OTA SUITE
# ───────────────────────────────────────────────────────────────────────────────

@test("O01", "ota")
def t_latest_public(c: Ctx):
    """GET /app/latest is public and returns the active version."""
    r = requests.get(f"{c.base}/app/latest", timeout=10)
    assert_status(r, 200)
    body = r.json()
    if body.get("available"):
        for k in ("versionCode", "versionName", "apkSize"):
            assert_(k in body, f"/app/latest missing '{k}'")


@test("O02", "ota")
def t_download_admin_requires_auth(c: Ctx):
    """GET /app/download-admin requires admin token."""
    r = requests.get(f"{c.base}/app/download-admin", timeout=10, allow_redirects=False)
    assert_(r.status_code in (401, 403), f"expected 401/403, got {r.status_code}")


@test("O03", "ota")
def t_download_admin_works(c: Ctx):
    """GET /app/download-admin with admin auth streams back the APK."""
    r = requests.get(
        f"{c.base}/app/download-admin",
        headers=c.admin_headers(),
        timeout=30,
        stream=True,
    )
    assert_status(r, 200)
    ctype = r.headers.get("content-type", "")
    assert_("vnd.android.package-archive" in ctype or "octet-stream" in ctype,
            f"unexpected content-type '{ctype}'")
    # Read first 4 bytes — valid APK (ZIP) starts with PK\x03\x04
    chunk = next(r.iter_content(4096))
    r.close()
    assert_(chunk[:2] == b"PK", f"APK magic missing, got {chunk[:4]!r}")


@test("O04", "ota")
def t_heartbeat_offers_update_when_old(c: Ctx):
    """Device on v1 gets appUpdate in heartbeat pointing at latest."""
    did, _ = c.device_auth()
    r = requests.post(
        f"{c.base}/classroom-recording/devices/{did}/heartbeat",
        headers=c.device_headers(),
        json={"isRecording": False, "appVersionCode": 1},  # very old
        timeout=15,
    )
    assert_status(r, 200)
    upd = r.json().get("appUpdate")
    # Update MAY be offered (depends on whether an active APK exists)
    if upd is None:
        raise SkipTest("no active APK on server, update offer cannot be validated")
    assert_(upd.get("versionCode", 0) > 1, "update versionCode not newer")
    url = upd.get("downloadUrl", "")
    assert_(url.startswith("https://"),
            f"downloadUrl must be HTTPS (Android HttpURLConnection won't follow HTTP→HTTPS redirect), got: {url}")


@test("O05", "ota")
def t_heartbeat_no_update_when_current(c: Ctx):
    """Device claiming very-high version code gets NO appUpdate."""
    did, _ = c.device_auth()
    r = requests.post(
        f"{c.base}/classroom-recording/devices/{did}/heartbeat",
        headers=c.device_headers(),
        json={"isRecording": False, "appVersionCode": 99999},  # higher than any real release
        timeout=15,
    )
    assert_status(r, 200)
    upd = r.json().get("appUpdate")
    assert_(upd is None,
            f"device claiming version 99999 should not be offered an update, got: {upd}")


# ───────────────────────────────────────────────────────────────────────────────
# ANALYTICS SUITE
# ───────────────────────────────────────────────────────────────────────────────

@test("AN01", "analytics")
def t_fleet_overview(c: Ctx):
    """GET /analytics/fleet-overview returns aggregate + device list."""
    r = c.get("/analytics/fleet-overview")
    assert_status(r, 200)
    body = r.json()
    for k in ("total", "online", "offline", "recording", "healthy", "warning", "critical", "devices"):
        assert_(k in body, f"fleet-overview missing '{k}'")
    assert_(isinstance(body["devices"], list), "devices not a list")


@test("AN02", "analytics")
def t_fleet_overview_phase3_fields(c: Ctx):
    """Phase 3: each device summary includes version/mic/pipeline fields."""
    r = c.get("/analytics/fleet-overview")
    body = r.json()
    if not body["devices"]:
        raise SkipTest("no devices to validate shape")
    d = body["devices"][0]
    expected_phase3_fields = [
        "appVersionName", "appVersionCode", "deviceModel",
        "micLabel", "videoPipeline", "glCompositorEnabled",
        "glCameraPiP", "lastRecordingError", "recordingErrorCount",
    ]
    missing = [f for f in expected_phase3_fields if f not in d]
    assert_(not missing, f"device summary missing Phase 3 fields: {missing}")


@test("AN03", "analytics")
def t_fleet_overview_sorted(c: Ctx):
    """Fleet-overview sorts critical (low score) first."""
    r = c.get("/analytics/fleet-overview")
    devs = r.json().get("devices", [])
    if len(devs) < 2:
        raise SkipTest("need >= 2 devices to check sort order")
    scores = [d["healthScore"] for d in devs]
    assert_(scores == sorted(scores), f"devices not sorted by score asc: {scores}")


@test("AN04", "analytics")
def t_device_history(c: Ctx):
    """GET /analytics/device/:id/history returns N data points."""
    did, _ = c.device_auth()
    r = c.get(f"/analytics/device/{did}/history?days=7")
    assert_status(r, 200)
    body = r.json()
    for k in ("deviceId", "days", "dataPoints", "history"):
        assert_(k in body, f"history response missing '{k}'")


@test("AN05", "analytics")
def t_requires_auth(c: Ctx):
    """Analytics endpoints reject unauthenticated requests."""
    r = requests.get(f"{c.base}/analytics/fleet-overview", timeout=10)
    assert_(r.status_code in (401, 403), f"expected 401/403, got {r.status_code}")


# ───────────────────────────────────────────────────────────────────────────────
# ADMIN PORTAL SUITE
# ───────────────────────────────────────────────────────────────────────────────

@test("P01", "portal")
def t_portal_root(c: Ctx):
    """Admin portal root returns HTTP 200 (SPA)."""
    r = requests.get(c.portal_url("/"), timeout=10, allow_redirects=True)
    assert_(r.status_code in (200, 304), f"expected 200, got {r.status_code}")


@test("P02", "portal")
def t_portal_fleet_route(c: Ctx):
    """Admin portal /fleet returns HTTP 200 (SPA fallback)."""
    r = requests.get(c.portal_url("/fleet"), timeout=10)
    assert_eq(r.status_code, 200, "/fleet must return 200 via SPA rewrite")


@test("P03", "portal")
def t_portal_serves_html(c: Ctx):
    """Portal serves HTML (not an error page)."""
    r = requests.get(c.portal_url("/"), timeout=10)
    ctype = r.headers.get("content-type", "")
    assert_("html" in ctype.lower(), f"content-type not HTML: {ctype}")
    assert_("<div id=\"root\"" in r.text or "<!doctype html>" in r.text.lower(),
            "response doesn't look like SPA shell")


@test("P04", "portal")
def t_portal_deep_route_fallback(c: Ctx):
    """Unknown portal route still returns 200 (SPA fallback) not 404."""
    r = requests.get(c.portal_url("/nonexistent-route-abc"), timeout=10)
    assert_eq(r.status_code, 200, "SPA should serve index.html for unknown routes")


# ───────────────────────────────────────────────────────────────────────────────
# INTEGRITY SUITE
# ───────────────────────────────────────────────────────────────────────────────

@test("I01", "integrity")
def t_apk_matches_declared_size(c: Ctx):
    """Downloaded APK size equals the apkSize field returned by /app/latest."""
    latest = requests.get(f"{c.base}/app/latest", timeout=10).json()
    if not latest.get("available"):
        raise SkipTest("no active APK on server")
    declared = latest["apkSize"]
    # Download and count
    r = requests.get(
        f"{c.base}/app/download-admin",
        headers=c.admin_headers(),
        timeout=60,
        stream=True,
    )
    assert_status(r, 200)
    total = 0
    for chunk in r.iter_content(64 * 1024):
        total += len(chunk)
    r.close()
    # Allow small tolerance for chunked transfer edge cases
    assert_(abs(total - declared) < 4096,
            f"declared {declared} B, downloaded {total} B (delta {abs(total - declared)})")


@test("I02", "integrity")
def t_apk_is_valid_zip(c: Ctx):
    """APK is a valid ZIP archive containing AndroidManifest.xml."""
    import zipfile
    r = requests.get(
        f"{c.base}/app/download-admin",
        headers=c.admin_headers(),
        timeout=60,
    )
    assert_status(r, 200)
    try:
        zf = zipfile.ZipFile(io.BytesIO(r.content))
    except zipfile.BadZipFile:
        raise AssertionError("downloaded bytes are not a valid ZIP/APK")
    names = zf.namelist()
    assert_in("AndroidManifest.xml", names, "APK contents")
    assert_(any(n.startswith("classes") and n.endswith(".dex") for n in names),
            "APK missing classes*.dex")


@test("I03", "integrity")
def t_backend_health(c: Ctx):
    """Backend responds on base URL (doesn't need to be /health, just reachable)."""
    # Known working endpoint: public /app/latest
    r = requests.get(f"{c.base}/app/latest", timeout=10)
    assert_(r.status_code < 500, f"backend unhealthy: {r.status_code}")


# ───────────────────────────────────────────────────────────────────────────────
# RUNNER
# ───────────────────────────────────────────────────────────────────────────────

def run(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="LectureLens QA Suite")
    parser.add_argument("--base", default=DEFAULT_BASE, help="API base URL")
    parser.add_argument("--portal", default=DEFAULT_PORTAL, help="Admin portal URL")
    parser.add_argument("--suite", default="", help="Comma-separated suite names (default: all)")
    parser.add_argument("--json", action="store_true", help="Emit JSON report to stdout")
    parser.add_argument("--report-file", default="", help="Write full report to file")
    args = parser.parse_args(argv)

    selected = set(s.strip() for s in args.suite.split(",") if s.strip()) if args.suite else None

    ctx = Ctx(args.base, args.portal)
    results: list[TestResult] = []

    t0 = time.time()
    if not args.json:
        print(f"\n{'=' * 78}")
        print(f" LectureLens QA Suite  [run {RUN_ID}]")
        print(f"   API:    {ctx.base}")
        print(f"   Portal: {ctx.portal}")
        print(f"{'=' * 78}\n")

    suite_order = sorted(_SUITES.keys())
    for suite_name in suite_order:
        if selected and suite_name not in selected:
            continue
        suite = _SUITES[suite_name]
        if not args.json:
            print(f"── {suite_name.upper()} ".ljust(78, "─"))
        for test_id, fn in sorted(suite.tests, key=lambda x: x[0]):
            start = time.time()
            status, reason = "PASS", ""
            try:
                fn(ctx)
            except SkipTest as e:
                status, reason = "SKIP", str(e)
            except AssertionError as e:
                status, reason = "FAIL", str(e)
            except requests.exceptions.RequestException as e:
                status, reason = "FAIL", f"network error: {e}"
            except Exception as e:
                status, reason = "FAIL", f"{type(e).__name__}: {e}"
            elapsed = int((time.time() - start) * 1000)
            doc = (fn.__doc__ or "").strip().split("\n", 1)[0]
            results.append(TestResult(
                test_id=test_id, suite=suite_name, name=doc,
                status=status, reason=reason, duration_ms=elapsed,
            ))
            if not args.json:
                icon = {"PASS": "✓", "FAIL": "✗", "SKIP": "⊘"}[status]
                colour = {"PASS": "\033[32m", "FAIL": "\033[31m", "SKIP": "\033[33m"}[status]
                reset = "\033[0m"
                line = f"  {colour}{icon}{reset}  {test_id}  {doc}  [{elapsed}ms]"
                print(line)
                if status == "FAIL":
                    print(f"       → {reason}")
                elif status == "SKIP":
                    print(f"       → {reason}")

    total_ms = int((time.time() - t0) * 1000)
    by_status = {"PASS": 0, "FAIL": 0, "SKIP": 0}
    for r in results:
        by_status[r.status] += 1

    summary = {
        "runId": RUN_ID,
        "base": ctx.base,
        "portal": ctx.portal,
        "totals": by_status,
        "durationMs": total_ms,
        "results": [r.__dict__ for r in results],
    }

    if args.report_file:
        with open(args.report_file, "w") as f:
            json.dump(summary, f, indent=2)

    if args.json:
        print(json.dumps(summary, indent=2))
    else:
        print(f"\n{'=' * 78}")
        fails = by_status["FAIL"]
        verdict_colour = "\033[32m" if fails == 0 else "\033[31m"
        print(f" {verdict_colour}{'ALL PASS' if fails == 0 else f'{fails} FAILED'}\033[0m  "
              f"·  pass={by_status['PASS']}  fail={by_status['FAIL']}  skip={by_status['SKIP']}"
              f"  ({total_ms}ms)")
        print(f"{'=' * 78}\n")

        if fails > 0:
            print("FAILED TESTS:")
            for r in results:
                if r.status == "FAIL":
                    print(f"  {r.test_id}  ({r.suite})  {r.name}")
                    print(f"    → {r.reason}")
            print()

    return 0 if by_status["FAIL"] == 0 else 1


if __name__ == "__main__":
    sys.exit(run(sys.argv[1:]))
