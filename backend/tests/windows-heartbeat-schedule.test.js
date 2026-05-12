/**
 * Windows device heartbeat — schedule filter behaviour.
 *
 * The schedule slice in the heartbeat response is what drives device-side
 * auto-start / auto-stop. v2.x added two filters that must be tested to
 * stay correct:
 *
 *   1. Platform routing — only classes with assignedPlatform in
 *      ["windows", "any"] should reach a Windows device. Classes tagged
 *      "android" must NOT appear (otherwise the Windows recorder would
 *      try to capture them too, undoing the routing fix).
 *
 *   2. Legacy compat — rows created before the assignedPlatform field
 *      existed (i.e. field is missing entirely on the doc, $exists:false)
 *      must still be matched. The fix uses $or with an explicit $exists
 *      branch so pre-migration rows continue to work for both fleets.
 *
 * Auth: heartbeat is windowsDeviceAuth (X-Device-Id + X-Device-Token).
 */

const request = require("supertest");
const mongoose = require("mongoose");
const { setupTestDb } = require("./testDb");
const createApp = require("./app");
const { createWindowsDevice } = require("./helpers");
const ScheduledClass = require("../models/ScheduledClass");
const Course = require("../models/Course");
const Batch = require("../models/Batch");
const User = require("../models/User");

setupTestDb();
const app = createApp();

let _pkgCounter = 0;
async function makeCoursePackage(suffix = "") {
  _pkgCounter += 1;
  const tag = `${suffix}-${Date.now()}-${_pkgCounter}-${Math.random().toString(36).slice(2,8)}`;
  const batch = await Batch.create({
    batchCode: `B${_pkgCounter}${Math.random().toString(36).slice(2,6)}`.toUpperCase(),
    name: "Batch " + tag,
  });
  const teacher = await User.create({
    name: "T",
    email: `t-${tag}@t.com`,
    password: "x",
    role: "teacher",
    employeeId: `E-${tag}`.substring(0, 30),
  });
  const course = await Course.create({
    courseName: "C",
    courseCode: `C-${tag}`.substring(0, 30),
    batch: batch._id,
    teacher: teacher._id,
  });
  return { course, teacher, batch };
}

// Schedule a class for "today" so it falls inside the device's
// 48-hour window. The device-side ProcessScheduleAsync compares
// each entry's full UTC start/end to DateTime.UtcNow so the
// in-window check only fires for the time slot itself, but the
// SLICE filter at the backend just needs the date to be in window.
async function makeClass({ room = "001", title, assignedPlatform, omitPlatform = false }) {
  const { course, teacher } = await makeCoursePackage(title.replace(/\s+/g,"-"));
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const payload = {
    title,
    course: course._id,
    teacher: teacher._id,
    courseName: course.courseName,
    courseCode: course.courseCode,
    teacherName: teacher.name,
    roomNumber: room,
    date: today,
    startTime: "09:00",
    endTime: "10:00",
    status: "scheduled",
  };
  if (!omitPlatform && assignedPlatform) payload.assignedPlatform = assignedPlatform;
  // Use .save() with unset() to simulate pre-migration rows (where the
  // field truly doesn't exist on the doc, not just defaulted)
  const doc = new ScheduledClass(payload);
  if (omitPlatform) {
    doc.assignedPlatform = undefined;
  }
  await doc.save();
  if (omitPlatform) {
    // Make sure the field really is absent on the DB doc
    await ScheduledClass.updateOne({ _id: doc._id }, { $unset: { assignedPlatform: 1 } });
  }
  return doc;
}

// Returns the supertest chain directly (no `async` wrapper) so callers
// can do `.expect(200)` on it — an async function would wrap it in a
// Promise and the chained `.expect()` would fail with "not a function".
function postHeartbeat(device) {
  return request(app)
    .post(`/api/windows/devices/${device.deviceId}/heartbeat`)
    .set("X-Device-Id", device.deviceId)
    .set("X-Device-Token", device.authToken)
    .send({});
}

