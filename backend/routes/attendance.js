const router = require("express").Router();
const ctrl = require("../controllers/attendanceController");
const { auth, adminOnly, studentOnly } = require("../middleware/auth");

router.post("/generate-qr/:classId", auth, adminOnly, ctrl.generateQr);
router.post("/verify", auth, ctrl.verify);
router.get("/my", auth, studentOnly, ctrl.getMyAttendance);
router.get("/:classId", auth, ctrl.getByClass);

module.exports = router;
