const router = require("express").Router();
const { auth, adminOnly } = require("../middleware/auth");
const analytics = require("../controllers/analyticsController");

// All analytics endpoints require admin auth
router.use(auth, adminOnly);

router.get("/fleet-overview", analytics.fleetOverview);
router.get("/trends", analytics.fleetTrends);
router.get("/device/:deviceId/history", analytics.deviceHistory);
router.get("/alerts", analytics.activeAlerts);
router.get("/peak-hours", analytics.peakHours);
router.get("/device-ranking", analytics.deviceRanking);
router.get("/daily-summary", analytics.dailySummary);

module.exports = router;
