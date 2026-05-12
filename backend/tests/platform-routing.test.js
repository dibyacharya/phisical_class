/**
 * Platform-aware scheduling (assignedPlatform on LCS_ScheduledClass).
 *
 * The bug this guards against:
 *   When an Android TV (ClassroomDevice) and a Windows Mini PC
 *   (WindowsDevice) both poll the same roomNumber for scheduled classes,
 *   without an explicit platform tag they race to claim every class.
 *   Pre-fix every booking was visible to both fleets; whichever
 *   heartbeat landed first created the recording and the other side
 *   silently woke up its recorder anyway (stealing HDMI input, in the
 *   smart-TV case, since the Android app would foreground itself
 *   ~2 min before scheduled start).
 *
 * Fix (commit ef2bd75):
 *   - Added assignedPlatform: "windows" | "android" | "any" field
 *     on LCS_ScheduledClass (default "any" for backward compat).
 *   - Windows booking page sends "windows" on POST /api/classes.
 *   - Android booking page sends "android".
 *   - Each device's heartbeat schedule filter only surfaces classes
 *     where assignedPlatform is its platform OR "any".
 *
 * What this test file covers (the BACKEND piece only; the heartbeat
 * filter that pairs with this lives in the windows device controller
 * and the classroom-recording controller — those filter shapes are
 * verified here at the model + create endpoint level):
 *   1. Default value is "any" when client omits the field
 *   2. Schema enum rejects unknown platform values
 *   3. Field is whitelisted on PUT /classes/:id update
 *   4. Bulk-create respects row.assignedPlatform with fallback to
 *      body.assignedPlatform default ("windows" on bulk Windows
 *      page, "android" on bulk Android page)
 */

const request = require("supertest");
const mongoose = require("mongoose");
const { setupTestDb } = require("./testDb");
const createApp = require("./app");
const { createAdmin } = require("./helpers");
const Batch = require("../models/Batch");
const Course = require("../models/Course");
const User = require("../models/User");
const ScheduledClass = require("../models/ScheduledClass");

setupTestDb();
const app = createApp();

// Helper: spin up a teacher + course + batch so POST /classes has all
// the FK refs it needs. batchCode + courseCode are randomized so multiple
// invocations within one test don't trip the unique-index on
// {courseCode, batch}.
let _packageCounter = 0;
async function makeCoursePackage() {
  _packageCounter += 1;
  const suffix = `${Date.now()}-${_packageCounter}-${Math.random().toString(36).slice(2, 8)}`;
  const batch = await Batch.create({
    batchCode: `BC${suffix}`.substring(0, 30).toUpperCase(),
    name: "Test Batch " + suffix,
  });
  const teacher = await User.create({
    name: "Test Teacher",
    email: `teacher-${suffix}@test.com`,
    password: "teacher123",
    role: "teacher",
    employeeId: `EMP-${suffix}`.substring(0, 30),
  });
  const course = await Course.create({
    courseName: "Test Course",
    courseCode: `TC-${suffix}`.substring(0, 30),
    batch: batch._id,
    teacher: teacher._id,
  });
  return { batch, course, teacher };
}

describe("LCS_ScheduledClass.assignedPlatform schema field", () => {
  it("defaults to 'any' when not specified at create", async () => {
    const { course, teacher } = await makeCoursePackage();
    const cls = await ScheduledClass.create({
      title: "Default platform test",
      course: course._id,
      teacher: teacher._id,
      roomNumber: "001",
      date: new Date(),
      startTime: "09:00",
      endTime: "10:00",
      // assignedPlatform intentionally omitted
    });
    expect(cls.assignedPlatform).toBe("any");
  });

  it("rejects unknown enum value at schema level", async () => {
    const { course, teacher } = await makeCoursePackage();
    await expect(
      ScheduledClass.create({
        title: "Bad platform",
        course: course._id,
        teacher: teacher._id,
        roomNumber: "001",
        date: new Date(),
        startTime: "09:00",
        endTime: "10:00",
        assignedPlatform: "linux", // not in enum
      })
    ).rejects.toThrow(/assignedPlatform/);
  });

  it("accepts each of windows / android / any", async () => {
    const { course, teacher } = await makeCoursePackage();
    for (const p of ["windows", "android", "any"]) {
      const cls = await ScheduledClass.create({
        title: `Platform ${p}`,
        course: course._id,
        teacher: teacher._id,
        roomNumber: "001",
        date: new Date(),
        startTime: "09:00",
        endTime: "10:00",
        assignedPlatform: p,
      });
      expect(cls.assignedPlatform).toBe(p);
    }
  });
});

