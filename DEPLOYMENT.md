# LectureLens — Complete Deployment & Credentials Guide

> **Last updated:** 16 April 2026
> **Product:** LectureLens (Lecture Capture System)
> **Company:** D&R AI Solutions Pvt Ltd
> **Owner:** Dibyakanta Acharya (dibyacharya@gmail.com)

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Live Production URLs](#live-production-urls)
3. [DNS & Domain Configuration](#dns--domain-configuration)
4. [GitHub Repository](#github-repository)
5. [MongoDB Atlas (Database)](#mongodb-atlas-database)
6. [Backend — Railway (Node.js API)](#backend--railway-nodejs-api)
7. [Admin Portal — Vercel](#admin-portal--vercel)
8. [Student/LMS Portal — Vercel](#studentlms-portal--vercel)
9. [Azure Blob Storage (Video Uploads)](#azure-blob-storage-video-uploads)
10. [Android APK (Classroom Recorder)](#android-apk-classroom-recorder)
11. [Login Credentials (Demo/Test)](#login-credentials-demotest)
12. [License Key System](#license-key-system)
13. [Database Seeding](#database-seeding)
14. [Local Development Setup](#local-development-setup)
15. [Full Deploy Workflows](#full-deploy-workflows)
16. [Backend (Render.com) — DEPRECATED](#backend-rendercom--deprecated)
17. [Tech Stack Summary](#tech-stack-summary)
18. [Known Issues & Notes](#known-issues--notes)

---

## Architecture Overview

```
                        draisol.com (Hostinger DNS)
                              |
          +---------+---------+---------+
          |                   |                   |
  lecturelens-admin    lecturelens-lms    lecturelens-api
    (Vercel)             (Vercel)           (Railway)
    React+Vite           React+Vite         Express.js
       |                    |                   |
       +--------------------+----> VITE_API_BASE_URL
                                        |
                              +----+----+----+
                              |              |
                         MongoDB Atlas   Azure Blob
                         (lecture_capture) (lms-storage)
                              |
                     Android APK (recorder)
                     connects to lecturelens-api
```

### Project Structure (local)

```
/Users/dibyakantaacharya/ADMIN_PORTAL_with_phisical class/
  lecture-capture-system/         # Main monorepo (GitHub)
    backend/                     # Express.js API (deploys to Railway)
    admin-portal/                # React+Vite admin dashboard (deploys to Vercel)
    student-portal/              # React+Vite student/teacher LMS (deploys to Vercel)
  classroom-recorder-android/    # Android Kotlin app (separate, not in monorepo)
```

---

## Live Production URLs

| Service | Custom Domain | Platform | SSL |
|---------|--------------|----------|-----|
| **Admin Portal** | https://lecturelens-admin.draisol.com | Vercel | Let's Encrypt (auto-renew) |
| **Student/LMS Portal** | https://lecturelens-lms.draisol.com | Vercel | Let's Encrypt (auto-renew) |
| **Backend API** | https://lecturelens-api.draisol.com | Railway | Let's Encrypt (auto-renew) |

### API Health Check

```bash
# Root endpoint (confirms API is alive)
curl https://lecturelens-api.draisol.com/
# Response: {"status":"ok","service":"LectureLens API"}

# Health endpoint
curl https://lecturelens-api.draisol.com/health
# Response: {"status":"ok"}
```

### API Route Prefix

All API routes are under `/api/`:
```
/api/auth          — Login, register, profile
/api/classes       — Scheduled classes
/api/recordings    — Video recordings
/api/attendance    — QR attendance
/api/classroom-recording — Device registration + recording upload
/api/users         — User management
/api/batches       — Batch management
/api/courses       — Course management
/api/rooms         — Room/facility management
/api/licenses      — License key management
```

---

## DNS & Domain Configuration

**DNS Provider:** Hostinger (draisol.com)

| Subdomain | Type | Target | Purpose |
|-----------|------|--------|---------|
| `lecturelens-admin` | CNAME | `1292818e6bea7447.vercel-dns-017.com` | Vercel admin-portal |
| `lecturelens-lms` | CNAME | `25a01da10423a704.vercel-dns-017.com` | Vercel student-portal |
| `lecturelens-api` | CNAME | `hzah25el.up.railway.app` | Railway backend |
| `_railway-verify.lecturelens-api` | TXT | (Railway-provided verification code) | Railway domain verify |

> **Note:** Each Vercel project has a unique CNAME target. If you delete and re-add a domain on Vercel, the target hash will change — you must update DNS.

---

## GitHub Repository

- **Repo:** https://github.com/dibyacharya/phisical_class.git
- **Branch:** `main`
- **Auto-deploy:** Railway watches `main` branch and auto-deploys backend on push

### Git Remote (with embedded PAT)

```bash
# Current remote (has embedded token)
origin  https://dibyacharya:<YOUR_GITHUB_PAT>@github.com/dibyacharya/phisical_class.git

# Secondary remote (SSVM project — separate)
ssvm    https://dibyacharya:<YOUR_GITHUB_PAT>@github.com/dibyacharya/ssvm-lms-backend.git
```

### Push Commands

```bash
cd "/Users/dibyakantaacharya/ADMIN_PORTAL_with_phisical class/lecture-capture-system"
git add -A && git commit -m "description" && git push origin main
```

> **If token expires**, generate a new one at https://github.com/settings/tokens/new (scope: `repo`) and run:
> ```bash
> git remote set-url origin https://dibyacharya:<NEW_TOKEN>@github.com/dibyacharya/phisical_class.git
> ```

---

## MongoDB Atlas (Database)

### Connection Details

| Field | Value |
|-------|-------|
| **Provider** | MongoDB Atlas (Free M0 tier) |
| **Cluster** | Cluster0 |
| **Cluster Hostname** | `cluster0.033f2jt.mongodb.net` |
| **Database Name** | `lecture_capture` |
| **DB Username** | `dibyacharya_db_user` |
| **DB Password** | `LCSsecure2026` |
| **Network Access** | `0.0.0.0/0` (all IPs allowed) |
| **Atlas Dashboard** | https://cloud.mongodb.com |
| **Atlas Login** | Google OAuth -> dibyacharya@gmail.com |

### Full Connection String

```
mongodb+srv://dibyacharya_db_user:LCSsecure2026@cluster0.033f2jt.mongodb.net/lecture_capture?retryWrites=true&w=majority&appName=Cluster0
```

> **WARNING:** Do NOT use `cluster0.yivbc.mongodb.net` or user `lcsadmin` — those are wrong/old and will crash the server. The correct cluster is `033f2jt`.

### Collections

| Collection | Purpose |
|-----------|---------|
| `lcs_users` | Admin, Teacher, Student accounts (bcrypt hashed passwords) |
| `lcs_batches` | Academic batches (e.g. B.Tech CSE 2024) |
| `lcs_courses` | Courses linked to batch + teacher |
| `lcs_rooms` | Physical campus rooms (building, floor, room number) |
| `lcs_scheduledclasses` | Scheduled classes with date/time/room |
| `lcs_attendances` | QR-scanned attendance per class |
| `lcs_recordings` | Video recordings metadata + Azure blob URLs |
| `lcs_classroomdevices` | Registered Android Smart TV/tablet devices |
| `lcs_licenses` | License keys for device activation (LENS-XXXX-XXXX-XXXX) |

---

## Backend — Railway (Node.js API)

### Service Details

| Field | Value |
|-------|-------|
| **Platform** | Railway.app |
| **Service Name** | alert-youthfulness |
| **Project Name** | dazzling-spirit |
| **Project ID** | `27d75f47-b03b-4a46-b65f-335a8241305d` |
| **Service ID** | `4da6c08c-4a09-4070-80d0-5c029f24f666` |
| **Dashboard** | https://railway.com/project/27d75f47-b03b-4a46-b65f-335a8241305d |
| **Internal Domain** | `alert-youthfulness-production.up.railway.app` |
| **Custom Domain** | `lecturelens-api.draisol.com` |
| **Root Directory** | `/backend` |
| **Plan** | Free Trial ($5/month credit, no cold starts) |
| **Region** | us-west2 |
| **Runtime** | Node.js 18 |
| **Deploy Mode** | Auto-deploy on `git push origin main` |
| **Procfile** | `web: node index.js` |

### Environment Variables (Railway Dashboard -> Variables)

```env
PORT=5020
NODE_ENV=production
MONGODB_URI=mongodb+srv://dibyacharya_db_user:LCSsecure2026@cluster0.033f2jt.mongodb.net/lecture_capture?retryWrites=true&w=majority&appName=Cluster0
JWT_SECRET=lecture-capture-prod-secret-2026
ALLOWED_ORIGINS=*
AZURE_STORAGE_CONNECTION_STRING=<from Azure Portal -> stgkiitlmsdev -> Access keys>
AZURE_STORAGE_CONTAINER=lms-storage
AZURE_BLOB_PREFIX=physical-class-recordings
FRONTEND_URL=https://lecturelens-admin.draisol.com
```

> **Note on CORS:** The backend uses `app.use(cors())` with NO options — this means wildcard CORS by default. The `ALLOWED_ORIGINS` and `FRONTEND_URL` env vars exist but are **never consumed** by the code. CORS is fully open.

### Deploy Backend

```bash
# Just push to main — Railway auto-deploys in ~2 minutes
cd "/Users/dibyakantaacharya/ADMIN_PORTAL_with_phisical class/lecture-capture-system"
git add -A && git commit -m "description" && git push origin main
# Monitor: Railway dashboard -> Deployments tab
```

---

## Admin Portal — Vercel

### Project Details

| Field | Value |
|-------|-------|
| **Vercel Project** | `admin-portal` |
| **Vercel Team** | `private-product-projects` |
| **Framework** | Vite (React) |
| **Custom Domain** | `lecturelens-admin.draisol.com` |
| **Dev Port** | 3020 |
| **Package Name** | `lecture-capture-admin` |

### Environment Variables (Vercel Dashboard -> Settings -> Env Vars)

```env
VITE_API_BASE_URL=https://lecturelens-api.draisol.com/api
```

> **IMPORTANT:** After changing env vars on Vercel, you MUST redeploy for changes to take effect (Vite bakes env vars into the build at compile time).

### How the API URL is Used in Code

```js
// admin-portal/src/services/api.js
const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:5020/api";
```

The fallback `localhost:5020` is only used in local dev when no env var is set.

### vercel.json (SPA routing)

```json
{
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
}
```

### Deploy Admin Portal

```bash
# Option 1: Push to GitHub (if Vercel Git integration is linked)
git push origin main
# Vercel auto-deploys if connected

# Option 2: CLI deploy
cd "/Users/dibyakantaacharya/ADMIN_PORTAL_with_phisical class/lecture-capture-system/admin-portal"
vercel --prod --yes
```

---

## Student/LMS Portal — Vercel

### Project Details

| Field | Value |
|-------|-------|
| **Vercel Project** | `student-portal` |
| **Vercel Team** | `private-product-projects` |
| **Framework** | Vite (React) |
| **Custom Domain** | `lecturelens-lms.draisol.com` |
| **Dev Port** | 3021 |
| **Package Name** | `lecture-capture-student` |

### Environment Variables (Vercel Dashboard -> Settings -> Env Vars)

```env
VITE_API_BASE_URL=https://lecturelens-api.draisol.com/api
```

### How the API URL is Used in Code

```js
// student-portal/src/services/api.js
const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:5020/api";
```

### vercel.json (SPA routing)

```json
{
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
}
```

### Deploy Student Portal

```bash
cd "/Users/dibyakantaacharya/ADMIN_PORTAL_with_phisical class/lecture-capture-system/student-portal"
vercel --prod --yes
```

---

## Azure Blob Storage (Video Uploads)

### Configuration

| Field | Value |
|-------|-------|
| **Storage Account** | `stgkiitlmsdev` |
| **Container** | `lms-storage` |
| **Blob Prefix** | `physical-class-recordings` |
| **Portal** | https://portal.azure.com |

### Env Vars (set on Railway)

```env
AZURE_STORAGE_CONNECTION_STRING=<get from Azure Portal -> stgkiitlmsdev -> Security + networking -> Access keys>
AZURE_STORAGE_CONTAINER=lms-storage
AZURE_BLOB_PREFIX=physical-class-recordings
```

### Behavior

- If `AZURE_STORAGE_CONNECTION_STRING` is NOT set, the backend falls back to **local file storage** (`/uploads` directory on the server)
- Videos are uploaded as `physical-class-recordings/<blobName>.mp4`
- Max upload size: 500 MB (configured in `express-fileupload`)

---

## Android APK (Classroom Recorder)

### Current Version

| Field | Value |
|-------|-------|
| **Package** | `in.lecturelens.recorder` |
| **versionCode** | `4` |
| **versionName** | `1.3.0-draisol` |
| **minSdk** | 24 (Android 7.0) |
| **targetSdk** | 34 (Android 14) |
| **ABI Support** | armeabi-v7a, arm64-v8a, x86, x86_64 |

### Source Code Location

```
/Users/dibyakantaacharya/ADMIN_PORTAL_with_phisical class/classroom-recorder-android/
```

### Default Backend URL (hardcoded in app)

```
https://lecturelens-api.draisol.com/api
```

This is the pre-filled value in the setup screen. Users can override it during device setup.

### Keystore for Signing

| Field | Value |
|-------|-------|
| **File** | `classroom-recorder-android/lecturelens-release.jks` |
| **Alias** | `lecturelens` |
| **Store Password** | `lecturelens2024` |
| **Key Password** | `lecturelens2024` |
| **Key Algorithm** | RSA 2048-bit |
| **Validity** | 10,000 days (~27 years) |
| **DN** | `CN=LectureLens, OU=D&R AI Solutions, O=D&R AI Solutions Pvt Ltd, L=Bhubaneswar, ST=Odisha, C=IN` |

> **CRITICAL:** Do NOT lose this keystore. All future APK updates MUST be signed with the same keystore, or existing devices will reject the update.

### Build & Sign APK

```bash
cd "/Users/dibyakantaacharya/ADMIN_PORTAL_with_phisical class/classroom-recorder-android"

# Step 1: Build release APK
./gradlew assembleRelease

# Step 2: Align
TOOLS=~/Library/Android/sdk/build-tools/36.1.0
$TOOLS/zipalign -v -p 4 \
  app/build/outputs/apk/release/app-release-unsigned.apk \
  app/build/outputs/apk/release/app-release-aligned.apk

# Step 3: Sign
$TOOLS/apksigner sign \
  --ks lecturelens-release.jks \
  --ks-key-alias lecturelens \
  --ks-pass pass:lecturelens2024 \
  --key-pass pass:lecturelens2024 \
  --out app/build/outputs/apk/release/app-release.apk \
  app/build/outputs/apk/release/app-release-aligned.apk

# Step 4: Verify
$TOOLS/apksigner verify --verbose app/build/outputs/apk/release/app-release.apk

# Final APK: app/build/outputs/apk/release/app-release.apk (~2.6 MB)
```

### APK Setup Flow (on device)

1. Install APK on Android Smart TV/tablet
2. App requests permissions: Camera, Microphone, Notifications, Overlay, MediaProjection
3. Setup form appears with auto-detected device info (model, IP, MAC, cameras, storage)
4. Fill in: Backend URL (pre-filled), Campus Name, Block Name, Floor, Room Number, License Key
5. App calls `POST /api/classroom-recording/register` with device info + license key
6. Backend validates license, registers device, returns `deviceId` + `authToken`
7. Device starts foreground service for screen recording

---

## Login Credentials (Demo/Test)

### Admin Portal (lecturelens-admin.draisol.com)

| Role | Email | Password |
|------|-------|----------|
| **Admin** | `admin@draisol.com` | `admin@123` |

### Student/LMS Portal (lecturelens-lms.draisol.com)

> No demo users — create teachers and students via Admin Portal.

### JWT Token

- **Secret:** `lecture-capture-prod-secret-2026` (production, set on Railway)
- **Secret (local dev):** `lecture-capture-demo-secret-2024` (in backend/.env)
- **Expiry:** 7 days
- **Payload:** `{ id: user._id, role: user.role }`

---

## License Key System

### Format

```
LENS-XXXX-XXXX-XXXX
```

Uppercase alphanumeric, no ambiguous characters (0/O, 1/I/L excluded).

### How it Works

1. **Admin generates** license keys via Admin Portal (or `POST /api/licenses`)
2. **Android device** submits license key during setup
3. **Backend validates**: key exists, is active, not expired, not already activated
4. **On success**: license is bound to device MAC address, marked as activated
5. **One license = one device** (can be reset by admin to allow re-use)

### API Endpoints

```
POST   /api/licenses/validate   — Check if key is valid + unused
POST   /api/licenses            — Generate new key(s) (SUPER ADMIN only)
GET    /api/licenses            — List all licenses
DELETE /api/licenses/:id        — Revoke a license
POST   /api/licenses/:id/reset  — De-activate (unbind device, allow re-use)
```

---

## Database Seeding

Run these scripts to populate a fresh/empty database. **Order matters.**

```bash
cd "/Users/dibyakantaacharya/ADMIN_PORTAL_with_phisical class/lecture-capture-system/backend"

# Set the connection string
export MONGODB_URI="mongodb+srv://dibyacharya_db_user:LCSsecure2026@cluster0.033f2jt.mongodb.net/lecture_capture?retryWrites=true&w=majority&appName=Cluster0"

# Step 1: Rooms + Devices (9 rooms, 5 devices)
node scripts/seedFacility.js

# Step 2: Users + Batches + Courses (1 admin, 2 teachers, 2 students, 1 batch, 2 courses)
node scripts/seedUsers.js

# Step 3: Scheduled Classes + Recordings (22 classes, 19 recordings)
node scripts/seedClasses.js
```

> **Run order:** seedFacility -> seedUsers -> seedClasses (classes depend on user IDs from seedUsers, which uses fixed ObjectId constants)

### Clean Trial Data (preserve structure, wipe transactions)

```bash
MONGODB_URI="mongodb+srv://dibyacharya_db_user:LCSsecure2026@cluster0.033f2jt.mongodb.net/lecture_capture?retryWrites=true&w=majority&appName=Cluster0" \
  node scripts/cleanTrialData.js
```

**Wipes:** lcs_scheduledclasses, lcs_recordings, lcs_attendances
**Preserves:** lcs_users, lcs_rooms, lcs_classroomdevices, lcs_batches, lcs_courses, lcs_licenses

---

## Local Development Setup

### Prerequisites

- Node.js >= 18
- MongoDB (local) or Atlas URI
- Android Studio (for APK builds)
- Android SDK Build Tools 36.1.0

### Backend .env (local)

Create/edit `lecture-capture-system/backend/.env`:

```env
PORT=5020
MONGODB_URI=mongodb://127.0.0.1:27017/lecture_capture
JWT_SECRET=lecture-capture-demo-secret-2024
ALLOWED_ORIGINS=*
```

> **Note:** `AZURE_STORAGE_CONNECTION_STRING` is intentionally omitted for local dev — recordings will be saved to `backend/uploads/` directory instead.

### Start All Services Locally

```bash
# Terminal 1: Backend (port 5020)
cd "/Users/dibyakantaacharya/ADMIN_PORTAL_with_phisical class/lecture-capture-system/backend"
npm run dev

# Terminal 2: Admin Portal (port 3020)
cd "/Users/dibyakantaacharya/ADMIN_PORTAL_with_phisical class/lecture-capture-system/admin-portal"
npm run dev

# Terminal 3: Student Portal (port 3021)
cd "/Users/dibyakantaacharya/ADMIN_PORTAL_with_phisical class/lecture-capture-system/student-portal"
npm run dev
```

### Port Allocation

| Service | Local Port |
|---------|-----------|
| Backend API | 5020 |
| Admin Portal | 3020 |
| Student Portal | 3021 |

### Claude Code Preview Config (.claude/launch.json)

```json
{
  "version": "0.0.1",
  "configurations": [
    { "name": "lcs-backend", "runtimeExecutable": "node", "runtimeArgs": ["index.js"], "port": 5020, "cwd": "lecture-capture-system/backend" },
    { "name": "lcs-admin",   "runtimeExecutable": "npm",  "runtimeArgs": ["run", "dev"], "port": 3020, "cwd": "lecture-capture-system/admin-portal" },
    { "name": "lcs-student", "runtimeExecutable": "npm",  "runtimeArgs": ["run", "dev"], "port": 3021, "cwd": "lecture-capture-system/student-portal" }
  ]
}
```

---

## Full Deploy Workflows

### Deploy Backend Only

```bash
cd "/Users/dibyakantaacharya/ADMIN_PORTAL_with_phisical class/lecture-capture-system"
git add -A && git commit -m "backend: description" && git push origin main
# Railway auto-deploys in ~2 minutes. Monitor at:
# https://railway.com/project/27d75f47-b03b-4a46-b65f-335a8241305d
```

### Deploy Admin Portal Only

```bash
cd "/Users/dibyakantaacharya/ADMIN_PORTAL_with_phisical class/lecture-capture-system"
git add -A && git commit -m "admin: description" && git push origin main
cd admin-portal && vercel --prod --yes
```

### Deploy Student Portal Only

```bash
cd "/Users/dibyakantaacharya/ADMIN_PORTAL_with_phisical class/lecture-capture-system"
git add -A && git commit -m "student: description" && git push origin main
cd student-portal && vercel --prod --yes
```

### Deploy Everything

```bash
cd "/Users/dibyakantaacharya/ADMIN_PORTAL_with_phisical class/lecture-capture-system"
git add -A && git commit -m "release: description" && git push origin main

# Backend: auto-deploys on Railway
# Admin Portal:
cd admin-portal && vercel --prod --yes && cd ..
# Student Portal:
cd student-portal && vercel --prod --yes && cd ..
```

### Build & Deploy New Android APK

```bash
cd "/Users/dibyakantaacharya/ADMIN_PORTAL_with_phisical class/classroom-recorder-android"

# 1. Bump version in app/build.gradle.kts (versionCode + versionName)
# 2. Build
./gradlew assembleRelease
# 3. Align + Sign (see "Android APK" section above)
# 4. Install on device via ADB or file transfer
```

---

## Backend (Render.com) — DEPRECATED

> **Status:** Deprecated. Primary backend is on Railway (above). Render free tier has 50s cold starts.
> Kept as emergency fallback only.

| Field | Value |
|-------|-------|
| **Service Name** | phisical_class |
| **Service ID** | `srv-d71s38kr85hc739umnm0` |
| **Dashboard** | https://dashboard.render.com/web/srv-d71s38kr85hc739umnm0 |
| **URL** | https://phisical-class.onrender.com |
| **Plan** | Free (spins down after 15 min, ~50s cold start) |
| **Build Command** | `cd backend && npm install` |
| **Start Command** | `cd backend && node index.js` |
| **Deploy Mode** | Manual (dashboard -> Manual Deploy -> Deploy latest commit) |

### Render API Key (for programmatic deploys)

```
rnd_Ej19MuzIOwfmO1UfCkmlvgvekoo1
```

```bash
# Trigger deploy via API
curl -s -X POST "https://api.render.com/v1/services/srv-d71s38kr85hc739umnm0/deploys" \
  -H "Authorization: Bearer rnd_Ej19MuzIOwfmO1UfCkmlvgvekoo1" \
  -H "Content-Type: application/json" \
  -d '{"clearCache":"do_not_clear"}'
```

### Render Env Vars

```env
PORT=5020
MONGODB_URI=mongodb+srv://dibyacharya_db_user:LCSsecure2026@cluster0.033f2jt.mongodb.net/lecture_capture?retryWrites=true&w=majority&appName=Cluster0
JWT_SECRET=lecture-capture-prod-secret-2026
ALLOWED_ORIGINS=*
```

---

## Tech Stack Summary

| Component | Technology | Version |
|-----------|-----------|---------|
| Backend | Node.js, Express, Mongoose | Node 18+ |
| Admin Portal | React, Vite, Tailwind CSS, Axios | Vite 5 |
| Student Portal | React, Vite, Tailwind CSS, Axios | Vite 5 |
| Database | MongoDB Atlas (Free M0) | 7.x |
| Video Storage | Azure Blob Storage | @azure/storage-blob |
| Auth | JWT (jsonwebtoken) + bcryptjs | - |
| Backend Hosting | Railway.app (Free Trial) | - |
| Frontend Hosting | Vercel (Free) | - |
| Android App | Kotlin, CameraX, MediaProjection | SDK 34 |
| DNS | Hostinger (draisol.com) | - |
| QR Code | ZXing (Android) / qrcode (backend) | - |
| File Upload | express-fileupload (500MB limit) | - |
| Security | EncryptedSharedPreferences (Android) | - |

---

## Known Issues & Notes

1. **CORS is wide open** — `app.use(cors())` in backend has no origin restriction. The `ALLOWED_ORIGINS` env var is defined but never consumed by the code. For production lockdown, modify `index.js` to use `cors({ origin: [...] })`.

2. **Audio Recording Silent** — Android MediaRecorder + MediaProjection produces silent audio (~-91 dB). Needs `AudioRecord` fallback with separate audio capture + mux.

3. **Railway Free Tier Limit** — $5/month credit, only 1 custom domain on free tier. If you need to change the custom domain, you must delete the existing one first before adding a new one.

4. **GitHub PAT in git remote** — The remote URL has an embedded Personal Access Token. If it expires, generate a new one at https://github.com/settings/tokens/new and update with `git remote set-url origin`.

5. **Vercel env vars need redeploy** — Vite bakes `VITE_*` env vars at build time. Changing them on Vercel dashboard has no effect until you trigger a new deployment.

6. **MongoDB URI logged partially** — `backend/config/database.js` logs the first 30 chars of the URI on every connection attempt. In production logs this could leak the protocol + username prefix.

7. **No .env files for frontends** — Both admin-portal and student-portal have NO `.env` files locally. They rely on Vercel env vars in production and fall back to `localhost:5020` in dev.

---

## All Credentials Quick Reference

```
=== MongoDB Atlas ===
URI:       mongodb+srv://dibyacharya_db_user:LCSsecure2026@cluster0.033f2jt.mongodb.net/lecture_capture
User:      dibyacharya_db_user
Password:  LCSsecure2026
Dashboard: https://cloud.mongodb.com (Google OAuth -> dibyacharya@gmail.com)

=== JWT ===
Production:  lecture-capture-prod-secret-2026
Local Dev:   lecture-capture-demo-secret-2024

=== GitHub ===
Repo:   https://github.com/dibyacharya/phisical_class.git
PAT:    <YOUR_GITHUB_PAT>

=== Railway ===
Dashboard:  https://railway.com/project/27d75f47-b03b-4a46-b65f-335a8241305d
Project:    dazzling-spirit
Service:    alert-youthfulness

=== Render (deprecated) ===
API Key:    rnd_Ej19MuzIOwfmO1UfCkmlvgvekoo1
Service ID: srv-d71s38kr85hc739umnm0

=== Azure Blob ===
Account:    stgkiitlmsdev
Container:  lms-storage
Prefix:     physical-class-recordings
Conn String: <get from Azure Portal -> stgkiitlmsdev -> Access keys>

=== Android Keystore ===
File:       classroom-recorder-android/lecturelens-release.jks
Alias:      lecturelens
Password:   lecturelens2024

=== Vercel ===
Team:       private-product-projects
Admin:      admin-portal (lecturelens-admin.draisol.com)
Student:    student-portal (lecturelens-lms.draisol.com)
Env Var:    VITE_API_BASE_URL=https://lecturelens-api.draisol.com/api

=== DNS (Hostinger) ===
Domain:     draisol.com
Admin CNAME: lecturelens-admin -> 1292818e6bea7447.vercel-dns-017.com
LMS CNAME:   lecturelens-lms -> 25a01da10423a704.vercel-dns-017.com
API CNAME:   lecturelens-api -> hzah25el.up.railway.app

=== Admin Login ===
Admin:    admin@draisol.com / admin@123
```
