#!/usr/bin/env bash
# validate-tv.sh — end-to-end validation of a single TV recording.
#
# Usage:
#   ./validate-tv.sh <deviceId>
#   ./validate-tv.sh <deviceId> <recordingId>
#
# With just a deviceId, runs the LIVE checks (heartbeat, pipeline, audio level
# during a recording in flight). Add a recordingId to also run the AFTER-CLASS
# checks (ffprobe + frame variance + audio mean_volume).
#
# Exits 0 on full pass, 1 on any failure. Prints a per-check report.

set -uo pipefail

DEVICE_ID="${1:?Usage: $0 <deviceId> [recordingId]}"
RECORDING_ID="${2:-}"

API="https://lecturelens-api.draisol.com"
TOKEN_FILE="/tmp/ll_token"
TOKEN="$(cat "$TOKEN_FILE")"
if [[ -z "$TOKEN" ]]; then
  echo "ERROR: no admin token at $TOKEN_FILE" >&2
  exit 1
fi

PASS=0
FAIL=0
WARN=0

ok()    { echo "  ✅ $*"; PASS=$((PASS+1)); }
fail()  { echo "  ❌ $*"; FAIL=$((FAIL+1)); }
warn()  { echo "  ⚠️  $*"; WARN=$((WARN+1)); }
info()  { echo "  ℹ️  $*"; }

echo "═══════════════════════════════════════════════════════════"
echo " validate-tv.sh — $DEVICE_ID"
echo "═══════════════════════════════════════════════════════════"

# ─── Live checks (heartbeat-driven) ────────────────────────────────
echo
echo "▸ LIVE STATE CHECKS"

DEV_JSON="$(curl -sS "$API/api/classroom-recording/devices" -H "Authorization: Bearer $TOKEN")"

read -r ver vc hb_age is_online is_recording vp lk_state mic_bound audio_db last_err mic_name cam_ok mic_ok cam_name <<<"$(
  echo "$DEV_JSON" | python3 -c "
import sys, json, datetime
devices = json.load(sys.stdin)
now = datetime.datetime.now(datetime.timezone.utc)
target = '$DEVICE_ID'
for d in devices:
    if d.get('deviceId') != target: continue
    hb = d.get('lastHeartbeat')
    age = -1
    try: age = int((now - datetime.datetime.fromisoformat(hb.replace('Z','+00:00'))).total_seconds())
    except: pass
    h = d.get('health') or {}; rec = h.get('recording') or {}
    print(
        d.get('appVersionName','?'),
        d.get('appVersionCode','?'),
        age,
        d.get('isOnline'),
        d.get('isRecording'),
        repr(rec.get('videoPipeline')),
        repr(rec.get('livekitConnectionState')),
        rec.get('usbMicBoundOk'),
        rec.get('audioLevelDb', -90),
        repr(rec.get('lastError','')),
        repr((h.get('mic') or {}).get('name','')),
        (h.get('camera') or {}).get('ok'),
        (h.get('mic') or {}).get('ok'),
        repr((h.get('camera') or {}).get('name','')),
    )
    break
")"

info "version: $ver (vc=$vc)"
info "heartbeat age: ${hb_age}s"
info "online=$is_online | isRecording=$is_recording"
info "mic.name=$mic_name (ok=$mic_ok)"
info "camera.name=$cam_name (ok=$cam_ok)"
info "videoPipeline=$vp | livekit=$lk_state"
info "usbMicBoundOk=$mic_bound | audioLevelDb=$audio_db"
info "lastError=$last_err"

if [[ "$hb_age" =~ ^[0-9]+$ ]] && (( hb_age < 90 )); then ok "heartbeat fresh (<90s)"; else fail "heartbeat stale: ${hb_age}s"; fi
if [[ "$is_online" == "True" ]]; then ok "TV online"; else fail "TV offline"; fi
if [[ "$cam_ok" == "True" ]]; then ok "USB camera detected"; else fail "USB camera NOT detected"; fi
if [[ "$mic_ok" == "True" ]]; then ok "USB mic detected"; else fail "USB mic NOT detected"; fi

if [[ "$is_recording" == "True" ]]; then
  echo
  echo "▸ RECORDING-IN-PROGRESS CHECKS"
  if [[ "$vp" == "'livekit'" ]]; then ok "videoPipeline=livekit"; else fail "videoPipeline=$vp (expected 'livekit')"; fi
  if [[ "$lk_state" == "'CONNECTED'" ]]; then ok "LiveKit connected"; else fail "LiveKit state=$lk_state"; fi
  if [[ "$mic_bound" == "True" ]]; then ok "USB mic bound to AudioRecord"; else warn "usbMicBoundOk=$mic_bound (bind verify failed or in progress)"; fi

  # Audio level threshold check
  if python3 -c "import sys; v=float('$audio_db'); sys.exit(0 if v > -50 else 1)"; then
    ok "audioLevelDb=$audio_db > -50 (live audio detected)"
  else
    fail "audioLevelDb=$audio_db ≤ -50 (silent OR no signal)"
  fi
