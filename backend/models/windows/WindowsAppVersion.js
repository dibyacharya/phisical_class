const mongoose = require("mongoose");

/**
 * Windows app version registry — separate from existing AppVersion (Android).
 * Tracks uploaded .exe installers and their availability for OTA updates.
 *
 * Storage strategy: filesystem (/tmp/lecturelens-windows-installers/) — same
 * pattern as Android pilot-fs path, avoids GridFS quota issues with large
 * .exe files (200+ MB).
 */
const windowsAppVersionSchema = new mongoose.Schema(
  {
    versionCode: { type: Number, required: true, unique: true, index: true },
    versionName: { type: String, required: true },
    releaseNotes: String,

    fsPath: String,             // e.g., /tmp/lecturelens-windows-installers/v1.0.0.exe
    exeSize: Number,
    sha256: String,             // for integrity verification on download

    isActive: { type: Boolean, default: false, index: true },

    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: "LCS_User" },
    uploadedAt: { type: Date, default: Date.now },
  },
  {
    timestamps: true,
    collection: "windows_app_versions",
  }
);

module.exports = mongoose.model("WindowsAppVersion", windowsAppVersionSchema);
