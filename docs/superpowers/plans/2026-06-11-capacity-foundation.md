# Capacity Foundation Implementation Plan (Plan 1 of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the Tactical Barbell Green Protocol "Capacity" 12-week template (lifting wave + LSS running) to the Operator app, with the program engine extracted into a pure, Node-testable module.

**Architecture:** All program math moves from the inline `<script>` in `index.html` into `js/program.js` — a pure module (no DOM, no Electron) exposed as the `Program` namespace in the browser and via `module.exports` under Node. `index.html` keeps thin shim functions so render code barely changes. A template registry replaces the hardcoded 6-week `CYCLE`; session building emits both `lift` and `run` sessions. Storage key bumps `tb-operator-v1` → `tb-operator-v2` with a pure migration function.

**Tech Stack:** Vanilla JS (no build step, no runtime deps), `node --test` + `node:assert` for tests, Electron 31 unchanged.

**Spec:** `docs/superpowers/specs/2026-06-11-operator-v1-design.md`. Plans 2 (Calendar view + tabbed Setup) and 3 (Google Calendar + Strava) follow after this lands. Out of scope here: `.ics` removal, `sessionTime`/`durationMin` removal (they stay until Plan 3 replaces them with GCal sync), any UI beyond keeping the app fully usable.

**Context for the engineer:** Tactical Barbell prescribes lifting as `% of Training Max (TM)`. The existing app encodes one template: a 6-week wave (70/80/90/75/85/95%), TM stepping up `blockStep` kg every 6 weeks. Capacity is a 12-week template: weeks 1-3 / 5-7 / 9-11 load at 70/80/90%, weeks 4 & 8 are deloads (optional light session at 40% TM, 2×5), week 12 has **no lifting** (taper), and TM steps every 4 weeks instead of 6. Runs happen on separate days (default Tue/Thu/Sat), prescribed in minutes — see the table in Task 4.

---

## File map

| File | Status | Responsibility |
| --- | --- | --- |
| `js/program.js` | create | ALL pure program logic: date helpers, defaults, template registry, session building, TM math, rotation, run specs, swap, migration |
| `tests/program.test.js` | create | `node --test` suite for `js/program.js` |
| `index.html` | modify | remove moved logic, add `<script src>` + shims, render `run` sessions, template picker, run-days picker |
| `package.json` | modify | `test` script; `js/` added to electron-builder `files` |
| `context.md`, `README.md` | modify | document the new structure & template (Task 8) |

---

### Task 1: Extract pure logic into `js/program.js`

Pure refactor — zero behavior change. Every extracted function that read the global `state` now takes `state` as its first parameter; `index.html` keeps one-line shims so render code is untouched.

**Files:**
- Create: `js/program.js`
- Modify: `index.html` (delete lines 214–296 region: `CYCLE` through `currentSession`, plus `todayDate`/`ymd`/`parseYMD`/`addDays`/`roundTo` and `defaults`; add script tag + shims)
- Modify: `package.json`

- [ ] **Step 1: Create `js/program.js`** with the extracted code:

```js
"use strict";
/* Pure program logic — no DOM, no Electron. Loaded in the browser as the
   `Program` global, and under Node via require() for tests. */
const Program = (() => {

  const CYCLE = [
    { pct: 0.70, sets: 3, reps: 5 },
    { pct: 0.80, sets: 3, reps: 5 },
    { pct: 0.90, sets: 3, reps: 3 },
    { pct: 0.75, sets: 3, reps: 5, deload: true },
    { pct: 0.85, sets: 3, reps: 3 },
    { pct: 0.95, sets: 3, reps: 1 },
  ];

  /* ---- dates & rounding ---- */
  function todayDate() { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }
  function ymd(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
  function parseYMD(s) { const p = s.split("-").map(Number); return new Date(p[0], p[1] - 1, p[2]); }
  function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
  function roundTo(v, inc) { inc = inc || 2.5; return Math.round(v / inc) * inc; }

  /* ---- defaults ---- */
  function defaults() {
    const t = todayDate();
    const monday = t.getDay() === 0 ? addDays(t, 1) : addDays(t, 1 - t.getDay());
    return {
      theme: "dark", displayName: "Dimitar", startDate: ymd(monday), weeks: 6,
      increment: 2.5, bodyweight: null, sessionTime: "17:30", durationMin: 75,
      liftDays: [1, 3, 5],
      lifts: [
        { id: "fsq", name: "Front Squat", type: "barbell", enabled: true, tm: null, role: "core", blockStep: 5 },
        { id: "sdl", name: "Sumo Deadlift", type: "barbell", enabled: true, tm: null, role: "rotating", blockStep: 5 },
        { id: "wpu", name: "Weighted Pull-up", type: "pullup", enabled: true, tm: null, role: "rotating", blockStep: 2.5 },
        { id: "dbb", name: "DB Bench Press", type: "db", enabled: true, tm: null, role: "core", blockStep: 2.5 },
      ],
      status: {}, readiness: {}, sessionPick: {}, rotSchedule: { 1: "wpu", 3: "sdl", 5: "wpu" },
    };
  }

  /* ---- lift selectors ---- */
  function enabledLifts(state) { return state.lifts.filter(l => l.enabled); }
  function coreLifts(state) { return enabledLifts(state).filter(l => (l.role || "core") === "core"); }
  function rotatingLifts(state) { return enabledLifts(state).filter(l => l.role === "rotating"); }
  function hasAnyTM(state) { return enabledLifts(state).some(l => l.tm != null && !isNaN(l.tm)); }

  /* ---- session building ---- */
  function buildSessions(state) {
    const start = parseYMD(state.startDate);
    const days = state.liftDays.slice().sort((a, b) => a - b);
    const out = []; let idx = 0;
    for (let w = 0; w < state.weeks; w++) {
      const ws = addDays(start, w * 7); const cyc = CYCLE[w % CYCLE.length]; const wsd = ws.getDay();
      const dates = days.map(dow => addDays(ws, (dow - wsd + 7) % 7)).sort((a, b) => a - b);
      dates.forEach(date => out.push({ kind: "lift", date, dateStr: ymd(date), week: w + 1, pct: cyc.pct, sets: cyc.sets, reps: cyc.reps, deload: !!cyc.deload, idx: idx++ }));
    }
    return out;
  }

  function blockOf(state, week) { return Math.floor((week - 1) / CYCLE.length); }

  function effectiveTM(state, lift, week) {
    if (lift.tm == null || isNaN(lift.tm)) return null;
    return lift.tm + (lift.blockStep || 0) * blockOf(state, week);
  }

  /* ---- rotation ---- */
  function rotForWeekday(state, dow) {
    const rot = rotatingLifts(state); if (!rot.length) return null;
    const bySched = rot.find(l => l.id === state.rotSchedule[dow]); if (bySched) return bySched;
    const days = state.liftDays.slice().sort((a, b) => a - b); const pos = days.indexOf(dow);
    return rot[(pos < 0 ? 0 : pos) % rot.length];
  }
  function chosenRotating(state, session) {
    const rot = rotatingLifts(state); if (!rot.length) return null;
    const picked = state.sessionPick[session.dateStr];
    return rot.find(l => l.id === picked) || rotForWeekday(state, session.date.getDay());
  }
  function sessionLifts(state, session) {
    const ch = chosenRotating(state, session);
    return ch ? [...coreLifts(state), ch] : coreLifts(state);
  }

  /* ---- targets ---- */
  function targetFor(state, lift, pct, week) {
    const tm = effectiveTM(state, lift, week);
    if (tm == null) return { ref: lift, target: null, bw: lift.type === "pullup" };
    const t = roundTo(pct * tm, state.increment);
    let added = null; if (lift.type === "pullup" && state.bodyweight) added = +(t - state.bodyweight).toFixed(1);
    return { ref: lift, target: t, added, tm, projected: blockOf(state, week) > 0 };
  }
  function sessionTargets(state, session) { return sessionLifts(state, session).map(l => targetFor(state, l, session.pct, session.week)); }

  function currentSession(state, sessions) {
    const t = ymd(todayDate());
    return sessions.find(x => x.dateStr === t) || sessions.find(x => x.dateStr >= t) || sessions[sessions.length - 1] || null;
  }

  return {
    CYCLE, todayDate, ymd, parseYMD, addDays, roundTo, defaults,
    enabledLifts, coreLifts, rotatingLifts, hasAnyTM,
    buildSessions, blockOf, effectiveTM,
    rotForWeekday, chosenRotating, sessionLifts,
    targetFor, sessionTargets, currentSession,
  };
})();
if (typeof module !== "undefined" && module.exports) module.exports = Program;
```

