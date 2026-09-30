# Test Plan — consolidate-flow-agent-cards

Stage: proposal/design (scenario-design would open a HARD gate here; driving instruction is to make the most conservative assumption, record it, and continue — see Assumptions (unconfirmed)). Generated: 2026-09-30

Source artifacts read: `proposal.md`, `design.md`, `specs/flow-card-grid/spec.md`,
`specs/flow-card-status/spec.md`, `specs/flow-agent-card/spec.md`,
`specs/split-editor-workspace/spec.md`, `tasks.md`, `mockups/flow-agent-cards/index.html`.

Requirement refs used in the `requirement` column:

| ref | requirement |
|---|---|
| FG-live-status | `flow-card-grid` § Agent cards display live status |
| FG-grid | `flow-card-grid` § Responsive grid layout |
| FG-contrast | `flow-card-grid` § Card secondary text and file controls meet the contrast and target-size floors |
| FS-code | `flow-card-status` § Code and code-decision step cards |
| FA-handler | `flow-agent-card` § Code nodes expose a handler-source open affordance |
| SE-pane | `split-editor-workspace` § Chat pane SHALL budget its height so no row is clipped |
| NG-details | `proposal.md` Non-goals — `data-step` selection and the `FlowAgentDetail` Details dialog are unchanged |

Level routing: L1 = vitest `packages/*/**/__tests__/*.test.ts(x)` · L2 = `qa/tests/*.sh` ·
L3 = Playwright `tests/e2e/*.spec.ts` against the docker harness · electron / ci = shell, packaging, workflow.
A scenario whose observable is L1 cannot assert geometry (jsdom has no layout): L1 rows assert DOM
structure, classes, attributes and source shape; every box measurement is an L3 row.

## Assumptions (unconfirmed)

- **A1 — L2 not routed.** The change touches no install / spawn / multi-OS runtime path (proposal
  Impact is client-only), so no scenario is routed to `qa/tests/*.sh`.
- **A2 — card fill for contrast maths.** The card's unselected fill is
  `color-mix(in srgb, var(--bg-secondary), var(--bg-tertiary))` (design Context: the shell's
  unselected background), resolved per palette through the theme-token resolver.
- **A3 — threshold boundary.** "Less than 480px" is tested at a grid-wrapper `clientWidth` of
  ~243px (below) and >= 480px (above), measured on the wrapper itself; the split divider ratio that
  produces that width is not assumed.
- **A4 — e2e port.** L3 rows read the docker harness port from `.pi-test-harness.json`
  (`dashboardPort`, derived by `docker/test-up.sh`); `:18000` is never hardcoded.
- **A5 — "real click".** Real hit-tested input means a pointer event at the control's centre
  coordinates (`page.mouse.click`, or a locator click with real input) — never `element.click()`,
  which bypasses hit-testing and is the known false-pass for the reported bug.
- **A6 — no perf row.** The change declares no latency / throughput / memory requirement and adds no
  data path (proposal Discipline Skills: no `performance-optimization` trigger). A performance
  threshold would have to be invented, so no performance scenario is emitted rather than a guessed one.
- **A7 — nested-scroll verdict is manual.** Design Risks keeps `FlowSummary`'s `max-h-[48vh]` cap and
  defers the nested-scrollbar decision to a follow-up change, so the verdict is a manual observation
  (M2), not an assertion.
- **A8 — exact floors.** "At least 4.5:1" and "at least 24x24" are asserted as `>= 4.5` and `>= 24`
  with no tolerance; the compact row floor is asserted as `>= 76px` and the wide row floor as
  `>= 124px`.
- **A9 — Details control.** The Details button's 24px measurement (tasks 3.3) is asserted after the
  conditional `min-h-6`; if the unmodified measurement already clears 24px, the row still passes.
- **A10 — equal height in both grids.** Both grids use one helper (design D1), so the frozen-grid
  scenario mirrors the live-grid scenario including the bottom-alignment observable.
- **A11 — jsdom limits.** L1 rows never measure layout; anything geometric (equal height, bottom
  alignment, clip, scrollport, container query) is L3.
