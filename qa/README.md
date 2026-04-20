# LectureLens QA Regression Suite

End-to-end automated tests against the production deployment (Railway backend
+ Vercel admin portal). Designed to run in CI or manually before every
release.

## Prereqs

```bash
pip3 install requests
```

## Run

```bash
# All suites against production
python3 qa_suite.py

# Specific suite(s) only
python3 qa_suite.py --suite auth,devices

# Machine-readable JSON output (CI)
python3 qa_suite.py --json

# Persist full report
python3 qa_suite.py --report-file /tmp/qa-report.json

# Override target (e.g. staging)
python3 qa_suite.py --base https://staging-api.example.com/api \
                    --portal https://staging-admin.example.com
```

## Exit codes

| Code | Meaning |
|------|---------|
| 0    | All tests passed (or skipped with a valid reason) |
| 1    | One or more FAIL results |
| 2    | Framework error (missing dependency, etc.) |

## Suites & ID Scheme

| Prefix | Suite | Coverage |
|--------|-------|----------|
| A      | auth       | Login, token guards, role enforcement |
| D      | devices    | Device CRUD, heartbeat auth + persistence |
| R      | remote     | All 13 remote commands + command-result lifecycle |
| B      | broadcast  | Phase 3 bulk `/remote/broadcast` endpoint |
| RC     | recordings | List, shape, cleanup-stale, force-stop |
| L      | licenses   | Auth gating + public validate endpoint |
| O      | ota        | APK serving, download auth, HTTPS URL guarantee |
| AN     | analytics  | Fleet overview + Phase 3 fields + sort order + history |
| P      | portal     | Admin portal SPA routing + HTML shell |
| I      | integrity  | APK bytes match declared size, is a valid ZIP with manifest |

Each test has a stable ID (e.g. `R07`) that's printed alongside pass/fail —
use that ID in commit messages or issue reports for traceability.

## Safety

- All write operations are tagged with a run-scoped marker (`qa-YYYYMMDD-HHMMSS`)
  so test artefacts (queued commands, etc.) are identifiable.
- No test deletes real recordings or user data.
- Tests that depend on the Smart TV being online will SKIP (not FAIL) if the
  device is offline — the suite still validates server-side behaviour.

## Adding tests

Decorate a function with `@test("X99", "suite_name")` and it's auto-registered:

```python
@test("D09", "devices")
def t_something(c: Ctx):
    """One-line description shown on fail."""
    r = c.get("/some/endpoint")
    assert_status(r, 200)
```

`Ctx` provides lazy fixtures: `c.admin_token()`, `c.device_auth()`,
`c.admin_headers()`, `c.device_headers()`. See the existing tests for
patterns.

Raise `SkipTest("reason")` when the environment makes the test unrunnable
(e.g. no devices, no APK uploaded).
