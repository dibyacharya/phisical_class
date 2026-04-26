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
 *   - video (SCREEN_SHARE source) — the TV's display, which on this
 *     deployment already has the camera as a SYSTEM_ALERT_WINDOW PiP
 *     overlay baked in, so screen-share alone shows everything.
 *
 * For the simple v1 layout: the screen-share video gets full container,
 * audio plays via RoomAudioRenderer (auto-attaches to a hidden <audio>).
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
              <LiveScreenViewer onClose={onClose} />
              <RoomAudioRenderer />
            </LiveKitRoom>
          )}
        </div>

        {/* Footer hint */}
        <div className="px-5 py-2 bg-gray-950 text-[11px] text-gray-500 border-t border-gray-800">
          Live stream from the classroom TV. Audio mixes the room mic.
          Video is the TV display (camera PiP visible top-left).
        </div>
      </div>
    </div>
  );
}

/**
 * Inner component that picks the active screen-share / camera tracks
 * from the room and renders them. `useTracks` gives us all tracks of the
 * specified sources currently subscribed.
 */
function LiveScreenViewer({ onClose }) {
  const tracks = useTracks(
    [Track.Source.ScreenShare, Track.Source.Camera, Track.Source.Microphone],
    { onlySubscribed: true }
  );

  // Prefer the screen-share track for the main viewport; fall back to
  // the first video we see. Audio is handled by RoomAudioRenderer.
  const screenTrack = tracks.find(
    (t) => t.publication?.source === Track.Source.ScreenShare
  );
  const cameraTrack = tracks.find(
    (t) => t.publication?.source === Track.Source.Camera
  );
  const micPublished = tracks.some(
    (t) => t.publication?.source === Track.Source.Microphone
  );

  const videoTrack = screenTrack || cameraTrack;
  const videoRef = useRef(null);

  useEffect(() => {
    const el = videoRef.current;
    const track = videoTrack?.publication?.track;
    if (!el || !track) return;
    track.attach(el);
    return () => {
      try {
        track.detach(el);
      } catch (_) {}
    };
  }, [videoTrack]);

  if (!videoTrack && !micPublished) {
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
      {videoTrack ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={false}
          className="w-full h-full object-contain"
        />
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
                ? "Audio only — TV not sharing screen"
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