Note the single intentional change: sessions now carry `kind: "lift"` (used from Task 4 on; harmless to existing render code).

- [ ] **Step 2: Update `index.html`.** Immediately before the existing `<script>` tag (line 211), add:

```html
<script src="js/program.js"></script>
```

Then inside the main script, **delete** the following (they now live in `js/program.js`): the `CYCLE` const, `todayDate`, `ymd`, `parseYMD`, `addDays`, `roundTo`, `defaults`, `enabledLifts`, `coreLifts`, `rotatingLifts`, `hasAnyTM`, `buildSessions`, `blockOf`, `effectiveTM`, `rotForWeekday`, `chosenRotating`, `sessionLifts`, `targetFor`, `sessionTargets`, `currentSession`. **Keep** `DOW`, `KEY`, `ICONS`, `pad`, `fmt`, `load`, `save`, and everything below `/* ---- render ---- */`.

In place of the deleted block, add these shims (right after `const ICONS={...};`):

```js
const { CYCLE, todayDate, ymd, parseYMD, addDays, roundTo } = Program;
const defaults = () => Program.defaults();
const enabledLifts = () => Program.enabledLifts(state);
const coreLifts = () => Program.coreLifts(state);
const rotatingLifts = () => Program.rotatingLifts(state);
const hasAnyTM = () => Program.hasAnyTM(state);
const buildSessions = () => Program.buildSessions(state);
const blockOf = (w) => Program.blockOf(state, w);
const effectiveTM = (l, w) => Program.effectiveTM(state, l, w);
const rotForWeekday = (d) => Program.rotForWeekday(state, d);
const chosenRotating = (s) => Program.chosenRotating(state, s);
const sessionLifts = (s) => Program.sessionLifts(state, s);
const targetFor = (l, p, w) => Program.targetFor(state, l, p, w);
const sessionTargets = (s) => Program.sessionTargets(state, s);
const currentSession = (s) => Program.currentSession(state, s);
```

