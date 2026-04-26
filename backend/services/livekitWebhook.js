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
    recording.livekitEgressId = egressId || recording.livekitEgressId;
    recording.livekitEgressStatus = "recording";
    recording.livekitEgressStartedAt =
      recording.livekitEgressStartedAt || now;
    recording.pipeline = "livekit";
    await recording.save();
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

    recording.livekitEgressEndedAt = now;
    recording.recordingEnd = recording.recordingEnd || now;
    recording.pipeline = "livekit";

    if (isFailed) {
      recording.livekitEgressStatus = "failed";
      recording.livekitEgressErrorReason = String(
        errorReason || status || "unknown"
      ).slice(0, 500);
      recording.status = "failed";
      recording.mergeStatus = "failed";
      recording.mergeError = `LiveKit Egress: ${recording.livekitEgressErrorReason}`;
    } else {
      recording.livekitEgressStatus = "available";
      recording.status = "completed";
      recording.mergeStatus = "ready";
      // Egress wrote directly to Azure — these fields are the playback
      // source of truth. Both videoUrl and mergedVideoUrl are set so the
      // admin portal (which prefers mergedVideoUrl) and any legacy
      // consumer (which reads videoUrl) both work.
      //
      // Egress's reported `location` is missing the container segment on
      // this Azure deployment (verified iter3: stored URL gave 404, but
      // the same path with /lms-storage/ inserted gave HTTP 200 +
      // valid MP4). Always rebuild from filepath + env to guarantee a
      // playable URL.
      const filepath = fileResult.filename || "";
      const rebuilt = buildAzureBlobUrl(filepath);
      const fileLocation = rebuilt || fileResult.location || filepath || "";
      if (fileLocation) {
        recording.videoUrl = fileLocation;
        recording.mergedVideoUrl = fileLocation;
      }
      if (fileResult.size) {
        const sz = Number(fileResult.size) || 0;
        if (sz > 0) {
          recording.fileSize = sz;
          recording.mergedFileSize = sz;
        }
      }
      // Egress reports duration in NANOSECONDS (protobuf int64). Earlier
      // we stored the raw value (40 124 286 059) which displayed as
      // ~40 124 286 059 seconds (= 1271 years). Convert to seconds.
      if (fileResult.duration) {
        const ns = Number(fileResult.duration) || 0;
        const secs = Math.max(0, Math.round(ns / 1_000_000_000));
        if (secs > 0) recording.duration = secs;
      }
      recording.mergedAt = now;
    }

    await recording.save();

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
