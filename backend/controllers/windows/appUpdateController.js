const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const WindowsAppVersion = require("../../models/windows/WindowsAppVersion");

const INSTALLER_DIR = "/tmp/lecturelens-windows-installers";

/**
 * POST /api/windows/app/upload (admin)
 * Body (multipart): exe file + versionCode + versionName + releaseNotes
 *
 * Stores installer on the Railway ephemeral filesystem to avoid GridFS quota
 * issues. Computes SHA-256 for client-side integrity verification.
 *
 * Caveat: Railway redeploys wipe /tmp. Long-term, migrate to Azure Blob.
 */
exports.upload = async (req, res) => {
  try {
    if (!req.files || !req.files.exe) {
      return res.status(400).json({ error: "exe file is required" });
    }
    const { versionCode, versionName, releaseNotes } = req.body;
    if (!versionCode || !versionName) {
      return res.status(400).json({ error: "versionCode and versionName are required" });
    }
    const code = parseInt(versionCode, 10);
    if (isNaN(code) || code < 1) {
      return res.status(400).json({ error: "versionCode must be a positive integer" });
    }

    const existing = await WindowsAppVersion.findOne({ versionCode: code });
    if (existing) {
      return res.status(409).json({ error: `Version code ${code} already exists` });
    }

    fs.mkdirSync(INSTALLER_DIR, { recursive: true });
    const filename = `LectureLens-Setup-v${versionName}-${code}.exe`;
    const fsPath = path.join(INSTALLER_DIR, filename);

    const exeFile = req.files.exe;
    let bytes;
    if (exeFile.tempFilePath) {
      bytes = fs.readFileSync(exeFile.tempFilePath);
    } else {
      bytes = exeFile.data;
    }
    fs.writeFileSync(fsPath, bytes);

    const sha = crypto.createHash("sha256").update(bytes).digest("hex");

    // Deactivate all previous versions
    await WindowsAppVersion.updateMany({}, { isActive: false });

    const av = await WindowsAppVersion.create({
      versionCode: code,
      versionName,
      releaseNotes: releaseNotes || "",
      fsPath,
      exeSize: bytes.length,
      sha256: sha,
      isActive: true,
      uploadedBy: req.user?._id,
    });

    res.status(201).json({
      message: "Windows installer uploaded successfully",
      version: {
        versionCode: code,
        versionName,
        exeSize: bytes.length,
        sha256: sha,
        fsPath,
        createdAt: av.createdAt,
      },
      caveat: "Railway redeploys wipe /tmp. For long-term retention, migrate to Azure Blob.",
    });
  } catch (err) {
    console.error("[WinApp/upload] Error:", err);
    res.status(500).json({ error: err.message });
  }
};

/**
 * GET /api/windows/app/versions (admin)
 */
exports.list = async (_req, res) => {
  try {
    const versions = await WindowsAppVersion.find({})
      .populate("uploadedBy", "name email")
      .sort({ versionCode: -1 });
    res.json(versions);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/**
 * GET /api/windows/app/download
 * Public — devices download active installer here. Streams the .exe.
 */
exports.download = async (req, res) => {
  try {
    const active = await WindowsAppVersion.findOne({ isActive: true });
    if (!active) return res.status(404).json({ error: "No active Windows installer" });

    if (!fs.existsSync(active.fsPath)) {
      return res.status(503).json({
        error: "Active installer file missing on server (likely Railway redeploy wiped /tmp). Re-upload required.",
      });
    }

    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="LectureLens-Setup-v${active.versionName}.exe"`
    );
    res.setHeader("Content-Length", active.exeSize);
    res.setHeader("X-SHA256", active.sha256 || "");

    fs.createReadStream(active.fsPath).pipe(res);
  } catch (err) {
    console.error("[WinApp/download] Error:", err);
    res.status(500).json({ error: err.message });
  }
};

/**
 * POST /api/windows/app/versions/:id/activate (admin)
 */
exports.activate = async (req, res) => {
  try {
    await WindowsAppVersion.updateMany({}, { isActive: false });
    const av = await WindowsAppVersion.findByIdAndUpdate(
      req.params.id,
      { isActive: true },
      { new: true }
    );
    if (!av) return res.status(404).json({ error: "Version not found" });
    res.json({ message: "Activated", version: av });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
