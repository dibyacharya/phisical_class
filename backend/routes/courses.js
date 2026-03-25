const router = require("express").Router();
const ctrl = require("../controllers/courseController");
const { auth } = require("../middleware/auth");

router.get("/my", auth, ctrl.myCourses);
router.get("/:id/recordings", auth, ctrl.courseRecordings);
router.get("/:id/classes", auth, ctrl.courseClasses);
router.get("/:id/attendance", auth, ctrl.courseAttendance);

module.exports = router;
