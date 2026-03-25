const router = require("express").Router();
const { login, me, seed } = require("../controllers/authController");
const { auth } = require("../middleware/auth");

router.post("/login", login);
router.get("/me", auth, me);
router.post("/seed", seed);

module.exports = router;
