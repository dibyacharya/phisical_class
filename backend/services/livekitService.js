/**
 * LiveKit service — token issuance, room lifecycle, and Egress recording
 * trigger for the physical-classroom (Smart TV) recording pipeline.
 *
 * Ported from KIIT_LMS_BACKEND/services/livekitService.js (token + room
 * lifecycle) and extended with the Egress trigger functions that Univanta's
 * webhook handler expects on the receiving side.
 *
 * Activated only when:
 *   - LIVEKIT_ENABLED=true on the backend (default off for safe rollout)
 *   - Device PreferencesManager.useLiveKitPipeline = true on the TV
 *
 * See lecture-capture-system/LIVEKIT_MIGRATION_PLAN.md for the full design.
 */

const {
  AccessToken,
  RoomServiceClient,
  EgressClient,
  EncodedFileType,
  EncodingOptionsPreset,
} = require("livekit-server-sdk");

const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY || "";
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET || "";
const LIVEKIT_WS_URL =
  process.env.LIVEKIT_WS_URL || "wss://livekit.dev.kiitdev.online";

// Derive HTTP URL from WS URL — RoomServiceClient + EgressClient both
// speak HTTP, not WebSocket.
const LIVEKIT_HTTP_URL = LIVEKIT_WS_URL.replace("wss://", "https://").replace(
  "ws://",
  "http://"
);

// Master switch for the entire LiveKit pipeline. While this is false the
// backend behaves exactly as it did pre-v3.2 (legacy MediaCodec + segments).
const LIVEKIT_ENABLED =
  String(process.env.LIVEKIT_ENABLED || "").toLowerCase() === "true";

// Egress destination — Azure Blob (same storage account as legacy pipeline).
// Egress writes the final MP4 directly to Azure with no Railway hop.
//
// We reuse the existing AZURE_STORAGE_CONNECTION_STRING var that
// utils/azureBlob.js uses for legacy uploads — no need to add a second
// pair of secrets to Railway. Connection strings come in the canonical
// form `DefaultEndpointsProtocol=https;AccountName=…;AccountKey=…;
// EndpointSuffix=core.windows.net`, so we parse out the two pieces
// Egress wants. Falls back to explicit AZURE_ACCOUNT_NAME / KEY if
// someone really wants to override.
function parseAzureConnString(cs) {
  if (!cs) return { name: "", key: "" };
  const parts = String(cs)
    .split(";")
    .map((p) => p.trim())
    .filter(Boolean)
    .reduce((acc, p) => {
      const idx = p.indexOf("=");
      if (idx > 0) acc[p.slice(0, idx).toLowerCase()] = p.slice(idx + 1);
      return acc;
    }, {});
  return {
    name: parts.accountname || "",
    key: parts.accountkey || "",
  };
}
const _parsedAzure = parseAzureConnString(
  process.env.AZURE_STORAGE_CONNECTION_STRING
);
const AZURE_ACCOUNT_NAME =
  process.env.AZURE_ACCOUNT_NAME || _parsedAzure.name || "";
const AZURE_ACCOUNT_KEY =
  process.env.AZURE_ACCOUNT_KEY || _parsedAzure.key || "";
// Existing legacy pipeline writes into AZURE_STORAGE_CONTAINER (default
// "lms-storage"); we keep recordings in the same container under the
// "physical-class-recordings/" prefix so the admin portal's playback
// URL logic doesn't need to know which pipeline produced the file.
const AZURE_CONTAINER =
  process.env.LIVEKIT_EGRESS_CONTAINER ||
  process.env.AZURE_STORAGE_CONTAINER ||
  process.env.AZURE_CONTAINER ||
  "lms-storage";

const isConfigured = () =>
  !!(LIVEKIT_API_KEY && LIVEKIT_API_SECRET && LIVEKIT_WS_URL);

const isEnabled = () => LIVEKIT_ENABLED && isConfigured();

const getRoomServiceClient = () =>
  new RoomServiceClient(LIVEKIT_HTTP_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET);

const getEgressClient = () =>
  new EgressClient(LIVEKIT_HTTP_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET);

/**
 * Build the canonical room name for a physical-class Recording.
 *
 * Convention: `phyclass-<recordingId>`. The `phyclass-` prefix lets the
 * LiveKit dashboard / webhook receivers easily distinguish physical-class
 * rooms from online-class rooms (which use `vconf-<meetingId>`).
 */
const roomNameForRecording = (recordingId) =>
  `phyclass-${String(recordingId)}`;

/**
 * Build the Egress output object key for a given recording.
 *
 * Pattern: `{date}/{room}/{recId}/full.mp4` — mirrors the legacy
 * segmentMerger path so admin portal playback URLs only need the host
 * swapped if we ever change storage accounts.
 */
const blobKeyForRecording = ({ recordingId, roomNumber, startedAt }) => {
  const d = startedAt instanceof Date ? startedAt : new Date();
  const date = d.toISOString().slice(0, 10); // YYYY-MM-DD
  const room = roomNumber || "unknown";
  return `physical-class-recordings/${date}/${room}/${recordingId}/full.mp4`;
};

/**
 * Generate a publisher access token for a Smart TV joining a physical-class
 * room.
 *
 * The TV connects as a "teacher" — it's the only publisher in the room
 * and can request server-side recording. canSubscribe is false because the
 * TV never watches other participants (and saving that bandwidth keeps
 * the upstream uplink free for its own three tracks).
 */
