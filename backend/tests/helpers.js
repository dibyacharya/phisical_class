/**
 * Test helpers — creates test users, devices, classes, etc.
 */
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const ClassroomDevice = require("../models/ClassroomDevice");
const ScheduledClass = require("../models/ScheduledClass");
const License = require("../models/License");
const Course = require("../models/Course");
const mongoose = require("mongoose");

/**
 * Create an admin user and return { user, token }
 */
async function createAdmin(overrides = {}) {
  const user = await User.create({
    name: "Test Admin",
    email: overrides.email || "admin@test.com",
    password: "password123",
    role: "admin",
    ...overrides,
  });
  const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: "1h" });
  return { user, token };
}

/**
 * Create a student user and return { user, token }
 */
async function createStudent(overrides = {}) {
  const user = await User.create({
    name: "Test Student",
    email: overrides.email || "student@test.com",
    password: "password123",
    role: "student",
    rollNumber: "STU001",
    ...overrides,
  });
  const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: "1h" });
  return { user, token };
}

/**
 * Create a device directly in DB. Returns the device document.
 */
async function createDevice(overrides = {}) {
  return ClassroomDevice.create({
    name: "Test Smart TV",
    roomNumber: "R101",
    roomName: "Room 101",
    macAddress: overrides.macAddress || "AA:BB:CC:DD:EE:FF",
    deviceType: "android",
    deviceModel: "Amlogic S905X",
    isActive: true,
    ...overrides,
  });
}

/**
 * Create an active license. Returns the license document.
 */
async function createLicense(overrides = {}) {
  return License.create({
    label: "Test License",
    isActive: true,
    ...overrides,
  });
}

/**
 * Create a scheduled class for today. Returns the class document.
 */
async function createScheduledClass(overrides = {}) {
  // Need a course and teacher
  const courseId = overrides.course || new mongoose.Types.ObjectId();
  const teacherId = overrides.teacher || new mongoose.Types.ObjectId();

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return ScheduledClass.create({
    title: "Test Lecture",
    course: courseId,
    teacher: teacherId,
    courseName: "Test Course",
    courseCode: "TC101",
    teacherName: "Dr. Test",
    roomNumber: overrides.roomNumber || "R101",
    date: today,
    startTime: overrides.startTime || "09:00",
    endTime: overrides.endTime || "10:00",
    status: "scheduled",
    ...overrides,
  });
}

module.exports = {
  createAdmin,
  createStudent,
  createDevice,
  createLicense,
  createScheduledClass,
};
