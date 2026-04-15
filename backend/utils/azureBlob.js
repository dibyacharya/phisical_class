/**
 * Azure Blob Storage helper for video uploads
 *
 * Env vars needed:
 *   AZURE_STORAGE_CONNECTION_STRING — full connection string from Azure Portal
 *   AZURE_STORAGE_CONTAINER        — container name (default: lecturelens-recordings)
 */

const { BlobServiceClient } = require("@azure/storage-blob");

const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
const containerName = process.env.AZURE_STORAGE_CONTAINER || "lms-storage";
const blobPrefix = process.env.AZURE_BLOB_PREFIX || "physical-class-recordings";

let containerClient = null;

function getContainerClient() {
  if (!connectionString) {
    console.warn("[AzureBlob] No AZURE_STORAGE_CONNECTION_STRING set — falling back to local storage");
    return null;
  }
  if (!containerClient) {
    const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
    containerClient = blobServiceClient.getContainerClient(containerName);
  }
  return containerClient;
}

/**
 * Upload a file buffer to Azure Blob Storage
 * @param {Buffer} fileBuffer - file content
 * @param {string} blobName   - e.g. "rec123_1713150000.mp4"
 * @param {string} contentType - e.g. "video/mp4"
 * @returns {string|null} public URL or null if Azure not configured
 */
async function uploadToBlob(fileBuffer, blobName, contentType = "video/mp4") {
  const client = getContainerClient();
  if (!client) return null;

  try {
    const fullBlobPath = blobPrefix ? `${blobPrefix}/${blobName}` : blobName;
    const blockBlobClient = client.getBlockBlobClient(fullBlobPath);
    await blockBlobClient.uploadData(fileBuffer, {
      blobHTTPHeaders: { blobContentType: contentType },
    });
    console.log(`[AzureBlob] Uploaded: ${fullBlobPath} (${(fileBuffer.length / 1024 / 1024).toFixed(1)} MB)`);
    return blockBlobClient.url;
  } catch (err) {
    console.error("[AzureBlob] Upload failed:", err.message);
    return null;
  }
}

/**
 * Upload a file from local path to Azure Blob Storage
 * @param {string} filePath - local file path
 * @param {string} blobName - e.g. "rec123_1713150000.mp4"
 * @returns {string|null} public URL or null
 */
async function uploadFileToBlob(filePath, blobName) {
  const client = getContainerClient();
  if (!client) return null;

  try {
    const fullBlobPath = blobPrefix ? `${blobPrefix}/${blobName}` : blobName;
    const blockBlobClient = client.getBlockBlobClient(fullBlobPath);
    await blockBlobClient.uploadFile(filePath, {
      blobHTTPHeaders: { blobContentType: "video/mp4" },
    });
    const fs = require("fs");
    const stats = fs.statSync(filePath);
    console.log(`[AzureBlob] Uploaded file: ${fullBlobPath} (${(stats.size / 1024 / 1024).toFixed(1)} MB)`);
    return blockBlobClient.url;
  } catch (err) {
    console.error("[AzureBlob] File upload failed:", err.message);
    return null;
  }
}

/**
 * Delete a blob
 * @param {string} blobName
 */
async function deleteBlob(blobName) {
  const client = getContainerClient();
  if (!client) return;
  try {
    const fullBlobPath = blobPrefix ? `${blobPrefix}/${blobName}` : blobName;
    await client.getBlockBlobClient(fullBlobPath).deleteIfExists();
    console.log(`[AzureBlob] Deleted: ${fullBlobPath}`);
  } catch (err) {
    console.error("[AzureBlob] Delete failed:", err.message);
  }
}

/**
 * Check if Azure Blob is configured
 */
function isAzureConfigured() {
  return !!connectionString;
}

module.exports = {
  uploadToBlob,
  uploadFileToBlob,
  deleteBlob,
  isAzureConfigured,
};