- **A12 — no extra eye.** "No additional eye icon" means the control row holds exactly the two file
  controls plus the Details button — no preview/eye control is added.

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | FG-grid | source-scan + BVA on constants | L1 | automated | `packages/flows-plugin/src/client/flow-card-grid.ts` plus the two grid call sites `FlowDashboard.tsx` and `FlowSummary.tsx` | import the module and scan both sources | row track 124, compact row track 76, column minimum 190, gap 8; both call sites spread the helper; no `minmax(200px` literal remains in `packages/flows-plugin/src`; the module imports nothing from `packages/client` |
| E2 | FG-live-status | DOM-structure assertion (jsdom, no layout) | L1 | automated | agent cards with 0, 1 and 2 recorded `recentTools` | render `FlowAgentCard` in the primitive-registry harness | each card renders exactly one body slot carrying `min-h-[30px]` and `leading-[15px]`; entry count is 0 / 1 / 2; zero elements whose only text is U+00A0 (no placeholder pad rows) |
| E3 | FG-live-status | decision table over tool-call count 0/1/2/4 | L1 | automated | `recentTools` lists of length 0, 1, 2 and 4 in oldest-to-newest reducer order | render each card | 0 -> no entry text; 1 -> exactly one entry marked `▸` carrying the newest tool; 2 -> `▸` newest then `·` previous; 4 -> exactly 2 entries, `▸` is the 4th and `·` the 3rd, the 1st and 2nd are absent; never 3 entries |
| E4 | FS-code | boundary value (4 log lines) | L1 | automated | code node, `detailHistory` text lines `line-1`..`line-4` | render the card | `LogBlock` is called with `previewLines` 2; the preview body contains `line-3` and `line-4` and not `line-1` / `line-2`; the copy control's payload equals the full 4-line log |
| E5 | FS-code | BVA on log-line count 0/1/2/3 | L1 | automated | code node with 0, 1, 2 and 3 text entries | render each card | 0 -> no `LogBlock`, the body is the same `min-h-[30px]` reserved slot an agent card renders; 1 -> `LogBlock` with that single line; 2 -> both lines; 3 -> the last 2 only; the copy payload is always the full log |
| E6 | FG-live-status, FS-code | decision table (target resolution) + `title` attribute | L1 | automated | four cards: code with `codeTarget` `/a/b/handler.ts`; agent with `sourcePath` `/x/y/filler.md`; agent with alias `@ops` and no paths; agent with neither | render each card | exactly one monospace line per card: `handler.ts` with `title` `/a/b/handler.ts`, `filler.md` with `title` the full path, `@ops`, and none for the last card; the DOM has no `‹›` absolute-path line and no separate alias line |
| E7 | FG-live-status | decision table (pending+blocked / complete / neither) | L1 | automated | pending agent with `blockedBy` `alpha`,`beta` and no tokens | render the card | the stats line text contains `waiting: alpha, beta`; that value appears on exactly one line of the card and not on a second secondary line above the body |
| E8 | FG-live-status (cost carrier) | BVA on cost (0.0142 / 0 / undefined) | L1 | automated | complete agent with tokens, duration and cost 0.0142; then cost 0; then cost undefined | render each card | first: the stats line reads `↑<in> ↓<out> · $0.0142 · <duration>`; the other two: the `$` segment is absent while tokens and duration remain on the same line |
| E9 | FA-handler, FG-contrast | decision table (both targets present) + control count | L1 | automated | code-kind card with `codeTarget`, `sourcePath` and a session id; and an agent card with no `codeTarget` | render each card | the code card's control row holds exactly two file controls with titles exactly `Open handler in editor` and `Open <name> source in editor`; no third icon-only control (no eye/preview button); the agent card holds exactly one |
| E10 | FA-handler | decision table: kind x codeTarget x sourcePath x sessionId (16 combinations) | L1 | automated | the reachable flag combinations, including agent-kind with `codeTarget` (unreachable per reducer, asserted defensively) | render each combination | handler button present iff kind is `code`/`code-decision` AND `codeTarget` set AND session id present; doc button present iff `sourcePath` set AND session id present; both when both targets and a session exist; neither without a session id; no handler button for agent kind |
| E11 | FG-contrast | source-scan (text/AST gate) | L1 | automated | `packages/flows-plugin/src/client/FlowAgentCard.tsx` | scan the source for the retired tokens and shapes | zero occurrences of `--text-muted` / `text-muted`, zero U+00A0 or `&nbsp;` literals, zero `‹›` literals |
| E12 | FG-contrast | EP over 18 palettes + token-vs-fill contrast maths | L1 | automated | 9 themes x dark/light token maps; card fill `color-mix(in srgb, var(--bg-secondary), var(--bg-tertiary))` | resolve tokens with the file's palette resolver and compute the WCAG ratio | `--text-tertiary` >= 4.5:1 on the card fill for all 18 palettes; the same assertion computed with `--text-muted` is below 4.5, so a silent token swap fails the row |
| E13 | SE-pane | table assertion + completeness | L1 | automated | `CHAT_PANE_ROW_TABLE` and `App.tsx` | read the table and classify the row | `content-header-sticky` is `shrinkable` with bound 0, floor 1, weight 2 and floor > bound; shrinkable row count is 3; the completeness scan still finds the row exactly once; no assertion requires bound > 0 |
| E14 | NG-details | state-transition (select, open, close) | L1 | automated | live grid with two cards | click card A's wrapper, then its Details button, then close it | the wrapper still carries `data-step` equal to A's step id; A is marked selected and B is not; the Details dialog opens with A's content; the Details click does not change the selection |
| E15 | SE-pane | BVA far below the floor sum | L3 | automated | split mode with a flow attached, pane height below the sum of every shrinkable row's bound plus the fixed rows' content heights | render the pane | the header row renders at 0px (its bound), the transcript is >= 16px, the composer is >= 72px, and no row is below its own bound at the moment the pane's bottom edge starts clipping |
| E16 | FG-contrast | measurement, BVA on the 24px floor | L3 | automated | code card with both file targets, wide pane | measure the control row's boxes | each file control's clickable box is >= 24x24 CSS px with the icon glyph size unchanged, and the Details button box height is >= 24px |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|--------------------------------|
| F1 | FG-grid, FG-live-status | geometry measurement (state: live grid) | L3 | automated | live flow, row 1 = a 0-tool-call card plus a 2-tool-call card, row 2 = a single card, grid wrapper >= 480px | render the live panel and measure | `abs(h1 - h2) <= 1px`; each card's control row bottom edge equals the card's own bottom edge within 1px; no card is shorter than its row; the single-card row is >= 124px tall |
| F2 | FG-grid | geometry measurement (state: frozen summary grid) | L3 | automated | completed flow, two summary cards with differing content lengths | render the summary and measure inside `flow-summary-scrollbox` | both cards share one height within 1px and each control row is bottom-aligned to its own card bottom (same invariant as F1) |
| F3 | FS-code, FG-grid | geometry measurement with a content-grown card | L3 | automated | one row: an agent card with a 2-line body plus a code card with 6 log lines | render the live panel | the code card is > 124px, both cards in the row are equal within 1px, the code preview shows the last 2 lines and offers copy and expand |
| F4 | FG-grid | geometry measurement with extras | L3 | automated | one row: a card with 2 typed-output chips and a soft-failure banner plus a plain card | render the live panel | both cards are equal within 1px, the row is > 124px, and the chips and the banner are both rendered |
| F5 | FG-grid | container-query threshold, below (pane-keyed) | L3 | automated | 1440px viewport, split divider dragged so the grid wrapper's own `clientWidth` reads ~243px, live flow with 5 cards | render the panel | the grid renders exactly 1 column (each card's width equals the grid content width within 1px); the basename line and the body slot are absent from the rendered tree; the card count is still 5 |
| F6 | FG-grid | container-query threshold, above, and viewport-independence | L3 | automated | a 700px viewport (below the mobile breakpoint) with a >= 480px wrapper; and a desktop viewport with a 481px wrapper | render the panel in each configuration | full cards in both: the basename line and the body slot are present and the compact treatment is not applied, proving the query keys off pane width, not the viewport |
| F7 | SE-pane | geometry + scrollport measurement (split editor open) | L3 | automated | split editor open, chat pane ~243px, live flow panel ~476px tall in the sticky header row | render the pane | the header row is < 476px and >= 0; the header's `scrollHeight > clientHeight` (it owns a scrollport); the transcript is >= 16px and the composer >= 72px; every pane child's rect lies inside the pane's rect within 1px (nothing painted outside its box) |
| F8 | SE-pane | geometry above the base-height sum | L3 | automated | pane taller than the sum of all rows' base heights with the flow panel rendered | render the pane | the header row equals its content height within 1px and its `scrollHeight == clientHeight` (no scrollbar) |
| F9 | SE-pane | geometry with an empty slot (equivalence check) | L3 | automated | selected session with no flow attached (the sticky slot renders null), split mode, pane below the floor sum | render the pane | the header wrapper is exactly 0px tall; transcript and composer heights equal the values measured with the wrapper removed from the DOM within 1px; no dead band and no pixel floor |
| F10 | FA-handler, SE-pane | real hit-tested pointer injection, state-transition A -> B | L3 | automated | split editor open (pane ~243px), two code-kind cards A and B with distinct handler files | open A's handler from its control, then scroll the header row's own scrollbar to card B's `Open handler in editor` and click it with a real pointer at the control's centre (never `element.click()`) | the click is not reported as covered/intercepted; the route becomes `/session/<id>/editor?file=<B>`; card A's editor tab stays open and the active editor tab becomes B's basename; both files render |
| F11 | SE-pane (regression guard) | regression invariant | L3 | automated | the existing flow-less scenarios of `tests/e2e/chat-pane-below-floor-allocation.spec.ts` at their existing pane heights | run the spec against the built client | rows #E3 and #E4 (at/above the floor sum, clip 0), #E5-#E8 (deficit shared, transcript 16..64px, composer >= 72px, context strip > 20px), #E9 and #F4 pass with zero expectation edits; a failure is treated as a reclassification bug, not a stale expectation |
| F12 | FG-grid | geometry + content-presence in the compact tile | L3 | automated | pane < 480px with a code card that has neither `codeTarget` nor `sourcePath` (no basename line) and no logs (no body) | render the panel | the tile still renders the status icon, the name, the stats line and the control row; the tile is >= 76px tall; no zero-height card and no collapsed empty box |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | FA-handler | fault injection (unreadable resource) | L3 | automated | a code card whose `codeTarget` names a path that does not exist in the harness fixture | click the `Open handler in editor` control | the route carries that file parameter; the editor pane renders its own failure state (non-empty error text); the card gains no error or loading state and issues no fetch; no request to `/api/pi-resource-file` is observed |
| X2 | FA-handler | fault injection / state transition (session id withdrawn) | L1 | automated | a code card rendered with session id S1 and both file controls visible | re-render the same card with `sessionId` undefined | both file controls disappear, no navigation is recorded, and no exception is thrown |

