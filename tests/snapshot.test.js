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
