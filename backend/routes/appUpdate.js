const router = require("express").Router();
const mongoose = require("mongoose");
const { Readable } = require("stream");
const AppVersion = require("../models/AppVersion");
const { auth, adminOnly } = require("../middleware/auth");
const { deviceAuth } = require("../middleware/deviceAuth");

/**
 * Get GridFS bucket for APK storage.
 * GridFS splits files into 255KB chunks — no 16MB BSON limit.
 */
function getApkBucket() {
  return new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: "lcs_apks" });
}

// POST /api/app/upload — Admin uploads new APK (uses GridFS for files > 14MB)
router.post("/upload", auth, adminOnly, async (req, res) => {
  try {
    if (!req.files || !req.files.apk) {
      return res.status(400).json({ error: "APK file is required" });
    }

    const { versionCode, versionName, releaseNotes } = req.body;
    if (!versionCode || !versionName) {
      return res.status(400).json({ error: "versionCode and versionName are required" });
    }

    const code = parseInt(versionCode, 10);
    if (isNaN(code) || code < 1) {
      return res.status(400).json({ error: "versionCode must be a positive integer" });
    }
    const apkFile = req.files.apk;

    // Check if this version already exists
    const existing = await AppVersion.findOne({ versionCode: code });
    if (existing) {
      return res.status(409).json({ error: `Version code ${code} already exists` });
    }

    // Deactivate all previous versions
    await AppVersion.updateMany({}, { isActive: false });

    const USE_GRIDFS_THRESHOLD = 14 * 1024 * 1024; // 14MB — safe margin below 16MB BSON limit

    if (apkFile.size >= USE_GRIDFS_THRESHOLD) {
      // ── Large APK: Store via GridFS (chunked, no BSON limit) ──────
      const bucket = getApkBucket();
      const filename = `lecturelens-v${versionName}-${code}.apk`;
      const uploadStream = bucket.openUploadStream(filename, {
        contentType: "application/vnd.android.package-archive",
        metadata: { versionCode: code, versionName },
      });

      const readable = new Readable();
      readable.push(apkFile.data);
      readable.push(null);
      await new Promise((resolve, reject) => {
        readable.pipe(uploadStream)
          .on("finish", resolve)
          .on("error", reject);
      });

      const version = await AppVersion.create({
        versionCode: code,
        versionName,
        releaseNotes: releaseNotes || "",
        apkGridFsId: uploadStream.id,   // GridFS file ID
        apkSize: apkFile.size,
        uploadedBy: req.user._id,
        isActive: true,
      });

      console.log(`[AppUpdate] GridFS upload: v${versionName} (code ${code}) — ${(apkFile.size / 1024 / 1024).toFixed(1)} MB`);

      res.status(201).json({
        message: "APK uploaded successfully (GridFS)",
        version: {
          versionCode: version.versionCode,
          versionName: version.versionName,
          apkSize: version.apkSize,
          releaseNotes: version.releaseNotes,
          storage: "gridfs",
          createdAt: version.createdAt,
        },
      });
    } else {
      // ── Small APK: Store inline in MongoDB document ────────────────
      const version = await AppVersion.create({
        versionCode: code,
        versionName,
        releaseNotes: releaseNotes || "",
        apkData: apkFile.data,
        apkSize: apkFile.size,
        uploadedBy: req.user._id,
        isActive: true,
      });

      console.log(`[AppUpdate] Inline upload: v${versionName} (code ${code}) — ${(apkFile.size / 1024 / 1024).toFixed(1)} MB`);

      res.status(201).json({
        message: "APK uploaded successfully",
        version: {
          versionCode: version.versionCode,
          versionName: version.versionName,
          apkSize: version.apkSize,
          releaseNotes: version.releaseNotes,
          storage: "inline",
          createdAt: version.createdAt,
        },
      });
    }
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

// GET /api/app/download — Download APK binary (device auth). Supports both inline and GridFS storage.
router.get("/download", deviceAuth, async (req, res) => {
  try {
    const latest = await AppVersion.findOne({ isActive: true })
      .select("apkData apkGridFsId versionName versionCode apkSize")
      .sort({ versionCode: -1 });

    if (!latest) {
      return res.status(404).json({ error: "No APK available" });
    }

    res.set({
      "Content-Type": "application/vnd.android.package-archive",
      "Content-Disposition": `attachment; filename="LectureLens-v${latest.versionName}.apk"`,
      "Content-Length": latest.apkSize,
    });

    if (latest.apkGridFsId) {
      // ── Stream from GridFS ────────────────────────────────────────
      const bucket = getApkBucket();
      const downloadStream = bucket.openDownloadStream(latest.apkGridFsId);
      downloadStream.pipe(res);
      downloadStream.on("error", (err) => {
        console.error("[AppUpdate] GridFS download error:", err.message);
        if (!res.headersSent) {
          res.status(500).json({ error: "APK download failed" });
        } else {
          // Headers already sent — destroy response so client knows transfer failed
          res.destroy();
        }
      });
    } else if (latest.apkData) {
      // ── Inline binary ─────────────────────────────────────────────
      res.send(latest.apkData);
    } else {
      res.status(404).json({ error: "No APK data available" });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/app/download-admin — Admin-accessible APK download (JWT auth instead of device auth)
router.get("/download-admin", auth, adminOnly, async (req, res) => {
  try {
    const latest = await AppVersion.findOne({ isActive: true })
      .select("apkData apkGridFsId versionName versionCode apkSize")
      .sort({ versionCode: -1 });

    if (!latest) {
      return res.status(404).json({ error: "No APK available" });
    }

    res.set({
      "Content-Type": "application/vnd.android.package-archive",
      "Content-Disposition": `attachment; filename="LectureLens-v${latest.versionName}.apk"`,
      "Content-Length": latest.apkSize,
    });

    if (latest.apkGridFsId) {
      const bucket = getApkBucket();
      const downloadStream = bucket.openDownloadStream(latest.apkGridFsId);
      downloadStream.pipe(res);
      downloadStream.on("error", (err) => {
        console.error("[AppUpdate] Admin download GridFS error:", err.message);
        if (!res.headersSent) res.status(500).json({ error: "APK download failed" });
        else res.destroy();
      });
    } else if (latest.apkData) {
      res.send(latest.apkData);
    } else {
      res.status(404).json({ error: "No APK data available" });
    }
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
