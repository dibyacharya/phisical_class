/**
 * Faststart MP4 optimizer for LiveKit Egress output.
 *
 * THE PROBLEM. LiveKit Egress writes its MP4 with the moov atom at the
 * END of the file. This is the default for streaming muxers because the
 * moov contains the index and codec parameters which are only fully known
 * once the file is finished. The downside:
 *
 *   • HTML5 video players can't seek until the entire file is loaded —
 *     because the seek table lives in moov, and moov is at the end.
 *   • Audio playback fails in many players when streaming from a URL.
 *     The AAC decoder needs codec extradata from moov to initialize. If
 *     the player tries to start playback before downloading the whole
 *     file, audio comes out silent.
 *
 *   Symptom user reported (v3.3.20 5-min test): downloaded MP4 plays
 *   sequentially but seek/forward doesn't work and audio is silent.
 *
 * THE FIX. Re-mux the file with ffmpeg's `-c copy -movflags +faststart`.
 * Stream copy = no re-encoding (fast + lossless). The +faststart flag
 * tells ffmpeg to do a second pass that moves moov to the start of the
 * file. The result is a "progressive" MP4 that streams + seeks instantly.
 *
 * COST. Roughly 2x the file size in temporary disk + 2x the network
 * (download + upload). For a 1-hour ~1 GB recording this is ~2 GB tmp
 * disk and ~30-60s of bandwidth each way. Acceptable for our scale.
 *
 * DESIGN. Idempotent — a second run on an already-faststart file just
 * produces the same file. Safe to retry. Fires fire-and-forget from the
 * webhook handler so it doesn't block the LiveKit response.
 */

const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { BlobServiceClient } = require("@azure/storage-blob");

const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING || "";
// LiveKit Egress writes to LIVEKIT_EGRESS_CONTAINER (env), which on this
// deployment is the same `lms-storage` container that legacy uploads
// use. We don't reuse the legacy `AZURE_BLOB_PREFIX` because Egress
// writes the prefix into the filepath itself (e.g.
// "physical-class-recordings/.../full.mp4") — passing the prefix again
// would double it.
const containerName =
  process.env.LIVEKIT_EGRESS_CONTAINER ||
  process.env.AZURE_STORAGE_CONTAINER ||
  process.env.AZURE_CONTAINER ||
  "lms-storage";

let _containerClient = null;
function getContainerClient() {
  if (!connectionString) {
    return null;
  }
  if (!_containerClient) {
    _containerClient = BlobServiceClient.fromConnectionString(
      connectionString,
    ).getContainerClient(containerName);
  }
  return _containerClient;
}

/**
 * Download an Azure blob to a local file. Throws if Azure isn't configured
 * or the download fails.
 */
async function downloadBlobToFile(blobName, destPath) {
  const client = getContainerClient();
  if (!client) {
    throw new Error(
      "Azure not configured (AZURE_STORAGE_CONNECTION_STRING missing)",
    );
  }
  const blob = client.getBlockBlobClient(blobName);
  await blob.downloadToFile(destPath);
}

/**
 * Upload a local file to Azure, overwriting whatever's at blobName.
 * Sets contentType=video/mp4 so the browser plays it inline.
 */
async function uploadFileOverwriteBlob(localPath, blobName) {
  const client = getContainerClient();
  if (!client) {
    throw new Error(
      "Azure not configured (AZURE_STORAGE_CONNECTION_STRING missing)",
    );
  }
  const blob = client.getBlockBlobClient(blobName);
  await blob.uploadFile(localPath, {
    blobHTTPHeaders: { blobContentType: "video/mp4" },
  });
}

/**
 * Run `ffmpeg -i inPath -c copy -movflags +faststart outPath`. Resolves on
 * exit code 0, rejects with the last 500 chars of stderr otherwise.
 *
 * stream copy = no re-encode, just rewrite the container with the moov
 * atom at the start. Typical run time: a few seconds even for 1 GB+.
 */
function ffmpegFastStart(inPath, outPath) {
  return new Promise((resolve, reject) => {
    const args = [
      "-y",
      "-hide_banner",
      "-loglevel", "error",
      "-i", inPath,
      "-c", "copy",
      "-movflags", "+faststart",
      outPath,
    ];
    const proc = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > 4000) stderr = stderr.slice(-2000);
    });
    proc.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-500)}`));
      }
    });
    proc.on("error", reject);
  });
}

/**
 * Re-mux an Azure-hosted MP4 to faststart layout, overwriting the original
 * blob. See top-of-file docstring for why.
 *
 * @param {string} blobName — full blob key (no container prefix), e.g.
 *   "physical-class-recordings/2026-04-27/001/abc123/full.mp4"
 * @param {string} [tag] — short label included in log lines for tracing
 * @returns {Promise<{durationMs:number, oldSize:number, newSize:number}>}
 */
async function fastStartOptimizeBlob(blobName, tag = "") {
  if (!blobName) throw new Error("blobName is required");
  const t0 = Date.now();
  const tmpDir = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "lk-faststart-"),
  );
  const inPath = path.join(tmpDir, "in.mp4");
  const outPath = path.join(tmpDir, "out.mp4");
  try {
    console.log(`[fastStart ${tag}] download blob=${blobName}`);
    await downloadBlobToFile(blobName, inPath);
    const oldSize = fs.statSync(inPath).size;
    console.log(
      `[fastStart ${tag}] downloaded ${(oldSize / 1e6).toFixed(1)} MB, running ffmpeg`,
    );
    await ffmpegFastStart(inPath, outPath);
    const newSize = fs.statSync(outPath).size;
    console.log(
      `[fastStart ${tag}] re-muxed ${(newSize / 1e6).toFixed(1)} MB, uploading back`,
    );
    await uploadFileOverwriteBlob(outPath, blobName);
    const durationMs = Date.now() - t0;
    console.log(
      `[fastStart ${tag}] done in ${(durationMs / 1000).toFixed(1)}s (old=${oldSize} new=${newSize})`,
    );
    return { durationMs, oldSize, newSize };
  } finally {
    // Always wipe tmp to avoid leaking GBs on Railway disk
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_) {}
  }
}

/**
 * Convenience wrapper: kick off optimization in the background. Logs but
 * never throws — used by the webhook handler which must respond to
 * LiveKit fast.
 *
 * @param {string} blobName
 * @param {string} [tag]
 */
function fastStartOptimizeBlobInBackground(blobName, tag = "") {
  setImmediate(() => {
    fastStartOptimizeBlob(blobName, tag).catch((err) => {
      console.error(`[fastStart ${tag}] FAILED:`, err.message);
    });
  });
}

module.exports = {
  fastStartOptimizeBlob,
  fastStartOptimizeBlobInBackground,
};
