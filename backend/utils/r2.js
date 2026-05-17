/**
 * Cloudflare R2 helper — S3-compatible client for listing + deleting objects.
 *
 * Used by the recording storage-audit / orphan-cleanup admin endpoints. R2
 * credentials come from the same env vars the rest of the backend already
 * reads (R2_ENDPOINT / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET).
 *
 * 2026-05-17 — added so an admin can prune R2 objects that no recording
 * document references any more (e.g. recordings deleted from the portal,
 * which intentionally leave the R2 file behind as a safety net).
 */
const {
  S3Client,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} = require("@aws-sdk/client-s3");

let _client = null;
function client() {
  if (_client) return _client;
  _client = new S3Client({
    region: "auto",
    endpoint: process.env.R2_ENDPOINT,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  });
  return _client;
}

function bucket() {
  return process.env.R2_BUCKET;
}

/**
 * List every object under a prefix (handles pagination). Returns
 * [{ key, size, lastModified }].
 */
async function listAllObjects(prefix) {
  const out = [];
  let token;
  do {
    const resp = await client().send(
      new ListObjectsV2Command({
        Bucket: bucket(),
        Prefix: prefix,
        ContinuationToken: token,
      })
    );
    for (const o of resp.Contents || []) {
      out.push({ key: o.Key, size: o.Size || 0, lastModified: o.LastModified });
    }
    token = resp.IsTruncated ? resp.NextContinuationToken : undefined;
  } while (token);
  return out;
}

/**
 * Delete a list of object keys. DeleteObjects caps at 1000 keys per call,
 * so we batch. Returns { deleted, errors:[{key,message}] }.
 */
async function deleteObjects(keys) {
  let deleted = 0;
  const errors = [];
  for (let i = 0; i < keys.length; i += 1000) {
    const batch = keys.slice(i, i + 1000);
    const resp = await client().send(
      new DeleteObjectsCommand({
        Bucket: bucket(),
        Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
      })
    );
    for (const e of resp.Errors || []) {
      errors.push({ key: e.Key, message: e.Message });
    }
    deleted += batch.length - (resp.Errors ? resp.Errors.length : 0);
  }
  return { deleted, errors };
}

module.exports = { listAllObjects, deleteObjects };
