const mongoose = require("mongoose");

/**
 * Tracks a LiveKit RTMP Ingress created for a Windows device's live-watch
 * session (v2.1.0).
 *
 * Lifecycle:
 *   - state="ready" after backend's createIngress call returns
 *   - state="active" once LiveKit fires the publisher_joined webhook
 *     (future: tied to ingress webhooks once we wire them)
 *   - state="ended" on explicit deleteIngress or auto-cleanup
 *
 * We store the streamKey too — admin should NEVER see it but the device
 * may need to refresh its ffmpeg target on reconnect.
 */
const windowsLiveIngressSchema = new mongoose.Schema(
  {
    recordingId: { type: String, required: true, index: true },
    classId: { type: String, default: null, index: true },
    deviceId: { type: String, required: true, index: true },

    ingressId: { type: String, required: true, unique: true, index: true },
    streamKey: { type: String, required: true }, // sensitive — never expose to admin role
    url: { type: String, required: true },
    roomName: { type: String, required: true },

    state: {
      type: String,
      enum: ["ready", "active", "ended", "error"],
      default: "ready",
      index: true,
    },
    lastError: String,
    endedAt: Date,
  },
  {
    timestamps: true,
    collection: "windows_live_ingresses",
  }
);

windowsLiveIngressSchema.index({ deviceId: 1, createdAt: -1 });
windowsLiveIngressSchema.index({ state: 1, createdAt: -1 });

module.exports = mongoose.model(
  "WindowsLiveIngress",
  windowsLiveIngressSchema
);
