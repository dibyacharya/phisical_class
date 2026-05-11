/**
 * LiveKit webhook handler — translates LiveKit Egress lifecycle events into
 * Recording document mutations.
 *
 * Adapted from Univanta_LMS_BACKEND/services/exam/livekitRecordingWebhook.js,
 * which targets a separate `CloudRecording` collection. For physical-class
 * recordings we don't need a second collection — the Recording model already
 * has the lifecycle slot (status, mergeStatus, mergedVideoUrl) and the
 * livekit* fields added in v3.2 (see models/Recording.js). The webhook
 * handler updates those fields in place.
 *
 * Events we handle (LiveKit sends these via signed POST):
 *
 *   egress_started — Egress process has begun recording. We mirror this on
 *     Recording.livekitEgressStatus="recording" and set startedAt.
 *
 *   egress_updated — periodic progress event. No-op today; we may use it
 *     in future to surface "still recording" health on the admin dashboard.
 *
 *   egress_ended — Egress process has finalised the file (or failed). We
 *     finalise the Recording row: set mergedVideoUrl, mergedFileSize,
 *     mergeStatus="ready" (or "failed"), and stop the legacy ffmpeg merge
 *     path from running for this row (it's already done by Egress).
 *
 * LiveKit signs each request with the API secret. The receiving controller
 * verifies the JWT before invoking processEgressEvent.
 */

const { WebhookReceiver } = require("livekit-server-sdk");
const Recording = require("../models/Recording");
const ScheduledClass = require("../models/ScheduledClass");
const { fastStartOptimizeBlobInBackground } = require("./fastStartOptimizer");

// ────────────────────────────────────────────────────────────────
// Idempotency cache for inbound webhooks.
//
// LiveKit retries any non-2xx webhook up to 5 times with exponential
// backoff. If our handler takes too long the same event can also arrive
// twice independently (load balancer retries, network blip after we
// already committed). Without dedup, two concurrent egress_ended events
// race each other in `recording.save()` and the last-writer-wins,
// occasionally corrupting status (especially when one is a success and
// one is a delayed failure retry).
//
// Strategy: cache <event>:<egressId>:<status> for 60s. Second hit is a
// no-op return. 60s comfortably covers LiveKit's retry window and is
// short enough that legitimate re-publishes after a server restart
// (rare) still go through.
// ────────────────────────────────────────────────────────────────
const _seen = new Map(); // key -> expiresAtEpochMs
const SEEN_TTL_MS = 60_000;
const _seenKey = (event, egressId, status) =>
  `${event}::${egressId || ""}::${status || ""}`;

function _markSeen(key) {
  const now = Date.now();
  _seen.set(key, now + SEEN_TTL_MS);
  // Lazy GC: when map gets bigger than 1k entries, sweep expired.
  if (_seen.size > 1000) {
    for (const [k, expires] of _seen.entries()) {
      if (expires <= now) _seen.delete(k);
    }
  }
}

function _alreadySeen(key) {
  const expiresAt = _seen.get(key);
  if (!expiresAt) return false;
  if (expiresAt <= Date.now()) {
    _seen.delete(key);
    return false;
  }
  return true;
}

// Helper — Egress's webhook payload reports `fileResult.location` as a
// URL but on this Azure deployment the URL is built without the container
// segment (account_name.blob.core.windows.net/{filepath} instead of
// account_name.blob.core.windows.net/{container}/{filepath}). The actual
// blob is correctly written to {container}/{filepath} though, so we
// reconstruct the public URL from filepath + the env-known container.
function buildAzureBlobUrl(filepath) {
  const account = (() => {
    const cs = process.env.AZURE_STORAGE_CONNECTION_STRING || "";
    const m = cs.match(/AccountName=([^;]+)/i);
    return m ? m[1] : process.env.AZURE_ACCOUNT_NAME || "";
  })();
  const container =
    process.env.LIVEKIT_EGRESS_CONTAINER ||
    process.env.AZURE_STORAGE_CONTAINER ||
    process.env.AZURE_CONTAINER ||
    "lms-storage";
  if (!account || !filepath) return "";
  return `https://${account}.blob.core.windows.net/${container}/${String(filepath).replace(/^\/+/, "")}`;
}

const ALLOWED_EVENTS = new Set([
  "egress_started",
  "egress_updated",
  "egress_ended",
]);