fi

# ─── After-class MP4 analysis ──────────────────────────────────────
if [[ -n "$RECORDING_ID" ]]; then
  echo
  echo "▸ POST-RECORDING MP4 ANALYSIS"

  REC_JSON="$(curl -sS "$API/api/recordings/$RECORDING_ID" -H "Authorization: Bearer $TOKEN")"
  read -r status pipeline merge_status egress_status file_size duration url <<<"$(
    echo "$REC_JSON" | python3 -c "
import sys, json
r = json.load(sys.stdin)
print(
    r.get('status','?'),
    r.get('pipeline','?'),
    r.get('mergeStatus','?'),
    r.get('livekitEgressStatus','?'),
    r.get('fileSize',0),
    r.get('duration',0),
    repr(r.get('mergedVideoUrl') or r.get('videoUrl') or ''),
)
")"
  info "status=$status pipeline=$pipeline mergeStatus=$merge_status egressStatus=$egress_status"
  info "fileSize=${file_size}B (${file_size} bytes)  duration=${duration}s"

  if [[ "$pipeline" == "livekit" ]]; then ok "pipeline=livekit"; else fail "pipeline=$pipeline (expected 'livekit')"; fi
  if [[ "$merge_status" == "ready" ]]; then ok "mergeStatus=ready"; else fail "mergeStatus=$merge_status"; fi

  if (( file_size > 1048576 )); then
    ok "fileSize > 1 MB ($(awk -v b="$file_size" 'BEGIN{printf "%.1f MB", b/1024/1024}'))"
  else
    fail "fileSize too small: $file_size bytes"
  fi

  if (( duration >= 60 )); then ok "duration ≥ 60s ($duration s)"; else warn "short duration: $duration s"; fi

  # Strip the python-repr quotes to get a usable URL
  URL_CLEAN="$(echo "$url" | sed "s/^'//;s/'$//")"
  if [[ -z "$URL_CLEAN" ]]; then
    fail "no video URL on recording document"
  else
    info "url: ${URL_CLEAN:0:100}..."

    # Audio mean_volume check via ffmpeg volumedetect
    AUDIO_OUT="$(ffmpeg -i "$URL_CLEAN" -af volumedetect -f null - 2>&1 | grep -E 'mean_volume|max_volume' | head -2 || true)"
    if [[ -z "$AUDIO_OUT" ]]; then
      fail "ffmpeg volumedetect produced no output"
    else
      info "$AUDIO_OUT"
      MEAN_DB="$(echo "$AUDIO_OUT" | grep mean_volume | grep -oE -- '-?[0-9]+\.[0-9]+ dB' | head -1 | awk '{print $1}')"
      if [[ -n "$MEAN_DB" ]] && python3 -c "import sys; sys.exit(0 if float('$MEAN_DB') > -50 else 1)"; then
        ok "mean_volume=$MEAN_DB dB > -50 (real audio)"
      else
        fail "mean_volume=$MEAN_DB dB ≤ -50 (silent recording)"
      fi
    fi

    # Video frame variance check (sample 5 frames at 10/30/60/120/200s)
    echo "  Video frame YAVG samples:"
    declare -a YAVGS=()
    for t in 5 30 60 120 200; do
      Y=$(ffmpeg -ss "$t" -i "$URL_CLEAN" -vframes 1 -filter:v "signalstats,metadata=mode=print" -f null - 2>&1 \
            | grep -oE 'YAVG=[0-9.]+' | head -1 | sed 's/YAVG=//')
      echo "    t=${t}s YAVG=${Y:-?}"
      [[ -n "$Y" ]] && YAVGS+=("$Y")
    done
    # Compute YAVG range
    if (( ${#YAVGS[@]} >= 3 )); then
      RANGE="$(python3 -c "vals=[${YAVGS[*]// /,}]; vals=[float(v) for v in vals]; print(max(vals)-min(vals))")"
      if python3 -c "import sys; sys.exit(0 if float('$RANGE') > 20 else 1)"; then
        ok "YAVG range = $RANGE > 20 (video has motion)"
      else
        fail "YAVG range = $RANGE ≤ 20 (video appears frozen/static)"
      fi
    else
      fail "could not extract enough YAVG samples"
    fi
  fi
fi

# ─── Summary ───────────────────────────────────────────────────────
echo
echo "═══════════════════════════════════════════════════════════"
echo " RESULT — passed: $PASS · failed: $FAIL · warnings: $WARN"
echo "═══════════════════════════════════════════════════════════"

if (( FAIL > 0 )); then
  exit 1
fi
exit 0
