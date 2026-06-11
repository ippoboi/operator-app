# Calendar View + Tabbed Setup Implementation Plan (Plan 2 of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Program list with a month-grid Calendar view, restructure Setup into inline tabs, and add the per-week Endurance editor with "reset to book".

**Architecture:** View logic stays in `index.html`; three new pure helpers (`monthMatrix`, `parseRunSpec`, `runEditLabel`) go into `js/program.js` with `node --test` coverage. Calendar is a CSS-grid month matrix (Monday-start) with a program-week gutter, session chips, and an inline detail panel that reuses the Today screen's row-building (extracted as `liftRowsHtml`). Setup becomes five tabs driven by a module-level `setupTab` string.

**Tech Stack:** Vanilla JS, no deps. Suite currently at **32 passing** (`pnpm test`).

**Spec:** `docs/superpowers/specs/2026-06-11-operator-v1-design.md` (UI section). Deviations from spec, both deliberate: (1) readiness taps stay Today-only (readiness gates *today's* effort; backfilling it for arbitrary dates is meaningless) — the calendar detail panel offers done/skip/swap/rotating-override only; (2) the Connections tab ships as a placeholder (its content is Plan 3).

---

## File map

| File | Status | Responsibility |
| --- | --- | --- |
| `js/program.js` | modify | + `monthMatrix(year, monthIdx)`, `parseRunSpec(str)`, `runEditLabel(spec)` |
| `tests/program.test.js` | modify | + tests for the three helpers |
| `index.html` | modify | calendar CSS + `renderCalendar`/`chipFor`/`calDetailHtml`, `liftRowsHtml` extraction, nav rename, delete `renderProgram`, tabbed `renderSetup`, endurance editor |
| `context.md` | modify | nav description line |

---

### Task 1: Pure helpers — `monthMatrix`, `parseRunSpec`, `runEditLabel`

**Files:** Modify `js/program.js`, `tests/program.test.js`.

- [ ] **Step 1: Append failing tests** to `tests/program.test.js`:

```js
test("monthMatrix: Monday-start grid covering the whole month", () => {
  const june26 = Program.monthMatrix(2026, 5); // June 2026 starts Mon
  assert.equal(june26.length, 5);
  assert.equal(Program.ymd(june26[0][0]), "2026-06-01");
  assert.equal(Program.ymd(june26[4][6]), "2026-07-05"); // trailing fill to Sunday
  const jan26 = Program.monthMatrix(2026, 0); // Jan 1 2026 is a Thursday
  assert.equal(Program.ymd(jan26[0][0]), "2025-12-29"); // leading fill from Monday
  assert.equal(jan26[0][3].getDate(), 1);
  const feb27 = Program.monthMatrix(2027, 1); // Feb 2027 starts Mon, 28 days
  assert.equal(feb27.length, 4);
  assert.equal(Program.ymd(feb27[3][6]), "2027-02-28");
  for (const row of feb27) assert.equal(row.length, 7);
});

test("parseRunSpec: parses fixed/range/plus, rejects junk", () => {
  assert.deepEqual(Program.parseRunSpec("30"), { type: "fixed", min: 30 });
  assert.deepEqual(Program.parseRunSpec("30-60"), { type: "range", lo: 30, hi: 60 });
  assert.deepEqual(Program.parseRunSpec(" 60 – 90 "), { type: "range", lo: 60, hi: 90 }); // en-dash + spaces
  assert.deepEqual(Program.parseRunSpec("120+"), { type: "plus", lo: 120 });
  assert.equal(Program.parseRunSpec("fast 5k"), null);
  assert.equal(Program.parseRunSpec(""), null);
  assert.equal(Program.parseRunSpec("30-"), null);
});

test("runEditLabel: plain-ASCII inverse of parseRunSpec", () => {
  assert.equal(Program.runEditLabel({ type: "fixed", min: 30 }), "30");
  assert.equal(Program.runEditLabel({ type: "range", lo: 30, hi: 60 }), "30-60");
  assert.equal(Program.runEditLabel({ type: "plus", lo: 120 }), "120+");
  assert.equal(Program.runEditLabel({ type: "test", name: "6-Mile Test", targetMin: 60 }), "6-Mile Test");
  for (const s of ["30", "30-60", "120+"]) {
    assert.equal(Program.runEditLabel(Program.parseRunSpec(s)), s); // round-trip
  }
});
```

- [ ] **Step 2:** `pnpm test` → 32 pass, 3 fail (`monthMatrix is not a function`, …).

- [ ] **Step 3: Implement** in `js/program.js` (after `runLabel`):

```js
  /* Monday-start month grid: array of week rows (7 Dates each), covering every day of the month */
  function monthMatrix(year, monthIdx) {
    const first = new Date(year, monthIdx, 1);
    let cur = addDays(first, -((first.getDay() + 6) % 7));
    const weeks = [];
    do {
      const row = [];
      for (let i = 0; i < 7; i++) { row.push(cur); cur = addDays(cur, 1); }
      weeks.push(row);
    } while (cur.getMonth() === monthIdx);
    return weeks;
  }

  /* "30" | "30-60" | "120+" -> run spec; null on anything else (tests aren't editable) */
  function parseRunSpec(str) {
    const s = String(str).trim();
    let m;
    if ((m = s.match(/^(\d+)\s*[-–]\s*(\d+)$/))) return { type: "range", lo: +m[1], hi: +m[2] };
    if ((m = s.match(/^(\d+)\s*\+$/))) return { type: "plus", lo: +m[1] };
    if ((m = s.match(/^(\d+)$/))) return { type: "fixed", min: +m[1] };
    return null;
  }

  /* plain-ASCII editing form (runLabel uses typographic chars) */
  function runEditLabel(spec) {
    if (!spec) return "";
    if (spec.type === "range") return spec.lo + "-" + spec.hi;
    if (spec.type === "fixed") return String(spec.min);
    if (spec.type === "plus") return spec.lo + "+";
    if (spec.type === "test") return spec.name;
    return "";
  }
```

Export `monthMatrix, parseRunSpec, runEditLabel`.

- [ ] **Step 4:** `pnpm test` → **35 pass, 0 fail**.
- [ ] **Step 5:** `git add js/program.js tests/program.test.js && git commit -m "feat: monthMatrix + run-spec parse/format helpers"`

---

### Task 2: Calendar view replaces the Program list

**Files:** Modify `index.html` only.

- [ ] **Step 1: CSS** — add after the `/* program */` block:

```css
  /* calendar */
  .cal-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}
  .cal-title{font-family:var(--mono);font-size:14px;font-weight:700;letter-spacing:.04em}
  .cal-grid{display:grid;grid-template-columns:46px repeat(7,1fr);gap:4px;margin-bottom:4px}
  .cal-dow span{font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--faint);text-align:center;padding:2px 0}
  .cal-gut{font-family:var(--mono);font-size:10px;color:var(--faint);align-self:center;text-align:right;padding-right:4px;white-space:nowrap}
  .cal-cell{background:var(--surface);border:1px solid var(--line-soft);border-radius:8px;min-height:64px;padding:5px 6px;overflow:hidden}
  .cal-cell.has{cursor:pointer}
  .cal-cell.has:hover{border-color:var(--line);background:var(--surface-2)}
  .cal-cell.out{opacity:.35}
  .cal-cell.today{border-color:var(--accent)}
  .cal-cell.sel{border-color:var(--accent);background:var(--accent-soft)}
  .cal-num{font-family:var(--mono);font-size:10.5px;color:var(--muted);display:block;margin-bottom:3px}
  .cal-cell.today .cal-num{color:var(--accent);font-weight:700}
  .cal-chip{display:flex;align-items:center;gap:4px;font-family:var(--mono);font-size:10px;border-radius:4px;padding:1px 4px;margin-bottom:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .cal-chip.lift{background:var(--accent-soft);color:var(--accent)}
  .cal-chip.run{background:rgba(95,211,194,.12);color:var(--teal)}
  .cal-chip.gold{background:rgba(214,164,65,.12);color:var(--amber)}
  .cal-chip .dot{width:5px;height:5px;flex-shrink:0}
```

- [ ] **Step 2: Extract `liftRowsHtml`.** In `renderToday`, the `const rows=tg.map(t=>{...}).join("")` block becomes a top-level function so the calendar detail can reuse it:

```js
function liftRowsHtml(session){
  const pct=Math.round(session.pct*100);
  return sessionTargets(session).map(t=>{
    let val,extra="";
    if(t.target==null){if(t.bw){val=`<div class="kg" style="color:var(--text)">BW</div>`;extra=`<div class="added">bodyweight · ${session.sets}×${session.reps}</div>`;}else val=`<span class="row-flag">set TM</span>`;}
    else if(t.ref.type==="pullup"){val=`<div class="kg">${fmt(t.target)}<small>kg</small></div>`;extra=t.added!=null?`<div class="added">+${fmt(t.added)} added · bw ${fmt(state.bodyweight)}</div>`:`<div class="added">total system load</div>`;}
    else if(t.ref.type==="db"){val=`<div class="kg">${fmt(t.target)}<small>kg/hand</small></div>`;extra=`<div class="added">guide — round to your DBs</div>`;}
    else val=`<div class="kg">${fmt(t.target)}<small>kg</small></div>`;
    return `<div class="lift-row"><div class="lift-meta"><div class="lift-name">${escapeHtml(t.ref.name)}</div>
      <div class="lift-scheme">${session.sets}×${session.reps} @ ${pct}%</div></div><div class="lift-val">${val}${extra}</div></div>`;
  }).join("");
}
```

In `renderToday`, replace the whole `const rows=tg.map(...).join("");` block with `const rows=liftRowsHtml(cur);` (the `tg` const above it stays — it's still used? No: `tg` was only used for rows; delete `const tg=sessionTargets(cur);` too).

- [ ] **Step 3: Calendar state + helpers** (top-level, near `let state=load()`):

```js
let calYM=null;   // "YYYY-MM" being viewed; null = month of today
let calSel=null;  // selected dateStr in the calendar
function calMonth(){if(calYM){const p=calYM.split("-").map(Number);return{y:p[0],m:p[1]-1};}const t=todayDate();return{y:t.getFullYear(),m:t.getMonth()};}
function shiftCalMonth(n){const c=calMonth();const d=new Date(c.y,c.m+n,1);calYM=d.getFullYear()+"-"+pad(d.getMonth()+1);calSel=null;render();}

function chipFor(s){
  if(s.kind==="run"){
    const sport=Program.sportFor(state,s);
    if(s.run.type==="test")return{label:s.run.name,cls:"gold"};
    return{label:(sport==="bike"?"Bike ":"LSS ")+Program.runLabel(s.run),cls:s.run.type==="fixed"?"gold":"run"};
  }
  if(s.optional)return{label:"Deload 40%",cls:"gold"};
  const tg=sessionTargets(s).filter(t=>t.target!=null||t.bw);
  const label=tg.length?tg.map(t=>shortName(t.ref.name).split(" ")[0]+" "+(t.bw?"BW":fmt(t.target))).join(" · "):Math.round(s.pct*100)+"% · set TMs";
  return{label,cls:"lift"};
}
```

- [ ] **Step 4: `renderCalendar` + detail panel:**

```js
function renderCalendar(root){
  const sessions=buildSessions();
  const byDate={};sessions.forEach(s=>{(byDate[s.dateStr]=byDate[s.dateStr]||[]).push(s);});
  const c=calMonth();const weeks=Program.monthMatrix(c.y,c.m);
  const tStr=ymd(todayDate());
  const monthName=new Date(c.y,c.m,1).toLocaleString("en",{month:"long",year:"numeric"});
  const t=Program.template(state);
  let grid=`<div class="cal-head"><button class="btn ghost" id="calPrev">‹ Prev</button><span class="cal-title">${monthName}</span><button class="btn ghost" id="calNext">Next ›</button></div>
    <div class="cal-grid cal-dow"><span></span>${["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map(d=>`<span>${d}</span>`).join("")}</div>`;
  weeks.forEach(row=>{
    const rowSess=row.map(d=>byDate[ymd(d)]||[]).flat();
    const wk=rowSess.length?rowSess[0].week:null;
    const sp=wk?weekSpec(wk):null;
    const gut=wk?`W${wk}${sp?` · ${Math.round(sp.pct*100)}%`:""}`:"";
    grid+=`<div class="cal-grid"><span class="cal-gut">${gut}</span>${row.map(d=>{
      const ds=ymd(d);const ss=byDate[ds]||[];
      const chips=ss.map(s=>{const ch=chipFor(s);const stt=state.status[s.dateStr];return `<span class="cal-chip ${ch.cls}">${stt?`<span class="dot ${stt}"></span>`:""}${escapeHtml(ch.label)}</span>`;}).join("");
      const cls=["cal-cell",d.getMonth()!==c.m?"out":"",ds===tStr?"today":"",ds===calSel?"sel":"",ss.length?"has":""].filter(Boolean).join(" ");
      return `<div class="${cls}" data-date="${ds}"><span class="cal-num">${d.getDate()}</span>${chips}</div>`;
    }).join("")}</div>`;
  });
  const detail=(calSel&&byDate[calSel])?calDetailHtml(byDate[calSel]):`<p class="note">Click a session day for details.</p>`;
  root.innerHTML=`<div class="view-title">Calendar</div><div class="sub">${state.weeks} weeks · ${t.label}${t.endurance?` · runs ${state.runDays.slice().sort((a,b)=>a-b).map(d=>DOW[d]).join("/")}`:""}</div>${grid}<div id="calDetail" style="margin-top:18px">${detail}</div>`;
  root.querySelector("#calPrev").onclick=()=>shiftCalMonth(-1);
  root.querySelector("#calNext").onclick=()=>shiftCalMonth(1);
  root.querySelectorAll(".cal-cell.has").forEach(cell=>cell.onclick=()=>{calSel=calSel===cell.dataset.date?null:cell.dataset.date;render();});
  wireCalDetail(root);
}

function calDetailHtml(ss){
  return ss.map(s=>{
    const dateLabel=DOW[s.date.getDay()]+" "+s.date.getDate()+" "+s.date.toLocaleString("en",{month:"short"});
    const st=state.status[s.dateStr]||null;
    const statusBtns=`<div class="actions" style="padding:14px 18px">
      <button class="btn" data-act="done" data-date="${s.dateStr}" ${st==="done"?'data-state="done"':""}>${st==="done"?"✓ Done":"Mark done"}</button>
      <button class="btn ghost" data-act="skip" data-date="${s.dateStr}" ${st==="skipped"?'data-state="skipped"':""}>${st==="skipped"?"Skipped":"Skip"}</button>
      ${s.kind==="run"?`<button class="btn" data-act="swap" data-date="${s.dateStr}">${Program.sportFor(state,s)==="bike"?"Back to run":"Swap to bike"}</button>`:""}
    </div>`;
    if(s.kind==="run"){
      const sport=Program.sportFor(state,s);
      const title=s.run.type==="test"?s.run.name:(sport==="bike"?"LSS Bike":"LSS Run");
      return `<div class="card"><div class="card-head"><h3>Week ${s.week} — ${escapeHtml(title)}</h3><span class="meta">${dateLabel}</span></div>
        <div class="lift-row"><div class="lift-meta"><div class="lift-name">${escapeHtml(title)}</div><div class="lift-scheme">low aerobic · flat terrain</div></div>
        <div class="lift-val"><div class="kg run">${escapeHtml(Program.runLabel(s.run))}</div></div></div>${statusBtns}</div>`;
    }
    const rot=rotatingLifts();const ch=chosenRotating(s);
    const rotPick=rot.length>1?`<div class="rotpick" style="padding:0 18px 4px"><span class="rotpick-label">Rotating slot</span><div class="seg">${rot.map(l=>`<button class="seg-btn" data-act="rot" data-date="${s.dateStr}" data-rot="${l.id}" aria-pressed="${ch&&ch.id===l.id}">${escapeHtml(shortName(l.name))}</button>`).join("")}</div></div>`:"";
    return `<div class="card"><div class="card-head"><h3>Week ${s.week} — ${Math.round(s.pct*100)}%${s.optional?' · <span style="color:var(--amber)">Deload</span>':""}</h3><span class="meta">${dateLabel} · ${s.sets}×${s.reps}</span></div>
      ${liftRowsHtml(s)}${rotPick}${statusBtns}</div>`;
  }).join("");
}

function wireCalDetail(root){
  root.querySelectorAll("#calDetail [data-act]").forEach(b=>b.onclick=()=>{
    const d=b.dataset.date;const act=b.dataset.act;
    if(act==="done")state.status[d]=state.status[d]==="done"?undefined:"done";
    else if(act==="skip")state.status[d]=state.status[d]==="skipped"?undefined:"skipped";
    else if(act==="swap"){if(state.sessionSwap[d]==="bike")delete state.sessionSwap[d];else state.sessionSwap[d]="bike";}
    else if(act==="rot")state.sessionPick[d]=b.dataset.rot;
    save();render();
  });
}
```

- [ ] **Step 5: Rewire nav + delete the list view.** In `renderNav`, change `["program","Program"]` to `["calendar","Calendar"]` (keep `ICONS.program` for it: rename the ICONS key to `calendar`). In `render()`, replace the `renderProgram` branch with `else if(activeTab==="calendar"||activeTab==="program"){activeTab="calendar";renderCalendar(v);}`. **Delete the entire `renderProgram` function.**

- [ ] **Step 6: Verify.** `pnpm test` (35 — unchanged), parse check (`node -e "const html=require('fs').readFileSync('index.html','utf8');const m=html.match(/<script>([\s\S]*)<\/script>/);new Function(m[1]);console.log('parses OK')"`), then `pnpm start`: Calendar shows the month grid with gutter + chips, prev/next works, clicking a day opens detail, done/skip/swap/rot work from detail, Today unchanged.

- [ ] **Step 7:** `git add index.html && git commit -m "feat: month-grid calendar view replaces program list"`

---

### Task 3: Tabbed Setup

**Files:** Modify `index.html` only.

- [ ] **Step 1: CSS** (after the `/* setup */` comment):

```css
  .tabs{display:flex;gap:2px;border-bottom:1px solid var(--line);margin-bottom:24px}
  .tab{background:none;border:none;border-bottom:2px solid transparent;margin-bottom:-1px;color:var(--muted);font-family:var(--sans);font-size:13px;font-weight:600;padding:9px 14px;cursor:pointer}
  .tab:hover{color:var(--text)}
  .tab[aria-selected="true"]{color:var(--accent);border-bottom-color:var(--accent)}
```

- [ ] **Step 2: Restructure `renderSetup`.** Add `let setupTab="program";` next to `let activeTab`. The function keeps every existing group/handler but splits the body by tab. Structure (existing markup chunks move verbatim into the named tab bodies):

| Tab | Contents (existing groups) |
| --- | --- |
| `program` | Template select · Week 1 start · Length · Plate increment |
| `lifts` | Lift days · Cluster editor · Rotation schedule · Block step |
| `endurance` | Run days (+ the week editor from Task 4) — tab hidden when `!Program.template(state).endurance` |
| `connections` | placeholder (below) |
| `general` | Your name · Bodyweight · Calendar group (session time, duration, .ics) · backup/restore/reset buttons |

```js
function renderSetup(root){
  const hasEnd=!!Program.template(state).endurance;
  if(setupTab==="endurance"&&!hasEnd)setupTab="program";
  const tabs=[["program","Program"],["lifts","Lifts"],...(hasEnd?[["endurance","Endurance"]]:[]),["connections","Connections"],["general","General"]];
  const tabRow=`<div class="tabs">${tabs.map(([k,l])=>`<button class="tab" data-stab="${k}" aria-selected="${setupTab===k}">${l}</button>`).join("")}</div>`;
  let body="";
  if(setupTab==="program"){body=/* Program group: template, startDate, weeks, increment fields */;}
  else if(setupTab==="lifts"){body=/* lift days + cluster + rotation + block step groups */;}
  else if(setupTab==="endurance"){body=/* run days group (editor arrives in Task 4) */;}
  else if(setupTab==="connections"){body=`<div class="empty"><h3>Connections</h3><p>Google Calendar live sync and Strava import land in the next update.<br>The app stays fully usable offline either way.</p></div>`;}
  else{body=/* name, bodyweight, calendar group, setup-actions */;}
  root.innerHTML=`<div class="view-title">Setup</div><div class="sub">Enter your numbers once — every week is computed from them.</div>${tabRow}${body}`;
  root.querySelectorAll("[data-stab]").forEach(b=>b.onclick=()=>{setupTab=b.dataset.stab;renderSetup(root);});
  /* existing handlers, unchanged, but EVERY querySelector result must be null-guarded
     since most elements exist only on one tab: wrap each wiring line in
     `const el=root.querySelector(...); if(el) ...` or keep querySelectorAll (already safe). */
}
```

The comment placeholders above stand for the existing template-literal chunks from the current `renderSetup` — move them without modification (the engineer pastes the current group markup into the matching tab branch). Handlers that are already `querySelectorAll`-based (`[data-k]`, `.lift-cfg`, `[data-step]`, `[data-rotday]`) are naturally no-ops on tabs where their elements don't exist; the single-element ones (`[data-template]`, `#days`, `#runDays`, `#icsBtn2`, `#backupBtn`, `#restoreBtn`, `#restoreFile`, `#resetBtn`) are already null-guarded or must gain `if(el)` guards.

- [ ] **Step 3: Verify.** Parse check; `pnpm start`: five tabs render (four on operator6 — no Endurance), every control still works on its tab (template switch, day pickers with disjointness toasts, cluster edits, rotation, block step, backup/restore/reset, .ics).

- [ ] **Step 4:** `git add index.html && git commit -m "feat: tabbed setup (program/lifts/endurance/connections/general)"`

---

### Task 4: Endurance per-week editor

**Files:** Modify `index.html` only (pure helpers landed in Task 1).

- [ ] **Step 1: CSS** (after the tabs CSS):

```css
  .end-row{display:grid;grid-template-columns:34px 1fr 1fr 1fr;gap:6px;align-items:center;margin-bottom:6px}
  .end-row.end-head span{font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--faint)}
  .end-row>span{font-size:12px;color:var(--muted)}
  input.end-cell{width:100%;text-align:center;padding:7px 6px;font-size:13px}
  input.end-cell.ov{border-color:var(--accent)}
  input.end-cell:disabled{opacity:.55;border-style:dashed}
```

- [ ] **Step 2: Editor HTML** — new function + inclusion in the `endurance` tab body after the run-days group:

```js
function enduranceEditorHtml(){
  const t=Program.template(state);
  let rows=`<div class="end-row end-head"><span>Wk</span><span>Run 1</span><span>Run 2</span><span>Run 3 (long)</span></div>`;
  for(let w=1;w<=t.weeks;w++){
    rows+=`<div class="end-row"><span class="mono">${pad(w)}</span>${[0,1,2].map(slot=>{
      const spec=Program.runSpecAt(state,w,slot);
      const isTest=spec&&spec.type==="test";
      const isOv=!!((state.enduranceOverrides[w]||{})[slot]);
      return `<input type="text" class="end-cell${isOv?" ov":""}" data-w="${w}" data-slot="${slot}" value="${escapeAttr(Program.runEditLabel(spec))}" ${isTest?"disabled":""}>`;
    }).join("")}</div>`;
  }
  return `<div class="group"><span class="eyebrow">Week-by-week minutes — book values unless edited</span>${rows}
    <p class="note">Formats: <b>30</b> fixed · <b>30-60</b> range · <b>120+</b> open-ended. Accent border = edited; clear a cell to restore the book value. The 6-Mile Test isn't editable.</p>
    <div class="setup-actions"><button class="btn" id="resetBook">Reset all to book</button></div></div>`;
}
```

- [ ] **Step 3: Wiring** (inside `renderSetup`, runs only when the elements exist):

```js
  root.querySelectorAll(".end-cell").forEach(inp=>inp.addEventListener("change",()=>{
    const w=+inp.dataset.w,slot=+inp.dataset.slot;
    if(inp.value.trim()===""){
      const ov=state.enduranceOverrides[w];
      if(ov){delete ov[slot];if(!Object.keys(ov).length)delete state.enduranceOverrides[w];}
      save();renderSetup(root);return;
    }
    const spec=Program.parseRunSpec(inp.value);
    if(!spec){toast("Use 30, 30-60 or 120+");renderSetup(root);return;}
    (state.enduranceOverrides[w]=state.enduranceOverrides[w]||{})[slot]=spec;
    save();renderSetup(root);
  }));
  const rb=root.querySelector("#resetBook");
  if(rb)rb.onclick=()=>{if(confirm("Discard all endurance edits and restore the book table?")){state.enduranceOverrides={};save();renderSetup(root);toast("Book values restored");}};
```

Also delete the stale sentence "Edits to individual weeks come with the Endurance tab in the next release." from the run-days note.

- [ ] **Step 4: Verify.** Parse check; `pnpm start` → Setup → Endurance: edit a cell to `45` → accent border, Today/Calendar reflect it; junk input toasts and reverts; clearing restores book; Reset-all works; week-12 test cell disabled.

- [ ] **Step 5:** `git add index.html && git commit -m "feat: per-week endurance editor with reset-to-book"`

---

### Task 5: Docs + final verification

- [ ] **Step 1:** `context.md` design-language line: "Sidebar navigation (Today / Program / Progress / Setup)" → "(Today / Calendar / Progress / Setup)"; mention Setup is tabbed.
- [ ] **Step 2:** Full pass: `pnpm test` (35), parse check, `pnpm start` manual sweep in both templates and themes.
- [ ] **Step 3:** `git add context.md && git commit -m "docs: calendar view + tabbed setup"`
