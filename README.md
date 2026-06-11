# Operator

A local Tactical Barbell **Operator** companion. Set a training max per lift once; it hands you each session's weights in kg, tracks the 6-week wave (with block projection), rotates lifts on a fixed weekly pattern, and exports an `.ics` to Apple/Google Calendar. No APIs, no accounts, no network — your data stays on your machine.

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

## Files
- `index.html` — the whole app (UI + logic, self-contained)
- `main.js` — Electron window
- `build/icon.icns` · `icon.ico` · `icon.png` — the barbell app icon
- `assets/logo.svg` — source logo (vector)

## Notes
- Data is stored per-app. Moving from the browser version to the built app? Export **Setup → Back up data** (JSON) and **Restore** it in the new app.
- DB Bench is a %-of-TM guide (round to your dumbbells). Pull-ups are bodyweight until you set a TM.
