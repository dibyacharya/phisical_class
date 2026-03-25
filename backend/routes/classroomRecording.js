const router = require("express").Router();
const ctrl = require("../controllers/classroomRecordingController");
const { auth, adminOnly } = require("../middleware/auth");
const { deviceAuth } = require("../middleware/deviceAuth");

// Device registration — no auth needed (first-time setup)
router.post("/devices/register", ctrl.registerDevice);

// Device heartbeat — device auth via x-device-id / x-device-token
router.post("/devices/:deviceId/heartbeat", deviceAuth, ctrl.heartbeat);

// Device management — admin auth
router.get("/devices", auth, adminOnly, ctrl.getDevices);
router.delete("/devices/:id", auth, adminOnly, ctrl.deleteDevice);
router.post("/devices/:deviceId/force-start", auth, adminOnly, ctrl.forceStart);
router.post("/devices/:deviceId/force-stop", auth, adminOnly, ctrl.forceStop);

// Recording session — device auth
router.post("/recordings/session", deviceAuth, ctrl.findOrCreateSession);
router.post("/recordings/:recordingId/segment-upload", deviceAuth, ctrl.segmentUpload);
router.post("/recordings/:recordingId/active-source", deviceAuth, ctrl.updateActiveSource);
router.post("/recordings/:recordingId/merge", deviceAuth, ctrl.triggerMerge);

// Dashboard — admin auth
router.get("/dashboard", auth, adminOnly, ctrl.dashboard);

module.exports = router;
