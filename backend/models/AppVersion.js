const mongoose = require("mongoose");

const appVersionSchema = new mongoose.Schema(
  {
    versionCode: { type: Number, required: true },
    versionName: { type: String, required: true },
    releaseNotes: { type: String, default: "" },
    apkData: { type: Buffer },                     // Inline binary (for APKs < 14MB)
    apkGridFsId: { type: mongoose.Schema.Types.ObjectId },  // GridFS file ID (for APKs >= 14MB)
    apkSize: { type: Number },                     // file size in bytes
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: "LCS_User" },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

// Prevent duplicate version codes at DB level (not just app-level check)
appVersionSchema.index({ versionCode: 1 }, { unique: true });

module.exports = mongoose.model("LCS_AppVersion", appVersionSchema);
