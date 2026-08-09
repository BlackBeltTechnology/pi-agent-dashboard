# Test Plan — unify-folder-status-capsule

Stage: design   Generated: 2026-08-14

Clarification gate: **passed**. Three unfillable slots were resolved before this
catalog was written and folded back into the spec as requirements — count cap
(`999+`), counting budget (1000 sessions / 5 ms), and the filtered-target
observable (the reveal path's existing filtered notice). No `[NEEDS
CLARIFICATION]` markers remain.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | Segments are severity-ordered | decision-table | L1 | automated | folder with 1 needs-you, 9 error, 1 working, 1 idle | capsule counts + renders | segments emit in order needs-you, error, working, idle — magnitude does not reorder |
| E2 | Segments are severity-ordered | state-transition | L1 | automated | folder with only error + idle | capsule renders | error precedes idle; no empty slots between them |
| E3 | Empty segments do not render | EP | L1 | automated | folder with 12 idle, 0 of every other state | capsule renders | exactly one segment renders, the idle one |
| E4 | Empty segments do not render | BVA (zero boundary) | L1 | automated | folder with 0 sessions | header renders | no `folder-status-capsule-<cwd>` element in the DOM |
| E5 | Empty segments do not render | BVA (all-excluded boundary) | L1 | automated | folder whose 5 sessions all have status `ended` | header renders | no capsule element; the folder's `N ended` disclosure row still reports 5 |
| E6 | Ended/hidden/widget-bar excluded before bucketing | decision-table | L1 | automated | one session `status: ended` with its notice flag still set | counting pass runs | session appears in no bucket (guards the `hasNotice`-before-status short-circuit) |
| E7 | Ended/hidden/widget-bar excluded before bucketing | EP | L1 | automated | folder of 3 visible + 4 `hidden` sessions, mixed states | counting pass runs | only the 3 visible sessions are counted |
| E8 | Needs-you counted by explicit predicate | decision-table | L1 | automated | `ask_user` session whose widget-bar classification is `undefined` | counting pass runs | counted in **no** bucket — not needs-you, not idle (guards the `hasWidgetBarPrompt = false` coercion) |
| E9 | Needs-you counted by explicit predicate | decision-table | L1 | automated | `ask_user` session classified `true` (widget-bar-placed) | counting pass runs | counted in no bucket; specifically **absent** from idle |
| E10 | Needs-you counted by explicit predicate | decision-table | L1 | automated | `ask_user` session that is ALSO in `errorSessionIds` | counting pass runs | counted exactly once, in error; needs-you count is 0 |
| E11 | A retrying session counts as working | EP | L1 | automated | one session in `retrySessionIds`, no other live sessions | counting pass runs | working = 1, error = 0 |
| E12 | A noticed session counts as idle | EP | L1 | automated | one idle session in `noticeSessionIds` | counting pass runs | idle = 1 — the session is not dropped (guards the unbucketed `notice` shape) |
| E13 | Segment counts capped at four glyphs | BVA (just below) | L1 | automated | segment count 999 | capsule renders | segment text is exactly `999` |
| E14 | Segment counts capped at four glyphs | BVA (just above) | L1 | automated | segment count 1000 | capsule renders | segment text is exactly `999+` |
| E15 | Capsule is the only liveness surface | decision-table | L1 | automated | any folder with sessions | header renders | no raw `(N)` count, no needs-you pill, no status rollup element present |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | Counting is linear in session count | threshold (timed unit) | L1 | automated | one folder of 1000 sessions spanning every status, half `ask_user` with a populated widget-bar map | wall time of the counting pass < 5 ms | single call, median of 5 runs |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | Capsule renders in both collapse states | state-transition | L3 | automated | folder with mixed live states, initially collapsed | user expands the folder | capsule remains present with identical segment counts across the transition |
| F2 | Non-idle segments are navigation targets | state-transition | L3 | automated | collapsed folder with ≥1 errored session | user activates the error segment | folder converges to expanded AND the first errored session becomes the selected session |
| F3 | Activation does not toggle the row | state-transition (illegal edge) | L3 | automated | expanded folder, header row has its own click handler | user activates any segment | folder stays expanded — the row handler does not fire (guards missing `stopPropagation`) |
| F4 | Scroll sequenced after expansion commits | state-convergence | L3 | automated | collapsed folder whose target card mounts only when expanded | user activates a segment | target card converges to scrolled-into-view — not a silent no-op against an unmounted body |
| F5 | Idle segment is inert but labelled | state-transition (illegal edge) | L1 | automated | capsule rendering an idle count | keyboard tabs through the header | idle segment never receives focus, and exposes an accessible name naming the state |
| F6 | Segments carry distinct accessible labels | decision-table | L1 | automated | capsule with all four segments | accessibility tree read | each non-idle segment has a distinct name stating both its count and its state |
| F7 | Capsule never wraps; name absorbs the squeeze | BVA (width boundary) | L3 | automated | folder with a long name and all four segments at 3-glyph counts | sidebar narrowed to 220 px | capsule stays on one row with every segment present; the folder-name region truncates |
| F8 | Capsule uses the status token family | decision-table | L1 | automated | capsule with a working segment; a working session card in the same folder | both render | both reference the same `--status-working` custom property (token identity, not pixel equality) |
| F9 | Unclassified probe does not flash a high count | state-convergence | L3 | automated | folder mounting with 3 `ask_user` sessions whose probes resolve on a later tick | folder first paints | needs-you count never exceeds its settled value at any observed frame — it converges upward, never downward |
| F10 | Capsule visual density beside the menu trigger | visual/subjective | — | manual-only | a real sidebar with several folders in mixed states | human looks at the sidebar | [judgment: the capsule reads as one control and the purple needs-you signal still pre-attentively dominates — no automatable observable] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | Filtered-out target degrades, not no-ops | fault-injection (target unreachable) | L3 | automated | an active session-search filter excludes the segment's target session | user activates that segment | the reveal path's existing filtered-target notice is surfaced; the app does not silently do nothing |
| X2 | Hidden target degrades | fault-injection (target unreachable) | L3 | automated | `showHidden` off while the only session of a counted state is hidden | user activates that segment | either the state is not counted (per E7) or the reveal path's hidden-target notice is surfaced — never a silent no-op |
| X3 | Counting survives a malformed flag set | fault-injection (bad input) | L1 | automated | `errorSessionIds` / `noticeSessionIds` passed as `undefined` | counting pass runs | pass completes and buckets on the remaining signals; no throw |

---

## Coverage summary

- Requirements covered: 11/11 (`folder-status-capsule` ×10, `sidebar-folder-header` ×1)
- Scenarios by class: edge 15 · perf 1 · frontend 10 · error 3
- Scenarios by level: L1 18 · L2 0 · L3 10 · manual-only 1
- Scenarios by disposition: automated 28 · manual-only 1

No L2 rows: this change is client-only, with no process, install, spawn or
multi-OS runtime surface for the VM smoke tier.

## New infra needed

None. L1 rows extend the existing `session-status-visuals.test.ts` and the
folder component tests; L3 rows extend the existing Playwright suite against the
docker harness, whose port is read from `.pi-test-harness.json` (`dashboardPort`)
rather than hardcoded.

One caveat for the L3 author: several rows need a folder seeded with sessions in
specific states (errored, `ask_user`, retrying). Check `tests/e2e/` for an
existing seeding helper before building one — if none exists, that is fixture
work inside the existing harness, not a new level.
