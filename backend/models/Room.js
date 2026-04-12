const mongoose = require("mongoose");

const roomSchema = new mongoose.Schema(
  {
    campus: { type: String, required: true },
    block: { type: String, required: true },
    floor: { type: String },
    roomNumber: { type: String, required: true },   // space identifier e.g. "A-201"
    roomName: { type: String },                     // display name e.g. "Conference Hall 1"
    spaceType: {
      type: String,
      enum: ["room", "conference_hall", "auditorium"],
      default: "room",
    },
    capacity: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

// Unique per campus+block+roomNumber
roomSchema.index({ campus: 1, block: 1, roomNumber: 1 }, { unique: true });

module.exports = mongoose.model("LCS_Room", roomSchema);
