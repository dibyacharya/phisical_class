const router = require("express").Router();
const {
  listUsers,
  createUser,
  deleteUser,
  listTeachers,
  getUser,
  resetUserPassword,
} = require("../controllers/userController");
const { auth, adminOnly } = require("../middleware/auth");

router.get("/", auth, adminOnly, listUsers);
router.post("/", auth, adminOnly, createUser);
router.get("/teachers", auth, listTeachers);
// v3.6.0 — single-user detail + admin password reset (no currentPassword
// check; admin overrides). Routes ordered so /teachers matches before
// the /:id catchall.
router.get("/:id", auth, adminOnly, getUser);
router.patch("/:id/password", auth, adminOnly, resetUserPassword);
router.delete("/:id", auth, adminOnly, deleteUser);

module.exports = router;
