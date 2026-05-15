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

    // 2026-05-15 audit: WindowsDevice.authToken is marked `select: false` in
    // schema (keeps it out of admin-portal list responses). The WHERE clause
    // here STILL works against it — `select: false` only suppresses the field
    // in returned documents, not query filtering. So `device.authToken` will
    // be undefined on the returned object, which is exactly what we want:
    // downstream req.device is safe to log or serialize without leaking the
    // credential.
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
