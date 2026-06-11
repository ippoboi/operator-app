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

// ── New coverage tests ──────────────────────────────────────────────────────

test("currentSession: empty array returns null", () => {
  const s = baseState();
  assert.equal(Program.currentSession(s, []), null);
});

test("currentSession: all-past sessions returns last session", () => {
  const s = baseState({ startDate: "2020-01-06" }); // years in the past
  const sess = Program.buildSessions(s);
  const last = sess[sess.length - 1];
  assert.equal(Program.currentSession(s, sess).dateStr, last.dateStr);
});

test("currentSession: all-future sessions returns first session", () => {
  const s = baseState({ startDate: "2090-01-07" }); // Monday far in the future
  const sess = Program.buildSessions(s);
  assert.equal(Program.currentSession(s, sess).dateStr, sess[0].dateStr);
});

test("currentSession: session dated exactly today is returned directly", () => {
  const todayStr = Program.ymd(Program.todayDate());
  const fakeSessions = [
    { dateStr: "1999-01-01" },
    { dateStr: todayStr },
    { dateStr: "2099-01-01" },
  ];
  assert.equal(Program.currentSession({}, fakeSessions).dateStr, todayStr);
});

test("targetFor: null TM on barbell returns target:null, bw:false", () => {
  const s = Program.defaults();
  const fsq = s.lifts.find(l => l.id === "fsq"); // type "barbell", tm:null
  const result = Program.targetFor(s, fsq, 0.70, 1);
  assert.equal(result.target, null);
  assert.equal(result.bw, false);
});

test("targetFor: null TM on pullup returns target:null, bw:true", () => {
  const s = Program.defaults();
  const wpu = s.lifts.find(l => l.id === "wpu"); // type "pullup", tm:null
  const result = Program.targetFor(s, wpu, 0.70, 1);
  assert.equal(result.target, null);
  assert.equal(result.bw, true);
});

test("rotForWeekday: positional fallback when rotSchedule is empty", () => {
  // rot = [sdl, wpu] (rotating lifts in defaults order)
  // days = [1, 3, 5]; pos%2: 1->0(sdl), 3->1(wpu), 5->0(sdl)
  const s = baseState({ rotSchedule: {} });
  const rot = Program.rotatingLifts(s);
  const days = s.liftDays.slice().sort((a, b) => a - b); // [1,3,5]
  for (const dow of days) {
    const pos = days.indexOf(dow);
    const expected = rot[pos % rot.length];
    assert.equal(Program.rotForWeekday(s, dow).id, expected.id);
  }
});

test("hasAnyTM: false when all TMs null (defaults), true on baseState", () => {
  assert.equal(Program.hasAnyTM(Program.defaults()), false);
  assert.equal(Program.hasAnyTM(baseState()), true);
});

test("projected flag: week 7 is projected, week 1 is not", () => {
  const s = baseState({ weeks: 12 });
  const fsq = s.lifts.find(l => l.id === "fsq");
  assert.equal(Program.targetFor(s, fsq, 0.70, 7).projected, true);
  assert.equal(Program.targetFor(s, fsq, 0.70, 1).projected, false);
});

test("sessionTargets: Monday session returns [fsq, dbb, wpu] in order", () => {
  const s = baseState();
  const sess = Program.buildSessions(s);
  const mon = sess[0]; // first session is Monday 2026-01-05
  assert.equal(mon.date.getDay(), 1); // verify it is Monday
  const targets = Program.sessionTargets(s, mon);
  assert.deepEqual(targets.map(t => t.ref.id), ["fsq", "dbb", "wpu"]);
});

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

test("weekSpec returns copies — mutating a result never alters the registry", () => {
  const s = capacityState();
  const spec = Program.weekSpec(s, 4);
  spec.pct = 999;
  assert.equal(Program.weekSpec(s, 4).pct, 0.40);
  assert.equal(Program.weekSpec(s, 8).pct, 0.40);
});

test("buildSessions propagates deload/optional onto capacity deload-week sessions", () => {
  const x = Program.buildSessions(capacityState()).find(x => x.week === 4 && x.kind === "lift");
  assert.equal(x.deload, true);
  assert.equal(x.optional, true);
});

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

