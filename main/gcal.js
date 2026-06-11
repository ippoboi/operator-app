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
