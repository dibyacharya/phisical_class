const mongoose = require("mongoose");
const crypto = require("crypto");

const classroomDeviceSchema = new mongoose.Schema(
  {
    deviceId: {
      type: String,
      unique: true,
      default: () => "dev_" + crypto.randomBytes(8).toString("hex"),
    },
    name: { type: String, required: true },
    roomId: { type: String },
    roomName: { type: String },
    roomNumber: { type: String },
    building: { type: String },
    floor: { type: String },
    ipAddress: { type: String },
    deviceType: { type: String, enum: ["pc", "android"], default: "android" },
    deviceModel: { type: String },
    osVersion: { type: String },
    macAddress: { type: String },
    authToken: {
      type: String,
      default: () => crypto.randomBytes(32).toString("hex"),
    },
    isOnline: { type: Boolean, default: false },
    lastHeartbeat: { type: Date },
    isRecording: { type: Boolean, default: false },
    currentMeetingId: { type: String },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("LCS_ClassroomDevice", classroomDeviceSchema);
