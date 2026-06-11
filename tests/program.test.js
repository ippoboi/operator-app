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
