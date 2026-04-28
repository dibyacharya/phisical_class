const router = require("express").Router();
const ctrl = require("../controllers/recordingController");
const { auth, adminOnly } = require("../middleware/auth");

router.get("/", auth, ctrl.getAll);
router.post("/cleanup-stale", auth, adminOnly, ctrl.cleanupStale);
router.get("/:id", auth, ctrl.getOne);
router.put("/:id/toggle-publish", auth, adminOnly, ctrl.togglePublish);
router.post("/:id/force-stop", auth, adminOnly, ctrl.forceStop);
// v2.6.0: admin-initiated merge retry for recordings whose initial merge
// failed (ffmpeg missing, file missing, etc). Idempotent — returns the
// cached merged URL if merge is already `ready`.
router.post("/:id/merge", auth, adminOnly, ctrl.retryMerge);
// v3.2.8 — backfill the LiveKit-stored URL for recordings created before
// the webhook was teaching itself to insert the container segment. Re-
// computes mergedVideoUrl from the recording's livekitRoomName + the
// canonical Azure path, validates with HEAD, then saves.
router.post("/:id/relink-livekit", auth, adminOnly, ctrl.relinkLiveKit);
// v3.3.20 — re-mux an existing recording's MP4 with `+faststart` so seek
// + audio playback work in browsers. Fixes the moov-at-end issue that
// LiveKit Egress produces by default. Idempotent. Used to fix recordings
// created before the webhook auto-optimization landed; new recordings get
// optimized automatically post-egress_ended.
router.post("/:id/optimize-faststart", auth, adminOnly, ctrl.optimizeFaststart);
// v3.5.2 — video-stream proxy that adds the headers Azure Storage's old
// API version (x-ms-version: 2009-09-19) doesn't include. Specifically
// `Accept-Ranges: bytes` — without it, browser HTML5 <video> elements
// fall into progressive-download mode and can't seek beyond the
// already-buffered region. VLC works because it always uses Range
// requests regardless. Admin portal's <video> element doesn't.
//
// This proxy:
//   1. Resolves the recording's mergedVideoUrl
//   2. Forwards the client's Range header to Azure
//   3. Streams Azure's response back, ADDING `Accept-Ranges: bytes` and
//      `Content-Range` (when 206) so the browser knows seeking works.
//
// Used by admin portal Recordings.jsx for playback. Download links
// continue to point at Azure directly (saves Railway bandwidth).
//
// Auth: this route accepts the JWT either via the standard
// Authorization header OR via `?token=` query param, because HTML5
// <video src=...> elements don't send custom headers. The streamVideo
// controller does the check itself; no `auth` middleware on the route.
// Also responds to OPTIONS preflight without auth so browser CORS
// preflight succeeds.
router.options("/:id/video-stream", (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Range, Authorization, If-None-Match");
  res.setHeader("Access-Control-Expose-Headers", "Accept-Ranges, Content-Range, Content-Length");
  res.setHeader("Access-Control-Max-Age", "86400");
  res.status(204).end();
});
router.get("/:id/video-stream", ctrl.streamVideo);
router.delete("/:id", auth, adminOnly, ctrl.remove);

module.exports = router;
