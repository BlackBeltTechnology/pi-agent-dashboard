# Test Plan — fix-openspec-board-drop-targeting

Stage: design   Generated: 2026-08-05

All four clarification gaps were resolved before writing (HARD gate satisfied):

- **C1** → ship stable test hooks: `data-drop-target` on the target column, `data-drop-slot="<index>"` on the body, `data-rail-active` on the append rail. Assertions read these, not computed styles.
- **C2** → do not test the edge-zone boundary; assert only that the body scrolls when the pointer is near the edge. Two BVA rows dropped deliberately.
- **C3** → perf threshold is sustained 60fps during a full-column drag: no frame > 16.7ms.
- **C4** → contrast threshold is WCAG 2.1 SC 1.4.11 non-text, **3:1** against the column background, asserted programmatically across all 9 themes × light/dark (18 combinations).

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | Single drop rule | BVA | L1 | automated | column `[a,b,c]`, dragging `X` from another column; pointer 1px **above** `b`'s midpoint | resolve slot | `index === 1` (before `b`) |
| E2 | Single drop rule | BVA | L1 | automated | same; pointer **exactly at** `b`'s midpoint | resolve slot | `index === 2` (after `b`) — tie resolves *after* |
| E3 | Single drop rule | BVA | L1 | automated | same; pointer 1px **below** `b`'s midpoint | resolve slot | `index === 2` |
| E4 | Every slot reachable | BVA | L1 | automated | column `[a,b,c]`; pointer 1px below `c`'s midpoint | resolve slot | `index === 3` (last slot reachable) |
| E5 | Every slot reachable | BVA | L1 | automated | column `[a,b,c]`; pointer above `a`'s midpoint | resolve slot | `index === 0` (first slot) |
| E6 | Single drop rule | EP | L1 | automated | **empty** column, pointer anywhere in body | resolve slot | `index === 0`, no throw |
| E7 | Single drop rule | EP | L1 | automated | single-card column `[a]`, pointer below `a`'s midpoint | resolve slot | `index === 1` |
| E8 | Direction independence | decision-table | L1 | automated | column `[a,b,c,d]`; target gap between `b` and `c`; source ∈ {dragged-up-from-`d`, dragged-down-from-`a`, cross-column} | resolve slot for all 3 | all three return the **same** index; no direction/scope branch |
| E9 | Moved card excluded | EP | L1 | automated | same-column drag of `b` in `[a,b,c,d]` | resolve slot | the moved card is **not** counted; index is into the without-moved list |
| E10 | Adjacent drag is not a no-op | decision-table | L1 | automated | `[a,b,c,d]`, dragging `b`, pointer below `c`'s midpoint | resolve → `computeReorder` | result `[a,c,b,d]` — **not** `[a,b,c,d]` |
| E11 | `computeReorder` contract | EP | L1 | automated | `resolveDropSlot` output for each of E1–E9 | feed directly to `computeReorder` | correct order with **no** `+1` adjustment applied by the caller |
| E12 | Marker host index translation | BVA | L1 | automated | same-column drag of `b` in `[a,b,c]`; resolved without-index `1` | map to rendered index | host is `c` (rendered index 2), **never** the dragged card `b` |
| E13 | Marker host index translation | BVA | L1 | automated | cross-column drop into `[a,b,c]`; resolved without-index `1` | map to rendered index | host is `b` (rendered index 1) — no `+1` offset applied |
| E14 | Target resolver | decision-table | L1 | automated | `over.id` ∈ {`<cardId>`, `<colKey>`, `col-root:<k>`, `rail:<k>`} | resolve target | each returns `{ colKey: <k>, kind }`; `kind==='rail'` ⇒ slot forced to last |
| E15 | Append affordance size | BVA | L3 | automated | viewport 375px (phone stack), drag active | measure rail bounding box | `height >= 44` |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | Cross-column move | state-transition | L3 | automated | `add-auth` in `Backlog`, board loaded | drag into `In flight`, release | converges to assignment `In flight`; survives reload |
| F2 | Intra-column reorder | state-transition | L3 | automated | column `[add-auth, fix-bug]` | drag `add-auth` below `fix-bug`'s midpoint, release | order converges to `[fix-bug, add-auth]`; survives reload |
| F3 | Last position, overflowing column | state-transition | L3 | automated | column with `scrollHeight > clientHeight` (≥14 cards), card from another column | drag to below last card's midpoint, release | dragged card is **last**; the column's prior order is unchanged ahead of it |
| F4 | Rail reachable without scrolling | state-transition | L3 | automated | overflowing column scrolled to **top**, drag active | read rail bounding box | rail is inside the body's visible bounds; still visible after scrolling to bottom |
| F5 | Rail drop preserves order | state-transition | L3 | automated | target column `[a,b,c]`, dragging `X` from another column | release on rail | order `[a,b,c,X]`; persisted order still contains `a,b,c` — **not** a single entry |
| F6 | Rail in empty column | state-transition | L3 | automated | column with 0 cards, drag active | release on rail | card becomes the column's only card; `data-rail-active` was set |
| F7 | Marker tracks the slot | state-transition | L3 | automated | column `[a,b,c]`, drag active | move pointer across `b`'s midpoint | `data-drop-slot` changes from `1` to `2` on the crossing; marker element moves gap |
| F8 | Final slot indicated without hovering the rail | state-transition | L3 | automated | column `[a,b,c]`, drag active | hold pointer below `c`'s midpoint, **not** over the rail | `data-rail-active="true"` **and** `data-drop-slot="3"`; no unindicated state |
| F9 | Continuous indication invariant | state-convergence | L3 | automated | drag active, pointer swept across the full height of a column | sample `data-drop-slot` at every step | attribute is present and non-empty at **every** sample where the pointer is over the column |
| F10 | Column header accepts a drop | state-transition | L3 | automated | drag active | release over the target column's header | card moves into that column; `data-drop-target` was set on it |
| F11 | Whole-column drop target | state-transition | L3 | automated | drag active | hover header, body, and outer padding in turn | `data-drop-target` set on the column in all three positions |
| F12 | Non-target columns recede | state-transition | L3 | automated | drag active, pointer over column A | read attributes | column A has `data-drop-target="true"`; every other column has it absent |
| F13 | Drag affordances are drag-only | state-transition | L3 | automated | board at rest (no drag) | query rails | zero rail elements present; none appear until a drag starts |
| F14 | Grab cursor | state-transition | L3 | automated | pointer over a card | read computed cursor | `grab` at rest; `grabbing` while pressed |
| F15 | Drag preview follows pointer | state-transition | L3 | automated | drag active | move pointer 200px | preview element's position tracks within tolerance of the pointer |
| F16 | Auto-scroll at the edge | state-convergence | L3 | automated | column with `scrollHeight > clientHeight`, scrolled to top | drag and hold the pointer near the body's bottom edge | body `scrollTop` increases and converges toward its maximum (boundary size deliberately untested per C2) |
| F17 | Column reorder survives collision change | state-transition | L3 | automated | columns `[Backlog, In flight, Done]` | drag `Done` onto `Backlog`, releasing over its **header** | columns reorder; order persists |
| F18 | Column reorder released over a card | state-transition | L3 | automated | same | drag `Done` onto `Backlog`, releasing over one of its **cards** | columns reorder — **not** a silent no-op (`pointerWithin` elects the card) |
| F19 | Tablet wrap unaffected | state-transition | L3 | automated | viewport 900px | load board, start a drag | columns wrap; drop still resolves; no console error (`overflow-y: visible` ⇒ no internal scroll) |
| F20 | Phone stack unaffected | state-transition | L3 | automated | viewport 540px | load board, start a drag | columns stack full-width; rail ≥44px; drop still resolves |
| F21 | Ungrouped rail wording | visual/subjective | — | manual-only | Ungrouped column rail during a drag | human reads the label | [judgment: label must not read as "add to a group" — a drop there *clears* assignment] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | Release outside cancels | fault-injection (abort) | L3 | automated | pointer released outside every column | release over the page margin | no assignment or order change; `data-drop-slot` cleared; no rail, no marker, no preview |
| X2 | Release in the gutter cancels | fault-injection (abort) | L3 | automated | pointer released in the gutter **between two columns** | release there | card does **not** move into either neighbour; order unchanged |
| X3 | Interrupted by pointer-cancel | fault-injection (abort) | L3 | automated | `pointercancel` dispatched mid-drag | fire it | no order change; rail, marker, preview, and receded state all cleared |
| X4 | Interrupted by tab-hide | fault-injection (abort) | L3 | automated | `visibilitychange` to hidden mid-drag | fire it | same cleared state as X3 |
| X5 | Interrupted by window blur | fault-injection (abort) | L3 | automated | window `blur` mid-drag (tab still visible) | fire it | same cleared state as X3 — dnd-kit has **no** blur listener, so this exercises the separate handler |
| X6 | Stale-slot frame race | fault-injection (delay) | L3 | automated | pointer moves from inside a column into the gutter and releases within one frame | perform the fast move+release | commits nothing — the end event's live `over` gates the commit, not the last `dropSlot` |
| X7 | Rail id never reaches persistence | fault-injection | L1 | automated | `over.id === "rail:next-phase"` | run the commit path | persisted group key is `next-phase`; **no** `changeOrder` key or assignment containing `rail:` or `col-root:` |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | Drag-move resolution cost | frame-budget | L3 | automated | 64-card column (`next-phase`), drag swept top→bottom | no frame > **16.7ms** (sustained 60fps) | full sweep, ≥3s |
| P2 | Early bail-out is effective | frame-budget | L1 | automated | repeated resolution calls with the pointer inside one gap | zero state updates when the resolved slot is unchanged | 100 calls |

