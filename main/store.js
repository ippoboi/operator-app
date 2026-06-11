"use strict";
/* userData persistence: encrypted tokens (safeStorage) + sync state JSON. */
const { app, safeStorage } = require("electron");
const fs = require("fs");
const path = require("path");

const FILE = () => path.join(app.getPath("userData"), "sync-state.json");

const EMPTY = {
  credentials: {},
  google: { tokensEnc: null, calendarId: null, eventMap: {}, lastSync: null, lastError: null },
  strava: { tokensEnc: null, lastFetch: null, lastError: null },
};

function load() {
  try {
    const disk = JSON.parse(fs.readFileSync(FILE(), "utf8"));
    const d = JSON.parse(JSON.stringify(EMPTY));
    Object.assign(d.credentials, disk.credentials);
    Object.assign(d.google, disk.google);
    Object.assign(d.strava, disk.strava);
    return d;
  } catch (e) { return JSON.parse(JSON.stringify(EMPTY)); }
}
function save(data) { fs.writeFileSync(FILE(), JSON.stringify(data, null, 2)); }
function update(fn) { const d = load(); fn(d); save(d); return d; }

function encryptTokens(obj) {
  const json = JSON.stringify(obj);
  if (safeStorage.isEncryptionAvailable()) return "enc:" + safeStorage.encryptString(json).toString("base64");
  return "raw:" + Buffer.from(json).toString("base64"); // no-keychain fallback; file stays in userData
}
function decryptTokens(str) {
  if (!str) return null;
  try {
    if (str.startsWith("enc:")) return JSON.parse(safeStorage.decryptString(Buffer.from(str.slice(4), "base64")));
    return JSON.parse(Buffer.from(str.slice(4), "base64").toString("utf8"));
  } catch (e) { return null; }
}

module.exports = { load, save, update, encryptTokens, decryptTokens };