const getReceiver = () => {
  const apiKey = process.env.LIVEKIT_API_KEY || "";
  const apiSecret = process.env.LIVEKIT_API_SECRET || "";
  return new WebhookReceiver(apiKey, apiSecret);
};

/**
 * Verify and parse a LiveKit webhook request body.
 *
 * @param {string|Buffer} rawBody
 * @param {string} authHeader value of the `Authorization` header
 * @returns {Promise<Object>} the parsed event payload
 * @throws on signature verification failure
 */
const verifyAndParse = async (rawBody, authHeader) => {
  const receiver = getReceiver();
  const body = typeof rawBody === "string" ? rawBody : rawBody.toString("utf8");
  return receiver.receive(body, authHeader, /* skipAuth */ false);
};

/**
 * Apply a single egress event to the Recording document associated with
 * the egress's room.
 *
 * Two correlation strategies are tried in order:
 *   1. egressId — if Recording.livekitEgressId already matches (set when
 *      the recording session was created), this is the unambiguous path.
 *   2. roomName — fallback when, for whatever reason, we never persisted
 *      the egressId (e.g. Egress reconnect). The recording id is encoded
 *      in the room name (`phyclass-<recordingId>`) so we can recover it.
 *
 * @param {Object} payload — the verified webhook event from LiveKit
 * @returns {Promise<{ recordingId: string, status: string } | null>}
 */
