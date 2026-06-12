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

const DAY_MS = 86400000;
const dayNum = ds => Math.round(Date.parse(ds + "T00:00:00Z") / DAY_MS);

/* sessions: [{dateStr, kind, sport, status, activityId}] (sport has bike swap applied)
   rawActivities: Strava summaries
   opts: {dismissed, today, windowStart, linkWindow} — linkWindow (default 3) is the
   ±days radius for surfacing cross-day attach candidates when an activity has no
   same-day home (e.g. a run done today fulfilling yesterday's skipped run). */
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

  /* unmatched, non-skipped, sport-compatible sessions within ±linkWindow days of
     `day` (excluding `day` itself) — the cross-day attach offers, nearest first */
  const linkWindow = opts.linkWindow == null ? 3 : opts.linkWindow;
  function nearbyCompat(day, sport) {
    if (sport == null) return [];
    const d0 = dayNum(day);
    return sessions
      .filter(s => s.sport === sport && s.status !== "skipped" && s.activityId == null &&
                   s.dateStr !== day && Math.abs(dayNum(s.dateStr) - d0) <= linkWindow)
      .sort((a, b) => Math.abs(dayNum(a.dateStr) - d0) - Math.abs(dayNum(b.dateStr) - d0) ||
                      a.dateStr.localeCompare(b.dateStr))
      .map(s => ({ dateStr: s.dateStr, kind: s.kind, crossDay: true }));
  }

  const matches = [], queue = [];
  const matchedDays = new Set();

  Object.keys(actsByDay).sort().forEach(day => {
    const dayActs = actsByDay[day];
    const daySess = (sessByDay[day] || []).filter(s => s.status !== "skipped" && s.activityId == null);
    if (!daySess.length) {
      dayActs.forEach(a => queue.push({ type: "restday", dateStr: day, activity: a,
                                        candidates: nearbyCompat(day, a.sport) }));
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
                 candidates: daySess.map(s => ({ dateStr: s.dateStr, kind: s.kind })).concat(nearbyCompat(day, a.sport)) });
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
