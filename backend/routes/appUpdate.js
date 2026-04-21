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

    // ALWAYS use GridFS — inline Buffer storage has a persistent Mongoose/
    // MongoDB driver interop bug where apkData comes back as a Binary wrapper
    // whose backing buffer is lazy-allocated and reads empty on download (QA
    // caught this via tests I01/I02/O03 for v2.5.0). GridFS streams via
    // bucket.openDownloadStream() which has a clean, well-tested read path.
    // The 14 MB BSON-limit threshold was the old heuristic; we now use 0 so
    // every APK — regardless of size — goes through the reliable path.
    const USE_GRIDFS_THRESHOLD = 0;

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
    // See /download-admin comment — lean() + toNodeBuffer gives us a
    // deterministic path that works regardless of the Mongoose schema
    // Buffer hydration quirks we hit with larger inline APKs.
    // First try hydrated, then lean() as fallback — different shapes land
    // in each path depending on Mongoose + MongoDB driver versions. We try
    // both in one request rather than flipping code back and forth.
    let latest = await AppVersion.findOne({ isActive: true })
      .select("apkData apkGridFsId versionName versionCode apkSize")
      .sort({ versionCode: -1 });
    // If hydrated Mongoose doc returned but apkData is the wrapper shape
    // that toNodeBuffer() can't unwrap, refetch lean and re-try.
    const hydratedFailed = latest && latest.apkData && !toNodeBuffer(latest.apkData)?.length;
    if (hydratedFailed) {
      console.log(`[AppUpdate] hydrated shape=${describeBuffer(latest.apkData)} — retrying with .lean()`);
      latest = await AppVersion.findOne({ isActive: true })
        .select("apkData apkGridFsId versionName versionCode apkSize")
        .sort({ versionCode: -1 })
        .lean();
    }

    if (!latest) {
      return res.status(404).json({ error: "No APK available" });
    }

    if (latest.apkGridFsId) {
      // ── Stream from GridFS ────────────────────────────────────────
      // Defer header setup until the 'file' event fires — that's when
      // GridFS has located the file and can give us authoritative length.
      // Setting Content-Length before the file is confirmed is the
      // classic cause of HTTP/2 framing errors: header promises 7 MB,
      // pipe produces 0 bytes (if file missing from chunks), stream
      // emits RST → curl sees 200 headers + empty body. This pattern
      // is also how GridFS streams fail-safely.
      const bucket = getApkBucket();
      const downloadStream = bucket.openDownloadStream(latest.apkGridFsId);
      let fileFound = false;
      let bytesStreamed = 0;
      downloadStream.on("file", (file) => {
        fileFound = true;
        console.log(`[AppUpdate] GridFS (device) open: ${file.filename} len=${file.length}`);
        res.set({
          "Content-Type": "application/vnd.android.package-archive",
          "Content-Disposition": `attachment; filename="LectureLens-v${latest.versionName}.apk"`,
          "Content-Length": file.length,
        });
      });
      downloadStream.on("data", (chunk) => { bytesStreamed += chunk.length; });
      downloadStream.on("end", () => {
        console.log(`[AppUpdate] GridFS (device) done: streamed ${bytesStreamed} bytes`);
      });
      downloadStream.on("error", (err) => {
        console.error(`[AppUpdate] GridFS (device) error: ${err.message} fileFound=${fileFound} bytesStreamed=${bytesStreamed}`);
        if (!res.headersSent) {
          res.status(500).json({
            error: "GridFS download failed",
            codeRev: "v7-gridfs-file-event",
            detail: err.message,
            fileFound,
            gridfsId: String(latest.apkGridFsId),
          });
        } else {
          res.end();  // gracefully end if mid-stream
        }
      });
      downloadStream.pipe(res);
      return;  // don't fall through
    } else if (latest.apkData) {
      // ── Inline binary ─────────────────────────────────────────────
      // Normalise through toNodeBuffer() because Mongoose can expose
      // Buffer fields as { buffer, subType } wrappers that make res.send()
      // emit an empty body. Use res.end() to avoid any body-transform.
      const buf = toNodeBuffer(latest.apkData);
      if (!buf || buf.length === 0) {
        console.error(`[AppUpdate] apkData shape=${describeBuffer(latest.apkData)} → normalised buffer=${buf ? buf.length : "null"} bytes (declared=${latest.apkSize})`);
        return res.status(500).json({
          error: "APK binary not readable from database",
          diagnostic: describeBuffer(latest.apkData),
          declaredSize: latest.apkSize,
        });
      }
      console.log(`[AppUpdate] download: serving ${buf.length} bytes inline (declared=${latest.apkSize})`);
      res.end(buf);
    } else {
      res.status(404).json({ error: "No APK data available" });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Small helper — normalise Mongoose's buffer types to a Node Buffer we can
// hand to res.end(). When .select() returns an apkData field that was stored
// as a BSON Binary, Mongoose may expose it as `{ buffer: Buffer, subType: 0 }`
// instead of a plain Buffer. res.send() on that wrapper produces zero body
// output — which is exactly the silent-failure bug QA caught in test I01/I02/O03.
function toNodeBuffer(raw) {
  if (!raw) return null;
  if (Buffer.isBuffer(raw)) return raw;

  // MongoDB driver Binary type (BSON Binary — keys: sub_type, buffer, position).
  // Gotcha discovered via QA diagnostic (test I01/I02/O03): `Binary.buffer` is
  // a preallocated Node Buffer that may be LARGER than the stored payload.
  // Actual content length is tracked in `Binary.position` — the `Binary.length()`
  // method returns it. So we must slice by `position` (or call `.value(true)`
  // for the driver-blessed accessor) to get the real APK bytes. Grabbing
  // `.buffer` directly without slicing returns up-to-7 MB of correct bytes
  // PLUS padding, which some consumers tolerate and others don't; worse, in
  // certain code paths the backing buffer has length 0 with position tracking
  // data read from GridFS cursors. Being defensive handles both cases.
  if (raw._bsontype === "Binary") {
    try {
      if (typeof raw.value === "function") {
        const v = raw.value(true);  // `asBuffer=true` → returns Node Buffer
        if (Buffer.isBuffer(v) && v.length > 0) return v;
      }
    } catch (_) { /* fall through */ }
    if (raw.buffer) {
      const backing = Buffer.isBuffer(raw.buffer) ? raw.buffer : Buffer.from(raw.buffer);
      if (typeof raw.position === "number" && raw.position > 0 && raw.position <= backing.length) {
        return backing.subarray(0, raw.position);  // slice to actual payload
      }
      if (backing.length > 0) return backing;
    }
    return null;
  }

  // Mongoose-hydrated Buffer (wrapper with { buffer: Buffer, subType: 0 })
  if (raw.buffer && Buffer.isBuffer(raw.buffer)) return raw.buffer;

  // Uint8Array
  if (raw instanceof Uint8Array) return Buffer.from(raw);

  // Plain object with data array { type: "Buffer", data: [1,2,3...] }
  if (raw.type === "Buffer" && Array.isArray(raw.data)) return Buffer.from(raw.data);

  // ArrayBuffer view
  if (raw.byteLength !== undefined) {
    try { return Buffer.from(raw); } catch (_) {}
  }

  // Last resort
  try { return Buffer.from(raw); } catch (_) { return null; }
}

// Diagnostic helper — describes the shape of a potentially-buffer-like thing.
function describeBuffer(raw) {
  if (raw === null) return "null";
  if (raw === undefined) return "undefined";
  const t = typeof raw;
  if (t !== "object") return `primitive<${t}>`;
  const ctor = raw.constructor?.name || "?";
  const keys = Object.keys(raw).slice(0, 8);
  const bufLen = raw.buffer && Buffer.isBuffer(raw.buffer) ? raw.buffer.length : "?";
  const bufType = raw.buffer ? (Buffer.isBuffer(raw.buffer) ? "Buffer" : typeof raw.buffer) : "no";
  const pos = raw.position;
  const hasValue = typeof raw.value === "function";
  let valueLen = "?";
  try {
    if (hasValue) {
      const v = raw.value(true);
      valueLen = v ? (v.length ?? "no-length") : "null";
    }
  } catch (e) {
    valueLen = `threw:${e.message}`;
  }
  return `${ctor}(bsontype=${raw._bsontype}, keys=[${keys.join(",")}], buffer=${bufType}(${bufLen}), position=${pos}, value()=${valueLen})`;
}

// GET /api/app/download-admin — Admin-accessible APK download (JWT auth instead of device auth)
router.get("/download-admin", auth, adminOnly, async (req, res) => {
  try {
    // .lean() returns a plain JS object with raw MongoDB driver types —
    // apkData comes back as a `Binary` (mongodb.Binary) with .buffer holding
    // the actual bytes. Mongoose's hydrated Buffer path kept producing a
    // wrapper that res.send() couldn't serialise. lean() + explicit shape
    // normalisation is deterministic across Mongoose/MongoDB versions.
    // First try hydrated, then lean() as fallback — different shapes land
    // in each path depending on Mongoose + MongoDB driver versions. We try
    // both in one request rather than flipping code back and forth.
    let latest = await AppVersion.findOne({ isActive: true })
      .select("apkData apkGridFsId versionName versionCode apkSize")
      .sort({ versionCode: -1 });
    // If hydrated Mongoose doc returned but apkData is the wrapper shape
    // that toNodeBuffer() can't unwrap, refetch lean and re-try.
    const hydratedFailed = latest && latest.apkData && !toNodeBuffer(latest.apkData)?.length;
    if (hydratedFailed) {
      console.log(`[AppUpdate] hydrated shape=${describeBuffer(latest.apkData)} — retrying with .lean()`);
      latest = await AppVersion.findOne({ isActive: true })
        .select("apkData apkGridFsId versionName versionCode apkSize")
        .sort({ versionCode: -1 })
        .lean();
    }

    if (!latest) {
      return res.status(404).json({ error: "No APK available" });
    }

    console.log(`[AppUpdate] download-admin v${latest.versionName} (code ${latest.versionCode}), storage=${latest.apkGridFsId ? "gridfs" : "inline"}, declared size=${latest.apkSize}, apkData shape=${describeBuffer(latest.apkData)}`);

    if (latest.apkGridFsId) {
      // Use 'file' event — fires ONCE the GridFS file is located and we
      // have an authoritative length. Setting headers before this risks
      // Content-Length mismatch if the file is missing from chunks, which
      // manifests as HTTP/2 200 + 0-byte body (Railway edge then returns
      // opaque 502 "I/O error" on the 2nd request).
      const bucket = getApkBucket();
      const downloadStream = bucket.openDownloadStream(latest.apkGridFsId);
      let fileFound = false;
      let bytesStreamed = 0;
      downloadStream.on("file", (file) => {
        fileFound = true;
        console.log(`[AppUpdate] GridFS (admin) open: ${file.filename} len=${file.length} id=${latest.apkGridFsId}`);
        res.set({
          "Content-Type": "application/vnd.android.package-archive",
          "Content-Disposition": `attachment; filename="LectureLens-v${latest.versionName}.apk"`,
          "Content-Length": file.length,
        });
      });
      downloadStream.on("data", (chunk) => { bytesStreamed += chunk.length; });
      downloadStream.on("end", () => {
        console.log(`[AppUpdate] GridFS (admin) done: streamed ${bytesStreamed} bytes`);
      });
      downloadStream.on("error", (err) => {
        console.error(`[AppUpdate] GridFS (admin) error: ${err.message} fileFound=${fileFound} bytesStreamed=${bytesStreamed}`);
        if (!res.headersSent) {
          res.status(500).json({
            error: "GridFS download failed",
            codeRev: "v7-gridfs-file-event",
            detail: err.message,
            fileFound,
            gridfsId: String(latest.apkGridFsId),
          });
        } else {
          res.end();
        }
      });
      downloadStream.pipe(res);
      return;
    } else if (latest.apkData) {
      const buf = toNodeBuffer(latest.apkData);
      if (!buf || buf.length === 0) {
        console.error(`[AppUpdate] (admin v4-binpos) apkData shape=${describeBuffer(latest.apkData)} → normalised=${buf ? buf.length : "null"} bytes`);
        return res.status(500).json({
          error: "APK binary not readable from database",
          codeRev: "v5-dual-fetch-enhanced-diag",
          apkDataShape: describeBuffer(latest.apkData),
          declaredSize: latest.apkSize,
        });
      }
      console.log(`[AppUpdate] download-admin served ${buf.length} bytes`);
      res.end(buf);
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
