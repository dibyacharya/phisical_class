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
  const status = egressInfo.status || ""; // EGRESS_COMPLETE | EGRESS_FAILED ...
  const fileResult = (egressInfo.fileResults && egressInfo.fileResults[0]) || {};
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
    const isFailed =
      !!errorReason || (status && status !== "EGRESS_COMPLETE");

    recording.livekitEgressEndedAt = now;
    recording.recordingEnd = recording.recordingEnd || now;
    recording.pipeline = "livekit";

    if (isFailed) {
      recording.livekitEgressStatus = "failed";
      recording.livekitEgressErrorReason = String(errorReason || status).slice(
        0,
        500
      );
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
      const fileLocation = fileResult.location || fileResult.filename || "";
      if (fileLocation) {
        recording.videoUrl = fileLocation;
        recording.mergedVideoUrl = fileLocation;
      }
      if (fileResult.size) {
        recording.fileSize = Number(fileResult.size) || recording.fileSize;
        recording.mergedFileSize =
          Number(fileResult.size) || recording.mergedFileSize;
      }
      if (fileResult.duration) {
        recording.duration =
          Math.max(0, Number(fileResult.duration)) || recording.duration;
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