const generateDeviceToken = async ({
  recordingId,
  deviceId,
  deviceName = "Smart TV",
  ttl = "4h",
}) => {
  if (!isConfigured()) {
    throw new Error("LiveKit not configured (missing API key/secret)");
  }
  const roomName = roomNameForRecording(recordingId);

  const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
    identity: deviceId,
    name: deviceName,
    ttl,
    metadata: JSON.stringify({
      role: "teacher",
      kind: "physical-class-tv",
      recordingId: String(recordingId),
    }),
  });

  at.addGrant({
    roomJoin: true,
    room: roomName,
    canPublish: true,
    canSubscribe: false, // TV is publisher-only
    canPublishData: true,
    roomAdmin: true,
    roomRecord: true,
  });

  return await at.toJwt();
};

/**
 * Generate a SUBSCRIBER (read-only) access token for an admin who wants
 * to watch a physical-class recording **live** while it's in progress.
 *
 * Same room as the TV publisher, but with `canPublish: false` — the admin
 * sees the screen + camera + audio but cannot inject a track. Multiple
 * admins can hold valid subscriber tokens for the same room concurrently
 * (LiveKit SFU broadcasts to all of them without extra publisher load).
 *
 * Egress continues recording transparently — admin watching does not
 * disrupt or duplicate the recording pipeline.
 *
 * Caller (admin-watch route) is expected to authenticate the admin user
 * separately via the existing JWT middleware before calling this.
 */
const generateAdminWatchToken = async ({
  recordingId,
  adminUserId,
  adminName = "Admin",
  ttl = "2h",
}) => {
  if (!isConfigured()) {
    throw new Error("LiveKit not configured (missing API key/secret)");
  }
  const roomName = roomNameForRecording(recordingId);

  const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
    identity: `admin-${adminUserId}`,
    name: adminName,
    ttl,
    metadata: JSON.stringify({
      role: "admin-watcher",
      recordingId: String(recordingId),
    }),
  });

  at.addGrant({
    roomJoin: true,
    room: roomName,
    canPublish: false, // strictly view-only
    canSubscribe: true,
    canPublishData: false,
    roomAdmin: false,
    roomRecord: false,
  });

  return await at.toJwt();
};

/**
 * Create the LiveKit room for a recording (idempotent — `already exists`
 * is treated as success).
 */
const createRoom = async (recordingId, { maxParticipants = 5 } = {}) => {
  const client = getRoomServiceClient();
  const roomName = roomNameForRecording(recordingId);
  try {
    const room = await client.createRoom({
      name: roomName,
      maxParticipants, // Just the TV + a handful of admin observers
      emptyTimeout: 300, // 5-minute idle grace period
    });
    return room;
  } catch (err) {
    if (err?.message?.includes("already exists")) {
      return { name: roomName };
    }
    throw err;
  }
};

const deleteRoom = async (recordingId) => {
  const client = getRoomServiceClient();
  const roomName = roomNameForRecording(recordingId);
  try {
    await client.deleteRoom(roomName);
  } catch (err) {
    // Best-effort cleanup — room may already be gone.
    console.warn(`[LiveKit] deleteRoom(${roomName}) failed:`, err.message);
  }
};

/**
 * Start a RoomCompositeEgress for the given recording. The Egress server
 * subscribes to the room and writes one continuous MP4 to Azure Blob.
 *
 * `recording` is a Mongoose Recording document — we read its _id, the
 * scheduled-class room number, and recordingStart from it to build the
 * output path.
 *
 * Returns the EgressInfo object from LiveKit; callers should persist
 * `egressInfo.egressId` on the Recording so the webhook handler can
 * correlate `egress_ended` events back to the right row.
 */
const startCompositeEgress = async (recording, { roomNumber } = {}) => {
  const client = getEgressClient();
  const roomName = roomNameForRecording(recording._id);
  const filepath = blobKeyForRecording({
    recordingId: recording._id,
    roomNumber: roomNumber || "unknown",
    startedAt: recording.recordingStart || new Date(),
  });

  // Composite layout: "speaker" (single dominant tile) is fine for our
  // single-publisher case — the TV publishes screen+camera+mic; the
  // composite picks the most recently active video track. We may swap
  // this for a custom HTML layout later that pins the screen as the
  // background and overlays the camera as a PiP — see Phase 4 in the
  // migration plan.
  const output = {
    fileType: EncodedFileType.MP4,
    filepath,
    azure: {
      accountName: AZURE_ACCOUNT_NAME,
      accountKey: AZURE_ACCOUNT_KEY,
      containerName: AZURE_CONTAINER,
    },
  };

  const opts = {
    layout: "speaker",
    encodingOptions: EncodingOptionsPreset.H264_720P_30,
    audioOnly: false,
    videoOnly: false,
  };

  const info = await client.startRoomCompositeEgress(roomName, output, opts);
  return info;
};

const stopEgress = async (egressId) => {
  if (!egressId) return null;
  const client = getEgressClient();
  try {
    return await client.stopEgress(egressId);
  } catch (err) {
    console.warn(`[LiveKit] stopEgress(${egressId}) failed:`, err.message);
    return null;
  }
};

/**
 * List participants in a physical-class room — useful for the admin
 * dashboard to confirm the TV is actually publishing.
 */
const listParticipants = async (recordingId) => {
  const client = getRoomServiceClient();
  const roomName = roomNameForRecording(recordingId);
  try {
    return await client.listParticipants(roomName);
  } catch (err) {
    console.warn(
      `[LiveKit] listParticipants(${roomName}) failed:`,
      err.message
    );
    return [];
  }
};

module.exports = {
  // Status / config
  isConfigured,
  isEnabled,
  LIVEKIT_WS_URL,
  // Naming helpers
  roomNameForRecording,
  blobKeyForRecording,
  // Lifecycle
  generateDeviceToken,
  generateAdminWatchToken,
  createRoom,
  deleteRoom,
  startCompositeEgress,
  stopEgress,
  listParticipants,
};
