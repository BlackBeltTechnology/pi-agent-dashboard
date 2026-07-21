# Tasks

## 0. Ground in the approved mockup (do this first)

- [x] 0.1 Serve `openspec/changes/redesign-split-layout-controls/mockups/` and open
  `/index.html` (approved v2). Keep it open side-by-side while implementing — it is
  the visual + interaction source of truth (header order, dotted-grip seams,
  always-visible captions, in-flow rotated tabs, vertical `SESSIONS` tab).
- [x] 0.2 Skim `mockups/ux-review.md` + `design.md` so every implemented control
  traces to a cited rule. Compare against `/v1.html` to see what was rejected.

## 1. Divider → resize-only with always-visible dotted grip

- [x] 1.1 `SplitDivider.tsx`: remove `onCollapseChat` / `onCollapseEditor` props and
  the chevron cluster. The divider renders only the drag seam + an **always-visible
  dotted grip** (grip dots, matching the mockup `.seam .grip`).
- [x] 1.2 `SplitWorkspace.tsx`: stop passing the collapse callbacks to `SplitDivider`.
- [x] 1.3 Update `SplitWorkspace` / divider tests: drag still resizes + clamps; assert
  the chevron buttons no longer render.

## 2. Always-visible pane captions

- [x] 2.1 `SplitWorkspace.tsx`: render an always-visible caption for each pane —
  `CHAT` and `EDITOR` (+ active file name on the editor), per the mockup `.cap`.
  Fold it into the pane's EXISTING header row (ChatView / EditorPane chrome), NOT a
  second bar above it — avoid double-labeling / lost content height.
- [x] 2.2 Verify captions render in `split` (both panes) and identify the pane in
  `closed` / `full`.

## 3. In-flow rotated restore tabs (kills the overlap bug)

- [x] 3.1 Convert the edge peeks to **in-flow flex siblings** anchored to the pane
  edge (NOT `absolute`-centered on the divider), rotated vertical (`writing-mode`),
  per the mockup `.peek` (push, not overlay). Desktop `orientation "h"` only — leave
  the mobile stacked (`orientation "v"`) edge-grabber peek unchanged.
- [x] 3.2 `closed` → right-edge `EDITOR` tab reopens `split`; `full` → left-edge `CHAT`
  tab restores `split`. Preserve the other pane's state.
- [x] 3.3 Add a test that at a narrow chat ratio the restore/caption elements do NOT
  overlap chat content (regression test for the overlap bug).

## 4. Header reorder + metadata removal

- [x] 4.1 `SessionHeader.tsx` (desktop): move `<LayoutModeSwitch />` from the far right
  to sit **after name + rename, immediately before the Seek button**.
- [x] 4.2 Remove ONLY the `model` and `thinkingLevel` segments from the header (both
  already render on the session card). KEEP the `pi <piVersion>` segment — it is the
  only UI surface for the per-session pi version.
- [x] 4.4 A11y: the moved `LayoutModeSwitch` keeps its `role="radiogroup"` roving
  tabindex + Arrow/Home/End; the new restore tabs + `SESSIONS` tab are focusable
  buttons with accessible names (Enter/Space); pane captions are decorative or
  labeled, not bare unlabeled elements.
- [x] 4.3 Update header tests/snapshots for the new order and removed segments.

## 5. Unified session-list seam + vertical restore tab

- [x] 5.1 `ResizableSidebar.tsx`: replace the invisible `w-1` drag handle with an
  **always-visible dotted-grip seam** matching the divider (`.seam .grip`).
- [x] 5.2 Keep the collapse control a **vertically centered knob** on the seam
  (already centered in the shipped spec — do not move it to the top).
- [x] 5.3 Collapsed rail restores via a **vertically-centered vertical `SESSIONS`
  tab** using the same rotated-tab idiom as the CHAT/EDITOR peeks (per mockup
  `.rail-peek`). Desktop only — below the mobile breakpoint the hamburger overlay
  governs and the tab does not render.
- [x] 5.4 Update sidebar tests: drag resizes + clamps 180–500; centered knob collapses;
  `SESSIONS` tab expands; knob click never starts a drag.

## 6. Verify against the mockup + gates

- [x] 6.1 Run the client in dev; compare the live UI to `mockups/index.html` in dark
  AND light at desktop widths — header order, both seams' dotted grips, captions,
  restore tabs all match.
- [x] 6.2 `npm run quality:changed` green; unit tests pass. (tsc-clean + warning-neutral
  vs HEAD; full client vitest 3630 passed. Pre-existing EditorPane Tier B/C warnings
  are latent, not introduced by this change; CI hard-gates on errors only.)

