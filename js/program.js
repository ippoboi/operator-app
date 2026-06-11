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
    return Object.assign({}, raw);
  }

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
      template: "operator6", theme: "dark", displayName: "Dimitar", startDate: ymd(monday), weeks: 6,
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

  function blockOf(state, week) { return Math.floor((week - 1) / template(state).tmStepEvery); }

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
    CYCLE, TEMPLATES, todayDate, ymd, parseYMD, addDays, roundTo, defaults,
    enabledLifts, coreLifts, rotatingLifts, hasAnyTM,
    buildSessions, blockOf, effectiveTM, template, weekSpec,
    rotForWeekday, chosenRotating, sessionLifts,
    targetFor, sessionTargets, currentSession,
  };
})();
if (typeof module !== "undefined" && module.exports) module.exports = Program;
