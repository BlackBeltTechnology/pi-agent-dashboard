# Test Plan — fix-chat-transcript-layout

Stage: apply   Generated: 2026-11-03   Clarifications resolved: 2026-11-03

## Resolved clarifications (owner decision 2026-11-03: all recommended answers accepted)

- **C1 → Q1 (a)**: spec scenario "Chip appearing does not yank a scrolled-up transcript" added (auto-canvas); oracle `scrollTop` delta = 0 ±1 px (F9).
- **C2 → Q2 (a)**: one collapsed-header constant for every burst row incl. running/expanded; spec sentence reworded + scenario "Burst estimate is independent of member count and open state" (E10).
- **C3 → Q3 (a)**: spec scenario "Composer stays fully visible on a short pane with two chips" added (auto-canvas); oracle `composer-root` box ⊆ `split-chat-pane` box at 375×320 (X2).

---

## Scenarios

Existing-test exemplars (verified present):
- L1 burst: `packages/client/src/components/__tests__/ToolBurstGroup.test.tsx` (`withViewport`, `renderViewportBurst`, `tool()`; #E20–#E22)
- L1 inspector: `packages/client-utils/src/minimal-chat/__tests__/MinimalChatView.test.tsx`
- L1 estimate: `packages/client/src/lib/__tests__/chat-virtual-rows.test.ts`
- L1 tray: `packages/client/src/components/__tests__/CanvasDriver.test.tsx`
- L1 layout table: `packages/client/src/lib/__tests__/chat-pane-row-completeness.test.ts`
- L3 tray: `tests/e2e/canvas-chip-tray-overlay.spec.ts` (helpers `layoutBoxes`, `composerStackTop`; faux `canvas-declare-server[-long]`)
- L3 burst: `tests/e2e/tool-burst.spec.ts` (faux `burst-heterogeneous`)
- L3 virtualizer/scroll: `tests/e2e/chat-transcript-virtualization.spec.ts`, `tests/e2e/scroll-to-top.spec.ts`
- L3 inspector: `tests/e2e/subagent-inspector.spec.ts` ("collapsed running card height is stable…")

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | chat-view: running burst cap (#1100) | BVA (cap=8, upper boundary) | L1 | automated | 7 complete + 1 running = 8 visible, desktop, `toolGroupDefaultCollapsed` off. Exemplar ToolBurstGroup.test.tsx #E22 | render | `tool-burst-body` mounted (expanded); header `Working` + `7 done` |
| E2 | chat-view: >8 stays collapsed | BVA (just-above-max) | L1 | automated | 8 complete + 1 running = 9 visible | render | `tool-burst-body` absent; header `Working`, `8 done`, running summary, stop control present |
| E3 | chat-view: Large running group stays collapsed (#1100 repro) | EP (large partition) | L1 | automated | 47 complete + 1 running | render | body absent AND zero member rows mounted (`querySelectorAll` member row testid = 0); header `Working` + `47 done` |
| E4 | chat-view: below-min / nominal | BVA (min) | L1 | automated | 0 complete + 1 running (1 visible) and 1+1 (2 visible) | render | body expanded in both |
| E5 | chat-view: "visible" count | decision-table (hidden-kind × cap) | L1 | automated | 12 members, 5 of a kind hidden by display prefs → 7 visible incl. running; and 9 members with 0 hidden | render | 7 visible → expanded; 9 visible → collapsed (count uses `isVisible`, not raw members) |
| E6 | chat-view: manual toggle wins | decision-table | L1 | automated | 47+1 running, collapsed | click header; click again | expanded; then collapsed (`override ?? autoOpen`) |
| E7 | chat-view: pref/mobile × size | decision-table (pref {off,on} × mobile {n,y} × size {≤8,>8}) | L1 | automated | 8 combos; only (off,desktop,≤8) auto-expands | render each | body present in exactly 1 of 8 combos; header live in all. Exemplar #E20/#E22, "toolGroupDefaultCollapsed keeps a running group's body closed" |
| E8 | chat-view: per-session override beats global (existing) | regression | L1 | automated | global on, session override off, 3 members running | render | follows run status (expanded); existing tests stay green with cap |
| E9 | minimal-chat-view: inline sizes to content | EP (empty/1 short/live-only/long) | L1 | automated | inline + {1 short text entry; live in-progress entry only} | render | root class has `max-h-[60vh]`, no `h-[60vh]`/fixed `h-*`; popout root still `h-full` |
| E10 | chat-transcript-virtualization: burst estimate | EP (burst vs text/custom/image rows) | L1 | automated | burst row display item with 1 / 8 / 47 members, and running+small | `estimateVirtualRowSize(item)` | `=== COLLAPSED_BURST_ESTIMATE` (≈32, not 220) independent of member count; unclaimed `custom` stays `160+240=400`; text/image arms unchanged. Running small (expanded) burst also returns the same constant (Q2 a). |
| E11 | chat-transcript-virtualization: O(1) | invariant | L1 | automated | burst row with a content getter that throws on access | call estimate | returns constant, getter never touched |
| E12 | auto-canvas: tray in slot | EP (anchor set vs null) | L1 | automated | `anchor` element set, split mode `split` | render `CanvasDriver` with chip | tray is descendant of `anchor`; not child of `document.body`; no `fixed`, no inline `bottom`/`right`; wrapper `pb-3` |
| E13 | auto-canvas: fallback | EP | L1 | automated | `anchor` null (read-only / frozen / ended) | render | tray portaled to body, `fixed`, safe-area bottom, visible (existing #E3 kept); `pointer-events:none` on tray, chips auto (#E5 kept) |
| E14 | auto-canvas: full-editor mode | state-transition (split→full→split) | L1 | automated | `anchor` set; split mode `full` | render; switch to `split` | `full`: tray in fallback overlay, not inside `anchor`; `split`: back inside `anchor`; `closed`: inside `anchor` |
| E15 | auto-canvas: slot a11y | role query | L1 | automated | slot with server chip | `getByRole("link"|"button", {name})` | found; `anchor` has no `aria-hidden` |
| E16 | auto-canvas: long path | BVA (path len 0 / 120 chars) | L1 | automated | `CanvasServerChip` with `path` ≥120 chars | render | address span has `min-w-0 truncate`, not `shrink-0`; label span still truncates |
| E17 | auto-canvas: no observers | invariant | L1 | automated | anchored case | mount/unmount | zero `ResizeObserver`/`MutationObserver`/`visualViewport` listeners created by `CanvasDriver` (replaces #E4/B1/B1r2/#E6) |
| E18 | auto-canvas: frozen underlay | decision-table | L1 | automated | frozen/readOnly session with live chip | render App composer column logic (guard `!frozen && !readOnly`) | slot ref not provided → `anchor` null → fallback overlay |
| E19 | composer-dock: chip slot row | table completeness | L1 | automated | `CHAT_PANE_ROW_TABLE` incl. `composer-stack-anchor` | run `chat-pane-row-completeness.test.ts` | still `fixed`/content; test green after comment update |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | chat-view: #1100 no ~1 kpx step | tail-latency (per-frame sampling) + threshold | L3 | automated | session with ≥40-member collapsed burst (new faux scenario, see New infra), then a new tool call joins; sample burst virtual-row height each rAF | max sampled height ≤ collapsed header height + 40 px; mounted member rows during run = 0 | from tool start to tool end (~3 s) |
| P2 | chat-view: mount cost bounded | threshold | L3 | automated | 47-member burst, tool start | DOM node count under `tool-burst-group` ≤ header-only baseline + small constant (no member rows) | one tool cycle |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | chat-view: ≤8 burst flap bound | state-transition | L3 | automated | 3-member burst (`burst-heterogeneous`) | tool start → end → next tool start | expands while running, collapses on end, re-expands next start; never mounts >8 member rows (accepted flap, design D1) |
| F2 | chat-view/D1: crossing the cap mid-run | state-transition | L1 | automated | 8 visible running (expanded); rerender with 9th member | rerender | collapses (accepted); header still `Working`, stop present. Illegal edge: manual-expanded group then crossing 9 → stays expanded (override wins) |
| F3 | chat-view: running→done with manual open | state-transition | L1 | automated | 47 members, user expanded, running→complete | rerender | body remains mounted (mirrors #E21) |
| F4 | minimal-chat-view: streaming growth monotone | state-convergence | L3 | automated | running inline inspector (faux `subagent-streaming-inner` family), entries appended 1-by-1 | observe root height after each append | root height non-decreasing, ≤ 60% viewport height; with 1 short entry root.bottom − lastEntry.bottom ≤ 8 px. Failure → fall back to D3 alt B. Exemplar subagent-inspector.spec.ts:115 |
| F5 | minimal-chat-view: long content scrolls at cap | BVA (just-above-cap) | L3 | automated | inspector with content > 60vh | render | root height == 0.6 × viewport (±1 px); body `scrollHeight > clientHeight` and scrollable |
| F6 | chat-transcript-virtualization: collapse after expand | state-transition | L3 | automated | historical collapsed burst | expand → collapse | row height and next row's offset return to collapsed value within 1 px |
| F7 | chat-transcript-virtualization: no new drift | regression | L3 | automated | long transcript with many collapsed bursts | scroll-to-top convergence (`scroll-to-top.spec.ts`) + virtualization spec | green, no new drift; `toggling an above-viewport tool group does not yank the viewport` still green |
| F8 | auto-canvas: chip appearing doesn't move chrome | state-transition | L3 | automated | desktop session, no chip; faux `canvas-declare-server` | chip appears (and disappears) | header-app-bar, toolbar, composer-root boxes unchanged ±0.5 px; chip box above `composer-dock` top (`composerStackTop`) |
| F9 | auto-canvas/D6: stays pinned when slot appears | state-convergence | L3 | automated | chat pinned to bottom with ≥1 screen of messages | chip appears, then disappears | last row bottom ≤ scroller bottom after each; follow mode retained. Unpinned case: scrollTop unchanged after chip appears. Unpinned (scrolled-up) case: `scrollTop` delta = 0 ±1 px after chip appears and after it disappears (Q1 a; spec scenario "Chip appearing does not yank a scrolled-up transcript"). |
| F10 | auto-canvas: editor-open | decision-table (editor split/full/closed) | L3 | automated | desktop with editor pane open + server chip | settle | tray box inside `split-chat-pane`, no intersection with `split-editor-pane` |
| F11 | auto-canvas: transcript & scrollbar & handle | geometry | L3 | automated | chip shown, pinned bottom, growing multi-line draft | settle | tray ∩ last row = ∅; ∩ scrollbar = ∅; ∩ `composer-dock-hide` = ∅; x-range ⊆ composer extent; tray.bottom ≤ dock top for each draft growth step |
| F12 | auto-canvas: mobile newest message | EP (375 px) | L3 | automated | 375×812, chip visible, pinned | settle | last message bottom ≤ tray top. Also mobile tap-to-open chip: in slot, header unmoved, tap opens target foreground |
| F13 | auto-canvas: long label/path | BVA (80-char title; 120-char path) | L3 | automated | faux `canvas-declare-server-long` | render | label truncated; chip width ≤ dock width (±0.5) in both cases |
| F14 | auto-canvas: full-editor reachability | state-transition | L3 | automated | chip shown; editor → `full` → `split` | toggle | `full`: chip visible as fixed bottom-right overlay; `split`: chip inside slot |
| F15 | auto-canvas: no-dock case | EP (dock hidden `allEmpty`) | L3 | automated | no dock rendered (existing F12b) | chip shown | tray within composer-root horizontal extent (8 px inset accepted); not over transcript |
| F16 | auto-canvas: popover over tray | z-order | L3 | automated | chip shown; open model selector | open | `elementFromPoint` at overlap is popover, not chip (popover z above) |
| F17 | auto-canvas: tray first-appearance | state-transition (sampling) | L3 | automated | live composer; chip first appears | sample every rAF from chip insertion | in every sampled frame the tray box ∩ composer stack = ∅ (in-flow, no unpositioned frame) |
| F18 | auto-canvas: fallback stacking | z-order | L1 | automated | fallback overlay chip + toast layer | render both | fallback tray layer class is below toast/dialog layers (`z-overlay` < toast); empty area `pointer-events:none` |
| F19 | auto-canvas: soft keyboard | real device | — | manual-only | iOS/Android, chip shown | open keyboard | [judgment: chip remains visible above composer — needs real soft keyboard; no automatable observable] |
| F20 | #1084/#1100 whole | subjective | — | manual-only | live session, the three issue repros after `npm run build` + restart | human pass (task 5.2) | [judgment: no flash/jump on burst, no blank inspector area, chip not covering content] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | auto-canvas: anchor lost | fault-injection (abort: anchor unmounts) | L1 | automated | `anchor` goes null while chip live (session ends / read-only) | rerender | tray moves to fallback overlay without throwing; chip still reachable |
| X2 | auto-canvas: short pane + two chips | boundary (viewport 375×320) | L3 | automated | mobile file chip (`min-h-[44px]`) + server chip both shown | settle | `composer-root` box ⊆ `split-chat-pane` box; transcript may shrink to its 16 px bound (Q3 a; spec scenario "Composer stays fully visible on a short pane with two chips") |
| X3 | auto-canvas: chip removed | fault-injection (abort: server stops) | L3 | automated | chip shown, server chip removed mid-session | removal | slot height returns to 0 (±0.5 px), chrome unmoved, pin retained |
| X4 | chat-view: elided member does not count | fault-injection (data) | L1 | automated | burst with elided/`isVisible=false` members (existing "does not count an elided member as done") | render | not counted toward cap nor `N done` |

---

## Coverage summary

- Requirements covered: 6 spec files / all scenarios (chat-view 8 incl. cap/size/manual/pref; minimal-chat-view 3; virtualization 4; auto-canvas 17; composer-dock 1; shared-timeline-view 1 via E9) + issue repros #1100 (E3, P1, P2), #1083 (E9, E10, F4, F6), #1084 (F8–F13)
- Scenarios by class: edge 19 · perf 2 · frontend 20 · error 4
- Scenarios by level: L1 24 · L2 0 · L3 19 · electron 0 · ci 0 (2 manual-only, level —)
- Scenarios by disposition: automated 43 · manual-only 2

## New infra needed

- Faux scenario for P1/P2: a session that yields a ≥40-member bash burst then one more running tool (extend `qa/fixtures/faux-scenarios.ts`; closest `burst-heterogeneous` at :1378). Same fixture file, no new level/harness.
- Optional: a faux scenario with a deterministic canvas chip for the unpinned/pinned F9 pair (reuse `canvas-declare-server`).
