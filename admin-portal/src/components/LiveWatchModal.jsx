import { useState, useEffect, useRef } from "react";
import { LiveKitRoom, RoomAudioRenderer, useTracks } from "@livekit/components-react";
import { Track, RoomEvent } from "livekit-client";
import "@livekit/components-styles";
import { X, Radio, Volume2, VolumeX, AlertCircle, Loader2 } from "lucide-react";
import api from "../services/api";

/**
 * Live-watch modal for in-progress LiveKit-pipeline recordings.
 *
 * Calls POST /api/classroom-recording/recordings/:id/admin-watch-token
 * to get a 2-hour subscriber-only LiveKit token, then connects to the
 * same room the TV is publishing to and renders its tracks.
 *
 * The TV publishes:
 *   - audio (MICROPHONE source)
 *   - video (SCREEN_SHARE source) — the TV's display
 *   - video (CAMERA source, but mislabeled SCREEN_SHARE in v3.3.x — see
 *     I-118 in LIVEKIT_ENGINEERING_LOG.md)
 *
 * v3.3.20-frontend layout: both video tracks are shown side-by-side in a
 * 2-up grid (no "main + PiP" picker). This matches the Egress recording's
 * grid layout exactly, and dodges the deterministic-track-selection
 * problem caused by both tracks publishing at the same resolution + same
 * source label.
 */
