# Operator V1 — Capacity, Calendar & Live Sync — Design

**Date:** 2026-06-11
**Status:** Approved (brainstorm with owner)

## Overview

V1 turns Operator from a lifting-only planner into the full **Tactical Barbell Green Protocol — Capacity** companion: lifting + LSS running in one 12-week program, a month calendar view, a live one-way Google Calendar mirror, and Strava-driven completion tracking. The app stays local, single-user, DB-free; the Electron main process becomes the integration "backend".

This supersedes two statements in `context.md`: "no network calls" and "Strava integration dropped" no longer hold. `context.md` must be updated as part of implementation.

## Goals

1. Encode the Capacity 12-week program (lifting wave + LSS running table) alongside the existing 6-week Operator template — hardcoded book defaults, editable per week.
2. Month-grid calendar view replacing the week-over-week program list.
3. One-way live mirror of all planned sessions into a dedicated Google Calendar, as all-day events; completed sessions upgrade to timed events with the real Strava timespan.
4. Strava fetch with auto-match + review queue: marks sessions done, stores activity data, surfaces the activity description as plan-vs-actual.
5. Run→bike swap per session.
6. Setup page refactored into inline tabs.

## Non-goals (V1)

- No accounts/auth, no database, no server. (V2 trajectory: real backend — auth + DB, Docker on a home server, mobile app. V1 prepares for it only via the API-shaped IPC seam, nothing more.)
- No WHOOP, no AI assistant, no other TB templates, no nutrition, no actual-weight logging UI (Strava descriptions are displayed verbatim, not parsed).
- `.ics` export is removed (replaced by GCal sync).
- No two-way calendar sync; the user's own calendars are never read or modified.

## Decisions log

| Decision | Choice |
| --- | --- |
| Integration mechanism | APIs built into the app (Electron pattern 1: main process = backend). The Strava/GCal MCPs are not used by the app. |
| Runtime | Electron-first. `file://` browser mode keeps working minus sync (`window.api` absent → sync UI hidden). |
| Persistence | No DB. Renderer: `localStorage` (key `tb-operator-v2`, one-time migration from v1). Main: tokens via `safeStorage` + sync state JSON in `userData`. |
| Endurance prescription | Book defaults hardcoded, editable per week (sparse overrides, "reset to book"). |
| GCal sync | One-way push, live, full plan, dedicated "Operator" calendar. All-day events; timed after Strava confirmation. `sessionTime`/`durationMin` settings removed. |
| Strava matching | Auto-match same-day + compatible sport; ambiguity goes to a review queue. |
| Lift logs | User records gym sessions on Strava with lifts in the description → shown verbatim next to the plan. |
| Code shape | Vanilla JS, no build step, no runtime deps; single-file rule relaxed to "a handful of plain files". |
| Calendar view | Month grid (option A). Program list view absorbed by it. |
| Setup | Inline tabs: Program / Lifts / Endurance / Connections / General. |

## Architecture

```
operator-app/
├── index.html          # shell: markup + CSS only
├── js/
│   ├── program.js      # PURE: template registry, buildSessions(), load math, matcher-helpers
│   ├── ui.js           # screens: Today / Calendar / Progress / Setup
│   └── calendar.js     # month-grid rendering
├── preload.js          # contextBridge → window.api
└── main/
    ├── main.js         # window + IPC wiring
    ├── store.js        # safeStorage tokens + sync-state JSON (userData)
    ├── oauth.js        # system-browser + http://127.0.0.1:<port>/callback loopback (both providers)
    ├── gcal.js         # calendar mirror engine (diff against eventMap)
    └── strava.js       # activity fetch + matching
```

- Plain `<script>` tags; Google/Strava called with bare `fetch` from main — no SDKs.
- **API-shaped IPC seam:** renderer talks only to `window.api.*` — `connectGoogle()`, `connectStrava()`, `disconnect(provider)`, `syncStrava()`, `pushPlan(snapshot)`, `getSyncStatus()` — plain JSON in/out. In V2 this surface becomes HTTP endpoints; `main/` is what gets promoted to the server.
- OAuth: clicking Connect opens the **system browser** (never a webview), main spins up a throwaway loopback listener for the redirect, exchanges the code, stores tokens encrypted (`safeStorage`), refreshes silently. Scopes: Google `calendar` only; Strava `activity:read_all`.
- Client IDs/secrets belong to the owner's own API apps and live locally (config in userData), never in the repo.

