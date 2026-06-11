# Handoff: Operator V1 — Plan 3 (Integrations)

**For:** a fresh session implementing Plan 3 of 3 — the Electron main-process "backend": OAuth, Google Calendar live mirror, Strava sync.
**Repo:** `/Users/dimitar/Desktop/Software_Dev/operator-app` (git, branch `main`, clean at the plans-1+2 merge).

## Read these first (in order)

1. `context.md` — what the app is, the training model, architecture, conventions. Kept current.
2. `docs/superpowers/specs/2026-06-11-operator-v1-design.md` — **the approved design spec.** Plan 3 implements its "Architecture", "Google Calendar mirror", "Strava sync", and the Connections-tab parts of "UI", plus the listed state additions (`activities`, `dismissedActivities` are already in the v2 state shape, empty). The spec's Decisions-log table records every choice the owner already made — do not re-litigate them.
3. `roadmap.md` — V1/V2/Vn framing.
4. Done plans (for codebase orientation, not for re-execution): `docs/superpowers/plans/2026-06-11-capacity-foundation.md`, `docs/superpowers/plans/2026-06-11-calendar-ui.md`.

## Where the code stands (plans 1 + 2 shipped)

- `index.html` — UI only: Today (lift + run cards), **Calendar** (month grid + inline detail panel; replaced the old Program list), Progress, **tabbed Setup** (Program / Lifts / Endurance / Connections / General). The **Connections tab is a placeholder** (`renderSetup`, `setupTab==="connections"` branch) — Plan 3 fills it.
- `js/program.js` — pure module (browser global `Program` + Node `require`): template registry (`operator6`, `capacity12`), merged lift+run session building, run-spec helpers, `sportFor` (bike swap), `monthMatrix`, v1→v2 migration. **Selectors return copies — keep that contract.**
- `tests/program.test.js` — **35 passing** (`pnpm test`; script is `node --test 'tests/**/*.test.js'` — the bare-directory form fails on Node 24).
- `main.js` — still the bare Electron window (`contextIsolation: true`, no preload). `package.json` builder `files` includes `js/**` — **add `preload.js` and `main/**` when they exist.**
- Useful greps: parse-check the inline script with `node -e "const html=require('fs').readFileSync('index.html','utf8');const m=html.match(/<script>([\s\S]*)<\/script>/);new Function(m[1]);console.log('parses OK')"`.

## Plan 3 scope (from the spec — summarizing, not redefining)

1. `preload.js` + `main/` modules (`main.js` wiring, `store.js` safeStorage tokens + sync-state JSON in `userData`, `oauth.js` system-browser + 127.0.0.1 loopback for both providers, `gcal.js`, `strava.js`). Renderer talks ONLY to `window.api.*` — this IPC surface is deliberately API-shaped because **V2 will move it to a real backend (auth + DB, Docker on a home server) and a mobile app**; keep it promotable.
2. Google Calendar: dedicated "Operator" calendar, one-way live mirror, **all-day events** for planned sessions, diff-based patching via a stored `eventMap`, ✓/⨯ prefixes for done/skipped.
3. Strava: fetch last ~14 days on launch + manual ↻; auto-match same local day + compatible sport (Ride only if day swapped to bike, else offer "swap & match"); ambiguity → review queue on Today; matched session → done + activity stored + **GCal event upgraded to the real timed event** (Strava start/duration).
4. Plan-vs-actual panel on done sessions (prescription left, Strava description verbatim right — owner logs lifts in the description; no parsing).
5. Remove `.ics` export and the `sessionTime`/`durationMin` settings (currently in Setup → General) once GCal sync works.
6. `file://` / no-`window.api` mode: hide sync UI, everything else works.
7. Owner-side prerequisites (document in README): Google Cloud OAuth client (Desktop type, calendar scope), Strava API app; credentials entered in Setup → Connections, stored in `userData`, never committed.

## Decisions/context NOT in the spec (from the working session)

- **Process:** owner found the subagent-per-task + two-reviewer workflow far too slow. Preferred flow: `superpowers:writing-plans` to plan, then **inline execution** (`superpowers:executing-plans`), tests + parse-check as the gate, commit per task, no reviewer-agent ceremony. Work on a feature branch off `main`, merge when done.
- **Design system is frozen:** charcoal instrument panel, existing CSS vars/classes, periwinkle accent, `--teal` for endurance, `--amber` for deload/test only. No new visual language; Connections UI should look like the existing Setup fields/buttons.
- **Known latent issue** (flagged in review, deliberately deferred to this plan's territory): per-session state (`status`, `readiness`, `sessionSwap`, `activities`) is keyed by bare `dateStr`. Lift and run can only share a date via a legacy-migrated overlapping `liftDays`/`runDays` config (pickers now enforce disjointness). The Strava matcher must key its writes by date+kind awareness — if this gets painful, that's the moment to consider keying by `kind:dateStr`.
- `statusCount(sessions, val)` in `index.html` exists because template switches orphan status keys — reuse it for any new stats.
- Node is v24; Electron 31; pnpm. No bundler, no runtime deps — `fetch` from the main process, no Google/Strava SDKs.
- Owner's email/Google account is the only user. Single-user assumptions are fine everywhere.

## Suggested skills for the next session

- `superpowers:writing-plans` → write `docs/superpowers/plans/<date>-integrations.md` against the actual code (read `index.html`, `main.js` first).
- `superpowers:executing-plans` → inline execution (owner's explicit preference; do NOT use subagent-driven-development).
- `superpowers:test-driven-development` for the pure parts: the Strava **matcher** should live in `main/strava.js` as pure (plan, activities) → verdicts logic, Node-testable like `js/program.js`; same for the GCal **diff** engine.
- OAuth flows can't be unit-tested meaningfully — plan a manual smoke checklist in the README instead.

## Definition of done for Plan 3 (= V1 complete)

Setup → Connections connects both providers with real OAuth; planned sessions appear as all-day events in the "Operator" Google calendar and update live on any plan change; a recorded Strava run/ride/lift auto-marks the session done, upgrades the calendar event to the actual timespan, and shows plan-vs-actual on Today/Calendar; unmatched activities land in a review queue; `.ics`/`sessionTime` are gone; `pnpm test` green; `file://` mode degrades gracefully. Then update `context.md` (it still says Strava/GCal are "planned next") and `roadmap.md` V1 checkboxes.
