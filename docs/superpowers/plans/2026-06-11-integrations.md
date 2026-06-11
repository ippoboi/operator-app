# Integrations (Plan 3: OAuth + Google Calendar mirror + Strava sync) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (owner's explicit preference — do NOT use subagent-driven-development). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Electron main process becomes the app's "backend": loopback OAuth for Google + Strava, a live one-way Google Calendar mirror of the plan, and Strava-driven completion tracking with a review queue and plan-vs-actual display.

**Architecture:** Renderer talks only to `window.api.*` (API-shaped IPC seam, promotable to a real backend in V2). New `main/` modules: `store.js` (safeStorage tokens + sync-state JSON in userData), `oauth.js` (system browser + 127.0.0.1 loopback), `gcal.js` (pure diff engine + fetch-based apply), `strava.js` (pure matcher + fetch). Pure parts are `node --test`-able with zero deps, like `js/program.js`. The GCal event snapshot is built renderer-side by a new pure `Program.calendarSnapshot(state)` so program math never leaks into main.

**Tech Stack:** Vanilla JS, Electron 31, Node 24, bare `fetch` (no SDKs), `node --test`, pnpm. No new dependencies.

**Constraints from the working session (do not re-litigate):**
- Inline execution, tests + parse-check as the gate, commit per task, feature branch off `main`.
- Design system frozen: existing CSS vars/classes; `--teal` endurance, `--amber` deload/test only. Connections UI looks like existing Setup fields/buttons.
- Per-session state stays keyed by bare `dateStr` (matcher is kind-aware; do NOT introduce `kind:dateStr` state keys). GCal `eventMap` keys ARE `kind:dateStr` — that's main-side internal and safe.
- `main/gcal.js` and `main/strava.js` must NOT `require("electron")` or `require("./store.js")` at top level — deps are injected from root `main.js` so tests can `require()` them.
- Parse-check command for the inline script:
  `node -e "const html=require('fs').readFileSync('index.html','utf8');const m=html.match(/<script>([\s\S]*)<\/script>/);new Function(m[1]);console.log('parses OK')"`

---

### Task 0: Feature branch

- [x] **Step 0.1:** `git checkout -b feat/integrations` (from clean `main`). No commit.

---

### Task 1: Drop `sessionTime`/`durationMin` from program state

**Files:**
- Modify: `js/program.js` (defaults, migrateV1)
- Test: `tests/program.test.js` (append)

- [x] **Step 1.1: Confirm no existing test references them**

Run: `grep -n "sessionTime\|durationMin" tests/program.test.js` — Expected: no matches (if any, update those assertions in this task).

- [x] **Step 1.2: Write the failing test** (append to `tests/program.test.js`)

```js
test("v2 state has no sessionTime/durationMin; migrateV1 drops them", () => {
  const d = Program.defaults();
  assert.equal("sessionTime" in d, false);
  assert.equal("durationMin" in d, false);
  const m = Program.migrateV1({ sessionTime: "17:30", durationMin: 75, displayName: "X" });
  assert.equal("sessionTime" in m, false);
  assert.equal("durationMin" in m, false);
  assert.equal(m.displayName, "X");
});
```

- [x] **Step 1.3:** Run `pnpm test` — Expected: FAIL (defaults still carry both keys).

- [x] **Step 1.4: Implement.** In `js/program.js` `defaults()`, delete `sessionTime: "17:30", durationMin: 75,`. In `migrateV1`, drop the keys the old state carries:

```js
  function migrateV1(old) {
    const s = Object.assign(defaults(), old, {
      template: "operator6",
      runDays: [2, 4, 6],
      enduranceOverrides: {}, sessionSwap: {},
      activities: {}, dismissedActivities: [],
    });
    delete s.sessionTime; delete s.durationMin;
    return s;
  }
```

