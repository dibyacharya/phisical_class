const mongoose = require("mongoose");

const appVersionSchema = new mongoose.Schema(
  {
    versionCode: { type: Number, required: true },
    versionName: { type: String, required: true },
    releaseNotes: { type: String, default: "" },
    apkData: { type: Buffer },                     // Inline binary (for APKs < 14MB)
    apkGridFsId: { type: mongoose.Schema.Types.ObjectId },  // GridFS file ID (for APKs >= 14MB)
    // v3.7.0 — fallback storage path on Railway container's ephemeral
    // filesystem. Used when MongoDB Atlas free tier (512 MB cap) blocks
    // GridFS writes. Set by /api/app/upload-fs. Container restarts wipe
    // this — fine for pilot deploys, NOT for long-term fleet rollout.
    // The download endpoint prefers GridFS but falls through to fsPath.
    apkFsPath: { type: String, default: null },
    apkSize: { type: Number },                     // file size in bytes
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: "LCS_User" },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

// Prevent duplicate version codes at DB level (not just app-level check)
appVersionSchema.index({ versionCode: 1 }, { unique: true });

module.exports = mongoose.model("LCS_AppVersion", appVersionSchema);
