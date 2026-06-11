# Operator — Project Context

A local, single-user desktop/web app that runs a **Tactical Barbell "Operator"** strength block: you enter a training max per lift once, and it computes every session's working weights in kg, tracks progress, mirrors the plan live into a dedicated "Operator" Google Calendar, and marks sessions done from Strava activities. No backend, no accounts — all state lives on the user's machine; the Electron main process is the only thing that talks to the network (Google + Strava, with the owner's own API credentials).

It ships two ways from one codebase: a self-contained `index.html` (open in any browser) and an Electron wrapper packaged into a native app.

---

## Why it exists

- **Kill the recurring math.** Before each session you'd otherwise compute "week 2, front squat is 80% of an 85 kg TM = 67.5 kg" by hand or in a spreadsheet. The app just hands you the number.
- **Local-first / data sovereignty.** The app owns its data outright. Strava integration is read-only and display-verbatim (Strava has no structured strength data — the owner logs lifts in the activity description, shown unparsed next to the plan). Calendar sharing is a one-way push into a dedicated "Operator" Google calendar; the user's own calendars are never read or modified.
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

### Capacity (Green Protocol) — second template

Selectable in Setup. 12 weeks combining the lifting above with LSS running: lifting weeks 1–3/5–7/9–11 at 70/80/90% (3×5 / 3×5 / 3×3); weeks 4 & 8 are **optional deloads at 40% TM, 2×5** ("do not add plates"); week 12 has **no lifting** — a taper of 30′ runs ending in the **6-Mile Test** (< 60:00). The TM steps every **4** weeks instead of 6. Runs land on `runDays` (default Tue/Thu/Sat) per the book table (30–60′ → 60–90′ → 60–120′/120′+, deload weeks 3×30′), editable per week as sparse overrides, and any run day can be swapped to **bike** with one tap (`sessionSwap`).

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

- **`index.html`** — markup, CSS, and UI logic; pure program math lives in **`js/program.js`** (loaded via plain `<script>`, also `require()`-able by `node --test` — see `tests/`). No framework, no build step. Charts are hand-drawn SVG. Persistence is `localStorage` (key `tb-operator-v2`; v1 auto-migrates on first load, the old key is left as a backup). Works opened directly via `file://` — there `window.api` is absent, sync UI hides, everything else works.
- **`main.js`** — Electron entry: window + IPC wiring for the sync backend.
- **`preload.js`** — contextBridge exposing **`window.api`**: `getSyncStatus / setCredentials / connectGoogle / connectStrava / disconnect / pushPlan / syncStrava`. This seam is deliberately API-shaped (plain JSON in/out): **V2 promotes `main/` to a real backend (auth + DB, Docker on a home server) and these calls become HTTP endpoints** — keep it promotable.
- **`main/`** — the integration "backend", bare `fetch`, no SDKs:
  - `store.js` — tokens encrypted via `safeStorage` + sync-state JSON (`sync-state.json` in `userData`: credentials, GCal `eventMap`, lastSync/lastError).
  - `oauth.js` — system-browser OAuth, throwaway `http://127.0.0.1:<port>/callback` loopback, PKCE for Google; silent refresh.
  - `gcal.js` — calendar mirror: pure `diffPlan` against the stored `eventMap` (keys `kind:dateStr`), insert/PUT/delete deltas, self-heals hand-deleted events.
  - `strava.js` — pure `matchActivities(plan, activities)` verdicts + activity fetch/hydrate. Pure parts of both are `node --test`ed like `js/program.js`.
- Renderer pushes a debounced `Program.calendarSnapshot(state)` on every save; planned sessions are all-day events (✓/⨯ prefixes), Strava-confirmed sessions upgrade to timed events at the real start/duration.
- **`package.json`** — npm scripts (`start`, `test`, `dist`) and the electron-builder config (mac `.dmg` / win `.exe` / linux AppImage; `mac.identity: null` so unsigned personal builds succeed).
- **`build/`** — generated app icons (`icon.icns`, `icon.ico`, `icon.png`).
- **`assets/logo.svg`** — source barbell logo (vector), the basis for the icons.

### Persisted state shape

```js
{
  theme: "dark" | "light",
  template: "operator6" | "capacity12",
  runDays: number[],              // LSS days (Capacity), 0=Sun .. 6=Sat (default [2,4,6]); kept disjoint from liftDays
  enduranceOverrides: { [week]: { [slot]: runSpec } },  // sparse edits over the book table
  sessionSwap: { [dateStr]: "bike" },  // run→bike swap per date
  activities: { [dateStr]: { id, sport, startISO, durationSec, ... } },  // matched Strava activity per date
  dismissedActivities: [],        // Strava ids marked "not training"
  displayName: string,
  startDate: "YYYY-MM-DD",        // week-1 Monday
  weeks: number,                  // program length; the 6-week block repeats
  increment: number,              // kg plate rounding (default 2.5)
  bodyweight: number | null,      // for pull-up added load
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

Lean, instrument-panel minimalism. Near-black charcoal (`#0b0c0e`), off-white text, a periwinkle-blue accent (`#6b8afd`) plus teal for endurance and amber for deload/test; green/red used only for done/skipped status. Sidebar navigation (Today / Calendar / Progress / Setup — Calendar is a month grid with session chips and an inline detail panel; Setup is split into inline tabs), monospace tabular numerals for all weights (the weight is the hero), system fonts only (offline-safe), generous whitespace, dark/light toggle. No marketing chrome.

---

## Scope

**In v1 (complete):** plan + compute + status + progression chart, Operator and Capacity (Green Protocol) templates, kg only, live Google Calendar mirror, Strava auto-completion with review queue and plan-vs-actual.

**Deliberately out (potential future work):**

- Quick-logging _actual_ lifted weights/reps in-app (Strava descriptions are shown verbatim, never parsed).
- WHOOP — a manual readiness tap stands in for WHOOP gating.
- Other TB templates beyond Operator and Capacity (Op/Pro, Op/DUP, Fighter, etc.).
- V2 trajectory: real backend (auth + DB, Docker on a home server) + mobile app — `main/` and the `window.api` seam are what get promoted.

---

## Conventions for anyone editing this

- Keep it **a handful of plain files**, dependency-free. No bundler, no npm runtime deps — Electron is the only dev dependency; Google/Strava are called with bare `fetch` from the main process.
- **Local-first.** Network calls only from `main/` to Google/Strava with the owner's own credentials; no analytics; storage is `localStorage` + `userData` sync state + user-initiated JSON backup.
- **kg throughout.** Round to the configured plate `increment`.
- Charts are plain SVG strings built in JS — no chart library.
- Run/build instructions live in `README.md`.
