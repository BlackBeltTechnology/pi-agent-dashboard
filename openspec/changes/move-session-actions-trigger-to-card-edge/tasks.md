## 1. L1 tests first (red)

Folded from `test-plan.md` (automated, L1). Write each test, see it fail for the expected reason, then implement in section 2.

- [x] 1.1 E1 trigger out of header. Exemplar: `packages/client/src/components/__tests__/SessionCard.actions-menu.test.tsx`. Triple: desktop card for alive `s1` · render · `session-actions-trigger-s1` is not in the header row; its wrapper is a direct child of `[data-session-card]` right after the content flex row and carries `absolute` + `card-edge-trigger`; the header has Archive and ✕ (test-plan #E1).
- [x] 1.2 E2 ended-card header. Exemplar: `packages/client/src/components/__tests__/SessionCard.test.tsx` "No action chips" case, plus `SessionCard.card-sections.test.tsx`. Triple: ended session with `sessionFile` in git · render · header has Archive and no trigger; the trigger exists on the card; no Resume/Fork/+Session/+Worktree (test-plan #E2).
- [x] 1.3 E3 reserved gutter. Exemplar: `SessionCard.test.tsx:1131` (the existing `pr-2` pin, rewritten). Triple: desktop card · render · className has `pr-[18px]` and not `pr-2`; the comment explains the trigger gutter (test-plan #E3).
- [x] 1.4 E4 pill markup. Exemplar: `packages/client/src/components/session/__tests__/SessionActionsMenu.test.tsx`. Triple: `SessionActionsMenu` for `s1` · render · inline SVG with 3 circles, `fill="currentColor"`, `aria-hidden="true"`; no `mdiDotsVertical` path; button has `focus-ring`, `inline-flex`, `before:content-['']`, `before:w-[24px]` and lacks `min-h-[44px]` / `sm:min-h-[32px]`; wrapper lacks `relative` (test-plan #E4).
- [x] 1.5 E5 selected-ring escape rule. Exemplar: `packages/client/src/__tests__/selected-card-fx-css.test.ts`. Triple: `index.css` source · parse · `.card-edge-trigger` declares `position: absolute; z-index: 20` at an offset after `.card-selected-ring > *` (test-plan #E5).
- [x] 1.6 E6 contrast across palettes. Exemplar: `packages/client/src/lib/__tests__/theme-body-text-contrast.test.ts`. Triple: `--text-tertiary` and `--text-secondary` vs `--bg-primary` for base dark/light plus every `themes.ts` palette × mode · compute WCAG ratio · every pair ≥ 3.00, with a failing synthetic fixture (`#8a8a8a`/`#e1e2e7`) proving the assertion bites (test-plan #E6).
- [x] 1.7 E17 mobile has no trigger. Exemplar: the mobile-layout cases in `SessionCard.actions-menu.test.tsx`. Triple: mobile render · render · no `session-actions-trigger-*` in the DOM (test-plan #E17).
- [x] 1.8 E18 dimmed card. Exemplar: `SessionCard.test.tsx` hidden / closing cases. Triple: card with `isHidden`, and separately `session.closing` · render · root has `opacity-40` / `opacity-50`; the trigger is rendered and clicking it calls `onOpenChange(true, …)` (test-plan #E18).
- [x] 1.9 F1 click pins a hover-opened menu. Exemplar: `SessionActionsMenu.test.tsx`. Triple: rendered `open` with source `"hover"` · click the trigger · `onOpenChange(true, { source: "trigger", opener: <button> })`, never `false` (test-plan #F1).
- [x] 1.10 F3 toggle unchanged for click-open. Exemplar: `SessionActionsMenu.test.tsx`. Triple: `open` with source `"trigger"` · click the trigger · `onOpenChange(false)` once (test-plan #F3).
- [x] 1.11 F4 resting on the pill or its hit area never arms. Exemplar: `packages/client/src/components/session/__tests__/session-hover-intent.test.ts`. Triple: pointermove targets = the trigger button inside the strip · samples < 0.4 px/ms for 500 ms · no `open` callback (test-plan #F4).
- [x] 1.12 F7 `aria-expanded:` variant present. Exemplar: `SessionActionsMenu.test.tsx`. Triple: trigger with `aria-expanded="true"` · read className · it contains the `aria-expanded:` emphasis classes (computed check in 3.6) (test-plan #F7).
- [x] 1.13 F10 Escape refocuses the moved trigger. Exemplar: the existing Escape case in `SessionCard.actions-menu.test.tsx`. Triple: menu opened by a trigger click · Escape · menu closed; `document.activeElement` is `session-actions-trigger-s1` (test-plan #F10).
- [x] 1.14 X2 unmount under a pinned menu. Exemplar: the "Card unmounts under an open menu" case in `packages/client/src/components/session/__tests__/SessionList.actions-menu.test.tsx`. Triple: menu pinned via the F1 path on `s1` · remove `s1` from the list · no `session-actions-menu-s1` remains; focus goes to the session region (test-plan #X2).

## 2. Implementation

- [x] 2.1 `packages/client/src/index.css`: add `.card-edge-trigger { position:absolute; z-index:20; }` next to `.card-drag-bead`, after `.card-selected-ring > *` (design D2). Verify: 1.5 passes.
- [x] 2.2 `packages/client/src/components/session/SessionActionsMenu.tsx`: restyle the trigger. Keep the testid, ARIA, `onKeyDown`, and the `onPointerEnter`/`onFocus` prefetch.
  - Wrapper `<span>`: drop `relative inline-flex`; use `absolute card-edge-trigger right-[-6px] top-1/2 -translate-y-1/2`.
  - Button: drop the `min-h`/`min-w` classes; keep `focus-ring inline-flex items-center justify-center flex-shrink-0`. Make it a `relative` 13×26 rounded pill with `--bg-primary` background and `--border-subtle` border, holding an inline 3×13 three-dot SVG (`fill="currentColor"`, `aria-hidden="true"`, `focusable="false"`).
  - Hit box: `before:content-[''] before:absolute before:top-0 before:bottom-0 before:right-0 before:w-[24px]`.
  - At rest: `text-[var(--text-tertiary)]`, no opacity.
  - Full emphasis (`text-[var(--text-secondary)]`, border `--border-primary`) under `group-hover/card:`, `focus-visible:` and `aria-expanded:`; `--bg-hover` on hover of the pill itself (design D3).

  Verify: 1.4 and 1.12 pass.
- [x] 2.3 `packages/client/src/components/session/SessionCard.tsx` (desktop branch only):
  - Remove `<SessionActionsMenu>` from the header row and mount it as a direct child of the card root `<li>`, immediately after the content flex row (`</div>{/* end flex row */}`), with the same props.
  - Change the card root's `pr-2` to `pr-[18px]`.
  - Leave the mobile branch untouched.

  Verify: 1.1, 1.2, 1.3, 1.7 and 1.8 pass, and the existing Shift+F10, right-click and hover-open tests in `SessionList.actions-menu.test.tsx` still pass.
- [x] 2.4 Click-pins-hover-open (design D4b). Pass the current menu open source from `SessionCard` into `SessionActionsMenu`. In `onClick`: if `open && source === "hover"`, call `onOpenChange(true, { source: "trigger", opener: triggerRef.current })`; otherwise keep the toggle. Verify: 1.9, 1.10 and 1.14 pass.
- [x] 2.5 Confirm the programmatic refocus paths (`SessionCard.tsx:1054,1095`, `querySelector("[data-testid^='session-actions-trigger-']")`) land on the moved trigger. Verify: 1.13 passes, and the existing keyboard-open tests pass.

## 3. L3 tests (Playwright vs the docker harness)

Folded from `test-plan.md` (automated, L3). Extend `tests/e2e/session-actions-menu.spec.ts` (exemplar: the same spec, plus `tests/e2e/flow-card-grid-geometry.spec.ts` for rect math). Read the harness port from `.pi-test-harness.json` and never hardcode it. Run with the `run-dashboard-e2e-local-changes` skill.

- [ ] 3.1 E7 vertical centring. Triple: minimal card (about 87 px) and tall card (OPENSPEC + PROCESS + FLOWS, ≥ 250 px) · read rects · \|trigger centre y − card centre y\| ≤ 1 px and the trigger x-span contains R on both (test-plan #E7).
- [ ] 3.2 E8 folder-border clearance. Triple: card in a grouped folder · zoom 90 / 100 / 125% · pill right ≤ folder-border left − 1 px at every zoom (test-plan #E8).
- [ ] 3.3 E9 ungrouped container. Triple: card in an ungrouped list · Tab-focus the trigger · pill and outline inside the scroller's right clearance; `scrollWidth === clientWidth` (test-plan #E9).
- [ ] 3.4 E10 focus ring not clipped. Triple: grouped card, trigger focused · read the outline vs the nearest clipping ancestor · outline right (≈R+10) < clip edge (≈R+14) (test-plan #E10).
- [ ] 3.5 E11 hit area real. Triple: minimal card · `getComputedStyle(trigger,'::before').content` and `elementFromPoint(R−10, centreY)` · content ≠ `none`; the point resolves to the trigger (test-plan #E11).
- [ ] 3.6 F6 + F7 emphasis states. Triple: card `s1` at rest / hovered / Tab-focused / menu open · read the computed `color` of the button · rest = `--text-tertiary`, other states = `--text-secondary`, opacity 1 at rest (test-plan #F6). The open-state check also proves, in the browser, that the `aria-expanded:` variant is generated (the computed half of the F7 row).
- [ ] 3.7 E12 no-overlap matrix. Triple: shapes (a) minimal, (b) change + lifecycle + dirty + PR, (c) PROCESS, (d) running flow + MEMORY + STATUS badge + worktree slot, (e) inline rename; zoom 100 / 125% · intersect the hit rect [R−18,R+6]×26 with every other `button, a, [role=button]` · hit rect ≥ 24×26 and zero intersections (test-plan #E12).
- [ ] 3.8 E13 minimum sidebar. Triple: shapes (a) and (b) with the sidebar at 180 px (`ResizableSidebar` `MIN_WIDTH`) · measure all descendant border boxes, overflow included · nothing but the trigger intersects [R−18, R] (test-plan #E13).
- [ ] 3.9 E14 click anywhere in the hit area. Triple: minimal card, menu closed · click (R−3, cy), Escape, then click (R−15, cy) · both open `session-actions-menu-s1`; `s1` is not selected (test-plan #E14).
- [ ] 3.10 E15 selected height invariant. Triple: `s1` unselected → selected · measure the height · equal ±0.5 px; the wrapper is `position: absolute` (test-plan #E15).
- [ ] 3.11 E16 Tab order. Triple: card with Archive, ✕ and a lifecycle bar · Tab through · the trigger is focused after ✕ and after the subcard controls; Enter opens the menu with focus on its first enabled item (test-plan #E16).
- [ ] 3.12 F2 pinned menu survives leave. Triple: `s1`, pointer rests in the strip below the pill until the hover open · click the pill, move to the chat for 600 ms, click again · open plus `aria-expanded="true"` after the first click and after 600 ms; closed plus `"false"` after the second click (test-plan #F2).
- [ ] 3.13 F5 strip off the pill still dwell-opens. Triple: pointer at (R−20, top+12) · rest 400 ms < 0.4 px/ms · the menu opens and focus is unchanged (test-plan #F5).
- [ ] 3.14 F8 touch. Triple: Playwright context `hasTouch: true`, desktop width ≥ 1024 · tap `session-actions-trigger-s1` · the trigger is visible at rest and the menu opens; no menu opens without the tap (test-plan #F8).
- [ ] 3.15 F9 right-click on the pill. Triple: `s1` · right-click the pill · the native menu is suppressed; the session menu opens at the pointer, clamped; `aria-expanded="true"` (test-plan #F9).
- [ ] 3.16 P1 open latency. Triple: 50 cards · click the edge trigger 20× (close in between) · p95 click→panel visible ≤ 100 ms (test-plan #P1; extends the existing latency case).
- [ ] 3.17 X1 slow panel chunk. Triple: route the `SessionActionsPanel` chunk with a 1500 ms delay · click the trigger, and in a second run click again before it resolves · `aria-expanded="true"` at once and the panel appears after the chunk loads; no error-boundary fallback; the early second click closes with no orphan portal (test-plan #X1).
- [ ] 3.18 `tests/e2e/flow-attach-before-run.spec.ts` still opens the menu through `session-actions-trigger-<id>`. Verify: the spec passes unchanged.

## 4. Manual

- [ ] 4.1 Visual balance of the left drag bead and right pill in dark and light, on two palettes, at rest / hover / open, using the change's mockup (`mockups/session-card-edge-trigger/`) as the reference (test-plan #F11, manual-only).

## 5. Docs and closeout

- [x] 5.1 Update the `SessionActionsMenu.tsx` and `SessionCard.tsx` rows in `packages/client/src/components/session/AGENTS.md` and `SessionCard.tsx.AGENTS.md`: edge trigger, `card-edge-trigger`, reserved `pr-[18px]` gutter, click-pins-hover-open, header no longer hosts the trigger, `See change: move-session-actions-trigger-to-card-edge`. Verify: `kb dox lint` is clean for these paths.
- [x] 5.2 Delegate the "entry points" section of `docs/session-actions-menu.md` to DocScribe in caveman style: header trigger → centred edge pill, always visible, 24 px hit box in the reserved gutter, click pins a hover-opened menu. Verify: the doc no longer says the trigger is in the header.
- [ ] 5.3 Full client test run: `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log`, then grep for the summary line. Verify: no new failures.
