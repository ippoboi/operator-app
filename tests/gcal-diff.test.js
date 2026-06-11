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
