/**
 * store.js — Persistent config storage (mirrors Android PreferencesManager)
 * Uses electron-store (encrypts sensitive values at rest)
 */
const Store = require("electron-store");

const store = new Store({
  name: "educampus-recorder",
  encryptionKey: "educampus-recorder-2024-secure-key",
  schema: {
    isSetupComplete: { type: "boolean", default: false },
    apiUrl:          { type: "string",  default: "http://localhost:4000/api" },
    deviceId:        { type: "string",  default: "" },
    authToken:       { type: "string",  default: "" },
    campus:          { type: "string",  default: "" },
    block:           { type: "string",  default: "" },
    floor:           { type: "string",  default: "" },
    roomId:          { type: "string",  default: "" },
    roomName:        { type: "string",  default: "" },
    roomNumber:      { type: "string",  default: "" },
  },
});

module.exports = store;
