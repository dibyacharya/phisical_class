const router = require("express").Router();
const mongoose = require("mongoose");
const { Readable } = require("stream");
const fs = require("fs");
const AppVersion = require("../models/AppVersion");
const { auth, adminOnly } = require("../middleware/auth");
const { deviceAuth } = require("../middleware/deviceAuth");

/**
 * Extract APK bytes from an express-fileupload File, handling both the
 * in-memory mode (apkFile.data is a Buffer) and the temp-file mode
 * (apkFile.tempFilePath points to a file on disk).
 *
 * The LectureLens backend is configured with `useTempFiles: true` which
 * means .data is an empty Buffer(0); the real bytes live in tempFilePath.
 * This function picks whichever is populated and returns a single Buffer.
 *
 * This is the root cause of the long QA chain for v2.5.0 upload bug —
 * previous upload logic read `.data` only and was writing 0 bytes to GridFS.
 */
async function apkBytesFrom(file) {
  if (file.data && Buffer.isBuffer(file.data) && file.data.length > 0) {
    return file.data;
  }
  if (file.tempFilePath) {
    return await fs.promises.readFile(file.tempFilePath);
  }
  throw new Error(`APK upload has neither .data bytes nor .tempFilePath (size=${file.size})`);
}

/**
 * Get GridFS bucket for APK storage.
 * GridFS splits files into 255KB chunks — no 16MB BSON limit.
 */
function getApkBucket() {
  return new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: "lcs_apks" });
}

// v3.7.0 — pure-filesystem pilot deploy path. Bypasses MongoDB ENTIRELY
// because Atlas free tier (512 MB) was rejecting both GridFS writes AND
// regular AppVersion create/update writes when over quota.
//
// Storage:
//   /tmp/lecturelens-pilot.apk   — binary
//   /tmp/lecturelens-pilot.json  — metadata { versionCode, versionName,
//                                              releaseNotes, apkSize, uploadedAt }
//
// Wiring:
//   /api/app/latest    — checks pilot.json first; if present, returns
//                        synthetic "available: true" pointing to it.
//   /api/app/download  — serves /tmp/lecturelens-pilot.apk if pilot is
//                        present (regardless of any AppVersion record).
//
// Caveat: Railway container redeploys wipe ephemeral filesystem.
// /api/app/pilot-clear deletes both files (used after rollout completes
// or to revert).
const PILOT_APK_PATH = "/tmp/lecturelens-pilot.apk";
const PILOT_META_PATH = "/tmp/lecturelens-pilot.json";

router.post("/pilot-upload", auth, adminOnly, async (req, res) => {
  const fs = require("fs");
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
    const apkBytes = await apkBytesFrom(apkFile);
    fs.writeFileSync(PILOT_APK_PATH, apkBytes);
    const meta = {
      versionCode: code,
      versionName,
      releaseNotes: releaseNotes || "",
      apkSize: apkBytes.length,
      uploadedAt: new Date().toISOString(),
    };
    fs.writeFileSync(PILOT_META_PATH, JSON.stringify(meta, null, 2));
    console.log(`[AppUpdate] pilot APK saved: v${versionName} (vc=${code}) ${apkBytes.length}B`);
    res.json({ ok: true, ...meta, apkSizeMB: (apkBytes.length / 1024 / 1024).toFixed(2) });
  } catch (err) {
    console.error("[AppUpdate] /pilot-upload failed:", err);
    res.status(500).json({ error: err.message });
  }
});

