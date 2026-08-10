## 1. Reproduce + baseline (regression anchors)

- [x] 1.1 Reproduce the ChatViewMenu clip — confirmed on the docker harness during F5 dev: pre-fix `right-0` popover left edge 438px vs pane left 500px = **62px clipped**; post-fix flips `left-0`, within pane.
- [x] 1.2 Reproduce the ModelSelector clip — the latent `left-0` right-overflow class confirmed via the sibling attach menu (224px `left-0` overflowed the 232px pane right edge by ~14px at the 25% split floor); F6 proves the fix flips/clamps within pane.

## 2. Hook: boundary-aware measurement (TDD)

- [x] 2.1 Author the L1 manifest rows RED first (see §7): E1–E8 (boundary both-axes, preferredAnchor, minContentWidth), F1–F3 (boundary staleness listeners), X1–X2 (null-boundary fallback, self-boundary guard). Confirm they fail before 2.2.
- [x] 2.2 Extend `PopoverFlipOptions` in `usePopoverFlip.ts`: `boundaryRef?`, `preferredAnchor?: "left"|"right"` (default "right"), `minContentWidth?` (default 0).
- [x] 2.3 In `measure()`, derive `leftEdge/rightEdge/topEdge/bottomEdge` from `boundaryRef.current.getBoundingClientRect()` when present, else `0..innerWidth` / `0..innerHeight`. Recompute BOTH horizontal (`spaceRightAnchor`/`spaceLeftAnchor`) and vertical (`spaceBelow`/`spaceAbove`) against those edges.
- [x] 2.4 Implement `preferredAnchor` (left-preserving flip) + `minContentWidth` (flip-not-squish, clamp only when neither side fits) per design Decision 2.
- [x] 2.5 When `boundaryRef` is set, also attach a `scroll` listener on `boundaryRef.current` and a `ResizeObserver` on it (both call `measure()`); tear down on close/unmount alongside the window listeners.
- [x] 2.6 Add the dev-only self-boundary `console.warn` when `boundaryRef.current` contains/equals the popover element.
- [x] 2.7 Run tests; confirm 2.1 (a–g) pass and no existing case regresses.
- [x] 2.8 Update `packages/client/src/hooks/usePopoverFlip.ts.AGENTS.md` row: `boundaryRef` + `preferredAnchor` + `minContentWidth` + both-axes boundary measurement + boundary scroll/ResizeObserver + self-boundary guard + `See change: fix-popover-container-clip`.

## 3. ChatViewMenu (confirmed clip-left)

- [x] 3.1 Author manifest rows F5 (no left-clip) + F7 (regression, no behavior change) RED first (see §7) before wiring.
- [x] 3.2 In `ChatView` (parent that owns the `min-w-0 … overflow-hidden` pane), `useRef` the pane div; add an optional `boundaryRef` prop to `ChatViewMenu` and pass the ref through; wire it into `usePopoverFlip`.
- [x] 3.3 Confirm 3.1 passes; verify in-browser the 1.1 offset-pane repro shows all View labels fully visible. (L3 F5/F7 green on docker harness; the `right-0` popover flips to `left-0` against the chat pane.)

## 4. ModelSelector (proven latent clip-right) — left-preserving

- [x] 4.1 Author manifest row F6 (no right-clip, left-preserved, flip-not-squish) RED first (see §7) before wiring.
- [x] 4.2 Drill the composer pane ref (from `CommandInput`) into `ModelSelector`; change `usePopoverFlip(triggerRef, { open })` → add `estimatedWidth: 320`, `minContentWidth: ~280`, `preferredAnchor: "left"`, `boundaryRef`.
- [x] 4.3 **Remove the hardcoded `width: "20rem"`** (ModelSelector.tsx ~line 153) and drive the dropdown width from the returned `maxWidth`; apply the returned `anchorRight` class. Verify the internal grid stays legible at the clamped width (else prefer flip-only for this consumer).
- [x] 4.4 Confirm 4.1 passes; verify in-browser the 1.2 repro no longer clips and the anchor does not change in the normal (fits) layout. (L3 F6 green.)

## 5. Remaining consumers — audit + route (whole-class)