describe("Windows heartbeat schedule filter — platform routing", () => {
  it("INCLUDES classes assignedPlatform='windows' in same room", async () => {
    const device = await createWindowsDevice({ roomNumber: "001" });
    await makeClass({ room: "001", title: "Windows class", assignedPlatform: "windows" });

    const res = await postHeartbeat(device).expect(200);

    const titles = res.body.schedule.map((s) => s.title);
    expect(titles).toContain("Windows class");
  });

  it("INCLUDES classes assignedPlatform='any' in same room", async () => {
    const device = await createWindowsDevice({ roomNumber: "001" });
    await makeClass({ room: "001", title: "Any class", assignedPlatform: "any" });

    const res = await postHeartbeat(device).expect(200);
    const titles = res.body.schedule.map((s) => s.title);
    expect(titles).toContain("Any class");
  });

  it("EXCLUDES classes assignedPlatform='android' in same room (the main routing guarantee)", async () => {
    const device = await createWindowsDevice({ roomNumber: "001" });
    await makeClass({ room: "001", title: "Android-only class", assignedPlatform: "android" });

    const res = await postHeartbeat(device).expect(200);
    const titles = res.body.schedule.map((s) => s.title);
    expect(titles).not.toContain("Android-only class");
  });

  it("INCLUDES legacy rows without assignedPlatform field (back-compat)", async () => {
    const device = await createWindowsDevice({ roomNumber: "001" });
    await makeClass({ room: "001", title: "Legacy untagged", omitPlatform: true });

    const res = await postHeartbeat(device).expect(200);
    const titles = res.body.schedule.map((s) => s.title);
    expect(titles).toContain("Legacy untagged");
  });

  it("EXCLUDES classes in a different room (room filter still works alongside platform filter)", async () => {
    const device = await createWindowsDevice({ roomNumber: "001" });
    await makeClass({ room: "002", title: "Wrong room", assignedPlatform: "windows" });

    const res = await postHeartbeat(device).expect(200);
    const titles = res.body.schedule.map((s) => s.title);
    expect(titles).not.toContain("Wrong room");
  });

  it("EXCLUDES cancelled classes regardless of platform", async () => {
    const device = await createWindowsDevice({ roomNumber: "001" });
    const cls = await makeClass({ room: "001", title: "Cancelled", assignedPlatform: "windows" });
    await ScheduledClass.findByIdAndUpdate(cls._id, { status: "cancelled" });

    const res = await postHeartbeat(device).expect(200);
    const titles = res.body.schedule.map((s) => s.title);
    expect(titles).not.toContain("Cancelled");
  });

  it("mixed routing — one windows, one android, one legacy → only windows + legacy returned", async () => {
    const device = await createWindowsDevice({ roomNumber: "001" });
    await makeClass({ room: "001", title: "WIN",     assignedPlatform: "windows" });
    await makeClass({ room: "001", title: "ANDROID", assignedPlatform: "android" });
    await makeClass({ room: "001", title: "LEGACY",  omitPlatform: true });
    await makeClass({ room: "001", title: "ANY",     assignedPlatform: "any" });

    const res = await postHeartbeat(device).expect(200);
    const titles = res.body.schedule.map((s) => s.title).sort();
    expect(titles).toEqual(["ANY", "LEGACY", "WIN"]);
  });
});

describe("Windows heartbeat response shape", () => {
  it("response carries schedule + commands + license + appUpdate + serverTime fields", async () => {
    const device = await createWindowsDevice({ roomNumber: "001" });
    const res = await postHeartbeat(device).expect(200);

    expect(Array.isArray(res.body.schedule)).toBe(true);
    expect(Array.isArray(res.body.commands)).toBe(true);
    expect(res.body).toHaveProperty("license");
    expect(res.body).toHaveProperty("appUpdate");
    expect(res.body).toHaveProperty("serverTime");
  });

  it("schedule entries carry start/end ISO strings + alreadyRecorded flag", async () => {
    const device = await createWindowsDevice({ roomNumber: "001" });
    await makeClass({ room: "001", title: "Shape test", assignedPlatform: "windows" });

    const res = await postHeartbeat(device).expect(200);
    const entry = res.body.schedule.find((s) => s.title === "Shape test");
    expect(entry).toBeDefined();
    expect(entry).toHaveProperty("meetingId");
    expect(entry).toHaveProperty("start");
    expect(entry).toHaveProperty("end");
    expect(typeof entry.alreadyRecorded).toBe("boolean");
  });
});

describe("Windows heartbeat auth", () => {
  it("401 without headers", async () => {
    const device = await createWindowsDevice();
    await request(app)
      .post(`/api/windows/devices/${device.deviceId}/heartbeat`)
      .send({})
      .expect(401);
  });

  it("401 with wrong token", async () => {
    const device = await createWindowsDevice();
    await request(app)
      .post(`/api/windows/devices/${device.deviceId}/heartbeat`)
      .set("X-Device-Id", device.deviceId)
      .set("X-Device-Token", "not-the-token-aaaaaa")
      .send({})
      .expect(401);
  });
});
