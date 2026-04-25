const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/classroomRecordingController");
const { auth, adminOnly } = require("../middleware/auth");
const { deviceAuth } = require("../middleware/deviceAuth");

// Device registration — no auth needed (first-time setup)
router.post("/devices/register", ctrl.registerDevice);

// Device heartbeat — device auth via x-device-id / x-device-token
router.post("/devices/:deviceId/heartbeat", deviceAuth, ctrl.heartbeat);

// Device health report — device auth
router.post("/devices/:deviceId/health-report", deviceAuth, ctrl.healthReport);

// Device management — admin auth
router.get("/devices", auth, adminOnly, ctrl.getDevices);
router.delete("/devices/:id", auth, adminOnly, ctrl.deleteDevice);
router.post("/devices/:deviceId/force-start", auth, adminOnly, ctrl.forceStart);
router.post("/devices/:deviceId/force-stop", auth, adminOnly, ctrl.forceStop);

// Recording session — device auth
router.post("/recordings/session", deviceAuth, ctrl.findOrCreateSession);
router.post("/recordings/:recordingId/segment-upload", deviceAuth, ctrl.segmentUpload);
// v3.1.24 — whole-recording audio m4a upload (see I-025 for why audio is decoupled)
router.post("/recordings/:recordingId/audio-upload", deviceAuth, ctrl.audioUpload);
router.post("/recordings/:recordingId/active-source", deviceAuth, ctrl.updateActiveSource);
router.post("/recordings/:recordingId/merge", deviceAuth, ctrl.triggerMerge);

// Dashboard — admin auth
router.get("/dashboard", auth, adminOnly, ctrl.dashboard);

// ── LiveKit endpoints (v3.2.0+) ─────────────────────────────────────
//
// Admin-watch token: lets an authenticated admin generate a subscriber
// (read-only) LiveKit token to watch a physical-class room live while
// it's recording. Token TTL is 2h; multiple concurrent admins are fine.
router.post(
  "/recordings/:recordingId/admin-watch-token",
  auth,
  adminOnly,
  ctrl.adminWatchToken
);

// LiveKit Egress webhook: receives JWT-signed POSTs from the LiveKit
// server (egress_started / egress_updated / egress_ended) and updates
// the corresponding Recording document.
//
// IMPORTANT: this route uses express.raw() because livekit-server-sdk's
// WebhookReceiver verifies the signature against the raw request body —
// any prior JSON-parse middleware would invalidate the JWT. The router-
// level express.raw call here overrides the global express.json() set
// up in index.js for this route only.
router.post(
  "/livekit-webhook",
  express.raw({ type: "application/webhook+json", limit: "1mb" }),
  // Some LiveKit deployments send `application/json` instead of the
  // custom MIME type — accept both by falling back to a generic raw
  // parser when the first didn't match.
  express.raw({ type: "application/json", limit: "1mb" }),
  ctrl.livekitWebhook
);

module.exports = router;