test("runSpecAt returns copies — mutation never corrupts the book table", () => {
  const s = capacityState();
  // mutating the returned spec must not affect subsequent calls
  const spec = Program.runSpecAt(s, 1, 0);
  spec.lo = 999;
  assert.equal(Program.runSpecAt(s, 1, 0).lo, 30);
  // mutating a run session's .run must not affect a freshly built session list
  const sessions = Program.buildSessions(s);
  const runSess = sessions.find(x => x.kind === "run" && x.week === 1 && x.slot === 0);
  runSess.run.lo = 999;
  const fresh = Program.buildSessions(s).filter(x => x.kind === "run" && x.week === 1 && x.slot === 0);
  assert.equal(fresh[0].run.lo, 30);
});

test("non-3 runDays: slots truncate to the table (documented behavior)", () => {
  // 2 run days => slots 0 and 1 only => 12 weeks x 2 = 24 runs
  const s2 = capacityState({ runDays: [2, 4] });
  assert.equal(Program.buildSessions(s2).filter(x => x.kind === "run").length, 24);
  // 4 run days => slot 3 is out-of-bounds on the 3-column table => silently dropped => 12 x 3 = 36
  const s4 = capacityState({ runDays: [1, 2, 4, 6] });
  assert.equal(Program.buildSessions(s4).filter(x => x.kind === "run").length, 36);
});

test("run sessions carry no lift fields", () => {
  const s = capacityState();
  const r = Program.buildSessions(s).find(x => x.kind === "run");
  assert.ok(r, "expected at least one run session");
  assert.equal(r.pct, undefined);
  assert.equal(r.sets, undefined);
  assert.equal(r.reps, undefined);
  assert.ok(r.run !== undefined, "run field must exist");
  assert.equal(typeof r.slot, "number");
});

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

test("monthMatrix: Monday-start grid covering the whole month", () => {
  const june26 = Program.monthMatrix(2026, 5); // June 2026 starts Mon
  assert.equal(june26.length, 5);
  assert.equal(Program.ymd(june26[0][0]), "2026-06-01");
  assert.equal(Program.ymd(june26[4][6]), "2026-07-05"); // trailing fill to Sunday
  const jan26 = Program.monthMatrix(2026, 0); // Jan 1 2026 is a Thursday
  assert.equal(Program.ymd(jan26[0][0]), "2025-12-29"); // leading fill from Monday
  assert.equal(jan26[0][3].getDate(), 1);
  const feb27 = Program.monthMatrix(2027, 1); // Feb 2027 starts Mon, 28 days
  assert.equal(feb27.length, 4);
  assert.equal(Program.ymd(feb27[3][6]), "2027-02-28");
  for (const row of feb27) assert.equal(row.length, 7);
});

test("parseRunSpec: parses fixed/range/plus, rejects junk", () => {
  assert.deepEqual(Program.parseRunSpec("30"), { type: "fixed", min: 30 });
  assert.deepEqual(Program.parseRunSpec("30-60"), { type: "range", lo: 30, hi: 60 });
  assert.deepEqual(Program.parseRunSpec(" 60 – 90 "), { type: "range", lo: 60, hi: 90 }); // en-dash + spaces
  assert.deepEqual(Program.parseRunSpec("120+"), { type: "plus", lo: 120 });
  assert.equal(Program.parseRunSpec("fast 5k"), null);
  assert.equal(Program.parseRunSpec(""), null);
  assert.equal(Program.parseRunSpec("30-"), null);
});

test("runEditLabel: plain-ASCII inverse of parseRunSpec", () => {
  assert.equal(Program.runEditLabel({ type: "fixed", min: 30 }), "30");
  assert.equal(Program.runEditLabel({ type: "range", lo: 30, hi: 60 }), "30-60");
  assert.equal(Program.runEditLabel({ type: "plus", lo: 120 }), "120+");
  assert.equal(Program.runEditLabel({ type: "test", name: "6-Mile Test", targetMin: 60 }), "6-Mile Test");
  for (const s of ["30", "30-60", "120+"]) {
    assert.equal(Program.runEditLabel(Program.parseRunSpec(s)), s); // round-trip
  }
});
