# Test Plan — fix-automation-board-scroll

Stage: design   Generated: 2026-11-16

No clarifications are needed. Every Triple slot resolves to concrete values from the design (viewports, counts, testids, endpoints).

Shared L3 fixtures (used by E1–E9):
- Desktop viewport 1440x900 (the 13-inch case in #1158). Mobile viewport 375x667.
- Board seeding: 12 definitions via `POST /api/plugins/automation/create` in `FIXTURE_GIT`, named `sbs-<n>` (prefix `sbs-`), with cron `0 0 31 2 *` (cannot match). Removed in `afterAll` via `DELETE /api/plugins/automation`, which must also run when a test fails.
- Run seeding: one ended run record + `result.md` written straight to the run store (the `seedDeclaredRun` / `cleanupSeeded` glue in `tests/e2e/archive-service-sessions-on-end.spec.ts`).
- Geometry: the `measure()` / `expectReachable()` helpers and the scroll-to-end probe in `tests/e2e/overlay-layout.spec.ts` (E5 block).

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | scroll own overflow — 13-inch desktop | BVA (content > panel) | L3 | automated | 12 seeded definitions; viewport 1440x900 | open `/folder/<enc FIXTURE_GIT>/automations`; set the `automation-board` scrollTop to its scrollHeight | `automation-board` computed `overflow-y` = `auto`; its clientHeight ≤ the `plugin-overlay` panel height; the last `sbs-*` card's bounding box lies inside the panel box (±4px); panel `clipped` ≤ EPS |
| E2 | scroll own overflow — mobile | BVA (content > panel) | L3 | automated | 12 seeded definitions; viewport 375x667 | open the same URL; scroll `automation-board` to its end | `automation-board` is a vertical scroller whose clientHeight ≤ the viewport height; the last `sbs-*` card's bounding box lies inside the viewport |
| E3 | scroll own overflow — short list | BVA (content < panel) | L3 | automated | no `sbs-*` definitions seeded (fixture state before the E1 seeding); viewport 1440x900 | open the board | `automation-board` scrollHeight ≤ clientHeight + 4 (no scrollbar) and the panel `clipped` ≤ EPS |
| E4 | single vertical scroller | invariant count | L3 | automated | the E1 state (12 definitions, 1440x900) | count descendants of the `plugin-overlay` panel whose `overflow-y` is auto/scroll AND scrollHeight > clientHeight + 4 | count === 1 and that element is `automation-board` |
| E5 | no horizontal scroll — board | BVA (long name) | L3 | automated | one extra definition named `sbs-` + 110 × `x` (no spaces); viewport 375x667 | open the board | `automation-board` scrollWidth ≤ clientWidth + 1; the long-name card's text is truncated or wrapped within the card |
| E6 | run monitor scrolls own overflow | BVA (content > panel) | L3 | automated | seeded run whose `result.md` is 200 lines `- sbs finding <n>`; viewport 1440x900 | open `/folder/<enc FIXTURE_GIT>/automations/run/<sid>`; scroll `automation-run-monitor` to its end | `automation-run-monitor` computed `overflow-y` = `auto`, bounded by the panel; the element containing `sbs finding 200` lies inside the panel box |
| E7 | no horizontal scroll — run monitor wide markdown | BVA (wide content) | L3 | automated | seeded run whose `result.md` has a 30-column markdown table and a 400-char code line; viewport 1440x900 | open the run monitor | `automation-run-monitor` scrollWidth ≤ clientWidth + 1; the findings wrapper inside `run-result` has scrollWidth > clientWidth, and after setting its scrollLeft to the max, the table's last header cell is inside the wrapper box |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | Back stays visible — board | state-transition (top → scrolled) | L3 | automated | the E1 state | scroll `automation-board` to its end | `automation-board-back` bounding box is inside the panel box; `document.elementFromPoint(back centre)` is the Back button (not occluded); clicking it leaves `/automations` |
| F2 | Back stays visible — run monitor | state-transition (top → scrolled) | L3 | automated | the E6 state | scroll `automation-run-monitor` to its end | `automation-run-monitor-back` bounding box is inside the panel box and is the hit-test target at its centre |
| F3 | create/edit dialog reachable (issue #1158 scope) | BVA (viewport) | L3 | automated | open the Create Automation dialog from the board, at 375x667 and at 1440x900 | scroll the dialog panel (the `create-automation-dialog` child with `overflow:auto`) to its end | the dialog's Save button's bounding box lies inside the viewport at both sizes; if it does not, task 1.4's portal fix is required |
| F4 | sticky header appearance | visual/subjective | — | manual-only | board in the desktop dialog and on mobile, scrolled mid-list | a human looks at the header band | [judgment: the `--bg-primary` toolbar strip over the `--bg-secondary` flush panel reads as intentional (KB parity), with no content showing through above the header] |

### Unit guards (class contracts — jsdom cannot measure layout)

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| U1 | scroll own overflow + sticky Back — board | decision table (valid / invalid scope branch) | L1 | automated | render `AutomationBoard` with a valid route, and with an invalid-scope route | inspect the `automation-board` className, and the parent of `automation-board-back` | both roots contain `flex-1`, `min-h-0`, `overflow-y-auto`; in the valid branch the header containing Back contains `sticky` and `top-0` |
| U2 | sticky Back — run monitor | contract | L1 | automated | render `AutomationRunMonitor` with an ended run and `onBack` spy | inspect classes; click `automation-run-monitor-back` | root contains `flex-1`, `min-h-0`, `overflow-y-auto`; Back's header contains `sticky`; clicking calls `onBack` once |

### Performance / Error-handling

None. The change is CSS layout only, with no new I/O path, so there are no latency or fault dimensions.

---

## Coverage summary

- Requirements covered: 3/3 (scroll own overflow: E1 E2 E3 E4 E6 U1 U2; Back visible: F1 F2 U1 U2; no horizontal scroll: E5 E7) + issue scope (F3) + subjective (F4)
- Scenarios by class: edge 7 · perf 0 · frontend 4 · error 0 · unit 2
- Scenarios by level: L1 2 · L2 0 · L3 11
- Scenarios by disposition: automated 12 · manual-only 1

## New infra needed

- None. Board seeding uses the existing create/delete REST endpoints. Run seeding reuses the run-store glue from `archive-service-sessions-on-end.spec.ts`. Geometry reuses the `overlay-layout.spec.ts` probes.
