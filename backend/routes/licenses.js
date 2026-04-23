/**
 * licenses.js — License management routes
 *
 * Super Admin routes (only D&R AI Solutions):
 *   POST   /api/licenses              — generate new license key(s)
 *   DELETE /api/licenses/:id          — revoke a license
 *   POST   /api/licenses/:id/reset    — de-activate (unbind device, allow re-use)
 *
 * Admin routes (client admin — read-only):
 *   GET    /api/licenses              — list all licenses (view status only)
 *
 * Public (called by device during setup):
 *   POST   /api/licenses/validate     — check if key is valid + unused
 */

const router  = require("express").Router();
const License = require("../models/License");
const { auth, adminOnly, superAdminOnly } = require("../middleware/auth");

// ── Validate (public — called from device setup before registration) ──────────
router.post("/validate", async (req, res) => {
  try {
    const { key, macAddress } = req.body;
    if (!key) return res.status(400).json({ error: "License key is required" });

    const lic = await License.findOne({ key: key.trim().toUpperCase() });
    if (!lic || !lic.isActive) {
      return res.status(404).json({ error: "Invalid license key" });
    }
    if (lic.expiresAt && new Date() > lic.expiresAt) {
      return res.status(403).json({ error: "License key has expired" });
    }
    if (lic.isActivated) {
      // Allow same device to re-register (e.g. app reset)
      if (macAddress && lic.deviceMac && lic.deviceMac === macAddress) {
        return res.json({ valid: true, alreadyOwned: true, licenseId: lic._id, label: lic.label });
      }
      return res.status(409).json({
        error: "License key already activated on another device",
        activatedOn: lic.deviceModel || "another device",
        activatedAt: lic.activatedAt,
      });
    }

    res.json({ valid: true, alreadyOwned: false, licenseId: lic._id, label: lic.label });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Generate license(s) — SUPER ADMIN ONLY ──────────────────────────────────
router.post("/", auth, superAdminOnly, async (req, res) => {
  try {
    const { label = "", count = 1, expiresAt } = req.body;
    const qty   = Math.min(Math.max(parseInt(count) || 1, 1), 100); // max 100 at once
    const docs  = [];
    for (let i = 0; i < qty; i++) {
      docs.push({
        label:     qty === 1 ? label : `${label} #${i + 1}`,
        expiresAt: expiresAt || null,
        createdBy: req.user._id,
      });
    }
    const created = await License.insertMany(docs);
    res.status(201).json(created);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── List all licenses — Admin can view (read-only) ───────────────────────────
router.get("/", auth, adminOnly, async (req, res) => {
  try {
    const licenses = await License.find()
      .sort({ createdAt: -1 })
      .populate("createdBy", "name email");
    res.json(licenses);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Revoke or hard-delete — SUPER ADMIN ONLY ────────────────────────────────
// ?hard=true removes the row entirely (for DB resets / fresh trial setup).
// Default is a soft revoke that flips isActive=false but keeps the audit row.
router.delete("/:id", auth, superAdminOnly, async (req, res) => {
  try {
    const hard = req.query.hard === "true" || req.query.hard === "1";
    if (hard) {
      await License.findByIdAndDelete(req.params.id);
      res.json({ message: "License hard-deleted" });
    } else {
      await License.findByIdAndUpdate(req.params.id, { isActive: false });
      res.json({ message: "License revoked" });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Reset (de-activate — allow to be used again) — SUPER ADMIN ONLY ─────────
router.post("/:id/reset", auth, superAdminOnly, async (req, res) => {
  try {
    const lic = await License.findByIdAndUpdate(
      req.params.id,
      {
        isActivated: false,
        activatedAt: null,
        deviceMac:   "",
        deviceId:    "",
        deviceModel: "",
        roomNumber:  "",
        campus:      "",
        block:       "",
        isActive:    true,
      },
      { new: true }
    );
    if (!lic) return res.status(404).json({ error: "License not found" });
    res.json(lic);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
