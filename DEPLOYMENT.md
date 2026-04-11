# Lecture Capture System — Deployment & Setup Guide

## Project Structure

```
lecture-capture-system/
  backend/          # Express.js API server (Node.js)
  admin-portal/     # React + Vite (Admin dashboard)
  student-portal/   # React + Vite (Student/Teacher LMS)
```

---

## GitHub Repository

- **Repo:** https://github.com/dibyacharya/phisical_class.git
- **Branch:** main

### Push Command
```bash
cd "/Users/dibyakantaacharya/ADMIN_PORTAL_with_phisical class/lecture-capture-system"
git add -A && git commit -m "message" && git push origin main
```

> **Note:** Git remote URL has an embedded token. If expired, update with:
> ```bash
> git remote set-url origin https://dibyacharya:<NEW_TOKEN>@github.com/dibyacharya/phisical_class.git
> ```
> Generate token at: https://github.com/settings/tokens/new (scope: `repo`)

---

## Live URLs

| Service | URL | Platform |
|---------|-----|----------|
| **Admin Portal** | https://admin-portal-two-gray.vercel.app | Vercel |
| **Student/LMS Portal** | https://student-portal-drab-seven.vercel.app | Vercel |
| **Backend API** | https://phisical-class.onrender.com | Render |

---

## Login Credentials

| Role | Email | Password |
|------|-------|----------|
| Admin | admin@kiit.ac.in | admin123 |
| Teacher (Rishitosh) | rishi@gmail.com | 123456 |
| Teacher (Dr. Sharma) | teacher@kiit.ac.in | teacher123 |
| Student (Rahul) | rahul@kiit.ac.in | student123 |
| Student (Dibyakanta) | dibyacharya@gmail.com | student123 |

---

## Backend (Render.com)

### Service Details
- **Service Name:** phisical_class
- **Service ID:** srv-d71s38kr85hc739umnm0
- **Dashboard:** https://dashboard.render.com/web/srv-d71s38kr85hc739umnm0
- **Plan:** Free (spins down after 15 min inactivity, cold start ~50s)
- **Build Command:** `cd backend && npm install`
- **Start Command:** `cd backend && node server.js`
- **Root Directory:** (repo root)
- **Deploy Mode:** Manual — click "Manual Deploy → Deploy latest commit" on dashboard

### Environment Variables on Render
Set these in Render dashboard → Environment tab:

```
PORT=4000
MONGODB_URI=mongodb+srv://dibyacharya_db_user:LCS2024secure@cluster0.033f2jt.mongodb.net/lecture_capture?retryWrites=true&w=majority&appName=Cluster0
JWT_SECRET=lecture-capture-prod-secret-2026
ALLOWED_ORIGINS=*
```

> ⚠️ **IMPORTANT:** The correct cluster is `cluster0.033f2jt.mongodb.net` and user is `dibyacharya_db_user`.
> Do NOT use `cluster0.yivbc.mongodb.net` or `lcsadmin` — those are wrong and will crash the server.

### Deploy after Code Changes (Backend)
1. `git add -A && git commit -m "message" && git push origin main`
2. Go to Render dashboard → **Manual Deploy → Deploy latest commit**
3. Wait 2–3 minutes for build + deploy
4. First request after deploy takes ~50s (cold start on free tier)

### Verify Backend is Live
```bash
curl https://phisical-class.onrender.com/health
# Expected: {"status":"ok"}
```

### Render API (if dashboard is broken/black screen)
Use the Render REST API directly with API key:
- **API Key:** `rnd_Ej19MuzIOwfmO1UfCkmlvgvekoo1`
- **Service ID:** `srv-d71s38kr85hc739umnm0`

```bash
# Trigger manual deploy via API
curl -s -X POST "https://api.render.com/v1/services/srv-d71s38kr85hc739umnm0/deploys" \
  -H "Authorization: Bearer rnd_Ej19MuzIOwfmO1UfCkmlvgvekoo1" \
  -H "Content-Type: application/json" \
  -d '{"clearCache":"do_not_clear"}'

# Check deploy status
curl -s "https://api.render.com/v1/services/srv-d71s38kr85hc739umnm0/deploys?limit=1" \
  -H "Authorization: Bearer rnd_Ej19MuzIOwfmO1UfCkmlvgvekoo1" | python3 -m json.tool

# Get current env vars
curl -s "https://api.render.com/v1/services/srv-d71s38kr85hc739umnm0/env-vars" \
  -H "Authorization: Bearer rnd_Ej19MuzIOwfmO1UfCkmlvgvekoo1"
```

