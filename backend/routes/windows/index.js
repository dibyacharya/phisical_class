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
// v2.1.x legacy — Azure connection string
router.get("/devices/blob-config", windowsDeviceAuth, deviceCtrl.blobConfig);
// v2.2.0+ — Cloudflare R2 S3-compatible credentials
router.get("/devices/r2-config", windowsDeviceAuth, deviceCtrl.r2Config);

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
router.delete("/recordings/:id", auth, adminOnly, recordingCtrl.remove);
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
// Admin: probe the live Azure config (no secrets returned, only operation results).
// Used to verify v2.1.3 BlobUploader fix before pushing a full OTA: confirms
// upload works against the existing container WITHOUT CreateIfNotExists.
router.get("/diagnostics/azure-probe", auth, adminOnly, diagnosticsCtrl.azureProbe);
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