router.post("/pilot-clear", auth, adminOnly, async (_req, res) => {
  const fs = require("fs");
  try {
    let cleared = [];
    if (fs.existsSync(PILOT_APK_PATH)) { fs.unlinkSync(PILOT_APK_PATH); cleared.push("apk"); }
    if (fs.existsSync(PILOT_META_PATH)) { fs.unlinkSync(PILOT_META_PATH); cleared.push("meta"); }
    res.json({ ok: true, cleared });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Helper: read pilot meta if present + on disk. Used by /latest and /download.
function getPilotMeta() {
  const fs = require("fs");
  try {
    if (!fs.existsSync(PILOT_APK_PATH)) return null;
    if (!fs.existsSync(PILOT_META_PATH)) return null;
    const raw = fs.readFileSync(PILOT_META_PATH, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    console.warn(`[AppUpdate] getPilotMeta error: ${err.message}`);
    return null;
  }
}

// v3.7.0 — POST /api/app/upload-fs — Emergency upload path that bypasses
// GridFS and writes the APK to Railway container's ephemeral filesystem.
// Used when MongoDB Atlas free tier (512 MB) is full and rejects GridFS
// writes. The /api/app/download endpoint prefers GridFS but falls
// through to fsPath when GridFS is missing.
//
// CAVEAT: Railway containers reset their filesystem on every redeploy.
// This is a pilot/emergency mechanism, NOT durable fleet storage.
// Long-term fix is migrating APK storage to Azure Blob (the same
// container that holds recordings) — see future roadmap.
router.post("/upload-fs", auth, adminOnly, async (req, res) => {
  const fs = require("fs");
  const path = require("path");
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

    const existing = await AppVersion.findOne({ versionCode: code });
    if (existing) {
      return res.status(409).json({ error: `Version code ${code} already exists` });
    }

    // Persist to ephemeral filesystem
    const apkDir = "/tmp/lecturelens-apks";
    fs.mkdirSync(apkDir, { recursive: true });
    const fsPath = path.join(apkDir, `v${versionName}-${code}.apk`);
    const apkBytes = await apkBytesFrom(apkFile);
    fs.writeFileSync(fsPath, apkBytes);
    console.log(`[AppUpdate] FS upload OK: ${fsPath} (${apkBytes.length} bytes)`);

    await AppVersion.updateMany({}, { isActive: false });
    const av = await AppVersion.create({
      versionCode: code,
      versionName,
      releaseNotes: releaseNotes || "",
      apkData: null,
      apkGridFsId: null,
      apkFsPath: fsPath,
      apkSize: apkBytes.length,
      uploadedBy: req.user?._id,
      isActive: true,
    });

    res.json({
      message: "APK uploaded to filesystem (ephemeral)",
      versionCode: code,
      versionName,
      apkSize: apkBytes.length,
      fsPath,
      _id: av._id,
      caveat: "Railway redeploys wipe this. Long-term: migrate to Azure Blob.",
    });
  } catch (err) {
    console.error("[AppUpdate] /upload-fs failed:", err);
    res.status(500).json({ error: err.message });
  }
});

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
      // ── Upload APK to GridFS ──────────────────────────────────────
      //
      // IMPORTANT: `readable.pipe(uploadStream).on("finish", ...)` does NOT
      // guarantee that chunks are actually flushed to the `.chunks`
      // collection. Under the mongodb driver version Railway runs, the
      // `finish` event was firing before chunks landed (or didn't land at
      // all), leaving behind a zero-length file record with no chunks —
      // exactly the QA failure mode for v2.5.0 (test I01).
      //
      // Use stream/promises pipeline() to guarantee backpressure is
      // respected and errors propagate. Then EXPLICITLY verify chunks
      // exist before trusting the upload. If not, surface a 500 with
      // diagnostic so the admin re-uploads instead of thinking it worked.
      const bucket = getApkBucket();
      const filename = `lecturelens-v${versionName}-${code}.apk`;
      const uploadStream = bucket.openUploadStream(filename, {
        contentType: "application/vnd.android.package-archive",
        metadata: { versionCode: code, versionName },
      });

      try {
        // Get the actual APK bytes — handles both in-memory and temp-file
        // express-fileupload modes. The app is configured with
        // useTempFiles=true, so apkFile.data is Buffer(0) and the real bytes
        // live in apkFile.tempFilePath. This is the root cause that made all
        // previous upload attempts silently write 0 bytes to GridFS.
        const apkBytes = await apkBytesFrom(apkFile);
        console.log(`[AppUpdate] GridFS upload starting: ${apkBytes.length} bytes (tempFile=${apkFile.tempFilePath || "none"})`);

        await new Promise((resolve, reject) => {
          uploadStream.once("finish", resolve);
          uploadStream.once("error", reject);
          uploadStream.end(apkBytes);
        });
      } catch (err) {
        console.error(`[AppUpdate] GridFS upload write failed: ${err.message}`);
        return res.status(500).json({
          error: "GridFS upload write failed",
          detail: err.message,
        });
      }

      // Verification: confirm .files record exists and has expected length,
      // AND .chunks has at least one document. This is the guard that
      // would have caught the v2.5.0 bug at upload time.
      const filesCol = mongoose.connection.db.collection("lcs_apks.files");
      const chunksCol = mongoose.connection.db.collection("lcs_apks.chunks");
      const fileDoc = await filesCol.findOne({ _id: uploadStream.id });
      const chunkCount = await chunksCol.countDocuments({ files_id: uploadStream.id });
      console.log(`[AppUpdate] GridFS upload verify: files.length=${fileDoc?.length}, chunks=${chunkCount}`);

      if (!fileDoc || !fileDoc.length || fileDoc.length === 0 || chunkCount === 0) {
        // Upload silently failed — clean up orphan file record and bail out
        try { await filesCol.deleteOne({ _id: uploadStream.id }); } catch (_) {}
        return res.status(500).json({
          error: "GridFS upload verification failed",
          codeRev: "v9-upload-verify",
          detail: {
            fileDocFound: !!fileDoc,
            storedLength: fileDoc?.length ?? 0,
            chunkCount,
            expectedSize: apkFile.size,
          },
        });
      }

      const version = await AppVersion.create({
        versionCode: code,
        versionName,
        releaseNotes: releaseNotes || "",
        apkGridFsId: uploadStream.id,   // GridFS file ID
        apkSize: apkFile.size,
        uploadedBy: req.user._id,
        isActive: true,
      });

      console.log(`[AppUpdate] GridFS upload OK: v${versionName} (code ${code}) — ${(apkFile.size / 1024 / 1024).toFixed(1)} MB in ${chunkCount} chunks`);

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
      // Read via helper so useTempFiles=true mode works — same bug root
      // cause as the GridFS path (apkFile.data is empty Buffer(0) in that
      // mode; real bytes are in apkFile.tempFilePath).
      const apkBytes = await apkBytesFrom(apkFile);
      const version = await AppVersion.create({
        versionCode: code,
        versionName,
        releaseNotes: releaseNotes || "",
        apkData: apkBytes,
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
    // v3.7.0 — pilot-fs path takes priority. When the Atlas quota
    // forced us off Mongo entirely, we serve from /tmp.
    const pilot = getPilotMeta();
    if (pilot) {
      return res.json({
        available: true,
        versionCode: pilot.versionCode,
        versionName: pilot.versionName,
        apkSize: pilot.apkSize,
        releaseNotes: pilot.releaseNotes,
        updatedAt: pilot.uploadedAt,
        _source: "pilot-fs",
      });
    }

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

/**
 * Stream a GridFS-stored APK back to the client. Pre-checks the files AND
 * chunks collections BEFORE committing response headers, so we never send
 * HTTP headers promising bytes that don't exist. Returns true if streaming
 * started, false if it already sent a JSON error.
 */
async function streamGridFsApk(res, apkGridFsId, versionName, label) {
  const filesCol = mongoose.connection.db.collection("lcs_apks.files");
  const fileInfo = await filesCol.findOne({ _id: apkGridFsId });
  if (!fileInfo) {
    console.error(`[AppUpdate] (${label}) GridFS file missing: id=${apkGridFsId}`);
    res.status(500).json({
      error: "GridFS file not found",
      codeRev: "v8-gridfs-precheck",
      gridfsId: String(apkGridFsId),
      bucket: "lcs_apks",
    });
    return false;
  }
  const chunksCol = mongoose.connection.db.collection("lcs_apks.chunks");
  const chunkCount = await chunksCol.countDocuments({ files_id: apkGridFsId });
  console.log(`[AppUpdate] (${label}) GridFS OK: id=${apkGridFsId} len=${fileInfo.length} chunks=${chunkCount}`);
  if (chunkCount === 0 || fileInfo.length === 0) {
    res.status(500).json({
      error: "GridFS file has zero chunks (upload was incomplete)",
      codeRev: "v8-gridfs-precheck",
      gridfsId: String(apkGridFsId),
      declaredLength: fileInfo.length,
      chunkCount,
    });
    return false;
  }
  res.set({
    "Content-Type": "application/vnd.android.package-archive",
    "Content-Disposition": `attachment; filename="LectureLens-v${versionName}.apk"`,
    "Content-Length": fileInfo.length,
  });
  const bucket = getApkBucket();
  const downloadStream = bucket.openDownloadStream(apkGridFsId);
  let bytesStreamed = 0;
  downloadStream.on("data", (c) => { bytesStreamed += c.length; });
  downloadStream.on("end", () => {
    console.log(`[AppUpdate] (${label}) streamed ${bytesStreamed}/${fileInfo.length} bytes`);
  });
  downloadStream.on("error", (err) => {
    console.error(`[AppUpdate] (${label}) stream err at ${bytesStreamed} B: ${err.message}`);
    if (!res.headersSent) {
      res.status(500).json({ error: "GridFS stream error", detail: err.message });
    } else {
      res.end();
    }
  });
  downloadStream.pipe(res);
  return true;
}

// GET /api/app/download — Download APK binary (device auth). Supports both inline and GridFS storage.
router.get("/download", deviceAuth, async (req, res) => {
  try {
    // v3.7.0 — pilot-fs override: if /tmp/lecturelens-pilot.apk is
    // present, serve it directly. This is the path used when Atlas
    // free-tier quota blocks Mongo writes entirely.
    const pilot = getPilotMeta();
    if (pilot) {
      const fs = require("fs");
      const stat = fs.statSync(PILOT_APK_PATH);
      console.log(`[AppUpdate] download (pilot-fs): serving ${stat.size} bytes from ${PILOT_APK_PATH}`);
      res.set({
        "Content-Type": "application/vnd.android.package-archive",
        "Content-Disposition": `attachment; filename="LectureLens-v${pilot.versionName}.apk"`,
        "Content-Length": stat.size,
      });
      const stream = fs.createReadStream(PILOT_APK_PATH);
      stream.on("error", (err) => {
        console.error(`[AppUpdate] pilot-fs stream err: ${err.message}`);
        if (!res.headersSent) res.status(500).json({ error: err.message });
      });
      stream.pipe(res);
      return;
    }

    // See /download-admin comment — lean() + toNodeBuffer gives us a
    // deterministic path that works regardless of the Mongoose schema
    // Buffer hydration quirks we hit with larger inline APKs.
    // First try hydrated, then lean() as fallback — different shapes land
    // in each path depending on Mongoose + MongoDB driver versions. We try
    // both in one request rather than flipping code back and forth.
    let latest = await AppVersion.findOne({ isActive: true })
      .select("apkData apkGridFsId apkFsPath versionName versionCode apkSize")
      .sort({ versionCode: -1 });
    // If hydrated Mongoose doc returned but apkData is the wrapper shape
    // that toNodeBuffer() can't unwrap, refetch lean and re-try.
    const hydratedFailed = latest && latest.apkData && !toNodeBuffer(latest.apkData)?.length;
    if (hydratedFailed) {
      console.log(`[AppUpdate] hydrated shape=${describeBuffer(latest.apkData)} — retrying with .lean()`);
      latest = await AppVersion.findOne({ isActive: true })
        .select("apkData apkGridFsId apkFsPath versionName versionCode apkSize")
        .sort({ versionCode: -1 })
        .lean();
    }

    if (!latest) {
      return res.status(404).json({ error: "No APK available" });
    }

    // v3.7.0 — filesystem fallback (only when GridFS is unavailable due
    // to Atlas free-tier quota). See /upload-fs route.
    if (latest.apkFsPath) {
      const fs = require("fs");
      try {
        const stat = fs.statSync(latest.apkFsPath);
        console.log(`[AppUpdate] download: serving ${stat.size} bytes from FS path=${latest.apkFsPath}`);
        res.set({
          "Content-Type": "application/vnd.android.package-archive",
          "Content-Disposition": `attachment; filename="LectureLens-v${latest.versionName}.apk"`,
          "Content-Length": stat.size,
        });
        const stream = fs.createReadStream(latest.apkFsPath);
        stream.on("error", (err) => {
          console.error(`[AppUpdate] FS stream err: ${err.message}`);
          if (!res.headersSent) res.status(500).json({ error: err.message });
        });
        stream.pipe(res);
        return;
      } catch (err) {
        console.warn(`[AppUpdate] FS fallback miss for ${latest.apkFsPath}: ${err.message} — trying GridFS/inline`);
        // fall through to GridFS/inline paths below
      }
    }

    if (latest.apkGridFsId) {
      // v8: pre-check GridFS file + chunks, then stream with authoritative length
      const ok = await streamGridFsApk(res, latest.apkGridFsId, latest.versionName, "device/admin");
      if (ok) return;
      return;
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
      .select("apkData apkGridFsId apkFsPath versionName versionCode apkSize")
      .sort({ versionCode: -1 });
    // If hydrated Mongoose doc returned but apkData is the wrapper shape
    // that toNodeBuffer() can't unwrap, refetch lean and re-try.
    const hydratedFailed = latest && latest.apkData && !toNodeBuffer(latest.apkData)?.length;
    if (hydratedFailed) {
      console.log(`[AppUpdate] hydrated shape=${describeBuffer(latest.apkData)} — retrying with .lean()`);
      latest = await AppVersion.findOne({ isActive: true })
        .select("apkData apkGridFsId apkFsPath versionName versionCode apkSize")
        .sort({ versionCode: -1 })
        .lean();
    }

    if (!latest) {
      return res.status(404).json({ error: "No APK available" });
    }

    console.log(`[AppUpdate] download-admin v${latest.versionName} (code ${latest.versionCode}), storage=${latest.apkGridFsId ? "gridfs" : (latest.apkFsPath ? "fs" : "inline")}, declared size=${latest.apkSize}`);

    // v3.7.0 — filesystem fallback (Atlas free-tier emergency path)
    if (latest.apkFsPath) {
      const fs = require("fs");
      try {
        const stat = fs.statSync(latest.apkFsPath);
        res.set({
          "Content-Type": "application/vnd.android.package-archive",
          "Content-Disposition": `attachment; filename="LectureLens-v${latest.versionName}.apk"`,
          "Content-Length": stat.size,
        });
        const stream = fs.createReadStream(latest.apkFsPath);
        stream.on("error", (err) => {
          console.error(`[AppUpdate] (admin) FS stream err: ${err.message}`);
          if (!res.headersSent) res.status(500).json({ error: err.message });
        });
        stream.pipe(res);
        return;
      } catch (err) {
        console.warn(`[AppUpdate] (admin) FS fallback miss: ${err.message} — trying GridFS`);
      }
    }

    if (latest.apkGridFsId) {
      const ok = await streamGridFsApk(res, latest.apkGridFsId, latest.versionName, "admin");
      if (ok) return;
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

// DELETE /api/app/versions/:id — Delete a version (admin) + purge GridFS
//
// Previously this only deleted the AppVersion document; the GridFS file
// in lcs_apks bucket stayed forever. The LiveKit migration spike chain
// (10+ test APKs at ~55 MB each) blew the 512 MB MongoDB quota. Now
// we drop the chunks too.
router.delete("/versions/:id", auth, adminOnly, async (req, res) => {
  try {
    const v = await AppVersion.findById(req.params.id).select("apkGridFsId versionCode versionName");
    if (v?.apkGridFsId) {
      try {
        await getApkBucket().delete(v.apkGridFsId);
        console.log(`[AppUpdate] Purged GridFS file ${v.apkGridFsId} for v${v.versionName} (code ${v.versionCode})`);
      } catch (e) {
        console.warn(`[AppUpdate] GridFS purge failed for ${v.apkGridFsId}: ${e.message}`);
      }
    }
    await AppVersion.findByIdAndDelete(req.params.id);
    res.json({ message: "Version deleted" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/app/versions/purge-orphans — One-shot recovery for the
// pre-fix chunks. Deletes any GridFS file in lcs_apks that isn't
// referenced by an AppVersion document.
router.post("/versions/purge-orphans", auth, adminOnly, async (_req, res) => {
  try {
    const filesCol = mongoose.connection.db.collection("lcs_apks.files");
    const allFiles = await filesCol.find({}).project({ _id: 1, length: 1 }).toArray();
    const validIds = new Set(
      (await AppVersion.find({}).select("apkGridFsId").lean())
        .map((v) => v.apkGridFsId && String(v.apkGridFsId))
        .filter(Boolean)
    );
    const bucket = getApkBucket();
    let purged = 0;
    let bytes = 0;
    const failures = [];
    for (const f of allFiles) {
      if (validIds.has(String(f._id))) continue;
      try {
        await bucket.delete(f._id);
        purged++;
        bytes += Number(f.length || 0);
      } catch (e) {
        failures.push({ id: String(f._id), error: e.message });
      }
    }
    res.json({
      message: "Orphan purge complete",
      filesScanned: allFiles.length,
      validReferenced: validIds.size,
      purged,
      bytesFreedMB: (bytes / 1024 / 1024).toFixed(1),
      failures,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/app/versions/:id/activate — Set this version as the active one,
// deactivating all others. Useful for:
//   - Rolling back to a prior version without re-uploading
//   - QA stress tests that want to restore state cleanly
//   - Admin flipping between pinned releases
router.post("/versions/:id/activate", auth, adminOnly, async (req, res) => {
  try {
    const target = await AppVersion.findById(req.params.id);
    if (!target) return res.status(404).json({ error: "Version not found" });

    // Deactivate everyone first (atomic-ish — single-writer admin endpoint).
    await AppVersion.updateMany({}, { isActive: false });
    target.isActive = true;
    await target.save();

    console.log(`[AppUpdate] Activated v${target.versionName} (code ${target.versionCode}) by ${req.user?.email || "admin"}`);
    res.json({
      message: `Activated v${target.versionName}`,
      version: {
        _id: target._id,
        versionCode: target.versionCode,
        versionName: target.versionName,
        apkSize: target.apkSize,
        isActive: true,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/app/free-mongo-quota — emergency one-shot trim of high-volume
// collections when MongoDB Atlas reports the cluster is full and rejects
// writes (including DELETEs of GridFS chunks). Trims:
//   1. HealthSnapshot — keeps last N days (default 3)
//   2. DeviceLog      — keeps last N days (default 3)
//   3. DeviceCommand  — keeps non-completed + last N days completed
//
// Why an explicit endpoint: at-quota Atlas rejects ALL writes via the
// app's Mongoose connection, but compact deleteMany ops with proper
// query filters still succeed because the WiredTiger reservation pool
// has cleanup credit. Admin triggers this manually when /api/app/upload
// or DELETE returns "over your space quota".
router.post("/free-mongo-quota", auth, adminOnly, async (req, res) => {
  try {
    // v3.7.0 — accept either `days` (default 3, floor 1) OR `hours`
    // (default null). When `hours` is supplied AND > 0, we use that;
    // otherwise fall back to the days path. The hours path also
    // supports `aggressive: true` to ignore the cutoff entirely
    // (i.e. truncate-all). Aggressive is the emergency lever for
    // 512 MB Atlas free-tier blocking an APK upload.
    const aggressive = req.body?.aggressive === true;
    const hours = parseInt(req.body?.hours);
    const days = Math.max(1, Math.min(parseInt(req.body?.days) || 3, 30));
    let cutoff;
    let label;
    if (aggressive) {
      cutoff = new Date(Date.now() + 24 * 60 * 60 * 1000); // future = matches everything
      label = "EVERYTHING (aggressive flag)";
    } else if (hours && hours > 0) {
      cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);
      label = `${hours} hours`;
    } else {
      cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      label = `${days} days`;
    }
    const HealthSnapshot = require("../models/HealthSnapshot");
    const DeviceLog = require("../models/DeviceLog");
    const DeviceCommand = require("../models/DeviceCommand");

    const results = {};

    try {
      const r1 = await HealthSnapshot.deleteMany({ timestamp: { $lt: cutoff } });
      results.healthSnapshot = r1.deletedCount || 0;
    } catch (e) { results.healthSnapshot = `error: ${e.message}`; }

    try {
      const r2 = await DeviceLog.deleteMany({ timestamp: { $lt: cutoff } });
      results.deviceLog = r2.deletedCount || 0;
    } catch (e) { results.deviceLog = `error: ${e.message}`; }

    try {
      const filter = aggressive
        ? { status: { $in: ["completed", "failed"] } }
        : {
            status: { $in: ["completed", "failed"] },
            completedAt: { $lt: cutoff },
          };
      const r3 = await DeviceCommand.deleteMany(filter);
      results.deviceCommand = r3.deletedCount || 0;
    } catch (e) { results.deviceCommand = `error: ${e.message}`; }

    console.log(`[AppUpdate] Mongo quota free (cutoff=${label}):`, results);
    res.json({
      message: `Trimmed collections older than ${label}`,
      cutoff: cutoff.toISOString(),
      deleted: results,
    });
  } catch (err) {
    console.error("[AppUpdate] free-mongo-quota failed:", err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