## Program model

### Template registry

The hardcoded 6-week `CYCLE` becomes:

```js
TEMPLATES = {
  operator6:  { weeks: 6,  lift: [70,80,90,75,85,95],
                schemes: ['3×5','3×5','3×3','3×5','3×3','3×1'],
                tmStepEvery: 6, endurance: null },
  capacity12: { weeks: 12,
                lift:    [70,80,90,'DL', 70,80,90,'DL', 70,80,90,null],
                schemes: ['3×5','3×5','3×3','2×5',
                          '3×5','3×5','3×3','2×5',
                          '3×5','3×5','3×3', null],
                tmStepEvery: 4,        // TM steps after weeks 4 and 8 (+5 kg lower / +2.5 kg upper, as today)
                endurance: CAPACITY_RUNS }
}
```

- **Cluster + rotation are template-independent.** Core/rotating lifts, `rotSchedule` (e.g. Mon PU · Wed DL · Fri PU → DL 1×, PU 2× per week), and `sessionPick` day-overrides keep working identically under Capacity. Templates only decide week percentages/schemes and the TM step period.
- **Deload weeks (4, 8):** lift days show an *optional* session at **40% TM, 2×5**, badged "Deload — do not add plates" (per the book's warning). Skipping a deload session is neutral — not red.
- **Week 12:** no lifting; taper runs 30′ / 30′ / **6-Mile Test** (target < 60:00 displayed; actual time from Strava).
- Block end: nudge "Block complete — TM stepped twice (+5/+2.5 ×2); review TMs in Setup."
- Weeks beyond the template repeat the wave (as today); chart projection behavior unchanged.

### Capacity endurance table (book defaults)

Runs on `runDays` (default Tue/Thu/Sat = [2,4,6]); day 7 rest.

| Week | Run 1 | Run 2 | Run 3 |
| --- | --- | --- | --- |
| 1–3 | 30–60′ | 30–60′ | 60–90′ |
| 4 (deload) | 30′ | 30′ | 30′ |
| 5–7 | 60–90′ | 60–90′ | 90–120′ |
| 8 (deload) | 30′ | 30′ | 30′ |
| 9 | 60–120′ | 60–120′ | 120′+ |
| 10–11 | 60–120′ | 60–120′ | 120′+ |
| 12 | 30′ | 30′ | 6-Mile Test |

Ranges render as ranges; the book's **easy/hard alternation** appears as a coaching hint (previous run long → "go shorter today"), advisory only. Book note shown on lift days as a passive hint: optional extra 20–30′ LSS. All weeks editable in Setup → Endurance as sparse overrides; "Reset to book" restores defaults.

## State

Renderer `localStorage` (`tb-operator-v2`), additions to the existing shape:

```js
{
  template: "operator6" | "capacity12",
  runDays: number[],                          // default [2,4,6]
  enduranceOverrides: { [week]: { [slot]: {min:[lo,hi]|fixed, test?:bool} } },
  sessionSwap: { [dateStr]: "bike" },         // run→bike; same prescription, sport icon changes,
                                              // matcher then expects Ride that day
  activities: { [dateStr]: { id, sport, startISO, durationSec, distanceKm, name, description } },
  dismissedActivities: number[],              // Strava IDs the user said "not training"
  // status / readiness unchanged, now also keyed for endurance session dates
  // removed: sessionTime, durationMin
}
```

Main-process `userData` JSON: `{ google: {tokensEnc, calendarId, eventMap: {dateKey: eventId}, lastSync, lastError}, strava: {tokensEnc, lastFetch} }`.

Migration: on first run, read `tb-operator-v1`, map to v2 (add `template:'operator6'`, defaults for new keys, drop `sessionTime`/`durationMin`), write `tb-operator-v2`, keep v1 untouched as backup.

## Google Calendar mirror

- Connect (Setup → Connections) → loopback OAuth → create-or-reuse a calendar named **"Operator"**; only that calendar is ever written.
- Every planned session = **all-day event**. Title: `🏋 FSQ 76 · DB 2×26 · PU +5` / `🏃 LSS 30–60′` / `🚴 LSS 45′` / `⛰ 6-Mile Test`. Description: full sets/reps/percentages. Done → "✓ " prefix; skipped → "⨯ " prefix.
- **Live:** renderer pushes a debounced plan snapshot via `api.pushPlan()` on any derived-session change (TM edit, swap, status, setup/template change). `gcal.js` diffs against `eventMap` and PATCHes/inserts/deletes only deltas.
- **Timespan upgrade:** when Strava confirms a session, its event is replaced by a **timed event** at the activity's actual start/duration. Future = fuzzy all-day plan; past = exact timed history.
- Manually deleted events self-heal on next diff. Offline/expired token → sync queues; Connections tab shows status dot + last sync + error; token refresh is silent, revocation shows a "Reconnect" banner.

## Strava sync

- Trigger: app launch + manual ↻ (Today and Calendar). Fetch: `GET /athlete/activities` for the last 14 days (rate limits irrelevant at this volume).
- **Auto-match:** same local calendar day (`start_date_local`) + compatible sport. `Run` → endurance session; `Ride` → endurance session only if that day is swapped to bike (otherwise the queue offers "swap & match" in one tap); `WeightTraining` → lift session. Match ⇒ status=done, activity stored, GCal upgraded to timed.
- **Review queue** (card on Today): two candidates on one day, sport mismatch, activity on a rest day, or a past planned session with no activity. Actions: attach to a session / dismiss (remembered via `dismissedActivities`) / mark planned session skipped.
- **Plan vs. actual** on any done session (Today + Calendar detail): left = prescription; right = Strava description verbatim (the lift log) plus duration/distance/pace for cardio. No description parsing in V1.

## UI

- **Nav:** Today / Calendar / Progress / Setup (Program list view removed — Calendar absorbs it).
- **Calendar:** month grid. Chips: periwinkle = lift, teal = run/bike, gold = deload & test; done/skip dots; left gutter shows program week + lift % (e.g. `W2 · 80%`); today outlined; rest days dimmed; ‹ › month nav. Click a day → the same session-detail panel Today uses (prescription, plan-vs-actual, status taps, rotating-lift override, bike swap).
- **Today:** unchanged role; adds endurance cards (duration range, easy/hard hint, bike-swap button), readiness tap also colors run guidance, the review queue, and the plan-vs-actual panel.
- **Setup → inline tabs** (thin underlined tab row, same instrument-panel styling):
  - **Program** — template picker, start date, program length, plate increment
  - **Lifts** — existing cluster editor (lifts, TMs, core/rotating, rotation schedule, block steps)
  - **Endurance** — run days + per-week duration table with "Reset to book" (visible only for Capacity)
  - **Connections** — Google/Strava connect/disconnect, status dots, last sync, manual sync
  - **General** — name, theme, bodyweight, JSON backup/restore
- Design language unchanged: charcoal, periwinkle accent, monospace tabular numerals, teal added as the endurance accent, gold for deload/test only.

## Errors & edge cases

- No network → everything works except sync; queued pushes flush on reconnect.
- Template switch mid-block → confirmation dialog; `status`/`readiness`/`activities` survive (keyed by date, not template).
- Dates keyed by local `YYYY-MM-DD` throughout (as today); DST-safe because no times exist until Strava provides them.
- Two activities, one day → never guess; review queue.
- `file://` mode: `window.api` undefined → Connections tab shows "available in the desktop app", everything else functional.

## Testing

- `js/program.js` and the matcher logic stay pure (no DOM/Electron imports) → `node --test` suites, zero deps: wave/scheme/TM-step derivation for both templates, deload/week-12 behavior, rotation under Capacity, overrides, swaps, matcher verdicts (match/queue cases).
- OAuth + GCal flows: manual smoke checklist in README (connect, revoke, offline, event-heal).
- Existing manual regression: v1→v2 localStorage migration with the real `operator-backup.json`.

## Out-of-repo prerequisites (owner setup, documented in README)

1. Google Cloud project → OAuth client (Desktop type) → calendar scope.
2. Strava API application → client ID/secret.
3. Both entered once in Setup → Connections; stored in `userData`, never committed.
