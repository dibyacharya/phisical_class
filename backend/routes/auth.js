const router = require("express").Router();
const { login, me, seed, changeMyPassword } = require("../controllers/authController");
const { auth } = require("../middleware/auth");

router.post("/login", login);
router.get("/me", auth, me);
// v3.6.0 — self-service password change for any authenticated user.
// Requires the current password (defence against session hijack).
router.patch("/me/password", auth, changeMyPassword);
router.post("/seed", seed);

module.exports = router;
