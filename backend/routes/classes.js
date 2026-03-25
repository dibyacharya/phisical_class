const router = require("express").Router();
const ctrl = require("../controllers/classController");
const { auth, adminOnly } = require("../middleware/auth");

router.get("/dashboard", auth, adminOnly, ctrl.dashboard);
router.get("/", auth, ctrl.getAll);
router.get("/:id", auth, ctrl.getOne);
router.post("/", auth, adminOnly, ctrl.create);
router.put("/:id", auth, adminOnly, ctrl.update);
router.delete("/:id", auth, adminOnly, ctrl.remove);

module.exports = router;
