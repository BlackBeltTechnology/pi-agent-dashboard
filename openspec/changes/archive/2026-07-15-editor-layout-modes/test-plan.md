# Test Plan — editor-layout-modes

Stage: design   Generated: 2026-07-15

All Triples resolved (2 spec gaps closed by the design-stage gate: `full` persists
as-is across reload; mobile supports `full` with a chat edge grabber).

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | Persistence migration | BVA/decision-table | L1 | automated | `{open:true,ratio:0.6,orientation:"h"}` | `loadSplitState` | returns `{mode:"split",ratio:0.6,…}` |
| E2 | Persistence migration | decision-table | L1 | automated | `{open:false,…}` | `loadSplitState` | returns `mode:"closed"` |
| E3 | Both-fields precedence | decision-table | L1 | automated | `{open:false,mode:"split",…}` | `loadSplitState` | `mode:"split"` (mode wins; `open` ignored) |
| E4 | Strip-on-write | state | L1 | automated | any loaded legacy blob | first `saveSplitState` | serialized JSON has `mode`, NO `open` key |
| E5 | Ratio clamp on migrate | BVA | L1 | automated | `{open:true,ratio:1.2,…}` | `loadSplitState` | `ratio===0.75` (clamped, not rejected) |
| E6 | Corrupt state | EP | L1 | automated | malformed JSON at `pi-dashboard:split:<id>` | session opens | `mode:"closed"` default, error logged, no crash |
| E7 | Divider clamp | BVA | L3 | automated | `split` at 50/50 | drag divider past min | ratio stops at `0.25`/`0.75`, neither pane collapses |
| E8 | Direct closed↔full | state-transition | L1 | automated | `mode:"full"` | select `Chat` segment | `mode:"closed"`; value never held `split` between |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | Tri-state render | state-transition | L3 | automated | `closed` session | select `Split` | chat + divider + editor all mounted; conversation interactive |
| F2 | Full via switch | state-transition | L3 | automated | `split` session | select `Editor` | editor full-width; chat collapsed to leading-edge peek |
| F3 | Draft/scroll preserved | state-convergence | L3 | automated | `split`, composer draft "wip", chat scrolled up | `split→full→split` | `ChatView` not remounted; draft="wip" + scroll unchanged |
| F4 | Left chevron | state-transition | L3 | automated | `split` | click `‹` chevron | `mode:"full"` (chat folded) |
| F5 | Right chevron | state-transition | L3 | automated | `split` | click `›` chevron | `mode:"closed"` (editor folded) |
| F6 | Chevron ≠ drag | state | L3 | automated | `split` at 50/50 | press+release `›` without movement | `mode:"closed"`; persisted ratio unchanged |
| F7 | Editor peek reopens | state-transition | L3 | automated | `closed` | activate right-edge Editor peek | `mode:"split"`, pane restores prior tabs |
| F8 | Chat peek restores | state-transition | L3 | automated | `full` | activate leading-edge Chat peek | `mode:"split"`, conversation visible |
| F9 | Opener from full → split | state-transition | L3 | automated | `full` | click header Changed-Files chip | `mode:"split"` (never `full`); chat visible |
| F10 | Switch present when closed | state | L3 | automated | `closed` session | header renders | `Chat│Split│Editor` visible, `Chat` active |
| F11 | Switch present on mobile | state | L3 | automated | viewport < mobile breakpoint | mobile header renders | layout switch present + reflects current mode |
| F12 | Mobile full | state-transition | L3 | automated | mobile viewport | select `Editor` | editor fills stacked area; chat = edge grabber restoring `split` |
| F13 | Full persists across reload | state-transition | L3 | automated | session left in `full` | reload + reopen | renders `full` (editor-only, chat peek); pane tabs restored |
| F14 | Per-session mode | state-transition | L3 | automated | A=`split` 50/50, B=`closed` | switch A→B→A | B `closed`; A restores `split` 50/50 |

### A11y

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| A1 | Switch a11y | state-transition | L1 | automated | `LayoutModeSwitch` rendered | Arrow/Home/End + Enter/Space | `role="radiogroup"`+`radio`; focus roves; selection sets mode; `aria-checked` reflects active mode |

### Manual-only

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| M1 | Header label form | visual/subjective | — | manual-only | live desktop header | human looks at cramped header | [judgment: icon-only vs glyph+word "reads clean" — no automatable observable] |
| M2 | Mobile grabber placement | visual/subjective | — | manual-only | 360px phone, `full` | human activates chat grabber | [judgment: grabber discoverable + thumb-reachable — no automatable observable] |

---

## Coverage summary

- Requirements covered: 5/5 capability requirements (content-area modes, layout
  switch, divider+chevrons, persistence+migration, peek handles).
- Scenarios by class: edge 8 · frontend-quirk 14 · a11y 1 · manual-only 2.
- Scenarios by level: L1 9 · L3 14 · manual-only 2. (No L2 — no process/install
  surface; no perf — the spec states no latency/throughput budget.)
- Scenarios by disposition: automated 23 · manual-only 2.

## New infra needed

- none. L1 → existing `packages/client/src/**/__tests__/*.test.ts` (vitest);
  L3 → existing `tests/e2e/*.spec.ts` (docker harness). Both tiers already host
  split-workspace tests to extend.
