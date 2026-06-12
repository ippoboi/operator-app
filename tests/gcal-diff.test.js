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

test("diff: drifted entry patches even when the hash matches", () => {
  const known = EV("lift:2026-06-15");
  const map = { "lift:2026-06-15": { eventId: "e1", hash: hashEvent(known), drifted: true } };
  const d = diffPlan([known], map);
  assert.equal(d.patches.length, 1);
  assert.equal(d.patches[0].eventId, "e1");
});

test("syncPlan: remote edit (updated stamp moved) forces a repair PUT", async () => {
  const { syncPlan } = require("../main/gcal.js");
  const ev = EV("lift:2026-06-15");
  const calls = [];
  const realFetch = global.fetch;
  global.fetch = async (url, opts = {}) => {
    const method = opts.method || "GET";
    calls.push(method + " " + url);
    const json = (() => {
      if (url.includes("/events?")) return { items: [{ id: "e1", updated: "2026-06-11T12:50:10.793Z" }] };
      if (method === "PUT") return { id: "e1", updated: "2026-06-12T09:00:00.000Z" };
      return {}; // calendar GET
    })();
    return { ok: true, status: 200, json: async () => json };
  };
  try {
    const res = await syncPlan([ev], {
      token: "t", calendarId: "cal1",
      /* hash matches the snapshot, but our recorded `updated` predates a remote edit */
      eventMap: { "lift:2026-06-15": { eventId: "e1", hash: hashEvent(ev), updated: "2026-06-10T00:00:00.000Z" } },
    });
    assert.ok(calls.some(c => c.startsWith("PUT ") && c.includes("/events/e1")), calls.join("\n"));
    assert.equal(res.eventMap["lift:2026-06-15"].updated, "2026-06-12T09:00:00.000Z");
  } finally { global.fetch = realFetch; }
});

test("syncPlan: matching updated stamp is a no-op (no writes)", async () => {
  const { syncPlan } = require("../main/gcal.js");
  const ev = EV("lift:2026-06-15");
  const calls = [];
  const realFetch = global.fetch;
  global.fetch = async (url, opts = {}) => {
    const method = opts.method || "GET";
    calls.push(method + " " + url);
    const json = url.includes("/events?")
      ? { items: [{ id: "e1", updated: "2026-06-11T12:50:10.793Z" }] }
      : {};
    return { ok: true, status: 200, json: async () => json };
  };
  try {
    await syncPlan([ev], {
      token: "t", calendarId: "cal1",
      eventMap: { "lift:2026-06-15": { eventId: "e1", hash: hashEvent(ev), updated: "2026-06-11T12:50:10.793Z" } },
    });
    assert.ok(!calls.some(c => c.startsWith("PUT ") || c.startsWith("POST ")), calls.join("\n"));
  } finally { global.fetch = realFetch; }
});
