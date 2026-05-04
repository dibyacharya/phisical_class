const router = require("express").Router();
const { auth, adminOnly } = require("../../middleware/auth");
const { windowsDeviceAuth } = require("../../middleware/windowsDeviceAuth");

const deviceCtrl = require("../../controllers/windows/deviceController");
const recordingCtrl = require("../../controllers/windows/recordingController");
const licenseCtrl = require("../../controllers/windows/licenseController");

// ── Device endpoints ──────────────────────────────────────
// Public
router.post("/devices/register", deviceCtrl.register);

// Device-authenticated (called by Windows app)
router.post("/devices/:deviceId/heartbeat", windowsDeviceAuth, deviceCtrl.heartbeat);

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

// Public (called by Windows installer to validate before activation)
router.get("/licenses/:key/validate", licenseCtrl.validate);

module.exports = router;
