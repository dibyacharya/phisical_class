const router = require("express").Router();
const { auth, adminOnly } = require("../middleware/auth");
const { deviceAuth } = require("../middleware/deviceAuth");
const remote = require("../controllers/remoteController");

// ── Admin endpoints (JWT auth) ──────────────────────────────────────
router.post("/command", auth, adminOnly, remote.sendCommand);
router.get("/commands/:deviceId", auth, adminOnly, remote.getCommands);
router.get("/thumbnails/:deviceId", auth, adminOnly, remote.getThumbnails);
router.get("/thumbnails/:deviceId/latest", auth, adminOnly, remote.getLatestThumbnail);
router.get("/logs/:deviceId", auth, adminOnly, remote.getLogs);

// ── Device endpoints (device auth) ─────────────────────────────────
router.get("/device/:deviceId/pending-commands", deviceAuth, remote.getPendingCommands);
router.post("/device/:deviceId/command-result", deviceAuth, remote.reportCommandResult);
router.post("/device/:deviceId/thumbnail", deviceAuth, remote.uploadThumbnail);
router.post("/device/:deviceId/logs", deviceAuth, remote.uploadLogs);

module.exports = router;
