const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");

/* Two instances share sync-state.json and race the GCal push: one writes the
   eventMap while the other rewrites the events, leaving the map claiming
   content Google no longer holds. Refuse to run twice. */
if (!app.requestSingleInstanceLock()) app.quit();
app.on("second-instance", () => {
  const win = BrowserWindow.getAllWindows()[0];
  if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
});
const store = require("./main/store.js");
const oauth = require("./main/oauth.js");
const gcal = require("./main/gcal.js");
const strava = require("./main/strava.js");

function createWindow() {
  const win = new BrowserWindow({
    width: 1140,
    height: 780,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: "#0b0c0e",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 14, y: 16 },
    webPreferences: { contextIsolation: true, preload: path.join(__dirname, "preload.js") },
  });
  win.loadFile("index.html");
}

function statusOf() {
  const d = store.load();
  return {
    google: {
      connected: !!d.google.tokensEnc,
      hasCredentials: !!(d.credentials.google && d.credentials.google.clientId),
      calendarId: d.google.calendarId, lastSync: d.google.lastSync, lastError: d.google.lastError,
    },
    strava: {
      connected: !!d.strava.tokensEnc,
      hasCredentials: !!(d.credentials.strava && d.credentials.strava.clientId),
      lastFetch: d.strava.lastFetch, lastError: d.strava.lastError,
    },
  };
}

async function freshToken(provider) {
  const d = store.load();
  const tokens = store.decryptTokens(d[provider].tokensEnc);
  if (!tokens) throw new Error(provider + " is not connected");
  if (tokens.expiresAt && Date.now() < tokens.expiresAt) return tokens.access_token;
  const creds = d.credentials[provider];
  const next = provider === "google"
    ? await oauth.refreshGoogle(creds, tokens.refresh_token)
    : await oauth.refreshStrava(creds, tokens.refresh_token);
  store.update(s => { s[provider].tokensEnc = store.encryptTokens(next); });
  return next.access_token;
}

/* Pushes are strictly serialized: concurrent runs once raced ensureCalendar and
   created TWO "Operator" calendars (calendarId was only persisted after the slow
   insert phase). queuedSnapshot holds the newest snapshot — waiting either
   because a push is in flight or because the last one failed (retry timer). */
let queuedSnapshot = null;
let pushing = false;

async function doPush(snapshot) {
  queuedSnapshot = snapshot;
  if (pushing) return; // the active run picks it up after its current pass
  pushing = true;
  try {
    while (queuedSnapshot) {
      const snap = queuedSnapshot;
      queuedSnapshot = null;
      const d = store.load();
      if (!d.google.tokensEnc) return;
      try {
        const token = await freshToken("google");
        const res = await gcal.syncPlan(snap, {
          token, calendarId: d.google.calendarId, eventMap: d.google.eventMap,
          /* persist the calendar id the moment it's known, BEFORE the insert phase */
          onCalendar: id => store.update(s => { s.google.calendarId = id; }),
        });
        store.update(s => {
          s.google.calendarId = res.calendarId;
          s.google.eventMap = res.eventMap;
          s.google.lastSync = new Date().toISOString();
          s.google.lastError = null;
        });
      } catch (e) {
        if (queuedSnapshot == null) queuedSnapshot = snap; // keep newest for the retry timer
        store.update(s => { s.google.lastError = String(e.message || e); });
        return;
      }
    }
  } finally { pushing = false; }
}

app.whenReady().then(() => {
  ipcMain.handle("sync:status", () => statusOf());

  ipcMain.handle("sync:set-credentials", (e, provider, creds) => {
    if (provider !== "google" && provider !== "strava") throw new Error("Unknown provider");
    store.update(s => {
      s.credentials[provider] = {
        clientId: String(creds.clientId || "").trim(),
        clientSecret: String(creds.clientSecret || "").trim(),
      };
    });
    return statusOf();
  });

  ipcMain.handle("sync:connect", async (e, provider) => {
    const d = store.load();
    const creds = d.credentials[provider];
    if (!creds || !creds.clientId || !creds.clientSecret) throw new Error("Enter the " + provider + " API credentials first");
    const tokens = provider === "google" ? await oauth.connectGoogle(creds) : await oauth.connectStrava(creds);
    store.update(s => { s[provider].tokensEnc = store.encryptTokens(tokens); s[provider].lastError = null; });
    return statusOf();
  });

  ipcMain.handle("sync:disconnect", (e, provider) => {
    store.update(s => {
      s[provider].tokensEnc = null;
      if (provider === "google") { s.google.eventMap = {}; s.google.calendarId = null; }
    });
    if (provider === "google") queuedSnapshot = null;
    return statusOf();
  });

  ipcMain.handle("sync:push-plan", async (e, snapshot) => { await doPush(snapshot); return statusOf(); });

  ipcMain.handle("sync:strava", async (e, plan) => {
    try {
      const token = await freshToken("strava");
      const after = Math.floor(Date.now() / 1000) - 14 * 86400;
      const acts = await strava.fetchActivities(token, after);
      const result = strava.matchActivities(plan.sessions, acts,
        { dismissed: plan.dismissed, today: plan.today, windowStart: plan.windowStart, linkWindow: plan.linkWindow });
      await strava.hydrateDescriptions(result, token);
      store.update(s => { s.strava.lastFetch = new Date().toISOString(); s.strava.lastError = null; });
      return result;
    } catch (err) {
      store.update(s => { s.strava.lastError = String(err.message || err); });
      throw err;
    }
  });

  setInterval(() => { if (queuedSnapshot && !pushing) doPush(queuedSnapshot); }, 60 * 1000);

  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
