const router = require("express").Router();
const ctrl = require("../controllers/roomController");
const { auth, adminOnly } = require("../middleware/auth");

router.get("/hierarchy", auth, adminOnly, ctrl.getHierarchy);
router.get("/", auth, adminOnly, ctrl.getRooms);
router.post("/", auth, adminOnly, ctrl.createRoom);
router.put("/:id", auth, adminOnly, ctrl.updateRoom);
router.delete("/:id", auth, adminOnly, ctrl.deleteRoom);
router.get("/:id/detail", auth, adminOnly, ctrl.getRoomDetail);
router.get("/:id/utilization", auth, adminOnly, ctrl.getUtilization);
router.get("/:id/schedule", auth, adminOnly, ctrl.getSchedule);
router.get("/:id/recordings", auth, adminOnly, ctrl.getRoomRecordings);

module.exports = router;
