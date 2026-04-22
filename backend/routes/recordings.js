const router = require("express").Router();
const ctrl = require("../controllers/recordingController");
const { auth, adminOnly } = require("../middleware/auth");

router.get("/", auth, ctrl.getAll);
router.post("/cleanup-stale", auth, adminOnly, ctrl.cleanupStale);
router.get("/:id", auth, ctrl.getOne);
router.put("/:id/toggle-publish", auth, adminOnly, ctrl.togglePublish);
router.post("/:id/force-stop", auth, adminOnly, ctrl.forceStop);
// v2.6.0: admin-initiated merge retry for recordings whose initial merge
// failed (ffmpeg missing, file missing, etc). Idempotent — returns the
// cached merged URL if merge is already `ready`.
router.post("/:id/merge", auth, adminOnly, ctrl.retryMerge);
router.delete("/:id", auth, adminOnly, ctrl.remove);

module.exports = router;
