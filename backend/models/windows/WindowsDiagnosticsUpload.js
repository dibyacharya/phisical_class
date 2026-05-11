const mongoose = require("mongoose");

/**
 * Diagnostics upload registry (v2.1.0).
 *
 * When admin issues `pull_logs` or `capture_screenshot` to a Windows
 * device, the device's DiagnosticsService bundles + POSTs the payload to
 * /api/windows/diagnostics/:kind. The backend streams it into Azure Blob
 * under the `diagnostics/<deviceId>/<yyyy-mm>/<filename>` prefix and
 * registers it as a row here so the admin portal can list and serve
 * historical artifacts.
 *
 * Retention is enforced by a TTL index on `expiresAt` (default 7 days).
 * Mongo auto-prunes the row, and a small cleanup cron in production
 * deletes the matching blob — keeping diagnostics storage bounded.
 */
const windowsDiagnosticsUploadSchema = new mongoose.Schema(
  {
    deviceId: { type: String, required: true, index: true },
    kind: {
      type: String,
      enum: ["logs", "screenshot"],
      required: true,
      index: true,
    },

    // Filename device chose (e.g., "logs-20260508T034512.zip").
    filename: { type: String, required: true },
    // MIME type ("application/zip" or "image/jpeg").
    contentType: { type: String, required: true },
    sizeBytes: { type: Number, default: 0 },

    // Where the binary actually lives.
    azureBlobUrl: { type: String, required: true },
    // Container-relative path (without host), in case we re-sign URLs.
    azureBlobPath: { type: String, required: true },

    // Diagnostic context — agent version + the timestamp the device
    // captured it (which may pre-date receipt by minutes if a retry
    // queue is in play).
    agentVersion: String,
    capturedAt: Date,

    // Soft-delete + TTL. Mongoose's TTL index on this field auto-removes
    // the document when the date passes; backend's nightly job sweeps
    // the matching blob.
    expiresAt: {
      type: Date,
      default: () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      index: { expires: 0 },
    },
  },
  {
    timestamps: true,
    collection: "windows_diagnostics_uploads",
  }
);

windowsDiagnosticsUploadSchema.index({ deviceId: 1, createdAt: -1 });

module.exports = mongoose.model(
  "WindowsDiagnosticsUpload",
  windowsDiagnosticsUploadSchema
);
