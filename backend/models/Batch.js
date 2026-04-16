const mongoose = require("mongoose");

const batchSchema = new mongoose.Schema(
  {
    batchCode: { type: String, required: true, unique: true, uppercase: true, trim: true },
    name: { type: String, required: true },
    description: { type: String, default: "" },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("LCS_Batch", batchSchema);