describe("POST /api/classes — assignedPlatform handling", () => {
  it("persists assignedPlatform='windows' when client sends it", async () => {
    const { token } = await createAdmin();
    const { course, teacher } = await makeCoursePackage();

    const res = await request(app)
      .post("/api/classes")
      .set("Authorization", `Bearer ${token}`)
      .send({
        title: "Windows-tagged class",
        course: course._id.toString(),
        teacher: teacher._id.toString(),
        roomNumber: "001",
        date: new Date().toISOString(),
        startTime: "09:00",
        endTime: "10:00",
        assignedPlatform: "windows",
      })
      .expect(201);

    expect(res.body.assignedPlatform).toBe("windows");
  });

  it("falls back to 'any' when client sends a junk value (NOT silently storing bad data)", async () => {
    const { token } = await createAdmin();
    const { course, teacher } = await makeCoursePackage();

    const res = await request(app)
      .post("/api/classes")
      .set("Authorization", `Bearer ${token}`)
      .send({
        title: "Junk platform value",
        course: course._id.toString(),
        teacher: teacher._id.toString(),
        roomNumber: "001",
        date: new Date().toISOString(),
        startTime: "09:00",
        endTime: "10:00",
        assignedPlatform: "raspberry-pi",
      })
      .expect(201);

    // Controller-level validation falls back to "any" rather than letting
    // the bad value reach Mongoose (which would 400).
    expect(res.body.assignedPlatform).toBe("any");
  });

  it("defaults to 'any' when client omits the field (pre-platform-routing rows)", async () => {
    const { token } = await createAdmin();
    const { course, teacher } = await makeCoursePackage();
    const res = await request(app)
      .post("/api/classes")
      .set("Authorization", `Bearer ${token}`)
      .send({
        title: "No platform",
        course: course._id.toString(),
        teacher: teacher._id.toString(),
        roomNumber: "001",
        date: new Date().toISOString(),
        startTime: "11:00",
        endTime: "12:00",
      })
      .expect(201);
    expect(res.body.assignedPlatform).toBe("any");
  });
});

describe("POST /api/classes/bulk-create — assignedPlatform handling", () => {
  it("applies body.assignedPlatform to every row that doesn't override it", async () => {
    const { token } = await createAdmin();
    const { course, teacher } = await makeCoursePackage();

    await request(app)
      .post("/api/classes/bulk-create")
      .set("Authorization", `Bearer ${token}`)
      .send({
        rows: [
          {
            title: "Bulk row 1",
            courseCode: course.courseCode,
            courseName: course.courseName,
            teacherName: teacher.name,
            roomNumber: "001",
            date: new Date().toISOString().split("T")[0],
            startTime: "13:00",
            endTime: "14:00",
            rowNum: 1,
          },
          {
            title: "Bulk row 2",
            courseCode: course.courseCode,
            courseName: course.courseName,
            teacherName: teacher.name,
            roomNumber: "001",
            date: new Date().toISOString().split("T")[0],
            startTime: "14:00",
            endTime: "15:00",
            rowNum: 2,
          },
        ],
        assignedPlatform: "windows", // applies to all rows
      })
      .expect(200);

    const all = await ScheduledClass.find({ title: /Bulk row/ }).sort({ title: 1 });
    expect(all).toHaveLength(2);
    expect(all[0].assignedPlatform).toBe("windows");
    expect(all[1].assignedPlatform).toBe("windows");
  });

  it("row-level assignedPlatform overrides body-level default", async () => {
    const { token } = await createAdmin();
    const { course, teacher } = await makeCoursePackage();

    await request(app)
      .post("/api/classes/bulk-create")
      .set("Authorization", `Bearer ${token}`)
      .send({
        rows: [
          {
            title: "Bulk override 1",
            courseCode: course.courseCode,
            courseName: course.courseName,
            teacherName: teacher.name,
            roomNumber: "001",
            date: new Date().toISOString().split("T")[0],
            startTime: "16:00",
            endTime: "17:00",
            rowNum: 1,
            assignedPlatform: "android", // overrides body default
          },
        ],
        assignedPlatform: "windows",
      })
      .expect(200);

    const cls = await ScheduledClass.findOne({ title: "Bulk override 1" });
    expect(cls.assignedPlatform).toBe("android");
  });
});

describe("PUT /api/classes/:id — assignedPlatform on update", () => {
  it("updates assignedPlatform via PUT (field is in update whitelist)", async () => {
    const { token } = await createAdmin();
    const { course, teacher } = await makeCoursePackage();
    const cls = await ScheduledClass.create({
      title: "Pre-tag",
      course: course._id,
      teacher: teacher._id,
      roomNumber: "001",
      date: new Date(),
      startTime: "18:00",
      endTime: "19:00",
      assignedPlatform: "any",
    });

    const res = await request(app)
      .put(`/api/classes/${cls._id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ assignedPlatform: "windows" })
      .expect(200);

    expect(res.body.assignedPlatform).toBe("windows");
    const fresh = await ScheduledClass.findById(cls._id);
    expect(fresh.assignedPlatform).toBe("windows");
  });
});
