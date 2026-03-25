const router = require("express").Router();
const { listUsers, createUser, deleteUser, listTeachers } = require("../controllers/userController");
const { auth, adminOnly } = require("../middleware/auth");

router.get("/", auth, adminOnly, listUsers);
router.post("/", auth, adminOnly, createUser);
router.delete("/:id", auth, adminOnly, deleteUser);
router.get("/teachers", auth, listTeachers);

module.exports = router;
