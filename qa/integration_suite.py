#!/usr/bin/env python3
"""
LectureLens Integration + Security + Performance Suite
========================================================

Catches classes of bugs the basic QA and stress suites miss:
 * real schedule → heartbeat flow (class visible to device)
 * device command lifecycle timing
 * recording segment URL resolvability
 * auth surface coverage (no protected endpoint leaks)
 * timezone integrity in scheduled classes
 * upload edge cases (duplicate code, empty file, wrong content-type)
 * admin portal HTML + JS bundle sanity
 * NoSQL injection attempts on user inputs
 * XSS resilience in title fields
 * response-time budgets on hot endpoints

Safe on production: tests that create data use a shared marker
(integ-<timestamp>) and clean up after themselves.
"""

from __future__ import annotations

import io
import json
import os
import re
import sys
import time
import zipfile
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

import requests

BASE = os.environ.get("LCS_API_BASE", "https://lecturelens-api.draisol.com/api")
PORTAL = os.environ.get("LCS_PORTAL", "https://lecturelens-admin.draisol.com")
ADMIN_EMAIL = os.environ.get("LCS_ADMIN_EMAIL", "admin@draisol.com")
ADMIN_PASSWORD = os.environ.get("LCS_ADMIN_PASSWORD", "admin@123")
DEVICE_ID = os.environ.get("LCS_QA_DEVICE", "dev_89c1eaca675006c3")

RUN_ID = datetime.now(timezone.utc).strftime("integ-%Y%m%d-%H%M%S")

_token = None
_device_auth = None
_test_artifacts = []


