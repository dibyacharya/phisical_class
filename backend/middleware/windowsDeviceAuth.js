const WindowsDevice = require("../models/windows/WindowsDevice");

/**
 * Middleware for Windows device endpoints. Validates X-Device-Id + X-Device-Token
 * headers against registered Windows devices. Sets req.device for downstream handlers.
 *
 * Separate from existing deviceAuth.js (Android) — completely isolated path.
 */
const windowsDeviceAuth = async (req, res, next) => {
  try {
    const deviceId = req.headers["x-device-id"];
    const deviceToken = req.headers["x-device-token"];

    if (!deviceId || !deviceToken) {
      return res.status(401).json({ error: "Missing X-Device-Id or X-Device-Token header" });
    }

    // Use .select("+authToken") if your schema marks authToken as select:false in future
    const device = await WindowsDevice.findOne({
      deviceId,
      authToken: deviceToken,
      isActive: true,
    });

    if (!device) {
      return res.status(401).json({ error: "Invalid Windows device credentials" });
    }

    req.device = device;
    next();
  } catch (err) {
    console.error("[WindowsDeviceAuth] Error:", err.message);
    res.status(500).json({ error: "Authentication error" });
  }
};

module.exports = { windowsDeviceAuth };
