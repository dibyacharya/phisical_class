<div align="center">

<img src="https://img.shields.io/badge/LectureLens-Lecture%20Capture-blue?style=for-the-badge&logo=video&logoColor=white" alt="LectureLens" />

# LectureLens Lecture Capture System

### *Automated, Low-Cost, Android-TV-First Classroom Recording Platform*

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-Android%20%7C%20Windows%20%7C%20Web-green.svg)]()
[![Backend](https://img.shields.io/badge/Backend-Node.js%20%2F%20Express-brightgreen.svg)]()
[![Database](https://img.shields.io/badge/Database-MongoDB%20Atlas-47A248.svg)]()
[![Frontend](https://img.shields.io/badge/Frontend-React%20%2F%20Vite-61DAFB.svg)]()

**Invented, Designed & Built by**

## Dibyakanta Acharya
### Founder & CEO — D&R AI Solutions Pvt. Ltd.

[![LinkedIn](https://img.shields.io/badge/LinkedIn-D%26R%20AI%20Solutions-blue?style=flat&logo=linkedin)](https://www.linkedin.com/company/dr-ai-solutions/)

*First public disclosure: April 2026*

</div>

---

## Abstract

LectureLens is the world's first enterprise-grade lecture capture system that uses **Android TV boxes and Smart TVs as first-class capture clients**. It enables Indian educational institutions to deploy automated, schedule-aware classroom recording at a fraction of the cost of existing solutions (Panopto, Echo360, Kaltura, YuJa) — using consumer-grade hardware already present in most classrooms.

No existing commercial or open-source lecture capture platform (as of April 2026) provides an Android TV APK as a native, cloud-integrated, schedule-aware capture client. This system constitutes a novel technical contribution to the educational technology domain.

---

## The Innovation

### Problem
- Enterprise lecture capture platforms (Panopto, Echo360, Kaltura) require dedicated Windows/Mac PCs per classroom → **₹50,000–2,00,000+ per room annually**
- Indian classrooms commonly have **LED Smart TVs + Android TV boxes (₹2,000–10,000)** — no platform supports this hardware
- No solution combines: auto-recording + cloud push + multi-campus hierarchy + attendance QR + facility monitoring in one system
- 52,000+ Indian colleges cannot afford Western enterprise pricing

### Solution — LectureLens
A ₹3,000 Android box drives a classroom Smart TV **and simultaneously** auto-records lectures, pushes video to cloud, tracks attendance, and reports device health — all visible from a single admin dashboard.

---

## Key Technical Contributions

### 1. Android TV as Enterprise Lecture Capture Client (Novel)
- Native Android APK running on Smart TV / Android TV box
- One-time setup: campus → block → floor → room registration
- Auto-records based on server-pushed schedule (no manual intervention)
- Sends 30-second video segments to cloud backend over WiFi
- Survives reboots via `BOOT_COMPLETED` receiver
- **No equivalent exists in any commercial or open-source platform**

### 2. License-Key Based Device Activation
- Format: `LENS-XXXX-XXXX-XXXX` (unambiguous character set)
- Cryptographically bound to device MAC address on first registration
- One license = one physical device (cannot be copied to another device)
- Admin portal: generate, revoke, reset, export licenses

### 3. Physical Facility Hierarchy
```
Campus → Block → Floor → Room
```
- Modelled after actual Indian university physical structures
- Multi-campus, multi-block, multi-floor support
- Live device status, recording state, health monitoring per room

### 4. Attendance QR Tied to Recording Session
- QR code generated simultaneously with recording session start
- Time-limited token for physical class attendance
- Students scan to mark attendance; data correlated with recording

### 5. Dual-Platform Capture Client
- **Android APK** — for Smart TVs and Android TV boxes
- **Windows EXE** — for classroom PCs (Electron, system tray, auto-start)
- Same backend API, same admin portal, same schedule source

### 6. Animated Live Camera Preview
- Canvas-based film-grain animation simulates live camera feed (silent)
- Green-tinted noise for Standby, Red-tinted for Recording
- Dual scanline sweep + vignette overlay
- Admin can see which rooms are live at a glance

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    ADMIN PORTAL (React)                     │
│  Facility Map · Device Health · Recordings · Licenses       │
│  Booking · Batches · Attendance · Floor-wise Grouping       │
│              Deployed: Vercel                               │
└──────────────────────┬──────────────────────────────────────┘
                       │ REST API (JWT)
┌──────────────────────▼──────────────────────────────────────┐
│               BACKEND API (Node.js / Express)               │
│  Device Registration · License Validation · Schedule Push   │
│  Recording Session Management · Segment Assembly & Merge    │
│  Attendance · Heartbeat · Room Hierarchy                    │
│              Deployed: Render.com · DB: MongoDB Atlas       │
└──────┬──────────────────────────────────────┬───────────────┘
       │ Heartbeat (30s) + Segment Upload      │ Heartbeat (30s) + Segment Upload
       │                                       │
┌──────▼──────────────┐             ┌──────────▼──────────────┐
│  ANDROID APK        │             │  WINDOWS EXE (Electron) │
│  Smart TV / Android │             │  Classroom PC           │
│  TV Box             │             │  System Tray · Auto-    │
│  MediaProjection    │             │  Start · desktopCapture │
│  + AudioRecord      │             │  + getUserMedia (mic)   │
│  30s WebM segments  │             │  30s WebM segments      │
│  License Key Auth   │             │  License Key Auth       │
└─────────────────────┘             └─────────────────────────┘
```

---

## Technology Stack

| Layer | Technology |
|-------|-----------|
| Admin Portal | React 18, Vite, Tailwind CSS, Lucide Icons |
| Backend API | Node.js, Express.js, Mongoose ODM |
| Database | MongoDB Atlas (cloud) |
| Android Client | Kotlin, MediaProjection, MediaRecorder, Retrofit, EncryptedSharedPreferences |
| Windows Client | Electron 28, desktopCapturer, MediaRecorder, electron-store, electron-builder |
| Video Storage | Local filesystem (Render) / extensible to S3 |
| Auth | JWT (RS256) |
| Deployment | Vercel (frontend) · Render.com (backend) · MongoDB Atlas (database) |

---

## Feature List

### Admin Portal
- 📊 **Dashboard** — live stats: online devices, active recordings, alerts
- 🏛️ **Facility Monitoring** — Campus → Block → Floor → Room hierarchy with animated live preview
- 📅 **Smart Booking** — 4-step wizard with campus/block/floor/room selection + Gantt timeline conflict detection
- 📹 **Recordings** — per-room recordings with date/course/teacher filters
- 👥 **Users** — admin, teacher, student roles
- 📚 **Batches & Courses** — batch management with course-teacher assignment
- 🔑 **Licenses** — generate/revoke/reset device activation keys, CSV export
- 📋 **Attendance** — QR-based attendance tied to recording sessions

### Android Client
- One-time setup wizard (no IT expertise required)
- License key validation on first registration
- MAC-address based device identity
- Auto-record from server schedule
- 30-second segment upload (resilient to network interruptions)
- Camera PiP overlay + QR overlay (for student attendance scanning)
- Boot auto-start (no manual intervention needed)

### Windows Client
- Single `.exe` installer (NSIS) — no Node.js required on target machine
- System tray operation (invisible to classroom users)
- Auto-start on Windows login
- Screen + microphone capture
- Identical API protocol to Android client

---

## Competitive Differentiation

| Feature | Panopto | Echo360 | Kaltura | YuJa | Opencast | **LectureLens** |
|---------|---------|---------|---------|------|----------|---------------|
| Android TV APK capture client | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Windows software capture | ✅ | ✅ | ✅ | ✅ | Partial | ✅ |
| Campus→Block→Floor→Room hierarchy | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Per-device license key model | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Attendance QR in recording session | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Facility monitoring dashboard | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| No LMS required | ❌ | ❌ | ❌ | ❌ | Partial | ✅ |
| India-first pricing | ❌ | ❌ | ❌ | ❌ | N/A | ✅ |
| Animated live preview (canvas) | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Open public disclosure | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ |

*As of April 2026 — based on publicly available product documentation*

---

## Deployment

| Service | URL |
|---------|-----|
| Admin Portal | https://admin-portal-two-gray.vercel.app |
| Backend API | https://phisical-class.onrender.com |
| Database | MongoDB Atlas (private) |

See [`DEPLOYMENT.md`](DEPLOYMENT.md) for full deployment instructions.  
See [`DEVICES_AND_LICENSES.md`](DEVICES_AND_LICENSES.md) for device setup and license system documentation.

---

## Repository Structure

```
lecture-capture-system/
├── admin-portal/          # React + Vite admin dashboard
│   └── src/pages/         # Dashboard, Facility, Booking, Recordings,
│                          # Devices, Users, Batches, Licenses, RoomDetail
├── backend/               # Node.js + Express API server
│   ├── models/            # Mongoose schemas
│   ├── controllers/       # Business logic
│   └── routes/            # API endpoints
├── classroom-recorder-windows/  # Electron Windows recorder
│   ├── main.js            # Main process (tray, IPC, scheduler)
│   ├── renderer/          # Setup, status, recorder-worker HTML
│   └── src/               # store, api, scheduler, recorder modules
├── DEPLOYMENT.md          # Full deployment guide
├── DEVICES_AND_LICENSES.md # Device setup + license system docs
└── README.md              # This file
```

*Android APK source: [`/classroom-recorder-android/`](../classroom-recorder-android/)*

---

## Intellectual Property

**First Public Disclosure:** April 13, 2026

**Inventor:** Dibyakanta Acharya  
**Organization:** D&R AI Solutions Pvt. Ltd.

This public disclosure establishes prior art for the following novel technical contributions:

1. Use of Android TV / Smart TV boxes as enterprise-grade, cloud-integrated, schedule-aware lecture capture clients
2. MAC-address bound license key activation system for educational recording devices (`LENS-XXXX-XXXX-XXXX` format)
3. Integration of physical attendance QR generation with cloud recording session initiation
4. Combined facility monitoring + lecture capture + device health dashboard for multi-campus educational institutions
5. Campus → Block → Floor → Room physical hierarchy model for educational facility and device management

> This repository constitutes a **Defensive Publication**. Any subsequent patent claim on these specific technical contributions by any third party is invalid by virtue of this prior art disclosure.

---

## License

```
MIT License

Copyright (c) 2026 Dibyakanta Acharya / D&R AI Solutions Pvt. Ltd.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## Citation

If you use or reference this work, please cite:

```bibtex
@software{acharya2026lecturelens,
  author    = {Acharya, Dibyakanta},
  title     = {LectureLens: A Low-Cost Android-TV-First Automated Lecture Capture System
               with Multi-Campus Hierarchy Management},
  year      = {2026},
  month     = {April},
  publisher = {D\&R AI Solutions Pvt. Ltd.},
  url       = {https://github.com/dibyacharya/phisical_class},
  note      = {First public disclosure. Establishes prior art for Android TV-based
               enterprise lecture capture with cloud integration.}
}
```

---

<div align="center">

**D&R AI Solutions Pvt. Ltd.**

*Built for India's 52,000+ colleges · Affordable · Scalable · Hardware-flexible*

© 2026 Dibyakanta Acharya · D&R AI Solutions Pvt. Ltd. · All rights reserved.

</div>