- [x] **Step 1.5:** Run `pnpm test` — Expected: 36 passing. (index.html still reads `state.sessionTime` in the ICS code — that's removed in Task 11; `Object.assign(defaults(), saved)` keeps old keys for now, harmless.)

- [x] **Step 1.6:** Commit: `git add -A && git commit -m "feat: drop sessionTime/durationMin from program state"`

---

### Task 2: `Program.calendarSnapshot(state)` — pure GCal event snapshot

**Files:**
- Modify: `js/program.js` (new functions + exports)
- Test: `tests/snapshot.test.js` (create)

- [x] **Step 2.1: Write failing tests** — create `tests/snapshot.test.js`:

```js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const Program = require("../js/program.js");

function baseState(over = {}) {
  const s = Program.defaults();
  s.startDate = "2026-01-05"; // a Monday
  s.bodyweight = 80;
  s.lifts.find(l => l.id === "fsq").tm = 85;
  s.lifts.find(l => l.id === "sdl").tm = 140;
  s.lifts.find(l => l.id === "wpu").tm = 90;
  return Object.assign(s, over);
}

test("liftAbbrev: initials for multi-word, 3 letters for single", () => {
  assert.equal(Program.liftAbbrev("Front Squat"), "FS");
  assert.equal(Program.liftAbbrev("DB Bench Press"), "DBP");
  assert.equal(Program.liftAbbrev("Weighted Pull-up"), "WP");
  assert.equal(Program.liftAbbrev("Squat"), "SQU");
});

test("snapshot: one event per session, keyed kind:dateStr, all-day by default", () => {
  const s = baseState();
  const snap = Program.calendarSnapshot(s);
  assert.equal(snap.length, Program.buildSessions(s).length);
  assert.equal(snap[0].key, "lift:2026-01-05");
  assert.equal(snap[0].date, "2026-01-05");
  assert.equal(snap[0].start, undefined);
});

test("snapshot: lift title has 🏋 + abbreviated loads; desc has full prescription", () => {
  const snap = Program.calendarSnapshot(baseState());
  const wk1 = snap.find(e => e.key === "lift:2026-01-05");
  assert.ok(wk1.title.startsWith("🏋 "), wk1.title);
  assert.ok(wk1.title.includes("FS 60"), wk1.title);      // 0.70*85=59.5 -> 60
  assert.ok(wk1.desc.includes("Week 1 · 70% · 3×5"), wk1.desc);
  assert.ok(wk1.desc.includes("Front Squat: 3×5 @ 60 kg"), wk1.desc);
});

test("snapshot: ✓ prefix when done, ⨯ when skipped", () => {
  const s = baseState();
  s.status["2026-01-05"] = "done";
  s.status["2026-01-07"] = "skipped";
  const snap = Program.calendarSnapshot(s);
  assert.ok(snap.find(e => e.key === "lift:2026-01-05").title.startsWith("✓ "));
  assert.ok(snap.find(e => e.key === "lift:2026-01-07").title.startsWith("⨯ "));
});

test("snapshot: done + stored activity upgrades to a timed event", () => {
  const s = baseState();
  s.status["2026-01-05"] = "done";
  s.activities["2026-01-05"] = { id: 7, sport: "lift", startISO: "2026-01-05T17:00:00Z", durationSec: 3600 };
  const ev = Program.calendarSnapshot(s).find(e => e.key === "lift:2026-01-05");
  assert.equal(ev.start, "2026-01-05T17:00:00Z");
  assert.equal(ev.end, "2026-01-05T18:00:00.000Z");
});

test("snapshot: capacity runs get 🏃 + range label; swapped day gets 🚴; test gets ⛰", () => {
  const s = baseState({ template: "capacity12", weeks: 12 });
  s.sessionSwap["2026-01-08"] = "bike"; // Thu wk1 run slot 1
  const snap = Program.calendarSnapshot(s);
  const tue = snap.find(e => e.key === "run:2026-01-06");
  assert.ok(tue.title.includes("🏃 LSS 30–60′"), tue.title);
  const thu = snap.find(e => e.key === "run:2026-01-08");
  assert.ok(thu.title.includes("🚴 LSS"), thu.title);
  const test6 = snap.find(e => e.title.includes("6-Mile Test"));
  assert.ok(test6.title.includes("⛰"), test6.title);
});

test("snapshot: deload lift flagged in title and desc", () => {
  const s = baseState({ template: "capacity12", weeks: 12 });
  const wk4 = Program.buildSessions(s).find(x => x.week === 4 && x.kind === "lift");
  const ev = Program.calendarSnapshot(s).find(e => e.key === "lift:" + wk4.dateStr);
  assert.ok(ev.title.includes("Deload"), ev.title);
  assert.ok(ev.desc.includes("do not add plates"), ev.desc);
});
```

- [x] **Step 2.2:** Run `pnpm test` — Expected: new file FAILS (`liftAbbrev` not a function).

- [x] **Step 2.3: Implement** in `js/program.js` (insert after `currentSession`, before `STORAGE_KEY`):

```js
  /* ---- Google Calendar snapshot (pure; consumed by main/gcal.js diff) ---- */
  function fmtKg(n) { return (Math.round(n * 10) / 10).toString(); }

  function liftAbbrev(name) {
    const words = String(name).trim().split(/\s+/).filter(Boolean);
    if (!words.length) return "?";
    if (words.length === 1) return words[0].slice(0, 3).toUpperCase();
    return words.map(w => w[0]).join("").toUpperCase();
  }

  /* [{key:"kind:dateStr", date, title, desc, start?, end?}] — all-day unless a
     stored Strava activity upgrades a done session to its real timespan */
  function calendarSnapshot(state) {
    return buildSessions(state).map(s => {
      const st = (state.status || {})[s.dateStr] || null;
      const act = (state.activities || {})[s.dateStr] || null;
      const prefix = st === "done" ? "✓ " : st === "skipped" ? "⨯ " : "";
      let title, desc;
      if (s.kind === "run") {
        const sport = sportFor(state, s);
        const lbl = runLabel(s.run);
        if (s.run.type === "test") {
          title = prefix + "⛰ " + s.run.name;
          desc = "Week " + s.week + " · " + s.run.name + " — target under " + s.run.targetMin + ":00, flat course.";
        } else {
          title = prefix + (sport === "bike" ? "🚴 LSS " : "🏃 LSS ") + lbl;
          desc = "Week " + s.week + " · LSS " + (sport === "bike" ? "Bike" : "Run") + " " + lbl + "\nLow aerobic range, flat terrain.";
        }
      } else {
        const tg = sessionTargets(state, s);
        const pl = Math.round(s.pct * 100);
        const parts = tg.map(t => {
          const ab = liftAbbrev(t.ref.name);
          if (t.target == null) return ab + (t.bw ? " BW" : " —");
          if (t.ref.type === "pullup" && t.added != null) return ab + " " + (t.added >= 0 ? "+" : "") + fmtKg(t.added);
          return ab + " " + fmtKg(t.target);
        });
        title = prefix + "🏋 " + parts.join(" · ") + (s.optional ? " · Deload" : "");
        const body = tg.map(t => {
          if (t.target == null) return t.ref.name + ": " + (t.bw ? s.sets + "×" + s.reps + " bodyweight" : "set TM");
          if (t.ref.type === "pullup") return t.ref.name + ": " + s.sets + "×" + s.reps + " @ " + fmtKg(t.target) + " kg" + (t.added != null ? " (" + (t.added >= 0 ? "+" : "") + fmtKg(t.added) + " added)" : "");
          if (t.ref.type === "db") return t.ref.name + ": " + s.sets + "×" + s.reps + " @ " + fmtKg(t.target) + " kg/hand";
          return t.ref.name + ": " + s.sets + "×" + s.reps + " @ " + fmtKg(t.target) + " kg";
        }).join("\n");
        desc = "Week " + s.week + " · " + pl + "% · " + s.sets + "×" + s.reps + (s.optional ? " · Deload — do not add plates" : "") + "\n\n" + body;
      }
      const ev = { key: s.kind + ":" + s.dateStr, date: s.dateStr, title, desc };
      if (st === "done" && act && act.startISO && act.durationSec) {
        ev.start = act.startISO;
        ev.end = new Date(Date.parse(act.startISO) + act.durationSec * 1000).toISOString();
      }
      return ev;
    });
  }
```

Add to the return object: `calendarSnapshot, liftAbbrev,` (after `monthMatrix, parseRunSpec, runEditLabel,`).

- [x] **Step 2.4:** Run `pnpm test` — Expected: all passing (36 + 7).

- [x] **Step 2.5:** Commit: `git add -A && git commit -m "feat: pure calendarSnapshot for the GCal mirror"`

---

### Task 3: `main/strava.js` — pure matcher (TDD)

**Files:**
- Create: `main/strava.js`
- Test: `tests/strava-match.test.js` (create)

**Matcher contract.** Input sessions are renderer-built "plan lite" rows `{dateStr, kind:"lift"|"run", sport:"lift"|"run"|"bike", status, activityId}` (sport already has the bike swap applied via `Program.sportFor`). Activities are raw Strava summaries. Output `{matches:[{dateStr, kind, activity}], queue:[…]}` where activity is the normalized summary. Queue item types: `swap` (single Ride on an unswapped run day), `ambiguous` (>1 candidate either side — never guess), `mismatch` (sport fits nothing that day), `restday` (no sessions that day), `missed` (past in-window planned session, no status, no activity).

- [x] **Step 3.1: Write failing tests** — create `tests/strava-match.test.js`:

```js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { matchActivities } = require("../main/strava.js");

const S = (dateStr, kind, sport, over = {}) =>
  Object.assign({ dateStr, kind, sport, status: null, activityId: null }, over);
const A = (id, type, day, over = {}) => Object.assign({
  id, sport_type: type, start_date: day + "T16:00:00Z", start_date_local: day + "T18:00:00Z",
  elapsed_time: 3600, moving_time: 3400, distance: 10000, name: type + " #" + id,
}, over);
const OPTS = { dismissed: [], today: "2026-06-11", windowStart: "2026-05-28" };

test("run activity auto-matches the run session on the same local day", () => {
  const r = matchActivities([S("2026-06-09", "run", "run")], [A(1, "Run", "2026-06-09")], OPTS);
  assert.equal(r.matches.length, 1);
  assert.deepEqual([r.matches[0].dateStr, r.matches[0].kind, r.matches[0].activity.id], ["2026-06-09", "run", 1]);
  assert.equal(r.queue.length, 0);
});

test("activity summary is normalized (km, durations, local day from start_date_local)", () => {
  const r = matchActivities([S("2026-06-09", "run", "run")], [A(1, "Run", "2026-06-09")], OPTS);
  const a = r.matches[0].activity;
  assert.equal(a.distanceKm, 10);
  assert.equal(a.durationSec, 3600);
  assert.equal(a.movingSec, 3400);
  assert.equal(a.startISO, "2026-06-09T16:00:00Z");
});

test("WeightTraining matches a lift session", () => {
  const r = matchActivities([S("2026-06-08", "lift", "lift")], [A(2, "WeightTraining", "2026-06-08")], OPTS);
  assert.equal(r.matches.length, 1);
  assert.equal(r.matches[0].kind, "lift");
});

test("Ride matches only when the day is swapped to bike", () => {
  const r = matchActivities([S("2026-06-09", "run", "bike")], [A(3, "Ride", "2026-06-09")], OPTS);
  assert.equal(r.matches.length, 1);
});

test("Ride on an unswapped run day queues a swap offer", () => {
  const r = matchActivities([S("2026-06-09", "run", "run")], [A(3, "Ride", "2026-06-09")], OPTS);
  assert.equal(r.matches.length, 0);
  assert.equal(r.queue[0].type, "swap");
  assert.equal(r.queue[0].dateStr, "2026-06-09");
  assert.equal(r.queue[0].activity.id, 3);
});

test("two activities on one session day → ambiguous, never guess", () => {
  const r = matchActivities([S("2026-06-09", "run", "run")],
    [A(4, "Run", "2026-06-09"), A(5, "Run", "2026-06-09", { name: "evening double" })], OPTS);
  assert.equal(r.matches.length, 0);
  assert.equal(r.queue[0].type, "ambiguous");
  assert.equal(r.queue[0].activities.length, 2);
  assert.equal(r.queue[0].candidates.length, 1);
});

test("activity on a rest day → restday queue item", () => {
  const r = matchActivities([S("2026-06-09", "run", "run")], [A(6, "Run", "2026-06-10")], OPTS);
  assert.equal(r.queue.find(q => q.type === "restday").activity.id, 6);
});

test("unknown sport on a session day → mismatch with candidates", () => {
  const r = matchActivities([S("2026-06-09", "run", "run")], [A(7, "Yoga", "2026-06-09")], OPTS);
  const q = r.queue.find(x => x.type === "mismatch");
  assert.equal(q.activity.id, 7);
  assert.deepEqual(q.candidates, [{ dateStr: "2026-06-09", kind: "run" }]);
});

test("dismissed and already-attached activities are ignored", () => {
  const sessions = [S("2026-06-11", "run", "run"), S("2026-06-09", "lift", "lift", { status: "done", activityId: 9 })];
  const r = matchActivities(sessions,
    [A(8, "Run", "2026-06-11"), A(9, "WeightTraining", "2026-06-09")],
    { dismissed: [8], today: "2026-06-11", windowStart: "2026-05-28" });
  assert.equal(r.matches.length, 0);
  assert.equal(r.queue.length, 0);
});

test("manually-done session without activity still attaches a compatible activity", () => {
  const r = matchActivities([S("2026-06-09", "lift", "lift", { status: "done" })],
    [A(10, "WeightTraining", "2026-06-09")], OPTS);
  assert.equal(r.matches.length, 1);
});

test("skipped sessions never match", () => {
  const r = matchActivities([S("2026-06-09", "run", "run", { status: "skipped" })],
    [A(11, "Run", "2026-06-09")], OPTS);
  assert.equal(r.matches.length, 0);
  assert.equal(r.queue[0].type, "restday");
});

test("past in-window session with no activity and no status → missed", () => {
  const r = matchActivities([S("2026-06-08", "lift", "lift"), S("2026-06-12", "lift", "lift"), S("2026-05-20", "lift", "lift")], [], OPTS);
  assert.equal(r.queue.length, 1);
  assert.deepEqual(r.queue[0], { type: "missed", dateStr: "2026-06-08", kind: "lift" });
});

test("TrailRun/VirtualRide variants normalize to run/bike", () => {
  const r = matchActivities([S("2026-06-09", "run", "run"), S("2026-06-10", "run", "bike")],
    [A(12, "TrailRun", "2026-06-09"), A(13, "VirtualRide", "2026-06-10")], OPTS);
  assert.equal(r.matches.length, 2);
});
```

- [x] **Step 3.2:** Run `pnpm test` — Expected: FAIL (`Cannot find module '../main/strava.js'`).

- [x] **Step 3.3: Implement** — create `main/strava.js`:

```js
"use strict";
/* Strava integration. matchActivities/summarize are PURE (node-testable, no
   Electron/store imports — deps injected by main.js). fetch* hit the API. */

const SPORT_MAP = {
  Run: "run", TrailRun: "run", VirtualRun: "run",
  Ride: "bike", VirtualRide: "bike", GravelRide: "bike", MountainBikeRide: "bike", EBikeRide: "bike",
  WeightTraining: "lift",
};

function sportOf(a) { return SPORT_MAP[a.sport_type || a.type] || null; }

function summarize(a) {
  return {
    id: a.id,
    sport: sportOf(a),
    rawType: a.sport_type || a.type || "",
    name: a.name || "",
    startISO: a.start_date,          // UTC instant — used for the timed GCal event
    startLocal: a.start_date_local,  // wall time — used for same-day matching
    durationSec: a.elapsed_time || 0,
    movingSec: a.moving_time || 0,
    distanceKm: a.distance ? +(a.distance / 1000).toFixed(2) : null,
    description: a.description || "",
  };
}

/* sessions: [{dateStr, kind, sport, status, activityId}] (sport has bike swap applied)
   rawActivities: Strava summaries; opts: {dismissed, today, windowStart} */
function matchActivities(sessions, rawActivities, opts) {
  opts = opts || {};
  const dism = new Set((opts.dismissed || []).map(String));
  const attached = new Set(sessions.filter(s => s.activityId != null).map(s => String(s.activityId)));
  const acts = rawActivities.map(summarize)
    .filter(a => !dism.has(String(a.id)) && !attached.has(String(a.id)));

  const sessByDay = {};
  sessions.forEach(s => { (sessByDay[s.dateStr] = sessByDay[s.dateStr] || []).push(s); });
  const actsByDay = {};
  acts.forEach(a => { const d = String(a.startLocal).slice(0, 10); (actsByDay[d] = actsByDay[d] || []).push(a); });

  const matches = [], queue = [];
  const matchedDays = new Set();

  Object.keys(actsByDay).sort().forEach(day => {
    const dayActs = actsByDay[day];
    const daySess = (sessByDay[day] || []).filter(s => s.status !== "skipped" && s.activityId == null);
    if (!daySess.length) {
      dayActs.forEach(a => queue.push({ type: "restday", dateStr: day, activity: a }));
      return;
    }
    if (dayActs.length > 1) {
      queue.push({ type: "ambiguous", dateStr: day, activities: dayActs,
                   candidates: daySess.map(s => ({ dateStr: s.dateStr, kind: s.kind })) });
      return;
    }
    const a = dayActs[0];
    const compat = daySess.filter(s => s.sport === a.sport);
    if (compat.length === 1) {
      matches.push({ dateStr: compat[0].dateStr, kind: compat[0].kind, activity: a });
      matchedDays.add(day);
      return;
    }
    if (compat.length > 1) {
      queue.push({ type: "ambiguous", dateStr: day, activities: [a],
                   candidates: compat.map(s => ({ dateStr: s.dateStr, kind: s.kind })) });
      return;
    }
    const swappable = a.sport === "bike" && daySess.find(s => s.kind === "run" && s.sport === "run");
    if (swappable) { queue.push({ type: "swap", dateStr: swappable.dateStr, kind: "run", activity: a }); return; }
    queue.push({ type: "mismatch", dateStr: day, activity: a,
                 candidates: daySess.map(s => ({ dateStr: s.dateStr, kind: s.kind })) });
  });

  if (opts.today && opts.windowStart) {
    sessions.forEach(s => {
      if (s.dateStr >= opts.windowStart && s.dateStr < opts.today && !s.status &&
          s.activityId == null && !matchedDays.has(s.dateStr))
        queue.push({ type: "missed", dateStr: s.dateStr, kind: s.kind });
    });
  }
  return { matches, queue };
}

/* ---- impure: Strava API (token injected) ---- */
const API = "https://www.strava.com/api/v3";

async function fetchActivities(token, afterEpoch) {
  const res = await fetch(API + "/athlete/activities?per_page=100&after=" + afterEpoch,
    { headers: { Authorization: "Bearer " + token } });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error("Strava " + res.status + ": " + ((data && data.message) || "request failed"));
  return data;
}

/* the list endpoint omits descriptions — hydrate every surfaced activity */
async function hydrateDescriptions(result, token) {
  const targets = [
    ...result.matches.map(m => m.activity),
    ...result.queue.flatMap(q => q.activity ? [q.activity] : (q.activities || [])),
  ];
  for (const a of targets) {
    try {
      const res = await fetch(API + "/activities/" + a.id, { headers: { Authorization: "Bearer " + token } });
      if (res.ok) { const d = await res.json(); a.description = d.description || ""; }
    } catch (e) { /* description is cosmetic — keep going */ }
  }
}

module.exports = { matchActivities, summarize, sportOf, fetchActivities, hydrateDescriptions };
```

- [x] **Step 3.4:** Run `pnpm test` — Expected: all passing (43 + 13... i.e. previous total + 13 new).

- [x] **Step 3.5:** Commit: `git add -A && git commit -m "feat: pure Strava matcher + activity fetch"`

---

### Task 4: `main/gcal.js` — pure diff engine (TDD)

**Files:**
- Create: `main/gcal.js`
- Test: `tests/gcal-diff.test.js` (create)

- [x] **Step 4.1: Write failing tests** — create `tests/gcal-diff.test.js`:

```js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { diffPlan, eventBody, hashEvent } = require("../main/gcal.js");

const EV = (key, over = {}) => Object.assign({ key, date: "2026-06-15", title: "🏋 FS 76", desc: "Week 1" }, over);

test("all-day event body spans exactly one day (exclusive end)", () => {
  const b = eventBody(EV("lift:2026-06-15"));
  assert.deepEqual(b, { summary: "🏋 FS 76", description: "Week 1",
    start: { date: "2026-06-15" }, end: { date: "2026-06-16" } });
});

test("all-day event at month end rolls to the 1st", () => {
  const b = eventBody(EV("lift:2026-06-30", { date: "2026-06-30" }));
  assert.deepEqual(b.end, { date: "2026-07-01" });
});

test("timed event body uses dateTime", () => {
  const b = eventBody(EV("run:2026-06-15", { start: "2026-06-15T16:00:00Z", end: "2026-06-15T17:00:00Z" }));
  assert.deepEqual(b.start, { dateTime: "2026-06-15T16:00:00Z" });
  assert.deepEqual(b.end, { dateTime: "2026-06-15T17:00:00Z" });
});

test("diff: new key inserts, unchanged does nothing", () => {
  const known = EV("lift:2026-06-15");
  const map = { "lift:2026-06-15": { eventId: "e1", hash: hashEvent(known) } };
  const d = diffPlan([known, EV("run:2026-06-16", { date: "2026-06-16" })], map);
  assert.equal(d.inserts.length, 1);
  assert.equal(d.inserts[0].key, "run:2026-06-16");
  assert.equal(d.patches.length, 0);
  assert.equal(d.deletes.length, 0);
});

test("diff: changed content patches with the stored eventId", () => {
  const old = EV("lift:2026-06-15");
  const map = { "lift:2026-06-15": { eventId: "e1", hash: hashEvent(old) } };
  const d = diffPlan([EV("lift:2026-06-15", { title: "✓ 🏋 FS 76" })], map);
  assert.equal(d.patches.length, 1);
  assert.equal(d.patches[0].eventId, "e1");
});

test("diff: vanished key deletes", () => {
  const map = { "lift:2026-06-15": { eventId: "e1", hash: "x" } };
  const d = diffPlan([], map);
  assert.deepEqual(d.deletes, [{ key: "lift:2026-06-15", eventId: "e1" }]);
});
```

- [x] **Step 4.2:** Run `pnpm test` — Expected: FAIL (module missing).

- [x] **Step 4.3: Implement** — create `main/gcal.js`:

```js
"use strict";
/* Google Calendar mirror. diffPlan/eventBody/hashEvent are PURE (node-testable).
   syncPlan applies a snapshot via fetch; token/state injected by main.js. */

function nextDay(ds) {
  const p = ds.split("-").map(Number);
  const d = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function eventBody(ev) {
  if (ev.start) return { summary: ev.title, description: ev.desc,
    start: { dateTime: ev.start }, end: { dateTime: ev.end } };
  return { summary: ev.title, description: ev.desc,
    start: { date: ev.date }, end: { date: nextDay(ev.date) } };
}

function hashEvent(ev) { return JSON.stringify(eventBody(ev)); }

function diffPlan(snapshot, eventMap) {
  const want = {};
  snapshot.forEach(ev => { want[ev.key] = ev; });
  const inserts = [], patches = [], deletes = [];
  Object.entries(want).forEach(([key, ev]) => {
    const cur = eventMap[key];
    if (!cur) inserts.push({ key, ev });
    else if (cur.hash !== hashEvent(ev)) patches.push({ key, ev, eventId: cur.eventId });
  });
  Object.entries(eventMap).forEach(([key, cur]) => { if (!want[key]) deletes.push({ key, eventId: cur.eventId }); });
  return { inserts, patches, deletes };
}

/* ---- impure: Calendar API ---- */
const BASE = "https://www.googleapis.com/calendar/v3";

async function api(token, method, url, body) {
  const res = await fetch(BASE + url, {
    method,
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error("GCal " + res.status + (data && data.error ? ": " + data.error.message : ""));
    err.status = res.status;
    throw err;
  }
  return data;
}

async function ensureCalendar(token, calendarId) {
  if (calendarId) {
    try { await api(token, "GET", "/calendars/" + encodeURIComponent(calendarId)); return calendarId; }
    catch (e) { if (e.status !== 404 && e.status !== 410) throw e; }
  }
  const list = await api(token, "GET", "/users/me/calendarList?minAccessRole=owner");
  const found = (list.items || []).find(c => c.summary === "Operator");
  if (found) return found.id;
  const created = await api(token, "POST", "/calendars", { summary: "Operator" });
  return created.id;
}

async function listEventIds(token, calId) {
  const ids = new Set();
  let pageToken = "";
  do {
    const q = "?maxResults=2500&fields=items(id),nextPageToken" + (pageToken ? "&pageToken=" + pageToken : "");
    const data = await api(token, "GET", "/calendars/" + encodeURIComponent(calId) + "/events" + q);
    (data.items || []).forEach(ev => ids.add(ev.id));
    pageToken = data.nextPageToken || "";
  } while (pageToken);
  return ids;
}

/* deps: {token, calendarId, eventMap} -> {calendarId, eventMap} (caller persists) */
async function syncPlan(snapshot, deps) {
  const calId = await ensureCalendar(deps.token, deps.calendarId);
  const liveIds = await listEventIds(deps.token, calId);
  const eventMap = {};
  /* drop entries whose event was deleted by hand — the diff re-inserts them (self-heal) */
  Object.entries(deps.eventMap || {}).forEach(([k, v]) => { if (liveIds.has(v.eventId)) eventMap[k] = v; });
  const { inserts, patches, deletes } = diffPlan(snapshot, eventMap);
  const base = "/calendars/" + encodeURIComponent(calId) + "/events";
  for (const { key, ev } of inserts) {
    const created = await api(deps.token, "POST", base, eventBody(ev));
    eventMap[key] = { eventId: created.id, hash: hashEvent(ev) };
  }
  for (const { key, ev, eventId } of patches) {
    try {
      await api(deps.token, "PUT", base + "/" + eventId, eventBody(ev));
      eventMap[key] = { eventId, hash: hashEvent(ev) };
    } catch (e) {
      if (e.status === 404 || e.status === 410) {
        const created = await api(deps.token, "POST", base, eventBody(ev));
        eventMap[key] = { eventId: created.id, hash: hashEvent(ev) };
      } else throw e;
    }
  }
  for (const { key, eventId } of deletes) {
    try { await api(deps.token, "DELETE", base + "/" + eventId); }
    catch (e) { if (e.status !== 404 && e.status !== 410) throw e; }
    delete eventMap[key];
  }
  return { calendarId: calId, eventMap };
}

module.exports = { diffPlan, eventBody, hashEvent, ensureCalendar, listEventIds, syncPlan };
```

- [x] **Step 4.4:** Run `pnpm test` — Expected: all passing (+6).

- [x] **Step 4.5:** Commit: `git add -A && git commit -m "feat: GCal diff engine + sync apply"`

---

### Task 5: `main/store.js` + `main/oauth.js`

**Files:**
- Create: `main/store.js`, `main/oauth.js`

No unit tests (Electron-bound; OAuth is covered by the README smoke checklist). Gate: `node --check`.

- [x] **Step 5.1:** Create `main/store.js`:

```js
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
```

- [x] **Step 5.2:** Create `main/oauth.js`:

```js
"use strict";
/* System-browser OAuth with a throwaway 127.0.0.1 loopback listener.
   Google uses PKCE; both providers exchange/refresh with bare fetch. */
const http = require("http");
const crypto = require("crypto");
const { shell } = require("electron");

const TIMEOUT_MS = 3 * 60 * 1000;

function b64url(buf) { return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }

/* spin up the listener first so the redirect_uri port is known */
function awaitCode(expectedState) {
  let resolveCode, rejectCode;
  const code = new Promise((res, rej) => { resolveCode = res; rejectCode = rej; });
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, "http://127.0.0.1");
    if (u.pathname !== "/callback") { res.writeHead(404); res.end(); return; }
    const ok = u.searchParams.get("code") && u.searchParams.get("state") === expectedState;
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end("<html><body style=\"font-family:sans-serif;background:#0b0c0e;color:#e7e9ec;padding:40px\"><p>" +
      (ok ? "Operator connected — you can close this tab." : "Connection failed — return to Operator and retry.") +
      "</p></body></html>");
    if (ok) resolveCode(u.searchParams.get("code"));
    else rejectCode(new Error(u.searchParams.get("error") || "OAuth state mismatch"));
    setImmediate(() => server.close());
  });
  const timer = setTimeout(() => { server.close(); rejectCode(new Error("OAuth timed out — no browser response in 3 minutes")); }, TIMEOUT_MS);
  code.finally(() => clearTimeout(timer)).catch(() => {});
  return new Promise(res => server.listen(0, "127.0.0.1", () => res({ port: server.address().port, code })));
}

async function tokenPost(url, params) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error("Token exchange failed (" + res.status + "): " + (data.error_description || data.error || data.message || ""));
  return data;
}

function withExpiry(t) { return Object.assign({}, t, { expiresAt: Date.now() + ((t.expires_in || 3600) - 60) * 1000 }); }

async function connectGoogle(creds) {
  const state = b64url(crypto.randomBytes(16));
  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash("sha256").update(verifier).digest());
  const { port, code } = await awaitCode(state);
  const redirect = "http://127.0.0.1:" + port + "/callback";
  shell.openExternal("https://accounts.google.com/o/oauth2/v2/auth?" + new URLSearchParams({
    client_id: creds.clientId, redirect_uri: redirect, response_type: "code",
    scope: "https://www.googleapis.com/auth/calendar",
    access_type: "offline", prompt: "consent",
    code_challenge: challenge, code_challenge_method: "S256", state,
  }));
  const c = await code;
  return withExpiry(await tokenPost("https://oauth2.googleapis.com/token", {
    code: c, client_id: creds.clientId, client_secret: creds.clientSecret,
    redirect_uri: redirect, grant_type: "authorization_code", code_verifier: verifier,
  }));
}

async function refreshGoogle(creds, refreshToken) {
  const t = await tokenPost("https://oauth2.googleapis.com/token", {
    client_id: creds.clientId, client_secret: creds.clientSecret,
    refresh_token: refreshToken, grant_type: "refresh_token",
  });
  return withExpiry(Object.assign({ refresh_token: refreshToken }, t));
}

async function connectStrava(creds) {
  const state = b64url(crypto.randomBytes(16));
  const { port, code } = await awaitCode(state);
  const redirect = "http://127.0.0.1:" + port + "/callback";
  shell.openExternal("https://www.strava.com/oauth/authorize?" + new URLSearchParams({
    client_id: creds.clientId, redirect_uri: redirect, response_type: "code",
    scope: "activity:read_all", approval_prompt: "auto", state,
  }));
  const c = await code;
  return withExpiry(await tokenPost("https://www.strava.com/oauth/token", {
    client_id: creds.clientId, client_secret: creds.clientSecret, code: c, grant_type: "authorization_code",
  }));
}

async function refreshStrava(creds, refreshToken) {
  /* Strava rotates refresh tokens — the response carries the new one */
  return withExpiry(await tokenPost("https://www.strava.com/oauth/token", {
    client_id: creds.clientId, client_secret: creds.clientSecret,
    refresh_token: refreshToken, grant_type: "refresh_token",
  }));
}

module.exports = { connectGoogle, connectStrava, refreshGoogle, refreshStrava };
```

- [x] **Step 5.3:** Run `node --check main/store.js && node --check main/oauth.js && pnpm test` — Expected: both parse; tests still green.

- [x] **Step 5.4:** Commit: `git add -A && git commit -m "feat: token store (safeStorage) + loopback OAuth for Google/Strava"`

---

### Task 6: `preload.js` + root `main.js` wiring + builder files

**Files:**
- Create: `preload.js`
- Modify: `main.js` (full rewrite below), `package.json` (builder `files`)

- [x] **Step 6.1:** Create `preload.js`:

```js
"use strict";
const { contextBridge, ipcRenderer } = require("electron");

/* API-shaped seam: plain JSON in/out. V2 promotes these to HTTP endpoints. */
contextBridge.exposeInMainWorld("api", {
  getSyncStatus: () => ipcRenderer.invoke("sync:status"),
  setCredentials: (provider, creds) => ipcRenderer.invoke("sync:set-credentials", provider, creds),
  connectGoogle: () => ipcRenderer.invoke("sync:connect", "google"),
  connectStrava: () => ipcRenderer.invoke("sync:connect", "strava"),
  disconnect: (provider) => ipcRenderer.invoke("sync:disconnect", provider),
  pushPlan: (snapshot) => ipcRenderer.invoke("sync:push-plan", snapshot),
  syncStrava: (plan) => ipcRenderer.invoke("sync:strava", plan),
});
```

- [x] **Step 6.2:** Rewrite `main.js`:

```js
const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
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

let pendingSnapshot = null; // offline/expired pushes queue here and flush on retry

async function doPush(snapshot) {
  const d = store.load();
  if (!d.google.tokensEnc) return;
  try {
    const token = await freshToken("google");
    const res = await gcal.syncPlan(snapshot, { token, calendarId: d.google.calendarId, eventMap: d.google.eventMap });
    store.update(s => {
      s.google.calendarId = res.calendarId;
      s.google.eventMap = res.eventMap;
      s.google.lastSync = new Date().toISOString();
      s.google.lastError = null;
    });
    pendingSnapshot = null;
  } catch (e) {
    pendingSnapshot = snapshot;
    store.update(s => { s.google.lastError = String(e.message || e); });
  }
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
    if (provider === "google") pendingSnapshot = null;
    return statusOf();
  });

  ipcMain.handle("sync:push-plan", async (e, snapshot) => { await doPush(snapshot); return statusOf(); });

  ipcMain.handle("sync:strava", async (e, plan) => {
    try {
      const token = await freshToken("strava");
      const after = Math.floor(Date.now() / 1000) - 14 * 86400;
      const acts = await strava.fetchActivities(token, after);
      const result = strava.matchActivities(plan.sessions, acts,
        { dismissed: plan.dismissed, today: plan.today, windowStart: plan.windowStart });
      await strava.hydrateDescriptions(result, token);
      store.update(s => { s.strava.lastFetch = new Date().toISOString(); s.strava.lastError = null; });
      return result;
    } catch (err) {
      store.update(s => { s.strava.lastError = String(err.message || err); });
      throw err;
    }
  });

  setInterval(() => { if (pendingSnapshot) doPush(pendingSnapshot); }, 60 * 1000);

  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
```

- [x] **Step 6.3:** In `package.json` builder `files`, add `"preload.js"` and `"main/**"`:

```json
    "files": [
      "index.html",
      "js/**",
      "main.js",
      "preload.js",
      "main/**",
      "package.json"
    ],
```

- [x] **Step 6.4:** Run `node --check main.js && node --check preload.js && pnpm test` — Expected: parse OK, tests green. Then `pnpm start` briefly: window opens, `window.api` is defined in DevTools console (`typeof window.api` → "object"), no main-process errors. Quit.

- [x] **Step 6.5:** Commit: `git add -A && git commit -m "feat: preload api bridge + main-process IPC wiring"`

---

### Task 7: Renderer sync plumbing (api guard, push debounce, Strava apply)

**Files:**
- Modify: `index.html` (script only)

- [x] **Step 7.1:** After the `function save(){...}` line, change `save` and add the sync block:

Replace:
```js
function save(){try{localStorage.setItem(Program.STORAGE_KEY,JSON.stringify(state));}catch(e){}}
```
with:
```js
function save(){try{localStorage.setItem(Program.STORAGE_KEY,JSON.stringify(state));}catch(e){} schedulePush();}
```

Insert immediately after `let state=load(); let activeTab="today";`:

```js
/* ---- sync (Electron only; window.api is absent under file://) ---- */
const api=window.api||null;
let syncStatus=null;   // last getSyncStatus() result
let stravaQueue=[];    // review-queue items from the last fetch (in-memory; re-derived each sync)
let pushT=null;
function googleConnected(){return !!(syncStatus&&syncStatus.google&&syncStatus.google.connected);}
function stravaConnected(){return !!(syncStatus&&syncStatus.strava&&syncStatus.strava.connected);}
function schedulePush(){
  if(!api||!googleConnected())return;
  clearTimeout(pushT);
  pushT=setTimeout(()=>{api.pushPlan(Program.calendarSnapshot(state)).then(st=>{syncStatus=st;}).catch(()=>{});},1200);
}
function planLite(){
  return {
    sessions:buildSessions().map(s=>({dateStr:s.dateStr,kind:s.kind,sport:Program.sportFor(state,s),
      status:state.status[s.dateStr]||null,activityId:(state.activities[s.dateStr]||{}).id||null})),
    dismissed:state.dismissedActivities,
    today:ymd(todayDate()),
    windowStart:ymd(addDays(todayDate(),-14)),
  };
}
async function runStravaSync(quiet){
  if(!api||!stravaConnected())return;
  try{
    const res=await api.syncStrava(planLite());
    res.matches.forEach(m=>{state.status[m.dateStr]="done";state.activities[m.dateStr]=m.activity;});
    stravaQueue=res.queue;
    save();render();
    if(!quiet)toast(res.matches.length?res.matches.length+" matched from Strava":"Up to date");
  }catch(e){if(!quiet)toast("Strava sync failed");syncStatus=api?await api.getSyncStatus().catch(()=>syncStatus):syncStatus;render();}
}
if(api){
  api.getSyncStatus().then(st=>{
    syncStatus=st;render();
    if(stravaConnected())runStravaSync(true);
    if(googleConnected())schedulePush();
  }).catch(()=>{});
}
```

- [x] **Step 7.2:** Run the parse-check (command in the header) — Expected: `parses OK`. `pnpm test` still green.

- [x] **Step 7.3:** Commit: `git add -A && git commit -m "feat: renderer sync plumbing — debounced plan push + Strava apply"`

---

### Task 8: Connections tab UI

**Files:**
- Modify: `index.html` (`renderSetup` connections branch + new `connectionsHtml` + wiring)

- [x] **Step 8.1:** Replace the placeholder branch in `renderSetup`:

```js
  }else if(setupTab==="connections"){
    body=connectionsHtml();
  }else{
```

Add before `function enduranceEditorHtml(){`:

```js
function connectionsHtml(){
  if(!api)return `<div class="empty"><h3>Desktop only</h3><p>Google Calendar and Strava sync run in the desktop app.<br>Everything else works right here in the browser.</p></div>`;
  if(!syncStatus)return `<div class="empty"><p>Loading sync status…</p></div>`;
  const ts=v=>v?new Date(v).toLocaleString():"—";
  const provider=(key,p,title,hint)=>{
    const dot=`<span class="dot ${p.connected?"done":""}" style="display:inline-block;vertical-align:middle;margin-right:7px"></span>`;
    if(p.connected){
      const when=key==="google"?p.lastSync:p.lastFetch;
      return `<div class="group"><span class="eyebrow">${dot}${title} — connected</span>
        <div class="field"><label>${key==="google"?"Mirror":"Activities"}<span class="hint">${key==="google"?"all-day plan events in the “Operator” calendar":"last ~14 days, matched to the plan"}</span></label>
          <button class="btn ghost" data-disc="${key}">Disconnect</button></div>
        <div class="field"><label>${key==="google"?"Last push":"Last fetch"}${p.lastError?`<span class="hint" style="color:var(--red)">${escapeHtml(p.lastError)}</span>`:""}</label>
          <span class="mono" style="font-size:12px;color:var(--muted)">${ts(when)}</span></div>
        <div class="setup-actions">${key==="google"
          ?`<button class="btn" id="pushNow">Push plan now</button>`
          :`<button class="btn" id="fetchNow">↻ Fetch activities</button>`}</div></div>`;
    }
    return `<div class="group"><span class="eyebrow">${dot}${title}</span>
      <div class="field"><label>Client ID <span class="hint">${hint}</span></label>
        <input type="text" style="width:300px;text-align:left" data-cred="${key}" data-cf="clientId" placeholder="${p.hasCredentials?"saved — leave blank to reuse":""}"></div>
      <div class="field"><label>Client secret</label>
        <input type="text" style="width:300px;text-align:left" data-cred="${key}" data-cf="clientSecret" placeholder="${p.hasCredentials?"saved — leave blank to reuse":""}"></div>
      <div class="setup-actions"><button class="btn primary" data-conn="${key}">Connect ${title}</button></div>
      ${p.lastError?`<p class="note" style="color:var(--red)">${escapeHtml(p.lastError)}</p>`:""}</div>`;
  };
  return provider("google",syncStatus.google,"Google Calendar","OAuth Desktop client — see README")
       +provider("strava",syncStatus.strava,"Strava","API application — see README");
}
```

- [x] **Step 8.2:** Add wiring at the end of `renderSetup` (before the closing `}`, after the `#resetBook` block):

```js
  root.querySelectorAll("[data-conn]").forEach(b=>b.onclick=async()=>{
    const key=b.dataset.conn;
    const idEl=root.querySelector(`[data-cred="${key}"][data-cf="clientId"]`);
    const secEl=root.querySelector(`[data-cred="${key}"][data-cf="clientSecret"]`);
    const id=idEl.value.trim(),sec=secEl.value.trim();
    try{
      if(id||sec)syncStatus=await api.setCredentials(key,{clientId:id,clientSecret:sec});
      b.textContent="Waiting for the browser…";b.disabled=true;
      syncStatus=key==="google"?await api.connectGoogle():await api.connectStrava();
      toast("Connected");
      if(key==="google")schedulePush();else runStravaSync(true);
    }catch(e){toast("Connect failed");if(api)syncStatus=await api.getSyncStatus().catch(()=>syncStatus);}
    renderSetup(root);
  });
  root.querySelectorAll("[data-disc]").forEach(b=>b.onclick=async()=>{
    if(!confirm("Disconnect? Tokens are forgotten. The Operator calendar stays in Google — delete it there if you want it gone."))return;
    syncStatus=await api.disconnect(b.dataset.disc);renderSetup(root);
  });
  const pn=root.querySelector("#pushNow");
  if(pn)pn.onclick=async()=>{pn.disabled=true;pn.textContent="Pushing…";
    syncStatus=await api.pushPlan(Program.calendarSnapshot(state));
    toast(syncStatus.google.lastError?"Push failed":"Plan pushed");renderSetup(root);};
  const fn=root.querySelector("#fetchNow");
  if(fn)fn.onclick=async()=>{fn.disabled=true;fn.textContent="Fetching…";await runStravaSync();renderSetup(root);};
```

- [x] **Step 8.3:** Parse-check + `pnpm test` — green. Open `index.html` via `file://`: Connections shows the "Desktop only" card. `pnpm start`: Connections shows both provider groups with credential fields.

- [x] **Step 8.4:** Commit: `git add -A && git commit -m "feat: Connections tab — credentials, connect/disconnect, status"`

---

### Task 9: Review queue + manual sync buttons (Today/Calendar)

**Files:**
- Modify: `index.html` (renderToday, renderTodayRun, renderCalendar + new helpers)

- [x] **Step 9.1:** Add helpers before `function renderToday(`:

```js
function queueCardHtml(){
  if(!api||!stravaQueue.length)return "";
  let rows="";
  stravaQueue.forEach((q,i)=>{
    if(q.type==="missed"){
      rows+=`<div class="lift-row"><div class="lift-meta"><div class="lift-name">Planned ${q.kind} not recorded</div>
        <div class="lift-scheme">${q.dateStr} — no Strava activity found</div></div>
        <div class="actions"><button class="btn ghost" data-qi="${i}" data-qa="skip">Mark skipped</button>
        <button class="btn ghost" data-qi="${i}" data-qa="drop">Leave planned</button></div></div>`;
      return;
    }
    const why={swap:"ride on a run day",restday:"no session this day",mismatch:"sport doesn't fit the plan",ambiguous:"several options this day"}[q.type];
    (q.activities||[q.activity]).forEach(a=>{
      const meta=`${q.dateStr} · ${escapeHtml(a.rawType)} · ${Math.round((a.movingSec||a.durationSec)/60)}′${a.distanceKm?` · ${a.distanceKm} km`:""}`;
      let btns="";
      if(q.type==="swap")btns+=`<button class="btn" data-qi="${i}" data-qa="swap" data-aid="${a.id}">Swap to bike &amp; match</button>`;
      (q.candidates||[]).forEach(c=>{btns+=`<button class="btn" data-qi="${i}" data-qa="attach" data-aid="${a.id}" data-date="${c.dateStr}">Attach to ${c.kind}</button>`;});
      btns+=`<button class="btn ghost" data-qi="${i}" data-qa="dismiss" data-aid="${a.id}">Not training</button>`;
      rows+=`<div class="lift-row"><div class="lift-meta"><div class="lift-name">${escapeHtml(a.name)}</div>
        <div class="lift-scheme">${meta} · ${why}</div></div><div class="actions">${btns}</div></div>`;
    });
  });
  return `<div class="card" style="margin-top:18px"><div class="card-head"><h3>Strava review</h3><span class="meta">${stravaQueue.length} to resolve</span></div>${rows}</div>`;
}
function wireQueue(root){
  root.querySelectorAll("[data-qa]").forEach(b=>b.onclick=()=>{
    const i=+b.dataset.qi;const q=stravaQueue[i];if(!q)return;
    const acts=q.activities||[q.activity];
    const act=b.dataset.aid?acts.find(a=>a&&String(a.id)===b.dataset.aid):null;
    const qa=b.dataset.qa;
    if(qa==="dismiss"&&act)state.dismissedActivities.push(act.id);
    else if(qa==="skip")state.status[q.dateStr]="skipped";
    else if(qa==="swap"&&act){state.sessionSwap[q.dateStr]="bike";state.status[q.dateStr]="done";state.activities[q.dateStr]=act;}
    else if(qa==="attach"&&act){state.status[b.dataset.date]="done";state.activities[b.dataset.date]=act;}
    stravaQueue.splice(i,1);
    save();render();
  });
}
```

- [x] **Step 9.2:** In `renderToday`, append the queue card + sync button. In the `.actions` div, the `icsBtn` is replaced in Task 11 — here only add after the skip button:

```js
      ${stravaConnected()?`<button class="btn ghost" id="syncBtn">↻ Sync Strava</button>`:""}
```
and after the closing `</div>` of `.actions` in the template string, append `${queueCardHtml()}`.
After the existing handlers add:
```js
  const sb=root.querySelector("#syncBtn");if(sb)sb.onclick=()=>runStravaSync();
  wireQueue(root);
```

- [x] **Step 9.3:** Same three additions in `renderTodayRun` (sync button in `.actions`, `${queueCardHtml()}` after it, `syncBtn` handler + `wireQueue(root)` at the end).

- [x] **Step 9.4:** In `renderCalendar`, change the header line to include a sync button:

```js
  let grid=`<div class="cal-head"><button class="btn ghost" id="calPrev">‹ Prev</button><span class="cal-title">${monthName}</span><span>${stravaConnected()?`<button class="btn ghost" id="calSync">↻</button> `:""}<button class="btn ghost" id="calNext">Next ›</button></span></div>
```
and after `#calNext` wiring: `const cs=root.querySelector("#calSync");if(cs)cs.onclick=()=>runStravaSync();`

- [x] **Step 9.5:** Parse-check + `pnpm test` — green.

- [x] **Step 9.6:** Commit: `git add -A && git commit -m "feat: Strava review queue + manual sync on Today/Calendar"`

---

### Task 10: Plan-vs-actual panel

**Files:**
- Modify: `index.html` (CSS + `actualHtml` + renderToday/renderTodayRun/calDetailHtml)

- [x] **Step 10.1:** Add CSS (after the `.cal-chip .dot` rule):

```css
  /* plan vs actual */
  .pva{display:grid;grid-template-columns:1fr 1fr;align-items:stretch}
  .actual{border-left:1px solid var(--line);padding:14px 18px;min-width:0}
  .actual .eyebrow{display:block;margin-bottom:8px}
  .actual-name{font-size:13.5px;font-weight:600;margin-bottom:2px}
  .actual-meta{font-family:var(--mono);font-size:11.5px;color:var(--muted);margin-bottom:8px}
  .actual-desc{font-family:var(--mono);font-size:12px;color:var(--muted);white-space:pre-wrap;line-height:1.6;margin:0}
  @media (max-width:760px){.pva{grid-template-columns:1fr}.actual{border-left:none;border-top:1px solid var(--line)}}
```

- [x] **Step 10.2:** Add helper before `function renderToday(`:

```js
function actualHtml(s){
  const a=state.activities[s.dateStr];
  if(state.status[s.dateStr]!=="done"||!a)return "";
  const secs=a.movingSec||a.durationSec||0;
  let meta=Math.round(secs/60)+"′";
  if(a.distanceKm){
    const p=secs/a.distanceKm;
    meta+=` · ${a.distanceKm} km · ${Math.floor(p/60)}:${pad(Math.round(p%60))}/km`;
  }
  return `<div class="actual"><span class="eyebrow">Actual — Strava</span>
    <div class="actual-name">${escapeHtml(a.name)}</div>
    <div class="actual-meta">${meta}</div>
    ${a.description?`<pre class="actual-desc">${escapeHtml(a.description)}</pre>`:`<p class="note" style="margin:0">No description on the activity.</p>`}</div>`;
}
function withActual(s,planHtml){
  const act=actualHtml(s);
  return act?`<div class="pva"><div>${planHtml}</div>${act}</div>`:planHtml;
}
```

- [x] **Step 10.3:** Use it in all three places:
  - `renderToday`: in the card, `${rows}` → `${withActual(cur,rows)}`.
  - `renderTodayRun`: wrap the run `.lift-row` — the card body becomes `${withActual(cur,`<div class="lift-row">…existing run row…</div>`)}` (move the existing row into a template literal argument).
  - `calDetailHtml`: lift branch `${liftRowsHtml(s)}` → `${withActual(s,liftRowsHtml(s))}`; run branch: wrap the run row the same way.

- [x] **Step 10.4:** Parse-check + `pnpm test` — green. Manual: seed `state.activities["<a done date>"]={name:"Test run",movingSec:3000,durationSec:3100,distanceKm:8.2,description:"FSQ 5x5x60"}` in DevTools, mark done, confirm the side-by-side panel renders on Today and in calendar detail.

- [x] **Step 10.5:** Commit: `git add -A && git commit -m "feat: plan-vs-actual panel on done sessions"`

---

### Task 11: Remove `.ics` export and `sessionTime`/`durationMin` UI

**Files:**
- Modify: `index.html`

- [x] **Step 11.1:** Delete the whole `/* ---- ics ---- */` block: `escICS`, `stamp`, `buildICS`, `exportICS` (keep `download` — backup uses it).

- [x] **Step 11.2:** `renderToday`: remove `<button class="btn primary" id="icsBtn">Add program to calendar</button>` and the `root.querySelector("#icsBtn").onclick=exportICS;` line.

- [x] **Step 11.3:** Setup → General: remove the "Calendar" group (sessionTime/durationMin fields + `icsBtn2`) and its `#icsBtn2` wiring; keep backup/restore/reset in a renamed group:

```js
    <div class="group"><span class="eyebrow">Data</span>
      <div class="setup-actions">
        <button class="btn" id="backupBtn">Back up data</button>
        <button class="btn" id="restoreBtn">Restore</button>
        <button class="btn ghost" id="resetBtn">Reset all</button>
        <input type="file" id="restoreFile" accept="application/json" hidden>
      </div>
    </div>
```

- [x] **Step 11.4:** In the `[data-k]` change handler, `["weeks","durationMin"].includes(k)` → `k==="weeks"`.

- [x] **Step 11.5:** `grep -n "sessionTime\|durationMin\|exportICS\|buildICS\|icsBtn" index.html` — Expected: no matches. Parse-check + `pnpm test` — green.

- [x] **Step 11.6:** Commit: `git add -A && git commit -m "feat: retire .ics export — GCal mirror replaces it"`

---

### Task 12: Docs — README prerequisites + smoke checklist, context.md, roadmap.md

**Files:**
- Modify: `README.md`, `context.md`, `roadmap.md`

- [x] **Step 12.1:** README: update the intro (no more "No APIs, no network"; `.ics` gone), update the Files list (`preload.js`, `main/`, new tests), and append:

```markdown
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
```

- [x] **Step 12.2:** `context.md`: update the intro ("no network" → main process talks to Google/Strava), Architecture (add `preload.js`, `main/` modules, the `window.api` seam and V2 promotion note), state shape (drop `sessionTime`/`durationMin`; `activities`/`dismissedActivities` no longer "reserved"), Scope ("planned next" → shipped in v1; `.ics` export removed).

- [x] **Step 12.3:** `roadmap.md`: tick the V1 items (GCal live sync, Strava fetch/compare, bike swap, calendar view, setup tabs were already in plans 1-2 — mark all V1 lines done, e.g. `- [x]`).

- [x] **Step 12.4:** Commit: `git add -A && git commit -m "docs: integration setup, smoke checklist, context/roadmap updates"`

---

### Task 13: Final verification + merge

- [x] **Step 13.1:** `pnpm test` — all green (expect 62 tests: 36 program + 7 snapshot + 13 matcher + 6 gcal). Parse-check `index.html` — `parses OK`. `node --check` all five main-process files.
- [x] **Step 13.2:** `pnpm start` — walk the smoke checklist items that don't need live credentials (file:// degradation, Connections UI states, queue card with seeded data).
- [x] **Step 13.3:** Merge: `git checkout main && git merge --no-ff feat/integrations -m "Merge feat/integrations: OAuth + GCal mirror + Strava sync (plan 3, V1 complete)"`.

---

## Self-review notes

- **Spec coverage:** architecture/files ✓ (Task 5-6), GCal mirror incl. all-day→timed upgrade + self-heal ✓ (Tasks 2, 4, 6, 7), Strava fetch/match/queue ✓ (Tasks 3, 7, 9), plan-vs-actual ✓ (Task 10), `.ics`+settings removal ✓ (Tasks 1, 11), `file://` degradation ✓ (Tasks 7, 8), owner prerequisites ✓ (Task 12). Spec's `js/ui.js`/`js/calendar.js` split is NOT done — plans 1+2 deliberately kept UI in `index.html`; the spec's "handful of plain files" rule is satisfied and re-splitting now is churn (recorded decision: keep).
- **Type consistency:** activity summary `{id, sport, rawType, name, startISO, startLocal, durationSec, movingSec, distanceKm, description}` used identically in matcher (Task 3), snapshot timed upgrade (Task 2: `startISO`+`durationSec`), queue card and actual panel (Tasks 9-10). Event snapshot `{key, date, title, desc, start?, end?}` matches between Task 2 and Task 4. `window.api` names match preload (Task 6) and renderer call sites (Tasks 7-8).
- **Known deviation:** spec stores `activities[dateStr]` with `{sport, startISO, durationSec, distanceKm, name, description}` — we add `rawType`, `startLocal`, `movingSec` (superset, harmless).
