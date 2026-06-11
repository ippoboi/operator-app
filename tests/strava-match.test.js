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