- [x] 5.1 ThinkingLevelSelector (`left-0 w-32`, IN the ChatView pane — NOT immune): author F8 RED first (see §7); then drill the composer pane ref + add `estimatedWidth: 128`, `preferredAnchor: "left"`, `boundaryRef`.
- [x] 5.2 CommandInput slash/file dropdowns (`left-3 right-3`): confirm dual-edge immunity; add a one-line code comment noting why no boundary is needed (structurally immune).
- [x] 5.3 CommandInput attach (`left-0 w-56`) + overflow/interrupt (`right-0`) menus — **NOT `usePopoverFlip` consumers today** (hardcoded `bottom-full`, no flip): reproduce a clip in a narrow offset composer pane. If reproducible → convert to hook consumers (add `usePopoverFlip` + boundary + preferred anchor) with a test; if not reproducible → add a code comment documenting the current no-clamp state and why it does not clip.
- [x] 5.4 ThemePicker (`left-0`, header): document immunity — lives in the full-width header, no narrow `overflow` pane above it (structural, add comment).
- [x] 5.5 WorktreeActionsMenu (`right-0 min-w-140`): (test-first) then drill the session-card rail pane ref + `estimatedWidth` + `boundaryRef`; verify no clip when the rail is slim.
- [x] 5.6 PackageRow (`right-0 min-w-160`): (test-first) then drill the resources-list pane ref + `estimatedWidth` + `boundaryRef`; verify no clip.

> Note: the concrete automated test rows for Sections 3–5 are finalized by
> `scenario-design` (test-plan.md manifest) and folded in §7; the RED-first
> bullets above mark the TDD ordering each consumer change must follow.
> Consumer-row map: 5.2→F12, 5.3→F11, 5.5→F9, 5.6→F10.

## 7. Folded automated scenarios (from test-plan.md manifest — author RED first)

Each row = one automated manifest scenario. Triple = `input · trigger · observable`.

### L1 — `packages/client/src/hooks/__tests__/usePopoverFlip.test.ts` (extend the existing mocked-`getBoundingClientRect` harness)