---

## Admin Portal (Vercel)

### Project Details
- **Vercel Project:** admin-portal
- **Team:** private-product-projects
- **Framework:** Vite (React)

### Environment Variables on Vercel
```
VITE_API_BASE_URL=https://phisical-class.onrender.com/api
```

### Deploy Command
```bash
cd "/Users/dibyakantaacharya/ADMIN_PORTAL_with_phisical class/lecture-capture-system/admin-portal"
vercel --prod --yes
```

### vercel.json
```json
{
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
}
```

---

## Student/LMS Portal (Vercel)

### Project Details
- **Vercel Project:** student-portal
- **Team:** private-product-projects
- **Framework:** Vite (React)

### Environment Variables on Vercel
```
VITE_API_BASE_URL=https://phisical-class.onrender.com/api
```

### Deploy Command
```bash
cd "/Users/dibyakantaacharya/ADMIN_PORTAL_with_phisical class/lecture-capture-system/student-portal"
vercel --prod --yes
```

---

## MongoDB Atlas

- **Cluster:** Cluster0
- **Cluster ID:** `033f2jt` (hostname: `cluster0.033f2jt.mongodb.net`)
- **Database:** `lecture_capture`
- **Connection String:**
  ```
  mongodb+srv://dibyacharya_db_user:LCS2024secure@cluster0.033f2jt.mongodb.net/lecture_capture?retryWrites=true&w=majority&appName=Cluster0
  ```
- **Dashboard:** https://cloud.mongodb.com
- **Login:** Google OAuth → dibyacharya@gmail.com
- **Network Access:** `0.0.0.0/0` (all IPs allowed)
- **DB User:** `dibyacharya_db_user` / `LCS2024secure`

### Collections

| Collection | Purpose |
|-----------|---------|
| lcs_users | Admin, Teacher, Student accounts |
| lcs_batches | Batches (e.g. B.Tech CSE 2024) |
| lcs_courses | Courses linked to batch + teacher |
| lcs_rooms | Campus rooms (building, floor, room number) |
| lcs_scheduledclasses | Scheduled classes with date/time/room |
| lcs_attendances | QR-scanned attendance per class |
| lcs_recordings | Video recordings from devices |
| lcs_classroomdevices | Registered Smart TV/tablet devices |

### Seed Scripts
Run these to populate a fresh database (e.g. after wiping or on a new Atlas cluster):

```bash
cd "/Users/dibyakantaacharya/ADMIN_PORTAL_with_phisical class/lecture-capture-system/backend"

# 1. Rooms + Devices (9 rooms, 5 devices)
MONGODB_URI="mongodb+srv://dibyacharya_db_user:LCS2024secure@cluster0.033f2jt.mongodb.net/lecture_capture?retryWrites=true&w=majority&appName=Cluster0" \
  node scripts/seedFacility.js

# 2. Users + Batches + Courses (admin, 2 teachers, 2 students, 1 batch, 2 courses)
MONGODB_URI="mongodb+srv://dibyacharya_db_user:LCS2024secure@cluster0.033f2jt.mongodb.net/lecture_capture?retryWrites=true&w=majority&appName=Cluster0" \
  node scripts/seedUsers.js

# 3. Scheduled Classes + Recordings (22 classes, 19 recordings)
MONGODB_URI="mongodb+srv://dibyacharya_db_user:LCS2024secure@cluster0.033f2jt.mongodb.net/lecture_capture?retryWrites=true&w=majority&appName=Cluster0" \
  node scripts/seedClasses.js
```

> Run in order: seedFacility → seedUsers → seedClasses (classes depend on user IDs from seedUsers)

---

## Android APK (Classroom Recorder)

- **Latest APK:** `/Users/dibyakantaacharya/Downloads/EduCampus-Recorder-v15.apk`
- **Source Code:** `/Users/dibyakantaacharya/ADMIN_PORTAL_with_phisical class/classroom-recorder-android/`

