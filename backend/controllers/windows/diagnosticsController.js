/**
 * Diagnostics endpoints — receive logs/screenshots uploaded by Windows
 * devices when admin issues a `pull_logs` or `capture_screenshot`
 * command, list them for the admin portal, and stream the actual blob
 * back when the operator clicks one.
 *
 * Auth model:
 *   POST /diagnostics/:kind     — windowsDeviceAuth (device uploads its
 *                                  own artifacts; deviceId in headers
 *                                  must match a registered device)
 *   GET  /diagnostics/:deviceId — admin auth (list recent uploads for
 *                                  a device)
 *   GET  /diagnostics/file/:id  — admin auth (serve a single upload)
 *
 * Storage: Azure Blob, container `lecturelens-diagnostics` (env-overridable),
 * prefix `<deviceId>/<yyyy-mm>/<filename>`. Mongo row carries the
 * azureBlobUrl + a 7-day TTL so old artifacts are auto-pruned.
 */
const path = require("path");
const crypto = require("crypto");
const { BlobServiceClient } = require("@azure/storage-blob");

const WindowsDiagnosticsUpload = require("../../models/windows/WindowsDiagnosticsUpload");
const WindowsDevice = require("../../models/windows/WindowsDevice");

const ALLOWED_KINDS = new Set(["logs", "screenshot"]);
const MAX_BYTES = 50 * 1024 * 1024; // 50 MB hard cap; logs bundle should be < 5 MB anyway

function getBlobContainer() {
  const conn =
    process.env.DIAGNOSTICS_AZURE_CONNECTION_STRING ||
    process.env.AZURE_STORAGE_CONNECTION_STRING ||
    "";
  if (!conn) {
    throw new Error(
      "Azure connection string missing (DIAGNOSTICS_AZURE_CONNECTION_STRING or AZURE_STORAGE_CONNECTION_STRING)"
    );
  }
  const containerName =
    process.env.DIAGNOSTICS_AZURE_CONTAINER ||
    "lecturelens-diagnostics";
  const svc = BlobServiceClient.fromConnectionString(conn);
  return { svc, container: svc.getContainerClient(containerName), containerName };
}

/**
 * POST /api/windows/diagnostics/logs       (windowsDeviceAuth)
 * POST /api/windows/diagnostics/screenshot (windowsDeviceAuth)
 */
exports.uploadArtifact = async (req, res) => {
  const kind = (req.params.kind || "").toLowerCase();
  if (!ALLOWED_KINDS.has(kind)) {
    return res.status(400).json({ error: `Unknown kind ${kind}` });
  }
  try {
    if (!req.files || !req.files.file) {
      return res.status(400).json({ error: "multipart 'file' is required" });
    }
    const file = req.files.file;
    const deviceId = (req.body.deviceId || req.headers["x-device-id"] || "").trim();
    if (!deviceId) {
      return res.status(400).json({ error: "deviceId is required" });
    }
    // windowsDeviceAuth already attached the WindowsDevice doc; just sanity-
    // check the deviceId matches what we proved with the token.
    if (req.device && req.device.deviceId && req.device.deviceId !== deviceId) {
      return res
        .status(403)
        .json({ error: "deviceId mismatch with auth token" });
    }

    const bytes = file.data ? file.data : file.tempFilePath ? require("fs").readFileSync(file.tempFilePath) : null;
    if (!bytes) {
      return res.status(400).json({ error: "could not read uploaded file" });
    }
    if (bytes.length === 0) {
      return res.status(400).json({ error: "empty upload" });
    }
    if (bytes.length > MAX_BYTES) {
      return res.status(413).json({ error: `payload exceeds ${MAX_BYTES} bytes` });
    }

    const filename = path.basename(String(file.name || `${kind}.bin`));
    const contentType =
      file.mimetype ||
      (kind === "logs" ? "application/zip" : "image/jpeg");

    // Compose blob path: <deviceId>/<yyyy-mm>/<random>-<filename>
    const yyyymm = new Date().toISOString().slice(0, 7); // 2026-05
    const rand = crypto.randomBytes(4).toString("hex");
    const blobPath = `${deviceId}/${yyyymm}/${rand}-${filename}`;

    let blobUrl = "";
    try {
      const { container } = getBlobContainer();
      // Create container lazily, idempotent.
      await container.createIfNotExists();
      const blockBlob = container.getBlockBlobClient(blobPath);
      await blockBlob.uploadData(bytes, {
        blobHTTPHeaders: { blobContentType: contentType },
      });
      blobUrl = blockBlob.url;
    } catch (azureErr) {
      console.error("[diagnostics] Azure upload failed:", azureErr.message);
      return res
        .status(502)
        .json({ error: "Azure upload failed", detail: azureErr.message });
    }

    const doc = await WindowsDiagnosticsUpload.create({
      deviceId,
      kind,
      filename,
      contentType,
      sizeBytes: bytes.length,
      azureBlobUrl: blobUrl,
      azureBlobPath: blobPath,
      agentVersion: req.body.agentVersion || "",
      capturedAt: req.body.capturedAt ? new Date(req.body.capturedAt) : new Date(),
    });

    return res.status(201).json({
      message: "uploaded",
      id: doc._id,
      url: blobUrl,
      sizeBytes: bytes.length,
      expiresAt: doc.expiresAt,
    });
  } catch (err) {
    console.error("[diagnostics] uploadArtifact error:", err);
    return res.status(500).json({ error: "internal error", detail: err.message });
  }
};

/**
 * GET /api/windows/diagnostics/:deviceId (admin)
 * Returns the latest 50 diagnostics artifacts for a device.
 */
exports.listForDevice = async (req, res) => {
  try {
    const { deviceId } = req.params;
    if (!deviceId) return res.status(400).json({ error: "deviceId required" });

    // Confirm device exists so admin can't accidentally list arbitrary IDs.
    const dev = await WindowsDevice.findOne({ deviceId }).lean();
    if (!dev) return res.status(404).json({ error: "device not found" });

    const rows = await WindowsDiagnosticsUpload.find({ deviceId })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    return res.json({
      deviceId,
      count: rows.length,
      uploads: rows.map((r) => ({
        id: r._id,
        kind: r.kind,
        filename: r.filename,
        contentType: r.contentType,
        sizeBytes: r.sizeBytes,
        url: r.azureBlobUrl,
        agentVersion: r.agentVersion,
        capturedAt: r.capturedAt,
        createdAt: r.createdAt,
        expiresAt: r.expiresAt,
      })),
    });
  } catch (err) {
    console.error("[diagnostics] listForDevice error:", err);
    return res.status(500).json({ error: "internal error", detail: err.message });
  }
};

/**
 * GET /api/windows/diagnostics/file/:id (admin)
 * Streams the artifact back. Useful when the blob URL itself isn't
 * publicly accessible — backend brokers access using admin JWT auth.
 */
exports.fetchById = async (req, res) => {
  try {
    const { id } = req.params;
    const row = await WindowsDiagnosticsUpload.findById(id).lean();
    if (!row) return res.status(404).json({ error: "not found" });

    const { container } = getBlobContainer();
    const blockBlob = container.getBlockBlobClient(row.azureBlobPath);
    const dl = await blockBlob.download();
    res.set("Content-Type", row.contentType);
    res.set(
      "Content-Disposition",
      `attachment; filename="${row.filename}"`
    );
    if (row.sizeBytes) res.set("Content-Length", String(row.sizeBytes));
    dl.readableStreamBody.pipe(res);
  } catch (err) {
    console.error("[diagnostics] fetchById error:", err);
    return res.status(500).json({ error: "internal error", detail: err.message });
  }
};
