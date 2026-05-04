const WindowsLicense = require("../../models/windows/WindowsLicense");

/**
 * POST /api/windows/licenses (admin)
 * Body: { tier, customerName, customerEmail, customerOrg, expiresAt, notes, pricePerYearINR, pricePerYearUSD }
 */
exports.issue = async (req, res) => {
  try {
    const { tier, customerName, customerEmail, customerOrg, expiresAt, notes, pricePerYearINR, pricePerYearUSD } = req.body;
    if (!tier || !customerName || !expiresAt) {
      return res.status(400).json({ error: "tier, customerName, expiresAt are required" });
    }

    const licenseKey = WindowsLicense.generateKey();
    const features = WindowsLicense.featuresForTier(tier);

    const lic = await WindowsLicense.create({
      licenseKey,
      tier,
      customerName,
      customerEmail,
      customerOrg,
      expiresAt: new Date(expiresAt),
      features,
      status: "issued",
      notes,
      issuedBy: req.user?._id,
      pricePerYearINR,
      pricePerYearUSD,
    });

    res.status(201).json({
      message: "License issued",
      license: lic,
      shareThisKey: licenseKey,
    });
  } catch (err) {
    console.error("[WinLic/issue] Error:", err);
    res.status(500).json({ error: err.message });
  }
};

/**
 * GET /api/windows/licenses (admin)
 */
exports.list = async (req, res) => {
  try {
    const status = req.query.status;
    const filter = status ? { status } : {};
    const licenses = await WindowsLicense.find(filter)
      .populate("boundDevice", "deviceId name roomNumber")
      .populate("issuedBy", "name email")
      .sort({ createdAt: -1 });
    res.json(licenses);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/**
 * GET /api/windows/licenses/:key
 */
exports.get = async (req, res) => {
  try {
    const lic = await WindowsLicense.findOne({ licenseKey: req.params.key })
      .populate("boundDevice", "deviceId name roomNumber");
    if (!lic) return res.status(404).json({ error: "License not found" });
    res.json(lic);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/**
 * GET /api/windows/licenses/:key/validate
 * Public endpoint (called by Windows installer to verify key before activation)
 */
exports.validate = async (req, res) => {
  try {
    const lic = await WindowsLicense.findOne({ licenseKey: req.params.key });
    if (!lic) {
      return res.json({ valid: false, reason: "key_not_found" });
    }
    if (lic.status === "revoked") {
      return res.json({ valid: false, reason: "revoked" });
    }
    if (lic.expiresAt && lic.expiresAt < new Date()) {
      return res.json({ valid: false, reason: "expired" });
    }
    if (lic.boundDeviceId) {
      return res.json({
        valid: true,
        alreadyBound: true,
        boundDeviceId: lic.boundDeviceId,
        tier: lic.tier,
      });
    }
    res.json({ valid: true, tier: lic.tier, features: lic.features });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/**
 * POST /api/windows/licenses/:key/revoke (admin)
 */
exports.revoke = async (req, res) => {
  try {
    const lic = await WindowsLicense.findOneAndUpdate(
      { licenseKey: req.params.key },
      {
        status: "revoked",
        revokedAt: new Date(),
        revokedBy: req.user?._id,
        revokeReason: req.body.reason || "Admin revoke",
      },
      { new: true }
    );
    if (!lic) return res.status(404).json({ error: "License not found" });
    res.json({ message: "License revoked", license: lic });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/**
 * PATCH /api/windows/licenses/:key/extend (admin)
 * Body: { newExpiresAt }
 */
exports.extend = async (req, res) => {
  try {
    const { newExpiresAt } = req.body;
    if (!newExpiresAt) return res.status(400).json({ error: "newExpiresAt is required" });

    const lic = await WindowsLicense.findOneAndUpdate(
      { licenseKey: req.params.key },
      {
        expiresAt: new Date(newExpiresAt),
        status: "active",
      },
      { new: true }
    );
    if (!lic) return res.status(404).json({ error: "License not found" });
    res.json({ message: "License extended", license: lic });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