- [x] 7.1 E1 boundary horizontal measurement (test-plan #E1): boundary {left:360,right:660} + right-preferred trigger rect.right=461, estimatedWidth 256 · open · spaceRightAnchor=93<256, spaceLeftAnchor=253 → `anchorRight=false`, `maxWidth` from boundary. See existing viewport cases in usePopoverFlip.test.ts.
- [x] 7.2 E2 boundary honored over viewport — the core bug (test-plan #E2): boundary {left:360,right:780}, right-preferred trigger rect.right=461, innerWidth 1280 · open with vs without boundaryRef · without → `anchorRight=true`; with → `anchorRight=false`; results differ.
- [x] 7.3 E3 viewport fallback unchanged (test-plan #E3): no boundaryRef, triggers across viewport quadrants · open · anchor/`maxWidth`/`flipUp`/`maxHeight` byte-identical to pre-change (both axes).
- [x] 7.4 E4 boundary vertical measurement, synthetic (test-plan #E4): boundary {top:100,bottom:400}, trigger rect.bottom=380, estimatedHeight 200, innerHeight 1000 · open · spaceBelow=12 vs boundary.bottom → `flipUp=true`; without boundary `flipUp=false`.
- [x] 7.5 E5 preferredAnchor left preserved (test-plan #E5): `preferredAnchor:"left"`, spaceLeftAnchor ≥ estimatedWidth · open · `anchorRight=false` (stays left-0).
- [x] 7.6 E6 preferredAnchor left flips only when forced (test-plan #E6): `preferredAnchor:"left"`, spaceLeftAnchor<estimatedWidth AND spaceRightAnchor>spaceLeftAnchor · open · `anchorRight=true`.
- [x] 7.7 E7 minContentWidth flips not squishes (test-plan #E7): `preferredAnchor:"left"`, `minContentWidth:280`, spaceLeftAnchor=270, spaceRightAnchor=400 · open · flips right; `maxWidth` NOT clamped to 270.
- [x] 7.8 E8 minContentWidth clamps only when neither side fits (test-plan #E8): `minContentWidth:280`, spaceLeftAnchor=200, spaceRightAnchor=180 · open · clamps `maxWidth=max(160,200)=200`, no beneficial flip.
- [x] 7.9 F1 re-measure on boundary scroll (test-plan #F1): open popover + boundaryRef, boundary rect changes · boundary `scroll` event · `measure()` re-invoked, state reflects new rect.
- [x] 7.10 F2 re-measure on boundary resize (test-plan #F2): open popover + boundaryRef, ResizeObserver mocked · RO callback fires · `measure()` re-invoked.
- [x] 7.11 F3 no listeners while closed (test-plan #F3): `open:false`, boundaryRef supplied · resize/scroll window+boundary · no measurement, zero window AND boundary listeners.
- [x] 7.12 X1 null boundary → viewport fallback (test-plan #X1): `boundaryRef.current===null` · open · viewport fallback, finite `maxWidth`/`maxHeight`, valid anchor, no throw/NaN.
- [x] 7.13 X2 self-boundary dev guard (test-plan #X2): `boundaryRef.current` contains the popover element · open (dev), spy `console.warn` · one dev-only warn naming the mis-wire, no crash.

### L3 — new `tests/e2e/*.spec.ts` on the docker harness (set viewport width per-spec to force the board/offset-pane layout; read the harness port from `.pi-test-harness.json`, never hardcode). Exemplar: `tests/e2e/reconnect.spec.ts` for harness glue.

- [x] 7.14 F5 ChatViewMenu no left-clip in offset pane (test-plan #F5) — `tests/e2e/popover-container-clip.spec.ts`: board/split layout, ChatView pane offset+narrow (viewport ≥1440) · open ⚙ View · `popover.left ≥ pane.left` AND `popover.right ≤ pane.right`, all row labels rendered (no pane-edge truncation).
- [x] 7.15 F6 ModelSelector no right-clip, left-preserved (test-plan #F6): offset composer pane, (a) fits / (b) narrower than 280 · open model dropdown · (a) stays `left-0`, `dropdown.right ≤ pane.right`; (b) flips, content within pane, rendered width ≥ 280.
- [x] 7.16 F7 no behavior change when it fits — regression (test-plan #F7): full-width single-column ChatView · open ⚙ View then model dropdown · ChatViewMenu flips `left-0` at viewport-left as today; ModelSelector stays `left-0` width 320; anchors identical to pre-change.
- [x] 7.17 F8 ThinkingLevelSelector no clip in-pane (test-plan #F8): offset composer pane · open thinking-level popover · popover rect ⊆ pane rect.
- [x] 7.18 F9 WorktreeActionsMenu no clip in slim rail (test-plan #F9) — REALIZED at component level (`WorktreeActionsMenu.test.tsx`, mocked rects): the docker fixture has no worktree session (menu renders null without `session.gitWorktree`), so the boundary-aware flip is proven deterministically instead of L3.: narrow+offset session-card rail · open worktree actions menu · menu rect ⊆ rail-pane rect.
- [x] 7.19 F10 PackageRow menu no clip in narrow list (test-plan #F10) — REALIZED at component level (`PackageRow.test.tsx`, mocked rects): the row menu renders in the wide settings Packages list (no narrow offset pane → viewport fallback), so the boundary-aware flip is proven deterministically instead of L3.: pi-resources list in a narrow pane · open a PackageRow menu · menu rect ⊆ list-pane rect.
- [x] 7.20 F11 CommandInput attach/interrupt routed (test-plan #F11) — attach menu CONVERTED (clip reproduced at the 25% split floor); overflow menu documented immune.: offset composer pane, attach (`left-0 w-56`) + interrupt (`right-0`) · open each · menu rect ⊆ composer-pane rect (after conversion if a clip reproduces; else same assertion passes unchanged).
- [x] 7.21 F12 CommandInput slash/file dual-edge immunity (test-plan #F12): offset composer pane · trigger slash dropdown · dropdown pinned `left-3 right-3`, rect ⊆ composer rect regardless of pane offset.

## 6. Verify + land

- [x] 6.1 All §7 folded scenarios (7.1–7.21) green: L1 (7.1–7.13) + L3 e2e F5–F8/F11–F12 on the docker harness + F9/F10 component-level.
- [x] 6.2 `npm run build` clean (client change).
- [x] 6.3 Manual QA in a real desktop board layout — DEFERRED to post-merge human verification (the automated L3 e2e F5–F8/F11–F12 already assert popover ⊆ pane on the rendered harness at viewport 1440 + 25% split floor).
- [x] 6.4 `review-code` pass on the diff (shared-primitive + multi-consumer change) — reviewed: design sound (explicit boundaryRef + context), correctness (23 L1 + 6 L3 + 4 component tests green), backward-compatible viewport fallback, `useLayoutEffect` pre-paint positioning, no security concerns.
- [x] 6.5 `openspec validate fix-popover-container-clip --strict`.
