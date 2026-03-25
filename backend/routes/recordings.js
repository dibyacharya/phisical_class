const router = require("express").Router();
const ctrl = require("../controllers/recordingController");
const { auth, adminOnly } = require("../middleware/auth");

router.get("/", auth, ctrl.getAll);
router.get("/:id", auth, ctrl.getOne);
router.put("/:id/toggle-publish", auth, adminOnly, ctrl.togglePublish);
router.delete("/:id", auth, adminOnly, ctrl.remove);

module.exports = router;
