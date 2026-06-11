# Operator

A local Tactical Barbell companion. Set a training max per lift once; it hands you each session's weights in kg, rotates lifts on a fixed weekly pattern, mirrors the plan live into a dedicated **"Operator" Google Calendar**, and marks sessions done from your **Strava** activities (with the activity description shown next to the plan). Two templates: **Operator** (6-week peaking wave with block projection) and **Capacity** (Green Protocol 12 weeks: lifting + LSS runs, 40% deloads on weeks 4/8, week-12 taper ending in the 6-Mile Test, run→bike swap per day). No accounts, no server — your data stays on your machine; the desktop app talks only to Google and Strava with your own API credentials.

## Build the native app

Requires **Node.js v18+**.

```bash
cd operator-app
npm install        # downloads Electron + electron-builder (first run only)
npm run dist       # builds the installer into ./dist
```

Outputs land in `dist/`:
- **macOS** → `Operator-1.0.0.dmg` (+ `Operator.app`). Open the dmg, drag to Applications.
- **Windows** → `Operator Setup 1.0.0.exe`
- **Linux** → `Operator-1.0.0.AppImage`

Build only one platform with `npm run dist:mac` / `dist:win` / `dist:linux` (cross-building to other OSes may need extra tooling — build on the target OS for best results).

**macOS first launch:** the app is unsigned, so you'll see "unidentified developer." Right-click the app → **Open** → **Open** (once). Or just `npm start` to run it without packaging.

## Run without building
- `npm start` — launches the Electron window directly.
- Double-click `index.html` — runs standalone in any browser, no install.

## Tests
- `npm test` — runs the program-logic suite (`node --test`, no dependencies).

## Files
- `index.html` — UI (markup + CSS + render logic)
- `js/program.js` — pure program math (templates, sessions, loads, calendar snapshot); also what the tests import
- `main.js` — Electron entry: window + IPC wiring
- `preload.js` — `window.api` bridge (the API-shaped seam the renderer talks to)
- `main/store.js` — encrypted tokens (safeStorage) + sync state in `userData`
- `main/oauth.js` — system-browser OAuth with a 127.0.0.1 loopback listener
- `main/gcal.js` — Google Calendar mirror (pure diff engine + apply)
- `main/strava.js` — Strava fetch + pure activity↔session matcher
- `tests/` — `node --test` suites for program math, snapshot, matcher, diff
- `build/icon.icns` · `icon.ico` · `icon.png` — the barbell app icon
- `assets/logo.svg` — source logo (vector)

## Connecting Google Calendar & Strava (desktop app only)

Both integrations use your own API credentials, entered once in **Setup → Connections** and stored in the app's `userData` directory (tokens encrypted with the OS keychain via safeStorage). Nothing is ever committed or sent anywhere except Google/Strava.

**Google** (one-time):
1. [console.cloud.google.com](https://console.cloud.google.com) → create a project → enable the **Google Calendar API**.
2. OAuth consent screen → External → add yourself as a test user.
3. Credentials → Create credentials → OAuth client ID → **Desktop app**. Copy the client ID + secret into Setup → Connections.
4. Connect → your browser opens → approve. The app creates (or reuses) a calendar named **"Operator"** and mirrors every planned session into it as all-day events. It never touches any other calendar.

**Strava** (one-time):
1. [strava.com/settings/api](https://www.strava.com/settings/api) → create an application. Set **Authorization Callback Domain** to `127.0.0.1`.
2. Copy the client ID + secret into Setup → Connections, Connect, approve in the browser.
3. On every launch (and via ↻) the app fetches your last ~14 days of activities, marks matching sessions done, and shows the activity description next to the plan. Log your lifts in the Strava activity description to see them in the app.

### Sync smoke checklist (manual)
- [ ] Connect Google → "Operator" calendar appears with all-day events for every planned session.
- [ ] Edit a TM / swap a day to bike / mark done → event title updates within ~2 s (✓ prefix on done).
- [ ] Delete an event by hand in Google Calendar → it reappears on the next push (self-heal).
- [ ] Record a Strava activity on a planned day → relaunch (or ↻) → session auto-marked done, calendar event becomes a timed event at the real start/duration, plan-vs-actual shows the description.
- [ ] Ride on an unswapped run day → review queue offers "Swap to bike & match".
- [ ] Disconnect → reconnect works; quit offline → app fully usable, push retries when back online.
- [ ] Open `index.html` via `file://` → Connections says desktop-only, everything else works.

## Notes
- Data is stored per-app. Moving from the browser version to the built app? Export **Setup → Back up data** (JSON) and **Restore** it in the new app.
- DB Bench is a %-of-TM guide (round to your dumbbells). Pull-ups are bodyweight until you set a TM.
