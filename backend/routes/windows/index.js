const router = require("express").Router();
const { auth, adminOnly } = require("../../middleware/auth");
const { windowsDeviceAuth } = require("../../middleware/windowsDeviceAuth");

const deviceCtrl = require("../../controllers/windows/deviceController");
const recordingCtrl = require("../../controllers/windows/recordingController");
const licenseCtrl = require("../../controllers/windows/licenseController");
const appUpdateCtrl = require("../../controllers/windows/appUpdateController");
const diagnosticsCtrl = require("../../controllers/windows/diagnosticsController");
const liveWatchCtrl = require("../../controllers/windows/liveWatchController");

// ── Device endpoints ──────────────────────────────────────
// Public
router.post("/devices/register", deviceCtrl.register);

// Device-authenticated (called by Windows app)
router.post("/devices/:deviceId/heartbeat", windowsDeviceAuth, deviceCtrl.heartbeat);
router.get("/devices/blob-config", windowsDeviceAuth, deviceCtrl.blobConfig);

// Admin-authenticated
router.get("/devices", auth, adminOnly, deviceCtrl.list);
router.get("/devices/:id", auth, adminOnly, deviceCtrl.get);
router.delete("/devices/:id", auth, adminOnly, deviceCtrl.deregister);

// ── Commands ──────────────────────────────────────────────
router.post("/devices/:id/command", auth, adminOnly, deviceCtrl.issueCommand);
router.get("/devices/:id/commands", auth, adminOnly, deviceCtrl.listCommands);

// ── Recordings ────────────────────────────────────────────
// Admin
router.get("/recordings", auth, adminOnly, recordingCtrl.list);
router.get("/recordings/:id", auth, adminOnly, recordingCtrl.get);
router.post("/recordings/:id/admin-set-merged", auth, adminOnly, recordingCtrl.setMerged);

// Device
router.post("/recordings", windowsDeviceAuth, recordingCtrl.create);
router.post("/recordings/:id/chunk", windowsDeviceAuth, recordingCtrl.recordChunk);
router.post("/recordings/:id/finalize", windowsDeviceAuth, recordingCtrl.finalize);

// ── Licenses ──────────────────────────────────────────────
// Admin
router.post("/licenses", auth, adminOnly, licenseCtrl.issue);
router.get("/licenses", auth, adminOnly, licenseCtrl.list);
router.get("/licenses/:key", auth, adminOnly, licenseCtrl.get);
router.post("/licenses/:key/revoke", auth, adminOnly, licenseCtrl.revoke);
router.patch("/licenses/:key/extend", auth, adminOnly, licenseCtrl.extend);
router.delete("/licenses/:key", auth, adminOnly, licenseCtrl.remove);

// Public (called by Windows installer to validate before activation)
router.get("/licenses/:key/validate", licenseCtrl.validate);

// ── Windows App OTA / installer management ───────────────────
router.post("/app/upload", auth, adminOnly, appUpdateCtrl.upload);
router.get("/app/versions", auth, adminOnly, appUpdateCtrl.list);
router.post("/app/versions/:id/activate", auth, adminOnly, appUpdateCtrl.activate);
router.get("/app/download", appUpdateCtrl.download); // public — used by self-updater

// ── Diagnostics (v2.1.0) ──────────────────────────────────────
// Device uploads (logs zip, screenshot jpeg) — windowsDeviceAuth gates
// who can write under which deviceId.
router.post("/diagnostics/:kind", windowsDeviceAuth, diagnosticsCtrl.uploadArtifact);
// Admin: list recent diagnostics for a device + fetch one by id.
router.get("/diagnostics/device/:deviceId", auth, adminOnly, diagnosticsCtrl.listForDevice);
router.get("/diagnostics/file/:id", auth, adminOnly, diagnosticsCtrl.fetchById);

// ── Live Watch (LiveKit RTMP Ingress, v2.1.0) ────────────────
// Device creates/tears down its own ingress.
router.post("/live-watch/ingress", windowsDeviceAuth, liveWatchCtrl.createIngress);
router.delete("/live-watch/ingress/:ingressId", windowsDeviceAuth, liveWatchCtrl.deleteIngress);
// Admin: watch a live session via subscriber JWT, list active sessions.
router.get("/live-watch/viewer-token", auth, adminOnly, liveWatchCtrl.viewerToken);
router.get("/live-watch/active", auth, adminOnly, liveWatchCtrl.listActive);

module.exports = router;