### Accessibility / theming

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| A1 | Marker contrast | threshold | L3 | automated | each of 9 themes × {light, dark} = 18 combinations | render marker over the column background | contrast ratio **≥ 3:1** (WCAG 2.1 SC 1.4.11 non-text) |
| A2 | Rail contrast | threshold | L3 | automated | same 18 combinations | render rail in its active state | contrast ratio **≥ 3:1** |
| A3 | Static accent risk | threshold | L3 | automated | blue-accented themes: github, tokyo-night, rose-pine, solarized (light + dark) | render marker + rail | ≥ 3:1 — these are the highest-risk combinations because `--accent-primary` is static, not theme-switched |

---

## Coverage summary

- Requirements covered: 6/6 (all delta requirements; all 21 spec scenarios map to ≥1 row)
- Scenarios by class: edge 15 · frontend 21 · error 7 · perf 2 · a11y 3 = **48**
- Scenarios by level: L1 **18** · L2 **0** · L3 **29** · manual-only **1**
- Scenarios by disposition: automated **47** · manual-only **1**

L2 is deliberately empty: this change touches only rendered client behaviour, and the level boundary forbids rendered-UI assertions in `qa/` process smoke.

## New infra needed

- **Test hooks must ship** (C1): `data-drop-target`, `data-drop-slot="<index>"`, `data-rail-active`. These are production DOM attributes, not test-only shims — they must be added in the implementation tasks, not the test tasks.
- **Contrast assertion helper** for A1–A3: iterate `THEMES` × {light, dark}, compute the ratio against the resolved column background. No such helper exists in `tests/e2e/` yet.
- **Frame-timing capture** for P1: Playwright tracing or a `requestAnimationFrame` probe. Confirm whether an existing spec already does this before writing a new one.
- No new test *level* or harness is required.