Caution: `let state = load();` must stay **below** the shims (shims close over `state` lazily, so order vs. `load()` matters only for `defaults`, which doesn't use `state`). The existing line `let state=load(); let activeTab="today";` works unchanged.

- [ ] **Step 3: Update `package.json`** — add a test script and ship `js/` in builds:

```json
  "scripts": {
    "start": "electron .",
    "test": "node --test tests/",
    "dist": "electron-builder",
    "dist:mac": "electron-builder --mac",
    "dist:win": "electron-builder --win",
    "dist:linux": "electron-builder --linux"
  },
```

and in `build.files`:

```json
    "files": [
      "index.html",
      "js/**",
      "main.js",
      "package.json"
    ],
```

- [ ] **Step 4: Smoke-verify the module loads under Node**

Run: `node -e "const P=require('./js/program.js');const s=P.defaults();console.log(P.buildSessions(s).length, P.buildSessions(s)[0].kind)"`
Expected: `18 lift`

- [ ] **Step 5: Verify the app still works**

Run: `pnpm start` — check Today shows targets (set a TM in Setup if blank), Program lists 6 weeks, Progress chart renders, theme toggles. Also open `index.html` directly in a browser (file://) and confirm the same.

- [ ] **Step 6: Commit**

```bash
git add js/program.js index.html package.json
git commit -m "refactor: extract pure program logic into js/program.js"
```

---

### Task 2: Characterization tests for existing Operator behavior

Lock current behavior before the template refactor. `2026-01-05` is a Monday — all tests pin `startDate` to it.

**Files:**
- Create: `tests/program.test.js`

- [ ] **Step 1: Write the tests**

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

test("operator6: 6 weeks x 3 lift days = 18 sessions, Mon/Wed/Fri", () => {
  const s = baseState();
  const sess = Program.buildSessions(s);
  assert.equal(sess.length, 18);
  assert.equal(sess[0].dateStr, "2026-01-05");
  assert.deepEqual([...new Set(sess.map(x => x.date.getDay()))].sort(), [1, 3, 5]);
});

test("operator6: wave is 70/80/90/75/85/95 with deload on week 4", () => {
  const s = baseState();
  const byWeek = w => Program.buildSessions(s).find(x => x.week === w);
  assert.equal(byWeek(1).pct, 0.70);
  assert.equal(byWeek(3).pct, 0.90);
  assert.equal(byWeek(3).reps, 3);
  assert.equal(byWeek(4).pct, 0.75);
  assert.equal(byWeek(4).deload, true);
  assert.equal(byWeek(6).pct, 0.95);
  assert.equal(byWeek(6).reps, 1);
});

test("operator6: TM steps by blockStep every 6 weeks", () => {
  const s = baseState({ weeks: 12 });
  const fsq = s.lifts.find(l => l.id === "fsq");
  assert.equal(Program.effectiveTM(s, fsq, 6), 85);
  assert.equal(Program.effectiveTM(s, fsq, 7), 90);   // +5 lower body
  const wpu = s.lifts.find(l => l.id === "wpu");
  assert.equal(Program.effectiveTM(s, wpu, 7), 92.5); // +2.5 upper body
});

test("targets: rounded to increment; pull-up shows added load over bodyweight", () => {
  const s = baseState();
  const fsq = s.lifts.find(l => l.id === "fsq");
  assert.equal(Program.targetFor(s, fsq, 0.70, 1).target, 60); // 59.5 -> 60
  const wpu = s.lifts.find(l => l.id === "wpu");
  const t = Program.targetFor(s, wpu, 0.70, 1);
  assert.equal(t.target, 62.5);
  assert.equal(t.added, -17.5); // below bodyweight -> negative added (assisted/band)
});

test("rotation: rotSchedule fixes the weekly pattern; sessionPick overrides one day", () => {
  const s = baseState();
  const sess = Program.buildSessions(s);
  const mon = sess[0], wed = sess[1];
  assert.equal(Program.chosenRotating(s, mon).id, "wpu");
  assert.equal(Program.chosenRotating(s, wed).id, "sdl");
  s.sessionPick[mon.dateStr] = "sdl";
  assert.equal(Program.chosenRotating(s, mon).id, "sdl");
  assert.equal(Program.sessionLifts(s, mon).length, 3); // 2 core + 1 rotating
});
```

- [ ] **Step 2: Run the tests**

Run: `pnpm test`
Expected: `tests 5` / `pass 5` (these characterize existing behavior, so they pass immediately — if any fails, Task 1's extraction changed behavior: stop and fix that first).

- [ ] **Step 3: Commit**

```bash
git add tests/program.test.js
git commit -m "test: characterization tests for operator6 program logic"
```

---

### Task 3: Template registry — `operator6` + `capacity12` lifting wave

**Files:**
- Modify: `js/program.js`
- Modify: `tests/program.test.js`
- Modify: `index.html` (one shim + two render references)

- [ ] **Step 1: Write the failing tests** (append to `tests/program.test.js`):

```js
function capacityState(over = {}) {
  return Object.assign(baseState(), { template: "capacity12", weeks: 12 }, over);
}

test("capacity12: weeks 1-3 load 70/80/90, schemes 3x5/3x5/3x3", () => {
  const s = capacityState();
  assert.deepEqual(Program.weekSpec(s, 1), { pct: 0.70, sets: 3, reps: 5 });
  assert.deepEqual(Program.weekSpec(s, 2), { pct: 0.80, sets: 3, reps: 5 });
  assert.deepEqual(Program.weekSpec(s, 3), { pct: 0.90, sets: 3, reps: 3 });
});

test("capacity12: weeks 4 and 8 are optional 40% 2x5 deloads", () => {
  const s = capacityState();
  for (const w of [4, 8]) {
    const spec = Program.weekSpec(s, w);
    assert.equal(spec.pct, 0.40);
    assert.equal(spec.sets, 2);
    assert.equal(spec.reps, 5);
    assert.equal(spec.deload, true);
    assert.equal(spec.optional, true);
  }
});

test("capacity12: week 12 has no lifting at all", () => {
  const s = capacityState();
  assert.equal(Program.weekSpec(s, 12), null);
  const sess = Program.buildSessions(s);
  assert.equal(sess.filter(x => x.week === 12 && x.kind === "lift").length, 0);
  assert.equal(sess.filter(x => x.kind === "lift").length, 33); // 11 lifting weeks x 3 days
});

test("capacity12: TM steps every 4 weeks (after weeks 4 and 8)", () => {
  const s = capacityState();
  const fsq = s.lifts.find(l => l.id === "fsq");
  assert.equal(Program.effectiveTM(s, fsq, 4), 85);
  assert.equal(Program.effectiveTM(s, fsq, 5), 90);
  assert.equal(Program.effectiveTM(s, fsq, 9), 95);
});

test("operator6 unchanged: weekSpec mirrors CYCLE", () => {
  const s = baseState();
  assert.equal(Program.weekSpec(s, 4).pct, 0.75);
  assert.equal(Program.weekSpec(s, 7).pct, 0.70); // wave repeats past template length
});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `pnpm test`
Expected: 5 pass, 5 fail with `Program.weekSpec is not a function`.

- [ ] **Step 3: Implement the registry in `js/program.js`.** Below the `CYCLE` const, add:

```js
  const L = (pct, sets, reps, extra) => Object.assign({ pct, sets, reps }, extra || {});
  const DELOAD_LIFT = { pct: 0.40, sets: 2, reps: 5, deload: true, optional: true };

  const TEMPLATES = {
    operator6: {
      id: "operator6", label: "Operator — 6-week peak",
      weeks: 6, tmStepEvery: 6,
      lift: CYCLE.map(c => L(c.pct, c.sets, c.reps, c.deload ? { deload: true } : null)),
      endurance: null,
    },
    capacity12: {
      id: "capacity12", label: "Capacity — Green Protocol 12-week",
      weeks: 12, tmStepEvery: 4,
      lift: [
        L(0.70, 3, 5), L(0.80, 3, 5), L(0.90, 3, 3), DELOAD_LIFT,
        L(0.70, 3, 5), L(0.80, 3, 5), L(0.90, 3, 3), DELOAD_LIFT,
        L(0.70, 3, 5), L(0.80, 3, 5), L(0.90, 3, 3), null, // wk 12: taper, no lifting
      ],
      endurance: null, // filled in Task 4
    },
  };

  function template(state) { return TEMPLATES[state.template] || TEMPLATES.operator6; }

  function weekSpec(state, week) {
    const t = template(state);
    const raw = t.lift[(week - 1) % t.weeks];
    if (raw == null) return null;
    return raw;
  }
```

Replace `blockOf` and rewrite `buildSessions`'s lift loop to use the spec:

```js
  function blockOf(state, week) { return Math.floor((week - 1) / template(state).tmStepEvery); }

  function buildSessions(state) {
    const start = parseYMD(state.startDate);
    const days = state.liftDays.slice().sort((a, b) => a - b);
    const out = []; let idx = 0;
    for (let w = 0; w < state.weeks; w++) {
      const week = w + 1;
      const ws = addDays(start, w * 7); const wsd = ws.getDay();
      const dateFor = dow => addDays(ws, (dow - wsd + 7) % 7);
      const spec = weekSpec(state, week);
      if (spec) {
        days.map(dateFor).sort((a, b) => a - b).forEach(date =>
          out.push({ kind: "lift", date, dateStr: ymd(date), week, pct: spec.pct, sets: spec.sets, reps: spec.reps, deload: !!spec.deload, optional: !!spec.optional, idx: idx++ }));
      }
    }
    return out;
  }
```

Add `TEMPLATES`, `template`, `weekSpec` to the returned export object. Also add `template: "operator6"` to the object returned by `defaults()` (right before `theme`).

- [ ] **Step 4: Update `index.html`.** Add to the shims: `const weekSpec = (w) => Program.weekSpec(state, w);`. Then fix the two render sites that index `CYCLE` directly:
  - In `renderProgram`, replace `if((wk-1)%CYCLE.length===0 && wk>1){` with `if((wk-1)%Program.template(state).weeks===0 && wk>1){`.
  - In `renderProgress`, replace the whole segment `const pts=[];for(let w=1;w<=state.weeks;w++)pts.push({w,v:roundTo(CYCLE[(w-1)%CYCLE.length].pct*effectiveTM(lift,w),state.increment)});chart=svgChart(pts);` with:

```js
const pts=[];for(let w=1;w<=state.weeks;w++){const sp=weekSpec(w);if(sp)pts.push({w,v:roundTo(sp.pct*effectiveTM(lift,w),state.increment)});}
chart=svgChart(pts,Program.template(state).weeks);
```

  - In `svgChart`, change the signature to `function svgChart(pts,blkWeeks)` and replace `const BLK=CYCLE.length;` with `const BLK=blkWeeks||6;`.
  - Remove `CYCLE` from the destructuring shim line (nothing references it anymore).

- [ ] **Step 5: Run tests**

Run: `pnpm test`
Expected: `pass 10`.

- [ ] **Step 6: Verify app** — `pnpm start`, Program view still renders 6 weeks for the default template.

- [ ] **Step 7: Commit**

```bash
git add js/program.js tests/program.test.js index.html
git commit -m "feat: template registry with capacity12 lifting wave (40% deloads, week-12 taper, 4-week TM step)"
```

---

### Task 4: Capacity endurance table + merged session building

**Files:**
- Modify: `js/program.js`
- Modify: `tests/program.test.js`

- [ ] **Step 1: Write the failing tests** (append):

```js
test("capacity12: run sessions on runDays with the book's prescriptions", () => {
  const s = capacityState(); // defaults runDays [2,4,6] = Tue/Thu/Sat
  const sess = Program.buildSessions(s);
  const runs = sess.filter(x => x.kind === "run");
  assert.equal(runs.length, 36); // 12 weeks x 3
  assert.deepEqual([...new Set(runs.map(x => x.date.getDay()))].sort(), [2, 4, 6]);
  const w1 = runs.filter(x => x.week === 1);
  assert.deepEqual(w1[0].run, { type: "range", lo: 30, hi: 60 });
  assert.deepEqual(w1[2].run, { type: "range", lo: 60, hi: 90 });
});

test("capacity12: deload weeks run 3x30, week 9+ has 120'+, week 12 ends in the 6-mile test", () => {
  const s = capacityState();
  const runs = Program.buildSessions(s).filter(x => x.kind === "run");
  assert.deepEqual(runs.filter(x => x.week === 4).map(x => x.run), [
    { type: "fixed", min: 30 }, { type: "fixed", min: 30 }, { type: "fixed", min: 30 }]);
  assert.deepEqual(runs.filter(x => x.week === 9)[2].run, { type: "plus", lo: 120 });
  const w12 = runs.filter(x => x.week === 12);
  assert.deepEqual(w12[2].run, { type: "test", name: "6-Mile Test", targetMin: 60 });
});

test("runLabel renders every spec type", () => {
  assert.equal(Program.runLabel({ type: "range", lo: 30, hi: 60 }), "30–60′");
  assert.equal(Program.runLabel({ type: "fixed", min: 30 }), "30′");
  assert.equal(Program.runLabel({ type: "plus", lo: 120 }), "120′+");
  assert.equal(Program.runLabel({ type: "test", name: "6-Mile Test", targetMin: 60 }), "6-Mile Test");
});

test("operator6 emits no run sessions; sessions stay date-sorted", () => {
  const s = baseState();
  assert.equal(Program.buildSessions(s).filter(x => x.kind === "run").length, 0);
  const c = capacityState();
  const all = Program.buildSessions(c);
  for (let i = 1; i < all.length; i++) assert.ok(all[i - 1].date <= all[i].date);
});
```

- [ ] **Step 2: Run tests** — Expected: the 4 new tests fail (`runs.length` 0, `runLabel` not a function).

- [ ] **Step 3: Implement in `js/program.js`.** Below `DELOAD_LIFT`, add:

```js
  const R = (lo, hi) => ({ type: "range", lo, hi });
  const F = (min) => ({ type: "fixed", min });
  const P = (lo) => ({ type: "plus", lo });
  const TEST_6MI = { type: "test", name: "6-Mile Test", targetMin: 60 };

  // Green Protocol Capacity LSS table — minutes, three run slots per week.
  const CAPACITY_RUNS = [
    [R(30, 60), R(30, 60), R(60, 90)],     // wk 1
    [R(30, 60), R(30, 60), R(60, 90)],     // wk 2
    [R(30, 60), R(30, 60), R(60, 90)],     // wk 3
    [F(30), F(30), F(30)],                 // wk 4 deload
    [R(60, 90), R(60, 90), R(90, 120)],    // wk 5
    [R(60, 90), R(60, 90), R(90, 120)],    // wk 6
    [R(60, 90), R(60, 90), R(90, 120)],    // wk 7
    [F(30), F(30), F(30)],                 // wk 8 deload
    [R(60, 120), R(60, 120), P(120)],      // wk 9
    [R(60, 120), R(60, 120), P(120)],      // wk 10
    [R(60, 120), R(60, 120), P(120)],      // wk 11
    [F(30), F(30), TEST_6MI],              // wk 12 taper + test
  ];
```

Set `endurance: CAPACITY_RUNS` in `TEMPLATES.capacity12` (replacing the `null`). Add below `weekSpec`:

```js
  function runSpecAt(state, week, slot) {
    const t = template(state);
    if (!t.endurance) return null;
    const ov = (state.enduranceOverrides || {})[week];
    if (ov && ov[slot]) return ov[slot];
    return t.endurance[(week - 1) % t.weeks][slot] || null;
  }

  function runLabel(spec) {
    if (!spec) return "";
    if (spec.type === "range") return spec.lo + "–" + spec.hi + "′";
    if (spec.type === "fixed") return spec.min + "′";
    if (spec.type === "plus") return spec.lo + "′+";
    if (spec.type === "test") return spec.name;
    return "";
  }
```

In `buildSessions`, after the `if (spec) {...}` lift block and still inside the week loop, add:

```js
      const t = template(state);
      if (t.endurance) {
        (state.runDays || []).slice().sort((a, b) => a - b).forEach((dow, slot) => {
          const rs = runSpecAt(state, week, slot);
          if (rs) out.push({ kind: "run", date: dateFor(dow), dateStr: ymd(dateFor(dow)), week, slot, run: rs });
        });
      }
```

and after the week loop ends, sort + index the merged list (replace the bare `return out;`):

```js
    out.sort((a, b) => a.date - b.date || (a.kind === "lift" ? -1 : 1));
    out.forEach((s, i) => { s.idx = i; });
    return out;
```

(also delete the now-redundant `idx: idx++` in the lift push and the `let idx = 0;`).

Add to `defaults()`: `runDays: [2, 4, 6], enduranceOverrides: {},` (after `liftDays`). Export `runSpecAt`, `runLabel`, `CAPACITY_RUNS`.

- [ ] **Step 4: Run tests** — Expected: `pass 14`.

- [ ] **Step 5: Commit**

```bash
git add js/program.js tests/program.test.js
git commit -m "feat: capacity endurance table and merged lift+run session building"
```

---

### Task 5: Bike swap + endurance overrides

**Files:**
- Modify: `js/program.js`
- Modify: `tests/program.test.js`

- [ ] **Step 1: Write the failing tests** (append):

```js
test("sportFor: runs default to 'run', swap to 'bike' per date, lifts are 'lift'", () => {
  const s = capacityState();
  const sess = Program.buildSessions(s);
  const run = sess.find(x => x.kind === "run");
  const lift = sess.find(x => x.kind === "lift");
  assert.equal(Program.sportFor(s, run), "run");
  s.sessionSwap[run.dateStr] = "bike";
  assert.equal(Program.sportFor(s, run), "bike");
  assert.equal(Program.sportFor(s, lift), "lift");
});

test("enduranceOverrides: sparse per-week/slot override wins over the book table", () => {
  const s = capacityState();
  s.enduranceOverrides[2] = { 1: { type: "fixed", min: 45 } };
  assert.deepEqual(Program.runSpecAt(s, 2, 1), { type: "fixed", min: 45 });
  assert.deepEqual(Program.runSpecAt(s, 2, 0), { type: "range", lo: 30, hi: 60 }); // untouched slot
  assert.deepEqual(Program.runSpecAt(s, 3, 1), { type: "range", lo: 30, hi: 60 }); // untouched week
});
```

- [ ] **Step 2: Run tests** — Expected: 2 new failures (`sessionSwap` undefined / `sportFor` not a function).

- [ ] **Step 3: Implement.** In `js/program.js` add `sessionSwap: {},` to `defaults()` (after `enduranceOverrides`), and:

```js
  function sportFor(state, session) {
    if (session.kind !== "run") return "lift";
    return (state.sessionSwap || {})[session.dateStr] === "bike" ? "bike" : "run";
  }
```

Export `sportFor`. (`runSpecAt` already honors overrides from Task 4 — the test locks it.)

- [ ] **Step 4: Run tests** — Expected: `pass 16`.

- [ ] **Step 5: Commit**

```bash
git add js/program.js tests/program.test.js
git commit -m "feat: per-date bike swap and endurance override coverage"
```

---

### Task 6: v1 → v2 storage migration

**Files:**
- Modify: `js/program.js`
- Modify: `tests/program.test.js`
- Modify: `index.html` (`KEY` const + `load()`)

- [ ] **Step 1: Write the failing tests** (append):

```js
test("migrateV1: adds v2 fields, defaults to operator6, preserves user data", () => {
  const old = {
    theme: "light", displayName: "D", startDate: "2025-11-03", weeks: 6,
    increment: 2.5, bodyweight: 79, sessionTime: "17:30", durationMin: 75,
    liftDays: [1, 3, 5],
    lifts: [{ id: "fsq", name: "Front Squat", type: "barbell", enabled: true, tm: 82.5, role: "core", blockStep: 5 }],
    status: { "2025-11-03": "done" }, readiness: { "2025-11-03": "green" },
    sessionPick: {}, rotSchedule: { 1: "wpu" },
  };
  const v2 = Program.migrateV1(old);
  assert.equal(v2.template, "operator6");
  assert.deepEqual(v2.runDays, [2, 4, 6]);
  assert.deepEqual(v2.enduranceOverrides, {});
  assert.deepEqual(v2.sessionSwap, {});
  assert.deepEqual(v2.activities, {});
  assert.deepEqual(v2.dismissedActivities, []);
  assert.equal(v2.status["2025-11-03"], "done");      // history survives
  assert.equal(v2.lifts[0].tm, 82.5);                  // TMs survive
  assert.equal(v2.theme, "light");
  assert.equal(Program.STORAGE_KEY, "tb-operator-v2");
  assert.equal(Program.LEGACY_KEY, "tb-operator-v1");
});
```

- [ ] **Step 2: Run tests** — Expected: fails with `Program.migrateV1 is not a function`.

- [ ] **Step 3: Implement.** In `js/program.js`:

```js
  const STORAGE_KEY = "tb-operator-v2";
  const LEGACY_KEY = "tb-operator-v1";

  function migrateV1(old) {
    return Object.assign(defaults(), old, {
      template: "operator6",
      runDays: [2, 4, 6],
      enduranceOverrides: {}, sessionSwap: {},
      activities: {}, dismissedActivities: [],
    });
  }
```

Also add `activities: {}, dismissedActivities: [],` to `defaults()` (Plan 3 fills them; migration shape must be final now). Export `STORAGE_KEY`, `LEGACY_KEY`, `migrateV1`.

In `index.html`, delete `const KEY="tb-operator-v1";` and replace `load()`/`save()`:

```js
function load(){
  try{
    const r=localStorage.getItem(Program.STORAGE_KEY);
    if(r)return Object.assign(Program.defaults(),JSON.parse(r));
    const legacy=localStorage.getItem(Program.LEGACY_KEY);
    if(legacy)return Program.migrateV1(JSON.parse(legacy));  // v1 left untouched as backup
    return Program.defaults();
  }catch(e){return Program.defaults();}
}
function save(){try{localStorage.setItem(Program.STORAGE_KEY,JSON.stringify(state));}catch(e){}}
```

- [ ] **Step 4: Run tests** — Expected: `pass 17`.

- [ ] **Step 5: Verify migration live** — `pnpm start` with existing v1 data present: app shows the same TMs/status as before; DevTools → `localStorage` has both keys after any edit.

- [ ] **Step 6: Commit**

```bash
git add js/program.js tests/program.test.js index.html
git commit -m "feat: tb-operator-v2 storage with one-time v1 migration"
```

---

### Task 7: UI wiring — run sessions, template picker, run days

Minimal UI so Capacity is fully usable today; the full Calendar view and tabbed Setup land in Plan 2. All changes in `index.html`.

**Files:**
- Modify: `index.html` (`renderToday`, `renderProgram`, `renderSetup`, `buildICS`, CSS)

- [ ] **Step 1: Add a `select` style** next to the input rule in the CSS (line ~165):

```css
  select{font-family:var(--mono);font-size:13px;background:var(--inset);border:1px solid var(--line);color:var(--text);border-radius:8px;padding:9px 11px}
  select:focus{outline:none;border-color:var(--accent)}
  .kg.run{color:#5fd3c2}
```

Add a `--teal:#5fd3c2;` custom property in `:root` and `[data-theme="light"]{--teal:#0e8a78;}`, then use `color:var(--teal)` instead of the hex in `.kg.run`.

- [ ] **Step 2: Today — render run sessions.** At the top of `renderToday`, after `const cur=currentSession(sessions);`, add the branch `if(cur&&cur.kind==="run"){renderTodayRun(root,cur);return;}` **before** the `!hasAnyTM()` empty-state check (a run day needs no TM). Then add the new function after `renderToday`:

```js
function renderTodayRun(root,cur){
  const isToday=cur.dateStr===ymd(todayDate());
  const d=cur.date;const dateLabel=DOW[d.getDay()]+" "+d.getDate()+" "+d.toLocaleString("en",{month:"short"});
  const sport=Program.sportFor(state,cur);
  const st=state.status[cur.dateStr]||null;
  const r=state.readiness[cur.dateStr]||null;
  const done=Object.values(state.status).filter(v=>v==="done").length;
  const label=Program.runLabel(cur.run);
  const title=cur.run.type==="test"?cur.run.name:(sport==="bike"?"LSS Bike":"LSS Run");
  const hint=cur.run.type==="test"?("Benchmark — target under "+cur.run.targetMin+":00, flat course.")
    :cur.run.type==="fixed"?"Deload pace. Conversational, flat terrain — recharge, don't train."
    :"Stay in the low aerobic range. Alternate easy/hard: long last time → go shorter today.";
  const nudges={green:`<b>Green.</b> Run it as prescribed.`,amber:`<b>Amber.</b> Bottom of the range, easy pace.`,red:`<b>Red.</b> Shortest option, or swap to bike / skip.`};
  root.innerHTML=`
    <div class="greet">${escapeHtml(greeting())}</div>
    <div class="sub">You're in <b>week ${cur.week}</b> of your block. ${isToday?"Today":"Next session ("+dateLabel+")"}: <b>${escapeHtml(title)} ${escapeHtml(label)}</b>.</div>
    <div class="stats">
      <div class="stat a"><div class="n mono">${pad(cur.week)}</div><div class="l">Current week</div></div>
      <div class="stat am"><div class="n mono">${escapeHtml(label)}</div><div class="l">Prescribed</div></div>
      <div class="stat g"><div class="n mono">${done}</div><div class="l">Sessions done</div></div>
      <div class="stat"><div class="n mono">${d.getDate()} ${d.toLocaleString("en",{month:"short"})}</div><div class="l">${isToday?"Today":"Next up"}</div></div>
    </div>
    <div class="card">
      <div class="card-head"><h3>${isToday?"Today's session":"Next session"}</h3><span class="meta">${dateLabel}</span></div>
      <div class="lift-row"><div class="lift-meta"><div class="lift-name">${escapeHtml(title)}</div>
        <div class="lift-scheme">${escapeHtml(hint)}</div></div>
        <div class="lift-val"><div class="kg run">${escapeHtml(label)}</div></div></div>
    </div>
    <div class="readiness" id="readiness">
      <button class="rb" data-r="green" ${r==="green"?'data-on="green"':""}>Green</button>
      <button class="rb" data-r="amber" ${r==="amber"?'data-on="amber"':""}>Amber</button>
      <button class="rb" data-r="red" ${r==="red"?'data-on="red"':""}>Red</button>
    </div>
    <div class="nudge">${r?nudges[r]:"Tap how you feel to gate the session."}</div>
    <div class="actions">
      <button class="btn" id="swapBtn">${sport==="bike"?"Back to run":"Swap to bike"}</button>
      <button class="btn" id="doneBtn" ${st==="done"?'data-state="done"':""}>${st==="done"?"✓ Done":"Mark done"}</button>
      <button class="btn ghost" id="skipBtn" ${st==="skipped"?'data-state="skipped"':""}>${st==="skipped"?"Skipped":"Skip"}</button>
    </div>`;
  root.querySelector("#readiness").addEventListener("click",e=>{const b=e.target.closest(".rb");if(!b)return;const v=b.dataset.r;state.readiness[cur.dateStr]=state.readiness[cur.dateStr]===v?undefined:v;save();render();});
  root.querySelector("#swapBtn").onclick=()=>{if(state.sessionSwap[cur.dateStr]==="bike")delete state.sessionSwap[cur.dateStr];else state.sessionSwap[cur.dateStr]="bike";save();render();};
  root.querySelector("#doneBtn").onclick=()=>{state.status[cur.dateStr]=st==="done"?undefined:"done";save();render();};
  root.querySelector("#skipBtn").onclick=()=>{state.status[cur.dateStr]=st==="skipped"?undefined:"skipped";save();render();};
}
```

Also in `renderToday` (lift branch), surface Capacity deloads by replacing the existing `card-head` line with:

```js
<div class="card-head"><h3>${isToday?"Today's session":"Next session"}${cur.optional?' · <span style="color:var(--amber)">Deload — do not add plates</span>':""}</h3><span class="meta">${dateLabel} · ${cur.sets}×${cur.reps}</span></div>
```

- [ ] **Step 3: Program list — handle run sessions and lift-less weeks.** In `renderProgram`, the week header derives from `ss[0]` which may now be a run. Replace the `Object.keys(byWeek)...forEach` body's first two lines (`const ss=byWeek[wk];const c=ss[0];const isC=wk===curWeek;`) with:

```js
    const ss=byWeek[wk];const isC=wk===curWeek;const sp=weekSpec(wk);
```

and replace the `html+=` week-head line with:

```js
    const headPct=sp?`<span class="wk-pct">${Math.round(sp.pct*100)}%</span>`:`<span class="wk-pct" style="color:var(--amber)">TAPER</span>`;
    const headScheme=sp?`<span class="wk-scheme">${sp.sets}×${sp.reps}</span>`:`<span class="wk-scheme">runs only</span>`;
    html+=`<div class="wk ${isC?"cur":""}"><div class="wk-head"><span class="wk-no">WK ${pad(wk)}</span>${headPct}${isC?'<span class="cur-badge">CURRENT</span>':""}${sp&&sp.deload?'<span class="cur-badge" style="color:var(--amber);border-color:color-mix(in srgb,var(--amber) 45%,transparent)">DELOAD</span>':""}${headScheme}</div>`;
```

Inside the `ss.forEach(s=>{...})`, branch on kind — replace the `const tg=...; const loads=...;` pair with:

```js
      let loads;
      if(s.kind==="run"){
        const sport=Program.sportFor(state,s);
        loads=(sport==="bike"?"LSS Bike ":"LSS Run ")+Program.runLabel(s.run);
      }else{
        const tg=sessionTargets(s).filter(t=>t.target!=null||t.bw);
        loads=tg.length?tg.map(t=>t.bw?shortName(t.ref.name)+" BW":shortName(t.ref.name)+" "+fmt(t.target)+(t.ref.type==="db"?"/h":"")).join("   ·   "):"set training maxes →";
      }
```

Update the `sub` line in `renderProgram` to be template-aware — replace it with:

```js
  const t=Program.template(state);
  let html=`<div class="view-title">Program</div><div class="sub">${state.weeks} weeks · ${t.label}${t.endurance?` · runs ${state.runDays.slice().sort((a,b)=>a-b).map(d=>DOW[d]).join("/")}`:""}</div>`;
```

- [ ] **Step 4: Setup — template picker + run days.** In `renderSetup`, inside the Program `group`, after the "Week 1 start" field, add:

```js
      <div class="field"><label>Template <span class="hint">lifting wave & endurance</span></label>
        <select data-template>${Object.values(Program.TEMPLATES).map(t=>`<option value="${t.id}" ${state.template===t.id?"selected":""}>${t.label}</option>`).join("")}</select></div>
```

After the Lift-days group, add a run-days group (only rendered for templates with endurance):

```js
    ${Program.template(state).endurance?`<div class="group"><span class="eyebrow">Run days (LSS)</span><div class="days" id="runDays">${[1,2,3,4,5,6,0].map(d=>`<button class="day" data-day="${d}" aria-pressed="${state.runDays.includes(d)}">${DOW[d][0]}</button>`).join("")}</div><p class="note">Three slots per week, matched in order to the book's table (slot 3 is the long one). Edits to individual weeks come with the Endurance tab in the next release.</p></div>`:""}
```

Wire them in the handler section:

```js
  const tplSel=root.querySelector("[data-template]");
  if(tplSel)tplSel.addEventListener("change",()=>{
    const id=tplSel.value;const t=Program.TEMPLATES[id];
    if(!confirm(`Switch to ${t.label}? Done/skipped history is kept; the wave and schedule change.`)){renderSetup(root);return;}
    state.template=id;state.weeks=t.weeks;save();render();toast(t.label);
  });
  const rd=root.querySelector("#runDays");
  if(rd)rd.addEventListener("click",e=>{const b=e.target.closest(".day");if(!b)return;const d=Number(b.dataset.day);const i=state.runDays.indexOf(d);if(i>=0){if(state.runDays.length>1)state.runDays.splice(i,1);}else state.runDays.push(d);save();renderSetup(root);});
```

Also fix the block-step eyebrow text (no longer always 6): change to `Block step — kg added to each TM per block (every ${Program.template(state).tmStepEvery} weeks)`.

- [ ] **Step 5: `.ics` export — don't crash on run sessions.** In `buildICS`'s `sessions.forEach(s=>{...})`, wrap the existing body so runs export too — replace the `const tg=...` through `lines.push(...)` block with:

```js
    const so=new Date(s.date);so.setHours(hh,mm,0,0);const eo=new Date(so.getTime()+state.durationMin*60000);
    const f=d=>d.getFullYear()+pad(d.getMonth()+1)+pad(d.getDate())+"T"+pad(d.getHours())+pad(d.getMinutes())+"00";
    let summary,desc;
    if(s.kind==="run"){
      const sport=Program.sportFor(state,s)==="bike"?"LSS Bike":"LSS Run";
      summary="Operator — "+sport+" "+Program.runLabel(s.run);
      desc="Week "+s.week+" · "+sport+" "+Program.runLabel(s.run)+"\n\nLow aerobic range, flat terrain.";
    }else{
      const tg=sessionTargets(s);const pl=Math.round(s.pct*100);
      const body=tg.map(t=>{if(t.target==null)return t.ref.name+": set TM";if(t.ref.type==="pullup")return t.ref.name+": "+s.sets+"×"+s.reps+" @ "+fmt(t.target)+" kg"+(t.added!=null?(" (+"+fmt(t.added)+" added)"):"");if(t.ref.type==="db")return t.ref.name+": "+s.sets+"×"+s.reps+" @ "+fmt(t.target)+" kg/hand";return t.ref.name+": "+s.sets+"×"+s.reps+" @ "+fmt(t.target)+" kg";}).join("\n");
      summary="Operator — Week "+s.week+" ("+pl+"%)"+(s.optional?" · Deload":"");
      desc="Week "+s.week+" · "+pl+"% · "+s.sets+"×"+s.reps+"\n\n"+body+"\n\nCuff warmup before pressing. Readiness red → cap intensity.";
    }
    lines.push("BEGIN:VEVENT","UID:operator-"+s.kind+"-"+s.dateStr+"@local","DTSTAMP:"+stamp(now),"DTSTART:"+f(so),"DTEND:"+f(eo),"SUMMARY:"+escICS(summary),"DESCRIPTION:"+escICS(desc),"END:VEVENT");
```

(Note the UID now includes `s.kind` — a lift and a run can never share a date in practice, but UIDs must be unique if days ever overlap.)

- [ ] **Step 6: Run tests + full manual pass**

Run: `pnpm test` → `pass 17`.
Run: `pnpm start` → switch template to Capacity in Setup, confirm: Program shows 12 weeks with runs interleaved, TAPER badge on wk 12, DELOAD on 4/8; Today on a run date shows the run card, swap-to-bike toggles, done/skip work; chart still renders; `.ics` downloads without errors; switch back to Operator — everything as before.

- [ ] **Step 7: Commit**

```bash
git add index.html
git commit -m "feat: render run sessions, template picker, run days, deload badges, ics for runs"
```

---

### Task 8: Documentation

**Files:**
- Modify: `context.md`
- Modify: `README.md`

- [ ] **Step 1: Update `context.md`.** Three surgical edits:
  1. In **Architecture**, replace the `index.html` bullet's "the entire app: markup, CSS, and logic in one file" with: "`index.html` — markup, CSS, and UI logic; pure program math lives in `js/program.js` (loaded via plain `<script>`, also `require()`-able by `node --test`). Persistence is `localStorage` (key `tb-operator-v2`; v1 auto-migrates)."
  2. In **The training model it encodes**, after the Operator wave table, add a short "Capacity (Green Protocol)" paragraph: 12 weeks; lifting 70/80/90 ×3 with optional 40% 2×5 deloads at weeks 4/8 and no lifting in week 12; TM steps every 4 weeks; LSS runs 3×/week per the book table ending in a 6-mile test; runs swappable to bike per day.
  3. In **Scope → Deliberately out**, remove the line "The running / LSS side of the Tactical Barbell Green Protocol…" (it's now in) and remove "Strava/WHOOP API integration (dropped…)" — replace with "Strava + Google Calendar integration: planned next (see roadmap), via the Electron main process."
  4. Update **Persisted state shape** with the new keys (`template`, `runDays`, `enduranceOverrides`, `sessionSwap`, `activities`, `dismissedActivities`).

- [ ] **Step 2: Update `README.md`** — add `pnpm test` under the run instructions and a one-liner about the `js/` directory.

- [ ] **Step 3: Commit**

```bash
git add context.md README.md
git commit -m "docs: capacity template, js/program.js split, v2 state shape"
```

---

## Verification at the end

1. `pnpm test` → 17 passing, 0 failing.
2. `pnpm start` → full manual pass of Task 7 Step 6 checklist in both templates and both themes.
3. Open `index.html` via `file://` → identical behavior (no Electron-only APIs used in this plan).
4. `git log --oneline` → 8 commits, each leaving the app working.