const processEgressEvent = async (payload) => {
  if (!payload || !ALLOWED_EVENTS.has(payload.event)) {
    return null;
  }

  const event = payload.event;
  const egressInfo = payload.egressInfo || {};
  const egressId = egressInfo.egressId || payload.egressId || "";
  const roomName = egressInfo.roomName || payload.roomName || "";

  // Dedup check — see _seen cache above. We key on (event, egressId,
  // rawStatus) so two retried egress_ended events with the same status
  // are coalesced, but a follow-up egress_updated still goes through.
  const _dedupKey = _seenKey(event, egressId, String(egressInfo.status ?? ""));
  if (_alreadySeen(_dedupKey)) {
    console.log(
      `[LiveKit webhook] dedup hit ${event} egress=${egressId} status=${egressInfo.status} — skipping`
    );
    return { recordingId: null, status: "deduped" };
  }
  _markSeen(_dedupKey);
  // LiveKit's webhook serialiser sends EgressStatus as either the enum
  // name string ("EGRESS_COMPLETE") or the protobuf enum integer (3).
  // Map both forms to a normalised lowercase string so isComplete /
  // isFailure checks work regardless of SDK version. Discovered on
  // spike #5 where status=3 (success) was getting flagged as failure
  // and the success path's blob URL never made it to the Recording row.
  //
  // Enum values from livekit_egress_pb: STARTING=0, ACTIVE=1, ENDING=2,
  //   COMPLETE=3, FAILED=4, ABORTED=5.
  const STATUS_MAP = {
    0: "egress_starting",
    1: "egress_active",
    2: "egress_ending",
    3: "egress_complete",
    4: "egress_failed",
    5: "egress_aborted",
  };
  const rawStatus = egressInfo.status;
  let status;
  if (typeof rawStatus === "number") {
    status = STATUS_MAP[rawStatus] || `unknown-${rawStatus}`;
  } else if (typeof rawStatus === "string") {
    status = rawStatus.toLowerCase();
  } else {
    status = "";
  }
  // fileResults can be camelCase (JS SDK) or snake_case (proto JSON).
  const fileResults =
    egressInfo.fileResults || egressInfo.file_results || [];
  const fileResult = (Array.isArray(fileResults) && fileResults[0]) || {};
  const errorReason = egressInfo.error || "";

  // 1. Find by egressId (preferred)
  let recording = null;
  if (egressId) {
    recording = await Recording.findOne({ livekitEgressId: egressId });
  }

  // 2. Fallback: parse recordingId out of the room name
  if (!recording && roomName.startsWith("phyclass-")) {
    const recordingId = roomName.slice("phyclass-".length);
    recording = await Recording.findById(recordingId).catch(() => null);
  }

  if (!recording) {
    console.warn(
      `[LiveKit webhook] no Recording for event=${event} egressId=${egressId} room=${roomName}`
    );
    return null;
  }

  const now = new Date();

  if (event === "egress_started") {
    // Atomic: only the first concurrent egress_started ever writes the
    // startedAt timestamp. Subsequent webhooks (retries) match the
    // pre-set state and become no-ops at the DB layer. This prevents
    // the startedAt timestamp from drifting on retry storms.
    const updated = await Recording.findOneAndUpdate(
      {
        _id: recording._id,
        // Idempotency guard: only first hit transitions out of any state
        // that is NOT already "recording" (e.g., null, "pending", "starting").
        livekitEgressStatus: { $ne: "recording" },
      },
      {
        $set: {
          livekitEgressId: egressId || recording.livekitEgressId,
          livekitEgressStatus: "recording",
          pipeline: "livekit",
        },
        $setOnInsert: {}, // no-op, but kept for clarity
        $min: {
          // First webhook wins on the earliest timestamp — if a faster
          // retry beats us with a slightly later `now`, $min still
          // preserves the earliest-known start time.
          livekitEgressStartedAt: now,
        },
      },
      { new: true }
    );
    if (!updated) {
      console.log(
        `[LiveKit webhook] egress_started no-op (already recording) rec=${recording._id} egress=${egressId}`
      );
    }
    return { recordingId: recording._id.toString(), status: "recording" };
  }

  if (event === "egress_updated") {
    // Reserved — could update a "last egress heartbeat" field for ops.
    return { recordingId: recording._id.toString(), status: "updated" };
  }

  if (event === "egress_ended") {
    // Treat both the explicit enum-name and integer-3 forms as success.
    // EGRESS_FAILED (4) and EGRESS_ABORTED (5) plus any populated error
    // string mark the row as failed.
    const isComplete = status === "egress_complete";
    const isFailed = !isComplete || !!errorReason;

    // Build the set of fields to write atomically below. We accumulate
    // into a plain object so we can do exactly one findOneAndUpdate
    // call at the end — replacing the old read-modify-save pattern
    // that raced when LiveKit retried egress_ended.
    const setFields = {
      livekitEgressEndedAt: now,
      pipeline: "livekit",
    };
    if (!recording.recordingEnd) {
      setFields.recordingEnd = now;
    }

    if (isFailed) {
      const errMsg = String(errorReason || status || "unknown").slice(0, 500);
      setFields.livekitEgressStatus = "failed";
      setFields.livekitEgressErrorReason = errMsg;
      setFields.status = "failed";
      setFields.mergeStatus = "failed";
      setFields.mergeError = `LiveKit Egress: ${errMsg}`;
    } else {
      setFields.livekitEgressStatus = "available";
      setFields.status = "completed";
      setFields.mergeStatus = "ready";
      // Egress wrote directly to Azure — these fields are the playback
      // source of truth. Both videoUrl and mergedVideoUrl are set so the
      // admin portal (which prefers mergedVideoUrl) and any legacy
      // consumer (which reads videoUrl) both work.
      //
      // Egress's reported `location` is missing the container segment on
      // this Azure deployment (verified iter3 + iter4: stored URL gave
      // 404 because container "lms-storage" wasn't in the URL path; the
      // actual MP4 lives at the URL with /lms-storage/ inserted). Try
      // three sources in order to get a playable URL:
      //   (a) fileResult.filename → build URL from it
      //   (b) extract path from fileResult.location and insert container
      //   (c) raw values as-is (last resort, may still be broken)
      const container =
        process.env.LIVEKIT_EGRESS_CONTAINER ||
        process.env.AZURE_STORAGE_CONTAINER ||
        process.env.AZURE_CONTAINER ||
        "lms-storage";
      let fileLocation = "";
      const filepath = fileResult.filename || "";
      if (filepath) {
        fileLocation = buildAzureBlobUrl(filepath);
      }
      if (!fileLocation && fileResult.location) {
        // Parse https://host/path → split, insert container if missing
        const m = String(fileResult.location).match(/^(https?:\/\/[^/]+)\/(.*)$/);
        if (m) {
          const host = m[1];
          const path = m[2];
          if (path.startsWith(container + "/")) {
            fileLocation = `${host}/${path}`;
          } else {
            fileLocation = `${host}/${container}/${path}`;
          }
        } else {
          fileLocation = fileResult.location;
        }
      }
      if (!fileLocation && filepath) fileLocation = filepath;
      if (fileLocation) {
        setFields.videoUrl = fileLocation;
        setFields.mergedVideoUrl = fileLocation;
      }
      if (fileResult.size) {
        const sz = Number(fileResult.size) || 0;
        if (sz > 0) {
          setFields.fileSize = sz;
          setFields.mergedFileSize = sz;
        }
      }
      // Egress reports duration in NANOSECONDS (protobuf int64). Earlier
      // we stored the raw value (40 124 286 059) which displayed as
      // ~40 124 286 059 seconds (= 1271 years). Convert to seconds.
      if (fileResult.duration) {
        const ns = Number(fileResult.duration) || 0;
        const secs = Math.max(0, Math.round(ns / 1_000_000_000));
        if (secs > 0) setFields.duration = secs;
      }
      setFields.mergedAt = now;
    }

    // Single atomic write. Precondition: only finalize if not already
    // finalized. This prevents two concurrent egress_ended retries from
    // both writing the terminal state; the second one matches zero
    // documents and is a no-op (we still return success to LiveKit so
    // it stops retrying).
    const finalizeResult = await Recording.findOneAndUpdate(
      {
        _id: recording._id,
        // Atomic guard: only first hit transitions out of "recording".
        // "available" and "failed" are both terminal so this filter
        // also ignores follow-up retries.
        livekitEgressStatus: { $nin: ["available", "failed"] },
      },
      { $set: setFields },
      { new: true }
    );
    if (!finalizeResult) {
      console.log(
        `[LiveKit webhook] egress_ended no-op (already finalized) rec=${recording._id} egress=${egressId}`
      );
      // Skip downstream side-effects too — they already ran for the
      // first webhook in this race.
      return {
        recordingId: recording._id.toString(),
        status: "already-finalized",
      };
    }
    // Use the freshly-updated doc for downstream side-effects below.
    recording = finalizeResult;

    // v3.3.20 — Faststart optimization.
    //
    // LiveKit Egress writes MP4 with the moov atom at the END of the file.
    // Result: HTML5 video can't seek (forward/scrub doesn't work), and
    // audio is silent in many players when streaming because the AAC
    // decoder can't find its codec init data without loading the entire
    // file first.
    //
    // Fire-and-forget a background re-mux that downloads the blob, runs
    // `ffmpeg -c copy -movflags +faststart` (stream copy, no re-encode),
    // and uploads back over the same blob. Idempotent. Does NOT block the
    // webhook response — LiveKit gets its 200 immediately, and the file
    // becomes seekable + audible within ~30s (5-min recording) to ~2 min
    // (1-hour recording). The blob URL doesn't change, so the admin portal
    // doesn't need to refresh — playback just starts working better.
    //
    // The original (broken) file stays accessible during the re-mux
    // window, so a user who downloads in that brief gap sees the old
    // behavior. Acceptable — the 1-2 min gap is much shorter than typical
    // post-class admin behavior (review the recording the next morning).
    // The success branch above declares `filepath` inside an else block,
    // so we can't read that local. Re-pull it from the same source the
    // success branch used (fileResult.filename), which is defined at the
    // outer scope of the egress_ended handler.
    const optimizeFilepath = fileResult.filename || "";
    if (!isFailed && optimizeFilepath) {
      try {
        fastStartOptimizeBlobInBackground(
          optimizeFilepath,
          `rec=${recording._id} egress=${egressId}`,
        );
      } catch (e) {
        // never let this failure block webhook response
        console.error(
          `[fastStart] kick-off failed rec=${recording._id}:`,
          e.message,
        );
      }
    }

    // Mark the linked ScheduledClass terminal — heartbeat reconcile would
    // eventually do this, but it's cleaner to flip it as soon as we know
    // the recording is final.
    if (recording.scheduledClass) {
      try {
        await ScheduledClass.findByIdAndUpdate(recording.scheduledClass, {
          status: isFailed ? "completed" : "completed",
        });
      } catch (e) {
        // non-fatal
      }
    }

    return {
      recordingId: recording._id.toString(),
      status: recording.livekitEgressStatus,
    };
  }

  return null;
};

module.exports = {
  ALLOWED_EVENTS,
  verifyAndParse,
  processEgressEvent,
};
