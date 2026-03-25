const router = require("express").Router();
const ctrl = require("../controllers/batchController");
const { auth, adminOnly } = require("../middleware/auth");

router.get("/", auth, ctrl.getAll);
router.post("/", auth, adminOnly, ctrl.create);
router.delete("/:id", auth, adminOnly, ctrl.remove);
router.get("/:id/courses", auth, ctrl.getCourses);
router.post("/:id/courses", auth, adminOnly, ctrl.addCourse);
router.put("/courses/:courseId", auth, adminOnly, ctrl.updateCourse);
router.delete("/courses/:courseId", auth, adminOnly, ctrl.removeCourse);

module.exports = router;
