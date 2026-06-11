# Operator — Project Context

A local, single-user desktop/web app that runs a **Tactical Barbell "Operator"** strength block: you enter a training max per lift once, and it computes every session's working weights in kg, tracks progress, and exports a calendar. No backend, no accounts, no network — all state lives on the user's machine.

It ships two ways from one codebase: a self-contained `index.html` (open in any browser) and an Electron wrapper packaged into a native app.

---

## Why it exists

- **Kill the recurring math.** Before each session you'd otherwise compute "week 2, front squat is 80% of an 85 kg TM = 67.5 kg" by hand or in a spreadsheet. The app just hands you the number.
- **Local-first / data sovereignty.** An earlier plan to auto-pull sessions from the Strava and WHOOP APIs was dropped: neither service exposes structured strength data (sets/reps/weight) — Strava only returns a free-text activity, WHOOP only strain/recovery. So the app owns its data outright and never phones home. Calendar sharing is one-way via `.ics` export.
- **Minimal, fast, durable.** Vanilla JS, zero runtime dependencies, hand-rolled SVG charts. It should still open and work in ten years.

---

## The training model it encodes

**Tactical Barbell — Operator template, 6-week peaking block.** The percentage wave (`CYCLE` in the code) is:

| Week | % of TM | Scheme         |
| ---- | ------- | -------------- |
| 1    | 70%     | 3×5            |
| 2    | 80%     | 3×5            |
| 3    | 90%     | 3×3            |
| 4    | 75%     | 3×5 _(deload)_ |
| 5    | 85%     | 3×3            |
| 6    | 95%     | 3×1            |

Core rules baked into the logic:

- **Training Max (TM)** is the anchor (≈ 90% of estimated 1RM). All weights are `round(pct × TM, increment)`. The user is expected to _not_ test a true 1RM — instead set a comfortable week-1 weight as the 70% and back-calculate (`TM = weight ÷ 0.70`).
- **Block progression.** Nothing changes inside a block. Between blocks the TM steps up: **+5 kg lower-body, +2.5 kg upper-body** (the metric form of TB's +10 lb / +5 lb rule). `effectiveTM(lift, week) = tm + blockStep × floor((week-1)/6)`. Weeks past 6 are therefore _projections_ (rendered as a dashed chart line). The honest alternative is retesting every 6–12 weeks; the increment is a plan, not a measurement.
- **Cluster + rotation.** Each lift is either `core` (every session) or `rotating` (shares one slot). Rotating lifts are assigned per weekday via `rotSchedule` so the weekly pattern is fixed and identical every week (e.g. Mon Pull-up · Wed Deadlift · Fri Pull-up = 1× DL, 2× PU). A single day can be overridden on the Today screen (`sessionPick`).
- **Readiness gating.** A per-session green/amber/red tap surfaces a coaching nudge (green = execute; amber = leave 1–2 in reserve; red = cap or skip). It's advisory, not enforced.

### Why the default cluster is what it is

The four default lifts reflect the intended user's constraints (a hybrid runner, joint-first):

- **Front Squat** — quad-dominant, upright, lower spinal load, and hamstring-sparing (relevant to a biceps-femoris issue being monitored).
- **Sumo Deadlift** — chosen over conventional/trap-bar (no trap bar available); more upright, less lumbar shear.
- **DB Bench Press** — neutral-grip, shoulder-friendly (a supraspinatus issue excludes barbell overhead press; there is intentionally **no OHP** in the cluster). DB bench is shown as a %-of-TM _guide_ and meant to be run by RPE, since dumbbells don't take clean percentages — it's flagged "round to your DBs."
- **Weighted Pull-up** — runs as **bodyweight** until a TM is set; added load = `target − bodyweight`.

These are defaults, not constraints — every lift is renamable/toggleable and the schedule is editable in Setup.

---

## Architecture

- **`index.html`** — the entire app: markup, CSS, and logic in one file, plain `<script>`, no framework, no build step. Charts are hand-drawn SVG. Persistence is `localStorage` (key `tb-operator-v1`). Works opened directly via `file://`.
- **`main.js`** — Electron main process; opens `index.html` in a `BrowserWindow` (hidden-inset title bar, inset traffic lights on macOS).
- **`package.json`** — npm scripts (`start`, `dist`) and the electron-builder config (mac `.dmg` / win `.exe` / linux AppImage; `mac.identity: null` so unsigned personal builds succeed).
- **`build/`** — generated app icons (`icon.icns`, `icon.ico`, `icon.png`).
- **`assets/logo.svg`** — source barbell logo (vector), the basis for the icons.

### Persisted state shape

```js
{
  theme: "dark" | "light",
  displayName: string,
  startDate: "YYYY-MM-DD",        // week-1 Monday
  weeks: number,                  // program length; the 6-week block repeats
  increment: number,              // kg plate rounding (default 2.5)
  bodyweight: number | null,      // for pull-up added load
  sessionTime: "HH:MM",
  durationMin: number,            // for .ics events
  liftDays: number[],             // weekdays, 0=Sun .. 6=Sat (default [1,3,5])
  lifts: [{
    id, name,
    type: "barbell" | "db" | "pullup",
    enabled: boolean,
    tm: number | null,            // training max (kg); null = bodyweight/unset
    role: "core" | "rotating",
    blockStep: number             // kg added to TM per 6-week block
  }],
  rotSchedule: { [weekday]: liftId },  // which rotating lift on each day
  sessionPick: { [dateStr]: liftId },  // one-off override of the rotating slot
  status:    { [dateStr]: "done" | "skipped" },
  readiness: { [dateStr]: "green" | "amber" | "red" }
}
```

Sessions are derived (never stored): `buildSessions()` walks `weeks` from `startDate`, places lifts on `liftDays`, and computes loads on demand.

---

## Design language

Lean, instrument-panel minimalism. Near-black charcoal (`#0b0c0e`), off-white text, a single periwinkle-blue accent (`#6b8afd`); green/red used only for done/skipped status. Sidebar navigation (Today / Program / Progress / Setup), monospace tabular numerals for all weights (the weight is the hero), system fonts only (offline-safe), generous whitespace, dark/light toggle. No marketing chrome.

---

## Scope

**In v1:** plan + compute + status + calendar export + progression chart, Operator template only, kg only.

**Deliberately out (potential future work):**

- Quick-logging _actual_ lifted weights/reps (v1 is plan + done/skip, not a training log).
- Strava/WHOOP API integration (dropped — see "Why it exists"). A manual readiness tap stands in for WHOOP gating and survives dropping the band.
- The running / LSS side of the Tactical Barbell Green Protocol (this app is the lifting half only).
- Other TB templates (Op/Pro, Op/DUP, Fighter, etc.).

---

## Conventions for anyone editing this

- Keep it **single-file and dependency-free** (`index.html`). No bundler, no npm runtime deps — Electron is the only dev dependency.
- **Local-first.** No network calls, no analytics, no storage outside `localStorage` + user-initiated JSON backup and `.ics` export.
- **kg throughout.** Round to the configured plate `increment`.
- Charts are plain SVG strings built in JS — no chart library.
- Run/build instructions live in `README.md`.
