# Test Plan — fix-popover-container-clip

Stage: design   Generated: 2026-07-20

All scenarios target the `popover-viewport-positioning` MODIFIED requirement
(boundary-aware measurement, `preferredAnchor`, `minContentWidth`, boundary
staleness listeners, self-boundary guard) and the consumer conversions.

Constants fixed at the design gate: `estimatedWidth` ChatViewMenu 256 /
ModelSelector 320 / ThinkingLevelSelector 128; ModelSelector `minContentWidth`
280; hook floors `MIN_POPOVER_WIDTH` 160 / `MIN_POPOVER_HEIGHT` 120.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | boundary horizontal measurement | BVA | L1 | automated | boundary rect {left:360,right:660}, right-preferred trigger rect.right=461, estimatedWidth 256, gap 8 | open | spaceRightAnchor=93 (<256), spaceLeftAnchor=253 → `anchorRight=false` (flips left), `maxWidth` computed from boundary (≤ boundary width), not viewport |
| E2 | boundary honored over viewport (the core bug) | decision-table | L1 | automated | boundary {left:360,right:780}, right-preferred trigger rect.right=461, estimatedWidth 256, innerWidth 1280 (ample viewport-left room) | open once with boundaryRef, once without | WITHOUT boundary `anchorRight=true` (viewport says fits) → would extend past pane.left; WITH boundary `anchorRight=false` → content within pane. Results DIFFER → boundary edges drove the decision |
| E3 | viewport fallback unchanged | EP | L1 | automated | no boundaryRef, representative trigger rects across viewport quadrants | open | anchor/`maxWidth`/`flipUp`/`maxHeight` byte-identical to pre-change hook on both axes |
| E4 | boundary vertical measurement (synthetic) | BVA | L1 | automated | boundary {top:100,bottom:400}, trigger rect.bottom=380/top=356, estimatedHeight 200, innerHeight 1000 | open | spaceBelow=12 vs boundary.bottom (not 612 vs innerHeight) → `flipUp=true`; without boundary `flipUp=false` |
| E5 | preferredAnchor left preserved | decision-table | L1 | automated | `preferredAnchor:"left"`, boundary wide enough (spaceLeftAnchor ≥ estimatedWidth) | open | `anchorRight=false` (stays left-0); opting into horiz axis did NOT flip it |
| E6 | preferredAnchor left flips only when forced | decision-table | L1 | automated | `preferredAnchor:"left"`, spaceLeftAnchor < estimatedWidth AND spaceRightAnchor > spaceLeftAnchor | open | `anchorRight=true` (flips right) |
| E7 | minContentWidth flips not squishes | BVA | L1 | automated | `preferredAnchor:"left"`, `minContentWidth:280`, spaceLeftAnchor=270, spaceRightAnchor=400 | open | flips to right (`anchorRight=true`); `maxWidth` NOT clamped to 270 |
| E8 | minContentWidth clamps only when neither side fits | BVA | L1 | automated | `minContentWidth:280`, spaceLeftAnchor=200, spaceRightAnchor=180 | open | no beneficial flip; clamps to larger side `maxWidth=max(160,200)=200` (down to floor) |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | re-measure on boundary scroll | state-transition | L1 | automated | open popover with boundaryRef; boundary rect changes | dispatch boundary `scroll` | `measure()` re-invoked; state reflects new boundary rect (spy/observable state change) |
| F2 | re-measure on boundary resize | state-transition | L1 | automated | open popover with boundaryRef; ResizeObserver mocked | RO callback fires (pane resized) | `measure()` re-invoked against new rect |
| F3 | no listeners while closed (extended to boundary) | state-transition | L1 | automated | `open:false`, boundaryRef supplied | resize/scroll boundary + window | no measurement; zero window AND boundary listeners attached |
| F5 | ChatViewMenu no left-clip in offset pane | state-convergence | L3 | automated | board/split layout, ChatView pane offset+narrow (viewport ≥1440) | open ⚙ View popover | popover bounding rect ⊆ pane rect: `popover.left ≥ pane.left` AND `popover.right ≤ pane.right`; all row labels rendered (no truncation by pane edge) |
| F6 | ModelSelector no right-clip, left-preserved | state-convergence | L3 | automated | offset composer pane; case (a) fits, case (b) narrower than 280 | open model dropdown | (a) stays `left-0`, `dropdown.right ≤ pane.right`; (b) flips so content stays within pane and rendered width ≥ 280 (not squished) |
| F7 | no behavior change when it fits (regression) | state-transition | L3 | automated | full-width single-column ChatView (no offset pane) | open ⚙ View, then model dropdown | ChatViewMenu flips to `left-0` at viewport-left as today; ModelSelector stays `left-0`, width 320 — anchors identical to pre-change |
| F8 | ThinkingLevelSelector no clip (in-pane) | state-convergence | L3 | automated | offset composer pane | open thinking-level popover | popover rect ⊆ pane rect |
| F9 | WorktreeActionsMenu no clip in slim rail | state-convergence | L3 | automated | narrow+offset session-card rail | open worktree actions menu | menu rect ⊆ rail-pane rect |
| F10 | PackageRow menu no clip in narrow list | state-convergence | L3 | automated | pi-resources list in a narrow pane | open a PackageRow menu | menu rect ⊆ list-pane rect |
| F11 | CommandInput attach/interrupt routed (convert-or-document) | state-convergence | L3 | automated | offset composer pane; attach (`left-0 w-56`) + interrupt (`right-0`) menus | open each menu | menu rect ⊆ composer-pane rect (after conversion if a clip reproduces; if structurally within-pane, the same assertion passes unchanged) |
| F12 | CommandInput slash/file dual-edge immunity | state-transition | L3 | automated | offset composer pane | trigger slash dropdown | dropdown pinned `left-3 right-3` within composer; rect ⊆ composer rect regardless of pane offset |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | null boundary → safe viewport fallback | fault-injection | L1 | automated | `boundaryRef` supplied but `.current === null` (pane not yet mounted) | open | measurement falls back to viewport; finite `maxWidth`/`maxHeight`, valid anchor, no throw/NaN |
| X2 | self-boundary dev guard | fault-injection | L1 | automated | `boundaryRef.current` contains the popover element (mis-wired) | open (dev build), spy `console.warn` | one dev-only `console.warn` naming the self-boundary mis-wire; no crash |

---

## Coverage summary

- Requirements covered: boundary-both-axes, viewport-fallback, preferredAnchor, minContentWidth, boundary-staleness listeners, self-boundary guard, 6 consumer conversions/immunity, no-behavior-change regression.
- Scenarios by class: edge 8 · perf 0 · frontend 11 · error 2 (total 21)
- Scenarios by level: L1 13 (E1–E8, F1–F3, X1–X2) · L3 8 (F5–F12)
- Scenarios by disposition: automated 21 · manual-only 0

## New infra needed

- none — L1 rows extend `packages/client/src/hooks/__tests__/usePopoverFlip.test.ts` (existing mocked-`getBoundingClientRect` harness); L3 rows are new `tests/e2e/*.spec.ts` specs on the existing docker harness (viewport width set per-spec to force the board/offset-pane layout). No new test level or harness.