### APK Setup Values
| Field | Value |
|-------|-------|
| Backend URL (local) | `http://<laptop-IP>:4000/api` |
| Backend URL (production) | `https://phisical-class.onrender.com/api` |

### APK Build Command
```bash
cd "/Users/dibyakantaacharya/ADMIN_PORTAL_with_phisical class/classroom-recorder-android"
./gradlew assembleDebug
# Output: app/build/outputs/apk/debug/app-debug.apk
```

---

## Local Development

### Start All Services
```bash
# Terminal 1: Backend
cd "/Users/dibyakantaacharya/ADMIN_PORTAL_with_phisical class/lecture-capture-system/backend"
npm run dev

# Terminal 2: Admin Portal (port 5174)
cd "/Users/dibyakantaacharya/ADMIN_PORTAL_with_phisical class/lecture-capture-system/admin-portal"
npm run dev

# Terminal 3: Student Portal (port 5175)
cd "/Users/dibyakantaacharya/ADMIN_PORTAL_with_phisical class/lecture-capture-system/student-portal"
npm run dev
```

### Local .env (backend)
```
PORT=4000
MONGODB_URI=mongodb://127.0.0.1:27017/lecture_capture
JWT_SECRET=lecture-capture-demo-secret-2024
ALLOWED_ORIGINS=http://localhost:5174,http://localhost:5175
```

### Preview Servers (.claude/launch.json)
```json
{
  "version": "0.0.1",
  "configurations": [
    { "name": "lcs-backend", "runtimeExecutable": "node", "runtimeArgs": ["server.js"], "port": 4000, "cwd": "lecture-capture-system/backend" },
    { "name": "lcs-admin",   "runtimeExecutable": "npm",  "runtimeArgs": ["run", "dev"], "port": 5174, "cwd": "lecture-capture-system/admin-portal" },
    { "name": "lcs-student", "runtimeExecutable": "npm",  "runtimeArgs": ["run", "dev"], "port": 5175, "cwd": "lecture-capture-system/student-portal" }
  ]
}
```

---

## Full Deploy Workflow (after code changes)

### Backend only
```bash
cd "/Users/dibyakantaacharya/ADMIN_PORTAL_with_phisical class/lecture-capture-system"
git add -A && git commit -m "description" && git push origin main
# Then: Render dashboard → Manual Deploy → Deploy latest commit
```

### Admin Portal only
```bash
cd "/Users/dibyakantaacharya/ADMIN_PORTAL_with_phisical class/lecture-capture-system"
git add -A && git commit -m "description" && git push origin main
cd admin-portal && vercel --prod --yes
```

### Student Portal only
```bash
cd "/Users/dibyakantaacharya/ADMIN_PORTAL_with_phisical class/lecture-capture-system"
git add -A && git commit -m "description" && git push origin main
cd student-portal && vercel --prod --yes
```

### All three at once
```bash
cd "/Users/dibyakantaacharya/ADMIN_PORTAL_with_phisical class/lecture-capture-system"
git add -A && git commit -m "description" && git push origin main

cd admin-portal && vercel --prod --yes
cd ../student-portal && vercel --prod --yes
# Then: Render dashboard → Manual Deploy → Deploy latest commit
```

---

## Known Issues & Pending Fixes

1. **Audio Recording Silent** — MediaRecorder + MediaProjection produces silent audio (-91 dB). Need `AudioRecord` fallback with separate audio capture + mux.
2. **Render Cold Start** — Free tier sleeps after 15 min. First request takes ~50s. Upgrade to paid ($7/mo) for always-on.
3. **Admin Attendance Page** — White screen when clicking attendance icon. Route `/api/attendance/class/:id` is missing — needs adding.
4. **Recording Upload Timeout** — Large files (60MB+) may timeout on Render free tier. Consider chunked upload or cloud storage (S3).

---

## Tech Stack Summary

| Component | Technology |
|-----------|-----------|
| Backend | Node.js, Express, Mongoose |
| Admin Portal | React, Vite, Tailwind CSS |
| Student Portal | React, Vite, Tailwind CSS |
| Database | MongoDB Atlas (Free M0) |
| Backend Hosting | Render.com (Free) |
| Frontend Hosting | Vercel (Free) |
| Android App | Kotlin, MediaProjection API |
| Video Format | MP4 (H.264 + AAC) |