export default function LiveWatchModal({ recordingId, recordingTitle, onClose }) {
  const [creds, setCreds] = useState(null);    // { wsUrl, token, roomName }
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  // Fetch admin-watch token on mount
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .post(`/classroom-recording/recordings/${recordingId}/admin-watch-token`)
      .then((res) => {
        if (cancelled) return;
        if (!res.data?.token || !res.data?.wsUrl) {
          setError("Backend returned no LiveKit credentials");
        } else {
          setCreds(res.data);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        const msg =
          err.response?.data?.error ||
          err.message ||
          "Failed to get watch token";
        setError(msg);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [recordingId]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative w-full max-w-5xl mx-4 bg-gray-900 rounded-2xl overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 bg-gray-950 border-b border-gray-800">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 px-2 py-1 rounded-md bg-red-900/40 border border-red-700/50">
              <Radio size={14} className="text-red-400 animate-pulse" />
              <span className="text-xs font-semibold text-red-300 tracking-wide">LIVE</span>
            </div>
            <h2 className="text-white font-medium text-sm truncate max-w-md">
              {recordingTitle || "Recording"}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-white transition"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="aspect-video bg-black relative">
          {loading && (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-300">
              <Loader2 size={32} className="animate-spin mb-3" />
              <div className="text-sm">Connecting to live class…</div>
            </div>
          )}

          {error && !loading && (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-6">
              <AlertCircle size={32} className="text-red-400 mb-3" />
              <div className="text-sm text-gray-200 mb-1">Cannot watch live</div>
              <div className="text-xs text-gray-400 max-w-md">{error}</div>
              <button
                onClick={onClose}
                className="mt-4 px-4 py-2 text-xs rounded-lg bg-gray-800 text-gray-200 hover:bg-gray-700"
              >
                Close
              </button>
            </div>
          )}

          {creds && !error && (
            <LiveKitRoom
              serverUrl={creds.wsUrl}
              token={creds.token}
              connect={true}
              audio={false}      // we don't publish, we subscribe
              video={false}
              data-lk-theme="default"
              className="h-full"
              onError={(e) => setError(e?.message || "LiveKit connection error")}
            >
              <LiveScreenViewer />
              <RoomAudioRenderer />
            </LiveKitRoom>
          )}
        </div>

        {/* Footer hint */}
        <div className="px-5 py-2 bg-gray-950 text-[11px] text-gray-500 border-t border-gray-800">
          Live stream from the classroom TV — TV display and teacher camera
          shown side-by-side. Audio is the classroom mic.
        </div>
      </div>
    </div>
  );
}

/**
 * Inner component that renders ALL subscribed video tracks side-by-side
 * in a 2-up grid, plus a mic indicator overlay.
 *
 * WHY SIDE-BY-SIDE INSTEAD OF MAIN + PIP.
 *
 * The TV-side LiveKit pipeline (LiveKitPipeline.kt, v3.3.x) sets
 * `LocalVideoTrackOptions(isScreencast = true)` at room level for the
 * screen-capture path. setCameraEnabled() inherits these defaults and
 * publishes the CAMERA track with source=SCREEN_SHARE too. Result: both
 * video tracks land in the room with the same source tag.
 *
 * Worse: in the current setup BOTH tracks publish at 1920×1080 (the TV
 * display capture and the Lumens VC-TR1 USB cam happen to use the same
 * native resolution). So neither source-label nor dimensions can
 * deterministically distinguish "screen" from "camera".
 *
 * v3.3.14–v3.3.17 used a resolution-sort to pick the larger track as
 * "main" and the smaller as "PiP". When both are the same area, the sort
 * order falls through to whatever order useTracks emitted them — which
 * varies between subscription cycles. Practical symptom: refreshing the
 * Watch Live page sometimes shows the slide deck as main and the teacher
 * face as PiP, sometimes the reverse. Inconsistent and confusing.
 *
 * v3.3.20-frontend fix: drop the main/PiP distinction entirely. Render
 * ALL video tracks side-by-side, equal-weight. Two practical benefits:
 *   1. Deterministic — same content on every refresh, ordered by track
 *      SID alphabetically so left/right doesn't flip.
 *   2. Matches the Egress recording's "grid" layout (livekitService.js)
 *      visually, so live preview and recorded MP4 look the same.
 *
 * The proper TV-side fix (explicit createVideoTrack with isScreencast=
 * false on the camera publish path so source labels don't collide) is
 * deferred to v3.3.20+ post-pilot.
 */
function LiveScreenViewer() {
  const tracks = useTracks(
    [Track.Source.ScreenShare, Track.Source.Camera, Track.Source.Microphone],
    { onlySubscribed: true }
  );

  // All published video tracks (any source). We don't try to discriminate
  // screen from camera anymore — see docstring above.
  const videoTracks = tracks
    .filter((t) => t.publication?.kind === "video")
    .sort((a, b) => {
      // Stable ordering: alphabetical by track SID. Without this, the
      // left/right tile assignment would swap whenever useTracks emits
      // them in a different order across renders.
      const aSid = a.publication?.trackSid || "";
      const bSid = b.publication?.trackSid || "";
      return aSid.localeCompare(bSid);
    });

  const micPublished = tracks.some(
    (t) => t.publication?.source === Track.Source.Microphone
  );

  if (videoTracks.length === 0 && !micPublished) {
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-400">
        <Loader2 size={28} className="animate-spin mb-3" />
        <div className="text-sm">Waiting for the TV to start publishing…</div>
        <div className="text-[11px] mt-1 text-gray-500">
          (Connected to room — no tracks yet)
        </div>
      </div>
    );
  }

  return (
    <div className="absolute inset-0 bg-black">
      {videoTracks.length > 0 ? (
        <div
          className={`w-full h-full grid gap-1 bg-black ${
            videoTracks.length === 1 ? "grid-cols-1" : "grid-cols-2"
          }`}
        >
          {videoTracks.map((track, idx) => (
            <VideoTile
              key={track.publication?.trackSid || `t-${idx}`}
              track={track}
            />
          ))}
        </div>
      ) : (
        <div className="absolute inset-0 flex items-center justify-center text-gray-300">
          <div className="flex items-center gap-2">
            {micPublished ? (
              <Volume2 size={20} className="text-green-400" />
            ) : (
              <VolumeX size={20} className="text-gray-500" />
            )}
            <span className="text-sm">
              {micPublished
                ? "Audio only — TV not sharing screen or camera"
                : "No audio or video published yet"}
            </span>
          </div>
        </div>
      )}

      {/* Mic indicator overlay */}
      <div className="absolute bottom-3 left-3 flex items-center gap-2 px-2 py-1 rounded-md bg-black/60 text-[11px] text-gray-200">
        {micPublished ? (
          <>
            <Volume2 size={12} className="text-green-400" />
            <span>Mic on</span>
          </>
        ) : (
          <>
            <VolumeX size={12} className="text-gray-400" />
            <span>No mic</span>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Renders one video track inside its grid cell. Pulled out so each track
 * gets its own ref + attach/detach lifecycle, keyed by track SID so React
 * cleanly remounts if a track is unpublished and a new one published
 * mid-session (e.g. teacher unplugs USB cam and replugs).
 */
function VideoTile({ track }) {
  const videoRef = useRef(null);

  // Attach the LiveKit track to the <video> element. autoPlay + muted
  // satisfies Chrome/Safari's autoplay-without-gesture rule; audio plays
  // separately via the parent's <RoomAudioRenderer />.
  useEffect(() => {
    const el = videoRef.current;
    const mediaTrack = track?.publication?.track;
    if (!el || !mediaTrack) return;
    mediaTrack.attach(el);
    el.play().catch((err) => {
      console.warn("[LiveWatch] video.play() rejected:", err?.message || err);
    });
    return () => {
      try {
        mediaTrack.detach(el);
      } catch (_) {}
    };
  }, [track]);

  return (
    <video
      ref={videoRef}
      autoPlay
      playsInline
      muted
      className="w-full h-full object-contain bg-black"
    />
  );
}
