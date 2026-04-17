const router = require("express").Router();
const AppVersion = require("../models/AppVersion");
const { auth, adminOnly } = require("../middleware/auth");
const { deviceAuth } = require("../middleware/deviceAuth");

// POST /api/app/upload — Admin uploads new APK
router.post("/upload", auth, adminOnly, async (req, res) => {
  try {
    if (!req.files || !req.files.apk) {
      return res.status(400).json({ error: "APK file is required" });
    }

    const { versionCode, versionName, releaseNotes } = req.body;
    if (!versionCode || !versionName) {
      return res.status(400).json({ error: "versionCode and versionName are required" });
    }

    const code = parseInt(versionCode);
    const apkFile = req.files.apk;

    // Check if this version already exists
    const existing = await AppVersion.findOne({ versionCode: code });
    if (existing) {
      return res.status(409).json({ error: `Version code ${code} already exists` });
    }

    // Deactivate all previous versions
    await AppVersion.updateMany({}, { isActive: false });

    // Save new version with APK binary in MongoDB
    const version = await AppVersion.create({
      versionCode: code,
      versionName,
      releaseNotes: releaseNotes || "",
      apkData: apkFile.data,
      apkSize: apkFile.size,
      uploadedBy: req.user._id,
      isActive: true,
    });

    console.log(`[AppUpdate] New version uploaded: v${versionName} (code ${code}) — ${(apkFile.size / 1024 / 1024).toFixed(1)} MB`);

    res.status(201).json({
      message: "APK uploaded successfully",
      version: {
        versionCode: version.versionCode,
        versionName: version.versionName,
        apkSize: version.apkSize,
        releaseNotes: version.releaseNotes,
        createdAt: version.createdAt,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/app/latest — Check latest version (no APK binary)
router.get("/latest", async (_req, res) => {
  try {
    const latest = await AppVersion.findOne({ isActive: true })
      .select("-apkData")
      .sort({ versionCode: -1 });

    if (!latest) {
      return res.json({ available: false });
    }

    res.json({
      available: true,
      versionCode: latest.versionCode,
      versionName: latest.versionName,
      apkSize: latest.apkSize,
      releaseNotes: latest.releaseNotes,
      updatedAt: latest.updatedAt,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/app/download — Download APK binary (device auth)
router.get("/download", deviceAuth, async (req, res) => {
  try {
    const latest = await AppVersion.findOne({ isActive: true })
      .select("apkData versionName versionCode apkSize")
      .sort({ versionCode: -1 });

    if (!latest || !latest.apkData) {
      return res.status(404).json({ error: "No APK available" });
    }

    res.set({
      "Content-Type": "application/vnd.android.package-archive",
      "Content-Disposition": `attachment; filename="LectureLens-v${latest.versionName}.apk"`,
      "Content-Length": latest.apkSize,
    });
    res.send(latest.apkData);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/app/versions — List all versions (admin)
router.get("/versions", auth, adminOnly, async (_req, res) => {
  try {
    const versions = await AppVersion.find()
      .select("-apkData")
      .sort({ versionCode: -1 });
    res.json(versions);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/app/versions/:id — Delete a version (admin)
router.delete("/versions/:id", auth, adminOnly, async (req, res) => {
  try {
    await AppVersion.findByIdAndDelete(req.params.id);
    res.json({ message: "Version deleted" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