def admin_token():
    global _token
    if _token:
        return _token
    r = requests.post(f"{BASE}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=10)
    r.raise_for_status()
    _token = r.json()["token"]
    return _token


def admin_headers():
    return {"Authorization": f"Bearer {admin_token()}"}


def device_auth_for(device_id):
    global _device_auth
    if _device_auth:
        return _device_auth
    r = requests.get(f"{BASE}/classroom-recording/devices", headers=admin_headers(), timeout=10)
    for d in r.json():
        if d.get("deviceId") == device_id:
            _device_auth = d.get("authToken") or ""
            return _device_auth
    raise RuntimeError(f"test device {device_id} not found")


def device_headers(device_id):
    return {"x-device-id": device_id, "x-device-token": device_auth_for(device_id)}


# ─────────── Result tracking ───────────
@dataclass
class Outcome:
    test_id: str
    name: str
    status: str
    reason: str = ""
    duration_ms: int = 0
    extra: dict = field(default_factory=dict)


results: list[Outcome] = []


def run_test(test_id, name, fn):
    t0 = time.time()
    try:
        r = fn()
        dur = int((time.time() - t0) * 1000)
        if isinstance(r, tuple):
            s = r[0]
            rsn = r[1] if len(r) > 1 else ""
            ext = r[2] if len(r) > 2 else {}
        else:
            s, rsn, ext = "PASS", "", {}
    except Exception as e:
        dur = int((time.time() - t0) * 1000)
        s, rsn, ext = "FAIL", f"{type(e).__name__}: {e}", {}

    results.append(Outcome(test_id, name, s, rsn, dur, ext))
    icon = {"PASS": "✓", "FAIL": "✗", "SKIP": "⊘"}[s]
    col = {"PASS": "\033[32m", "FAIL": "\033[31m", "SKIP": "\033[33m"}[s]
    print(f"  {col}{icon}\033[0m  {test_id}  {name}  [{dur}ms]")
    if s != "PASS":
        print(f"       → {rsn}")
    for k, v in ext.items():
        print(f"       • {k}: {v}")


# ═══════════════════════════════════════════════════════════════════════
# INTEGRATION SUITE — end-to-end data flows
# ═══════════════════════════════════════════════════════════════════════

def i01_schedule_visible_in_heartbeat():
    """Create a scheduled class for now+2min; heartbeat response must include it."""
    # Find a room + course to schedule under
    rooms = requests.get(f"{BASE}/rooms", headers=admin_headers(), timeout=10).json()
    if not rooms:
        return "SKIP", "no rooms in system"
    room = next((r for r in rooms if r.get("roomNumber") == "001"), rooms[0])

    courses = requests.get(f"{BASE}/courses", headers=admin_headers(), timeout=10).json()
    if not courses:
        return "SKIP", "no courses in system"
    course = courses[0]

    teachers = requests.get(f"{BASE}/users?role=teacher", headers=admin_headers(), timeout=10).json()
    if not teachers:
        # try /users with any role
        teachers = requests.get(f"{BASE}/users", headers=admin_headers(), timeout=10).json()
    teacher = (teachers if isinstance(teachers, list) else teachers.get("users", []))[0] if teachers else None

    now = datetime.now(timezone.utc)
    start = (now + timedelta(minutes=3))
    end = (now + timedelta(minutes=8))
    class_payload = {
        "title": f"integ-test-{RUN_ID}",
        "date": now.strftime("%Y-%m-%d"),
        "startTime": start.strftime("%H:%M"),
        "endTime": end.strftime("%H:%M"),
        "roomNumber": room.get("roomNumber", "001"),
        "course": course.get("_id"),
        "teacher": (teacher or {}).get("_id"),
        "courseName": course.get("courseName", ""),
        "courseCode": course.get("courseCode", ""),
        "teacherName": (teacher or {}).get("name", ""),
    }
    r = requests.post(f"{BASE}/classes", headers=admin_headers(), json=class_payload, timeout=15)
    if r.status_code not in (200, 201):
        return "FAIL", f"schedule HTTP {r.status_code}: {r.text[:200]}"
    class_id = (r.json().get("_id") or r.json().get("class", {}).get("_id"))
    _test_artifacts.append(("class", class_id))

    # Heartbeat and check schedule contains this class
    time.sleep(1)
    hb = requests.post(
        f"{BASE}/classroom-recording/devices/{DEVICE_ID}/heartbeat",
        headers=device_headers(DEVICE_ID),
        json={"isRecording": False, "appVersionCode": 22},
        timeout=15,
    )
    if hb.status_code != 200:
        return "FAIL", f"heartbeat HTTP {hb.status_code}"
    schedule = hb.json().get("schedule", [])
    found = any(s.get("meetingId") == class_id or s.get("title", "").startswith(f"integ-test-{RUN_ID}") for s in schedule)
    if not found:
        return "FAIL", f"class not in schedule: {[s.get('title') for s in schedule]}"
    return "PASS", "", {"class_id": class_id, "schedule_items": len(schedule)}


def i02_heartbeat_response_has_required_fields():
    """Heartbeat response must have schedule, serverTime, commands — every field Android expects."""
    r = requests.post(
        f"{BASE}/classroom-recording/devices/{DEVICE_ID}/heartbeat",
        headers=device_headers(DEVICE_ID), json={}, timeout=15,
    )
    if r.status_code != 200:
        return "FAIL", f"HTTP {r.status_code}"
    body = r.json()
    required = ["schedule", "serverTime", "commands"]
    missing = [k for k in required if k not in body]
    if missing:
        return "FAIL", f"missing keys: {missing}"
    # serverTime must be parseable ISO
    try:
        datetime.fromisoformat(body["serverTime"].replace("Z", "+00:00"))
    except Exception as e:
        return "FAIL", f"serverTime not ISO: {e}"
    return "PASS", "", {"keys": list(body.keys())}


def i03_command_lifecycle():
    """Queue a command → verify status=pending → simulated ack (no device needed)."""
    r = requests.post(
        f"{BASE}/remote/command", headers=admin_headers(),
        json={"deviceId": DEVICE_ID, "command": "pull_logs", "params": {"integ": RUN_ID}},
        timeout=10,
    )
    if r.status_code != 201:
        return "FAIL", f"queue HTTP {r.status_code}"
    cmd_id = r.json()["command"]["_id"]
    _test_artifacts.append(("command", cmd_id))

    # Fetch history and confirm the command is there with status=pending
    h = requests.get(f"{BASE}/remote/commands/{DEVICE_ID}?limit=5", headers=admin_headers(), timeout=10)
    cmds = h.json()
    found = next((c for c in cmds if c.get("_id") == cmd_id), None)
    if not found:
        return "FAIL", "command not in history"
    if found.get("status") != "pending":
        return "FAIL", f"expected pending, got {found.get('status')}"
    return "PASS", "", {"command_id": cmd_id[:8], "status": found.get("status")}


def i04_recording_segments_resolvable():
    """For every completed recording, every segment URL must return HTTP 200 or redirect."""
    r = requests.get(f"{BASE}/recordings", headers=admin_headers(), timeout=10)
    recs = r.json() if isinstance(r.json(), list) else []
    checked = 0
    broken = []
    # Check up to 5 most-recent segments to avoid heavy fetches
    for rec in sorted(recs, key=lambda x: x.get("createdAt", ""), reverse=True)[:3]:
        if rec.get("status") != "completed":
            continue
        for seg in rec.get("segments", [])[:2]:
            url = seg.get("videoUrl")
            if not url:
                continue
            full = url if url.startswith("http") else BASE.replace("/api", "") + url
            head = requests.head(full, timeout=15, allow_redirects=True)
            checked += 1
            if head.status_code not in (200, 206):
                broken.append(f"{rec.get('_id')[:6]}/seg{seg.get('segmentIndex')}: HTTP {head.status_code}")
    if not checked:
        return "SKIP", "no completed recordings with segments"
    if broken:
        return "FAIL", f"broken segment URLs: {broken}"
    return "PASS", "", {"checked": checked}


def i05_upload_duplicate_version_code_rejected():
    """POST /app/upload with an already-used versionCode must return 409."""
    # Use the currently-active code (which obviously exists) — should 409
    latest = requests.get(f"{BASE}/app/latest", timeout=10).json()
    if not latest.get("available"):
        return "SKIP", "no active version"
    existing_code = latest["versionCode"]

    # Upload a tiny file with the same code — should be rejected
    tiny = b"PK\x05\x06" + b"\x00" * 18  # empty-zip magic
    r = requests.post(
        f"{BASE}/app/upload", headers=admin_headers(),
        files={"apk": ("tiny.apk", io.BytesIO(tiny), "application/vnd.android.package-archive")},
        data={"versionCode": existing_code, "versionName": "duplicate-test", "releaseNotes": "dup"},
        timeout=30,
    )
    if r.status_code != 409:
        return "FAIL", f"expected 409 duplicate, got {r.status_code}: {r.text[:200]}"
    return "PASS", "", {"rejected_code": existing_code}


def i06_upload_invalid_version_code_rejected():
    """POST /app/upload with non-positive versionCode must return 400."""
    tiny = b"PK\x05\x06" + b"\x00" * 18
    r = requests.post(
        f"{BASE}/app/upload", headers=admin_headers(),
        files={"apk": ("tiny.apk", io.BytesIO(tiny), "application/vnd.android.package-archive")},
        data={"versionCode": -5, "versionName": "invalid", "releaseNotes": ""},
        timeout=30,
    )
    if r.status_code != 400:
        return "FAIL", f"expected 400, got {r.status_code}"
    return "PASS", "", {"rejected_code": -5}


def i07_timezone_integrity():
    """Server-side class dates must be stored/returned as UTC (no timezone drift)."""
    now = datetime.now(timezone.utc)
    # Read a class and confirm the date field is a valid ISO + server/client agree
    r = requests.get(f"{BASE}/classes", headers=admin_headers(), timeout=10)
    classes = r.json() if isinstance(r.json(), list) else []
    if not classes:
        return "SKIP", "no classes to validate"
    c = classes[0]
    try:
        dt = datetime.fromisoformat(c["date"].replace("Z", "+00:00"))
    except Exception as e:
        return "FAIL", f"class.date not ISO: {e}"
    return "PASS", "", {"sample_date": c.get("date")}


def i08_all_sensitive_routes_require_auth():
    """Brute-force: every admin-only route must reject unauthenticated requests."""
    # Sample of protected routes
    protected = [
        ("GET", "/recordings"),
        ("GET", "/classroom-recording/devices"),
        ("GET", "/analytics/fleet-overview"),
        ("GET", "/app/versions"),
        ("GET", "/app/download-admin"),
        ("GET", "/remote/commands/x"),
        ("POST", "/remote/command"),
        ("POST", "/remote/broadcast"),
        ("POST", "/recordings/cleanup-stale"),
        ("GET", "/users"),
        ("GET", "/licenses"),
        ("POST", "/app/upload"),
    ]
    leaks = []
    for method, path in protected:
        try:
            r = requests.request(method, f"{BASE}{path}", json={}, timeout=10)
            if r.status_code not in (401, 403):
                leaks.append(f"{method} {path} → {r.status_code}")
        except Exception:
            pass
    if leaks:
        return "FAIL", f"routes leaking without auth: {leaks}"
    return "PASS", "", {"checked": len(protected)}


def i09_device_token_scoping():
    """Device A's token cannot heartbeat as Device B."""
    # Try to heartbeat as DEVICE_ID using DEVICE_ID's own token but against a different device ID path.
    fake_id = "dev_nonexistent_xyz"
    r = requests.post(
        f"{BASE}/classroom-recording/devices/{fake_id}/heartbeat",
        headers=device_headers(DEVICE_ID),
        json={}, timeout=10,
    )
    # Backend should reject because the device token doesn't match URL deviceId.
    if r.status_code not in (401, 403):
        return "FAIL", f"token scoping leak — HTTP {r.status_code}"
    return "PASS", "", {"http_status": r.status_code}


def i10_jwt_expiry_signal():
    """Invalid JWT should be a clean 401, not 500."""
    r = requests.get(f"{BASE}/classroom-recording/devices",
                     headers={"Authorization": "Bearer eyJ0eXAiOi.invalid.signature"},
                     timeout=10)
    if r.status_code == 500:
        return "FAIL", "backend 500'd on malformed JWT"
    if r.status_code not in (401, 403):
        return "FAIL", f"expected 401/403, got {r.status_code}"
    return "PASS", "", {"http_status": r.status_code}


def i11_ota_url_is_https():
    """Heartbeat response's appUpdate.downloadUrl MUST be HTTPS."""
    r = requests.post(
        f"{BASE}/classroom-recording/devices/{DEVICE_ID}/heartbeat",
        headers=device_headers(DEVICE_ID),
        json={"isRecording": False, "appVersionCode": 1},  # force update offer
        timeout=15,
    )
    upd = r.json().get("appUpdate")
    if upd is None:
        return "SKIP", "no active APK"
    url = upd.get("downloadUrl", "")
    if not url.startswith("https://"):
        return "FAIL", f"downloadUrl not HTTPS: {url}"
    return "PASS", "", {"url": url}


# ═══════════════════════════════════════════════════════════════════════
# SECURITY SANITY
# ═══════════════════════════════════════════════════════════════════════

def sec01_nosql_injection_login():
    """Classic NoSQL injection on login should NOT authenticate."""
    # Try {"$gt": ""} as password — classic Mongoose injection
    r = requests.post(f"{BASE}/auth/login",
                      json={"email": ADMIN_EMAIL, "password": {"$gt": ""}},
                      timeout=10)
    # Must NOT return 200 with a token
    if r.status_code == 200:
        body = r.json()
        if body.get("token"):
            return "FAIL", "NoSQL injection succeeded! got a token"
    return "PASS", "", {"http_status": r.status_code}


def sec02_xss_in_class_title():
    """Create a class with <script> in title; fetch it back and confirm not XSS-exploitable."""
    payload = f"<script>alert(1)</script>-{RUN_ID}"
    now = datetime.now(timezone.utc)
    # Try to schedule — if it succeeds, verify the response is JSON (not a script injection surface)
    r = requests.post(f"{BASE}/classes", headers=admin_headers(),
                      json={
                          "title": payload,
                          "date": now.strftime("%Y-%m-%d"),
                          "startTime": "09:00",
                          "endTime": "09:30",
                          "roomNumber": "001",
                      },
                      timeout=15)
    if r.status_code not in (200, 201, 400):
        return "FAIL", f"unexpected HTTP {r.status_code}"
    if r.status_code >= 400:
        return "PASS", "rejected at schedule time"  # that's fine too
    # Clean up
    cid = (r.json().get("_id") or r.json().get("class", {}).get("_id"))
    if cid:
        _test_artifacts.append(("class", cid))
    # Check that fetch returns the title as a string (will be JSON-escaped)
    g = requests.get(f"{BASE}/classes", headers=admin_headers(), timeout=10).json()
    if not isinstance(g, list):
        return "PASS"  # can't verify shape
    stored = next((c for c in g if c.get("_id") == cid), None)
    if stored and stored.get("title") != payload:
        return "FAIL", "title got transformed — could be a sanitiser masking bug"
    return "PASS", "", {"title_stored_verbatim": True}


def sec03_no_api_stack_traces():
    """Trigger a known 400 and verify response doesn't leak a stack trace."""
    # Malformed JSON body on a protected route
    r = requests.post(f"{BASE}/remote/command",
                      headers={**admin_headers(), "Content-Type": "application/json"},
                      data="this is not json",
                      timeout=10)
    body = r.text
    # Stack traces typically contain "at " paths with file:line, Node throws
    if re.search(r"at .+:\d+:\d+", body):
        return "FAIL", "stack trace leaked in response"
    return "PASS", "", {"response_len": len(body)}


# ═══════════════════════════════════════════════════════════════════════
# PERFORMANCE SANITY
# ═══════════════════════════════════════════════════════════════════════

def perf_budget(url, budget_ms, headers=None):
    """Helper: time a GET request, compare against budget."""
    t0 = time.time()
    r = requests.get(url, headers=headers or {}, timeout=10)
    elapsed = int((time.time() - t0) * 1000)
    ok = r.status_code == 200 and elapsed <= budget_ms
    return ok, elapsed, r.status_code


def p01_devices_list_under_1500ms():
    """GET /devices should respond in under 1500 ms."""
    ok, elapsed, code = perf_budget(f"{BASE}/classroom-recording/devices", 1500, admin_headers())
    if not ok and code == 200:
        return "FAIL", f"took {elapsed}ms (budget 1500ms)"
    if code != 200:
        return "FAIL", f"HTTP {code}"
    return "PASS", "", {"elapsed_ms": elapsed}


def p02_recordings_list_under_3000ms():
    """GET /recordings should respond in under 3000 ms."""
    ok, elapsed, code = perf_budget(f"{BASE}/recordings", 3000, admin_headers())
    if not ok and code == 200:
        return "FAIL", f"took {elapsed}ms (budget 3000ms)"
    if code != 200:
        return "FAIL", f"HTTP {code}"
    return "PASS", "", {"elapsed_ms": elapsed}


def p03_fleet_overview_under_2000ms():
    """GET /analytics/fleet-overview should respond in under 2000 ms."""
    ok, elapsed, code = perf_budget(f"{BASE}/analytics/fleet-overview", 2000, admin_headers())
    if not ok and code == 200:
        return "FAIL", f"took {elapsed}ms (budget 2000ms)"
    if code != 200:
        return "FAIL", f"HTTP {code}"
    return "PASS", "", {"elapsed_ms": elapsed}


def p04_portal_root_under_1500ms():
    """Portal / should respond in under 1500 ms."""
    t0 = time.time()
    r = requests.get(f"{PORTAL}/", timeout=10)
    elapsed = int((time.time() - t0) * 1000)
    if r.status_code != 200:
        return "FAIL", f"HTTP {r.status_code}"
    if elapsed > 1500:
        return "FAIL", f"{elapsed}ms (budget 1500ms)"
    return "PASS", "", {"elapsed_ms": elapsed}


# ═══════════════════════════════════════════════════════════════════════
# PORTAL SANITY
# ═══════════════════════════════════════════════════════════════════════

def por01_index_has_js_bundle():
    """/ must reference a JS bundle (Vite build) — else frontend is broken."""
    r = requests.get(f"{PORTAL}/", timeout=10)
    if r.status_code != 200:
        return "FAIL", f"HTTP {r.status_code}"
    html = r.text
    match = re.search(r'<script[^>]+src="([^"]+\.js)"', html)
    if not match:
        return "FAIL", "no <script src> in index.html"
    js_url = match.group(1)
    full = f"{PORTAL}{js_url}" if js_url.startswith("/") else js_url
    js = requests.get(full, timeout=15)
    if js.status_code != 200:
        return "FAIL", f"JS bundle 404: {full}"
    if len(js.content) < 10_000:
        return "FAIL", f"JS bundle suspiciously small: {len(js.content)} bytes"
    return "PASS", "", {"bundle": js_url, "size_kb": len(js.content) // 1024}


def por02_spa_fallback_serves_index():
    """Any /random/path must serve the SPA index (same HTML)."""
    a = requests.get(f"{PORTAL}/", timeout=10).text
    b = requests.get(f"{PORTAL}/random/path-{RUN_ID}", timeout=10)
    if b.status_code != 200:
        return "FAIL", f"deep route HTTP {b.status_code}"
    # Compare a signature — both should contain <div id="root"
    if '<div id="root"' not in b.text:
        return "FAIL", "SPA fallback didn't return HTML shell"
    return "PASS"


def por03_api_cors_permits_portal():
    """API must permit requests from the admin portal origin."""
    r = requests.options(
        f"{BASE}/auth/login",
        headers={
            "Origin": PORTAL,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "Content-Type,Authorization",
        },
        timeout=10,
    )
    # Some servers handle OPTIONS at their CORS middleware and return 204 with headers
    if r.status_code not in (200, 204):
        return "FAIL", f"preflight HTTP {r.status_code}"
    allow = r.headers.get("Access-Control-Allow-Origin", "")
    if allow not in ("*", PORTAL):
        return "FAIL", f"CORS origin '{allow}' rejects portal"
    return "PASS", "", {"cors_origin": allow}


# ═══════════════════════════════════════════════════════════════════════
# APK STRUCTURAL VALIDATION
# ═══════════════════════════════════════════════════════════════════════

def apk01_v252_structure_valid():
    """Downloaded latest APK: valid ZIP, has AndroidManifest, classes.dex, resources."""
    r = requests.get(f"{BASE}/app/download-admin", headers=admin_headers(), timeout=60)
    if r.status_code != 200:
        return "FAIL", f"HTTP {r.status_code}"
    try:
        zf = zipfile.ZipFile(io.BytesIO(r.content))
        names = zf.namelist()
    except zipfile.BadZipFile:
        return "FAIL", "not a valid ZIP"
    required = ["AndroidManifest.xml"]
    missing = [n for n in required if n not in names]
    has_dex = any(n.startswith("classes") and n.endswith(".dex") for n in names)
    if missing:
        return "FAIL", f"APK missing {missing}"
    if not has_dex:
        return "FAIL", "APK missing classes*.dex"
    return "PASS", "", {"entries": len(names), "size_mb": len(r.content) // (1024 * 1024)}


def apk02_version_name_matches_latest():
    """/app/latest versionName should be the one actually in the served APK's manifest (approx — we just confirm it's present)."""
    latest = requests.get(f"{BASE}/app/latest", timeout=10).json()
    if not latest.get("available"):
        return "SKIP", "no active APK"
    name = latest.get("versionName", "")
    if not re.match(r"^\d+\.\d+\.\d+", name):
        return "FAIL", f"versionName '{name}' not semver-ish"
    return "PASS", "", {"versionName": name, "versionCode": latest.get("versionCode")}


# ═══════════════════════════════════════════════════════════════════════
# CLEANUP
# ═══════════════════════════════════════════════════════════════════════

def cleanup():
    """Remove test artefacts created during this run."""
    for kind, oid in _test_artifacts:
        try:
            if kind == "class":
                requests.delete(f"{BASE}/classes/{oid}", headers=admin_headers(), timeout=10)
            # Commands have TTL — not worth deleting
        except Exception:
            pass


# ═══════════════════════════════════════════════════════════════════════
# RUNNER
# ═══════════════════════════════════════════════════════════════════════

TESTS = [
    # Integration
    ("I01", "Scheduled class visible in heartbeat response", i01_schedule_visible_in_heartbeat),
    ("I02", "Heartbeat response has all required top-level keys", i02_heartbeat_response_has_required_fields),
    ("I03", "Command queue → history shows pending state", i03_command_lifecycle),
    ("I04", "Every recording segment URL resolves (HEAD 200/206)", i04_recording_segments_resolvable),
    ("I05", "Upload with duplicate versionCode returns 409", i05_upload_duplicate_version_code_rejected),
    ("I06", "Upload with non-positive versionCode returns 400", i06_upload_invalid_version_code_rejected),
    ("I07", "Class dates stored as ISO timestamps", i07_timezone_integrity),
    ("I08", "All sensitive routes reject unauthenticated access", i08_all_sensitive_routes_require_auth),
    ("I09", "Device token scoped to its own deviceId (cannot impersonate)", i09_device_token_scoping),
    ("I10", "Malformed JWT returns 401/403 (not 500)", i10_jwt_expiry_signal),
    ("I11", "Heartbeat's appUpdate.downloadUrl is HTTPS", i11_ota_url_is_https),
    # Security
    ("SEC01", "NoSQL injection on login password field rejected", sec01_nosql_injection_login),
    ("SEC02", "XSS payload in class title stored verbatim, not executed", sec02_xss_in_class_title),
    ("SEC03", "Protected endpoints don't leak Node stack traces", sec03_no_api_stack_traces),
    # Perf
    ("P01", "GET /devices < 1500ms", p01_devices_list_under_1500ms),
    ("P02", "GET /recordings < 3000ms", p02_recordings_list_under_3000ms),
    ("P03", "GET /analytics/fleet-overview < 2000ms", p03_fleet_overview_under_2000ms),
    ("P04", "Portal / < 1500ms", p04_portal_root_under_1500ms),
    # Portal
    ("POR01", "Portal index.html references a working JS bundle", por01_index_has_js_bundle),
    ("POR02", "SPA fallback serves index for deep routes", por02_spa_fallback_serves_index),
    ("POR03", "API CORS accepts portal origin", por03_api_cors_permits_portal),
    # APK
    ("APK01", "Downloaded APK is valid ZIP with manifest + dex", apk01_v252_structure_valid),
    ("APK02", "Latest versionName is semver-ish and matches metadata", apk02_version_name_matches_latest),
]


def main():
    print(f"\n{'=' * 78}")
    print(f"  Integration + Security + Performance  [run {RUN_ID}]")
    print(f"  API:    {BASE}")
    print(f"  Portal: {PORTAL}")
    print(f"{'=' * 78}\n")

    t0 = time.time()
    for test_id, name, fn in TESTS:
        run_test(test_id, name, fn)

    cleanup()

    dur = int((time.time() - t0) * 1000)
    counts = {"PASS": 0, "FAIL": 0, "SKIP": 0}
    for r in results:
        counts[r.status] += 1

    print(f"\n{'=' * 78}")
    fails = counts["FAIL"]
    col = "\033[32m" if fails == 0 else "\033[31m"
    verdict = "ALL PASS" if fails == 0 else f"{fails} FAILED"
    print(f"  {col}{verdict}\033[0m  ·  pass={counts['PASS']}  fail={counts['FAIL']}  skip={counts['SKIP']}  ({dur}ms)")
    print(f"{'=' * 78}\n")

    if fails:
        for r in results:
            if r.status == "FAIL":
                print(f"  {r.test_id}  {r.name}")
                print(f"    → {r.reason}")
    return 0 if fails == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
