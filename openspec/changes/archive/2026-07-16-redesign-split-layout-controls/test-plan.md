# Test Plan — redesign-split-layout-controls

Stage: design   Generated: 2026-07-16

No clarifications outstanding — the spec deltas carry concrete clamp values
(`[0.25,0.75]` ratio, `180–500px` width), a concrete mobile breakpoint (Tailwind
`md` = 768px, `hidden md:flex` in `App.tsx`), and measurable observables, so every
Triple resolves.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | Divider resize clamp (split-editor) | BVA | L1 | automated | split at 0.5, drag divider toward chat | pointer would set chat fraction < 0.25 | ratio clamps to 0.25; editor retains its min width; no pane collapses |
| E2 | Divider resize clamp (split-editor) | BVA | L1 | automated | split at 0.5, drag divider toward editor | pointer would set chat fraction > 0.75 | ratio clamps to 0.75 |
| E3 | Sidebar drag clamp (resizable-sidebar) | BVA | L1 | automated | sidebar at 264px, drag handle left | cursor at 120px (<180) | width stays at 180px |
| E4 | Sidebar drag clamp (resizable-sidebar) | BVA | L1 | automated | sidebar at 264px, drag handle right | cursor at 640px (>500) | width stays at 500px |
| E5 | Divider carries no collapse control (split-editor) | decision/state | L1 | automated | render `SplitWorkspace` in `split` | inspect divider subtree | `split-fold-chat` + `split-fold-editor` test-ids absent; dotted grip element present |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | Grip always visible, not hover-only (both deltas) | rendered | L3 | automated | `split` mode, no pointer over the seams | page at rest (no hover) | rail seam grip + divider grip both have non-zero opacity/visible box |
| F2 | Restore tab never overlaps a narrow pane (split-editor) | geometry | L3 | automated | `split` dragged to chat fraction 0.25, then collapse editor (`closed`) | mode `closed` renders EDITOR restore tab | restore tab + pane caption bounding boxes do NOT intersect the chat content box (overlap-bug regression) |
| F3 | Captions integrated, not stacked (split-editor) | structural | L3 | automated | `split` mode | render both panes | `CHAT`/`EDITOR` caption present AND is a child of the pane's existing header row, not a second bar above it |
| F4 | Header order + removed segments (proposal §4) | decision | L1 | automated | desktop `SessionHeader` with model+thinkingLevel+piVersion set | render | DOM order back→name→rename→mode-switch→Seek; `model` + `thinkingLevel` segments absent; `pi <version>` present |
| F5 | Mode-switch radiogroup a11y survives the move | state-transition | L1 | automated | `LayoutModeSwitch` rendered after reorder | focus active radio, press ArrowRight | `role=radiogroup`; selection advances; `aria-checked` moves to the new mode; roving `tabindex` intact |
| F6 | Restore tab is keyboard accessible (split-editor) | a11y | L3 | automated | `closed` mode, EDITOR restore tab focused | press Enter | mode becomes `split`; tab exposes an accessible name |
| F7 | SESSIONS tab centered restore (resizable-sidebar) | state-transition | L3 | automated | expanded rail at saved width 264px | click centered collapse knob, then activate `SESSIONS` tab | on collapse the `SESSIONS` tab renders vertically centered; on activate the rail returns to 264px |
| F8 | Mobile stacked keeps edge grabber (split-editor) | state-transition | L3 | automated | viewport < 768px, split `orientation "v"` | collapse a pane | existing edge-grabber peek restores the pane; desktop rotated tab NOT required |
| F9 | SESSIONS tab is desktop-only (resizable-sidebar) | decision | L3 | automated | viewport < 768px | render | hamburger overlay governs sidebar; vertical `SESSIONS` tab does not render |
| F10 | Collapse is header-only; tabs only restore (split-editor) | state | L1 | automated | `split` mode | inspect controls | divider has no collapse control; header switch drives `closed`/`full`; restore tabs re-open only (never collapse) |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | Corrupt persisted state does not crash (unchanged invariant) | fault-injection | L1 | automated | malformed JSON at `pi-dashboard:split:<id>` | session opens, new caption/tab code renders | workspace renders `closed` (default); no throw from the caption/restore-tab reimplementation |

### Visual / subjective (manual-only)

| id | requirement | technique | level | disposition | surface | human looks | expected observable |
|----|-------------|-----------|-------|-------------|---------|-------------|---------------------|
| M1 | Unified dotted-grip language | visual | — | manual-only | rail seam + split divider, dark + light | side-by-side | the two seams read as the same dotted-grip idiom [judgment — no automatable observable] |
| M2 | Caption legibility | visual | — | manual-only | CHAT/EDITOR captions, dark + light | scan each pane | caption reads cleanly, no double-label, no cramped content height [judgment] |

---

## Coverage summary

- Requirements covered: split-editor divider + captions/tabs + header reorder; resizable-sidebar seam + collapse/restore.
- Scenarios by class: edge 5 · perf 0 · frontend 10 · error 1 · visual 2
- Scenarios by level: L1 7 · L3 9 · manual-only 2
- Scenarios by disposition: automated 16 · manual-only 2

## New infra needed

- none — L1 extends existing `packages/client/src/components/__tests__/*.test.tsx`;
  L3 extends `tests/e2e/*.spec.ts` against the docker harness (port from
  `.pi-test-harness.json`, never hardcoded).
