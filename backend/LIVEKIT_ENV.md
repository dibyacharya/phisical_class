# LiveKit env vars — backend (Railway)

Add these to the `lecturelens-backend` service env on Railway. **Do NOT commit
real values** — only the names below should ever appear in the repo.

How to set: Railway dashboard → `lecturelens-backend` service → **Variables**
tab → "+ New Variable" for each row below → click **Deploy** (Railway
auto-redeploys on env change; auto-deploy from GitHub `main` push also
picks these up on subsequent deploys).

## Required

| Var | Example | What it does |
|---|---|---|
| `LIVEKIT_ENABLED` | `true` / `false` | Master switch. `false` → backend behaves exactly like pre-v3.2. **Default: false.** |
| `LIVEKIT_API_KEY` | `APIxxxxxxxxxx` | Issued by `docker run --rm livekit/generate` on the VM. Reused from the LMS deployment. |
| `LIVEKIT_API_SECRET` | `<48-char base64>` | Paired with `LIVEKIT_API_KEY`. Same secret as the LMS — keep it identical. |
| `LIVEKIT_WS_URL` | `wss://livekit.kiitdev.online` | The Smart TV connects to this. Production resolves directly to the Azure VM IP (no Front Door in path). |

## Egress destination — already configured

Egress writes recordings directly to Azure Blob via a per-request `Output`
config sent by `livekitService.startCompositeEgress()`. The credentials it
needs (account name + key + container) are derived from env vars the
backend already has set for the legacy pipeline:

| Source var | What we extract |
|---|---|
| `AZURE_STORAGE_CONNECTION_STRING` | parsed → `AccountName` and `AccountKey` |
| `AZURE_STORAGE_CONTAINER` (default `lms-storage`) | container name |
| `AZURE_BLOB_PREFIX` (default `physical-class-recordings`) | path prefix |

No new Azure-related env vars are required — recordings end up at
`{container}/{prefix}/{date}/{room}/{recId}/full.mp4`, the same
hierarchy as legacy.

To override (e.g. point Egress at a separate container), set:
- `LIVEKIT_EGRESS_CONTAINER` — override container name for LiveKit only
- `AZURE_ACCOUNT_NAME` / `AZURE_ACCOUNT_KEY` — bypass parsing, set explicitly

## Smoke-test commands (run locally before flipping LIVEKIT_ENABLED on Railway)

```bash
# 1. RoomService API (no Egress involved — verifies creds + reachability)
LIVEKIT_API_KEY=... LIVEKIT_API_SECRET=... LIVEKIT_WS_URL=... \
  node -e "
    const { RoomServiceClient, AccessToken } = require('livekit-server-sdk');
    const c = new RoomServiceClient(process.env.LIVEKIT_WS_URL.replace('wss://','https://'),
      process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET);
    c.listRooms().then(rs => console.log('rooms:', rs.length));
  "

# 2. Backend module check (with our wrapper)
LIVEKIT_API_KEY=... LIVEKIT_API_SECRET=... LIVEKIT_WS_URL=... LIVEKIT_ENABLED=true \
  node -e "
    const s = require('./services/livekitService');
    console.log('enabled:', s.isEnabled());
    s.createRoom('phyclass-smoketest').then(r =>
      s.deleteRoom('phyclass-smoketest').then(() => console.log('OK', r.name)));
  "
```

## Webhook URL to register on the LiveKit VM

Once Railway has these env vars set and the new code is deployed, edit
`/opt/livekit/livekit.yaml` on the VM and add:

```yaml
webhook:
  api_key: <same value as LIVEKIT_API_KEY>
  urls:
    - https://lecturelens-api.draisol.com/api/classroom-recording/livekit-webhook
```

Then `docker restart livekit-server` on the VM.

## Rollout checklist

1. ☐ Railway env vars set (above)
2. ☐ Railway auto-deploys feature branch (or merge to `main`)
3. ☐ Smoke-test passes from Railway CLI shell:
   `curl -s https://lecturelens-api.draisol.com/api/classroom-recording/dashboard ...`
4. ☐ LiveKit VM `livekit.yaml` updated with webhook URL → `docker restart`
5. ☐ Egress container deployed on VM (Phase 0b — needs SSH)
6. ☐ Network test from TV WiFi to VM passes (Phase 0c)
7. ☐ Android v3.2.0 APK with `useLiveKitPipeline=true` installed on Room 001 TV (Phase 2)
8. ☐ One pilot class run end-to-end (Phase 4)

Until step 1 is complete, `LIVEKIT_ENABLED=false` keeps the legacy pipeline
running unmodified.