### Manual-only

| id | requirement | technique | level | disposition | input | trigger | expected observable (judgment) |
|----|-------------|-----------|-------|-------------|-------|---------|-------------------------------|
| M1 | FG-live-status, FG-grid | visual/subjective | — | manual-only | the built card at the 124px row floor and the compact tile in a narrow pane | a human looks at both against the mockup | judgment: the card reads at a glance with no cramping or clipped text; no automatable signal |
| M2 | SE-pane | visual/subjective (nested scroll) | — | manual-only | split editor open, pane ~243px, flow summary rendered | a human scrolls the header row and the summary's `max-h-[48vh]` inner box | judgment: whether the produced scrollbars are acceptable — record the observation; the fix, if needed, is a separate change (design Risks) |
| M3 | FG-grid | tuning/subjective | — | manual-only | the built client at a real split ratio | a human drags the divider across the 480px threshold | judgment: whether the 480px threshold and the 76px compact row are the right values; the constants are tunable without a spec change (design Open Questions) |

## Coverage summary

- Requirements covered: 6/6 (FG-live-status, FG-grid, FG-contrast, FS-code, FA-handler, SE-pane) plus the NG-details non-goal guard (E14).
- Scenarios by class: edge 16 · frontend 12 · error 2 · manual 3 · performance 0.
- Scenarios by level: L1 15 · L2 0 · L3 15 · electron 0 · ci 0.
- Scenarios by disposition: automated 30 · manual-only 3.

## New infra needed

- None expected: every L1 row extends an existing vitest file and every L3 row extends an existing
  Playwright spec (`flow-attach-before-run.spec.ts` drives the live panel and the frozen summary;
  `chat-pane-below-floor-allocation.spec.ts` is the pane-geometry home; `ui-token-alignment.spec.ts`
  and `tests/e2e/helpers/computed-contrast.ts` hold the contrast/target helpers). If
  `flow-attach-before-run.spec.ts` breaches the spec size rule while absorbing F1-F6 and F10, spawn a
  sibling `flow-card-grid-geometry.spec.ts` rather than a new harness.
- Not routed: no L2 smoke row (nothing install/spawn/multi-OS — A1) and no performance row
  (no latency/throughput/memory requirement exists — A6).