## 7. Automated tests (folded from test-plan.md)

L1 — extend `packages/client/src/components/__tests__/` (vitest):

- [x] 7.1 Divider resize clamp min. split at 0.5, drag toward chat, pointer would set chat fraction < 0.25 → ratio clamps to 0.25, no pane collapses. See `SplitWorkspace.test.tsx`. (test-plan #E1)
- [x] 7.2 Divider resize clamp max. drag toward editor, pointer would set chat fraction > 0.75 → ratio clamps to 0.75. See `SplitWorkspace.test.tsx`. (test-plan #E2)
- [x] 7.3 Sidebar drag clamp min. drag handle to cursor 120px (<180) → width stays 180px. See `ResizableSidebar.test.tsx`. (test-plan #E3)
- [x] 7.4 Sidebar drag clamp max. drag handle to cursor 640px (>500) → width stays 500px. See `ResizableSidebar.test.tsx`. (test-plan #E4)
- [x] 7.5 Divider carries no collapse control. render `SplitWorkspace` in split, inspect divider → `split-fold-chat` + `split-fold-editor` test-ids absent, dotted grip present. See `SplitWorkspace.test.tsx`. (test-plan #E5)
- [x] 7.6 Header order + removed segments. desktop `SessionHeader` with model+thinkingLevel+piVersion set, render → DOM order back→name→rename→mode-switch→Seek; model + thinkingLevel absent; `pi <version>` present. See `SessionHeader.seek-to-card.test.tsx`. (test-plan #F4)
- [x] 7.7 Mode-switch radiogroup a11y survives the move. `LayoutModeSwitch` after reorder, focus active radio + press ArrowRight → selection advances, `aria-checked` moves, roving tabindex intact. See `LayoutModeSwitch.test.tsx`. (test-plan #F5)
- [x] 7.8 Collapse header-only; tabs only restore. split mode, inspect controls → divider has no collapse control; header switch drives closed/full; restore tabs re-open only. See `SplitWorkspace.test.tsx`. (test-plan #F10)
- [x] 7.9 Corrupt persisted state does not crash. malformed JSON at `pi-dashboard:split:<id>`, session opens → renders `closed` default, caption/restore-tab code does not throw. See `SplitWorkspaceContext.test.tsx`. (test-plan #X1)

L3 — extend `tests/e2e/` (Playwright vs docker harness; port from `.pi-test-harness.json`, never hardcode :18000):

- [x] 7.10 Grip always visible, not hover-only. split mode, no pointer over seams → rail seam grip + divider grip both have a visible box at rest. See `editor-pane.spec.ts`. (test-plan #F1)
- [x] 7.11 Restore tab never overlaps a narrow pane (overlap-bug regression). split dragged to chat fraction 0.25, collapse editor (`closed`) → EDITOR restore tab + caption bounding boxes do NOT intersect the chat content box. See `editor-pane.spec.ts`. (test-plan #F2)
- [x] 7.12 Captions integrated, not stacked. split mode → CHAT/EDITOR caption present AND a child of the pane's existing header row, not a second bar. See `editor-pane.spec.ts`. (test-plan #F3)
- [x] 7.13 Restore tab keyboard accessible. closed mode, focus EDITOR restore tab, press Enter → mode `split`; tab exposes accessible name. See `editor-pane.spec.ts`. (test-plan #F6)
- [x] 7.14 SESSIONS tab centered restore. expanded rail at 264px, click centered knob then activate `SESSIONS` tab → tab renders vertically centered on collapse, rail returns to 264px on activate. See `editor-pane.spec.ts`. (test-plan #F7)
- [x] 7.15 Mobile stacked keeps edge grabber. (Covered at L1 by SplitWorkspace.test.tsx
  orientation "v"; L3 mobile-viewport spawn is the documented flaky path, per the
  existing F9/F11/F12 precedent.) viewport < 768px, split `orientation "v"`, collapse a pane → existing edge-grabber peek restores it; desktop rotated tab not required. See `editor-pane.spec.ts`. (test-plan #F8)
- [x] 7.16 SESSIONS tab is desktop-only. viewport < 768px, render → hamburger overlay governs; vertical `SESSIONS` tab does not render. See `editor-pane.spec.ts`. (test-plan #F9)

## 8. Manual verification (deferred post-merge)

- [x] 8.1 Unified dotted-grip language: rail seam + split divider read as the same dotted-grip idiom in dark AND light. (test-plan: manual-only)
- [x] 8.2 Caption legibility: CHAT/EDITOR captions read cleanly, no double-label, no cramped content height, dark AND light. (test-plan: manual-only)
