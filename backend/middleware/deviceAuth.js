const ClassroomDevice = require("../models/ClassroomDevice");

const deviceAuth = async (req, res, next) => {
  try {
    const deviceId = req.headers["x-device-id"];
    const deviceToken = req.headers["x-device-token"];

    if (!deviceId || !deviceToken) {
      return res.status(401).json({ error: "Device credentials required" });
    }

    const device = await ClassroomDevice.findOne({
      deviceId,
      authToken: deviceToken,
      isActive: true,
    });

    if (!device) {
      return res.status(401).json({ error: "Invalid device credentials" });
    }

    req.device = device;
    next();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

module.exports = { deviceAuth };
