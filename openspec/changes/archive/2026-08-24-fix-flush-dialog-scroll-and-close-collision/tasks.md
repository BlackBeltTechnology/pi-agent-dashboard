## 1. Baseline — record current behaviour before touching the primitive

- [x] 1.1 Enumerate every `flush` consumer in the tree (expected: the six via
      `RouteBackedOverlay`, plus `OpenSpecArtifactDialog`, `AgentToolRenderer`,
      `FlowAgentCard`). Record the list in the change; the conversion set is
      NOT the consumer set (design R4). DERIVE it with
      `rg -n 'flush' --type tsx packages/` rather than copying any list in
      these artifacts — three separate revisions of this plan miscounted the
      consumer set by hand, so the enumeration is a build step, not prose.
- [x] 1.2 Capture baseline geometry for `AgentToolRenderer` (`size="lg" flush`,
      `h-[70vh]` child) and `FlowAgentCard` at BOTH short and tall content:
      panel height, `scrollHeight` vs `clientHeight`, working-scroller count.
      These are the two consumers D1 could regress and neither is currently
      covered.
      **Done differently, recorded:** no numeric in-browser baseline was captured.
      Both consumers keep a DEFINITE `h-[70vh]`, so height stability is a CSS
      tautology and the only real risk is deletion of the pin — which is now
      guarded by an L1 test (`AgentToolRenderer.test.tsx`, "F9") asserting the
      panel is the flush flex column AND the `h-[70vh]` child survives inside it.
- [x] 1.3 Confirm the measured defect table in `proposal.md` still reproduces on
      current `develop` (5 non-plugin routes clipped with 0 scrollers; the 2
      plugin routes clean). If any row has changed, update the proposal before
      implementing — the evidence is the justification.

## 2. Red tests — folded from `test-plan.md` (author before the contract exists)

> Every task below maps to exactly one manifest row. Do NOT hand-author extra
> test tasks here — the manifest is the source of truth for what gets tested,
> and `ship-change` maps these refs back to it.

### 2A. L1 unit — `packages/client-utils/src/__tests__/` (vitest)

Exemplar for all of 2A: `packages/client-utils/src/__tests__/Dialog.test.tsx`
(class-contract assertions on `baseElement.querySelector("[data-testid='d']")`);
for focus rows, `packages/client-utils/src/__tests__/useFocusTrap.test.tsx`
(its `Harness` component pattern).

      **Done via the stronger form:** rather than re-measuring `develop`, the
      gate was run against the CURRENT tree with D1's flex tokens reverted (task
      2.13). It failed on exactly the 5 non-plugin routes and passed on the 2
      plugin routes — the proposal's table, reproduced by the gate itself.
- [x] 2.1 Flush establishes a flex column. `<Dialog flush>` · render · panel
      class contains `flex`, `flex-col`, `min-h-0`, `overflow-hidden` and NOT
      `p-5`, NOT `overflow-y-auto`. (test-plan #E1)
- [x] 2.2 Non-flush is byte-identical. `<Dialog>` without flush · render · class
      contains `p-5` and `overflow-y-auto` and contains NO flex token.
      (test-plan #E2)
- [x] 2.3 Close-control decision table. All FOUR combinations of `flush` ×
      `showClose` · render · ✕ present for `!flush` (both showClose values) and
      for `flush+showClose`; absent for `flush` alone. Assert all four, not
      three. (test-plan #E3)
- [x] 2.4 Size cap is not coupled to flush. Each of `sm`/`md`/`lg`/`full`, in
      both flush modes · render · cap class is `max-h-[80vh]` for sm/md/lg and
      `max-h-[92vh]` for full, identical across flush modes. (test-plan #E4)
- [x] 2.5 Escape over a stacked overlay. Flush dialog open with a second
      dismissible layer registered above · `Escape` · dialog's `onClose` NOT
      called. Exemplar: `packages/client-utils/src/__tests__/escape-stack.test.ts`.
      (test-plan #E9)
- [x] 2.6 Parent controls open state. Flush dialog, `onClose` a no-op spy · any
      dismissal source fires · dialog remains mounted. (test-plan #E10)
- [x] 2.7 `showClose` rescues a zero-focusable child. `<Dialog flush>` whose
      child renders NO focusable element · render · with `showClose`: ✕ present
      and `activeElement` is the ✕; without: `activeElement` falls back to the
      container. Needs a new degenerate-child fixture (see test-plan "New infra
      needed"). (test-plan #X4)

### 2B. L3 browser gate — `tests/e2e/overlay-layout.spec.ts` (new file)

Exemplar for all of 2B: `tests/e2e/route-backed-overlay.spec.ts` (viewport
setup in `beforeEach`, route navigation, `fixtures.js` import); geometry probes
from `tests/e2e/chat-transcript-virtualization.spec.ts`. Port comes from
`.pi-test-harness.json#dashboardPort` via the fixtures' baseURL — never
hardcode `:18000`. **ε = 4 px** throughout.

- [x] 2.8 Tall flush content scrolls rather than clipping. Flush surface with
      content = cap + 500 px · overlay displayed at 1440×900 · panel
      `scrollHeight - clientHeight <= 4` AND ≥1 descendant is a working
      scroller. (test-plan #E5)
- [x] 2.9 Short flush content shrinks to fit. Flush surface with ~40 px of
      content · overlay displayed · panel height < 0.92 × viewport height (it
      did not expand to the cap). (test-plan #E6)
- [x] 2.10 At-cap boundary. Flush content exactly at the cap ±2 px · overlay
      displayed · panel clamps at cap, `scrollHeight - clientHeight <= 4`, no
      scroller required. (test-plan #E7)
- [x] 2.11 Route table derived from the router, not the mounts. The table
      enumerated from routing config (≥9 URLs incl. `PiResourceFileRoute`,
      `/folder/:cwd/view`, URL-preview) · each route opened · every route passes
      2.8's assertion, and a route present in the router but absent from the
      table fails a table-completeness check. (test-plan #E8)
- [x] 2.12 No interactive element occludes the effective close control. Each
      route in 2.11's table · overlay displayed · no visible
      `button`/`a`/`input`/`select` box intersects the EFFECTIVE close control
      (container ✕ where present, else the surface's own dismissal control).
      (test-plan #F5)
- [x] 2.13 Prove the gate is not vacuous. D1's flex tokens reverted in
      `Dialog.tsx` · gate re-run · 2.8/2.11 FAIL on the 5 previously-broken
      routes. Report geometry and occlusion assertion families SEPARATELY — a
      composite verdict hides which half works. (test-plan #X2)
- [x] 2.14 Content-rendered precedes geometry. A route seeded so its surface
      renders an error/empty state · gate run · gate FAILS on the content
      assertion rather than passing on the geometry of an empty box.
      (test-plan #X3)
## 3. Primitive — `Dialog.tsx` (D1 + D2)

- [x] 3.1 Change the `flush` branch to `overflow-hidden flex flex-col min-h-0`.
      Leave the non-flush branch byte-identical.
- [x] 3.2 Add `showClose?: boolean`; render the built-in ✕ when `!flush ||
      showClose`. Do not touch the escape-stack, focus trap, backdrop handler,
      or `onClose` wiring.
- [x] 3.2a Mirror `showClose` into `UiDialogProps` in
      `packages/shared/src/dashboard-plugin/ui-primitives.ts` and update its
      `flush` doc comment to state the flex-column contract. This is the
      PUBLIC plugin API — a plugin author reading only this file must learn
      that a flush child sizes `flex-1 min-h-0` and owns its own close
      affordance. Leaving it stale reproduces the exact failure this change
      fixes, one abstraction layer out.
- [x] 3.3 Confirm 2.1 and 2.2 now pass; confirm every pre-existing
      `dialog-system` scenario still passes (non-flush regression net).

## 4. Children — adopt `flex-1 min-h-0` (D3)

> **`min-h-0` is the load-bearing token, not the removal of `h-full`.** Measured
> in-browser: `flex-1 flex flex-col min-w-0` with `h-full` merely DROPPED still
> clips 3095 px and produces no scroller — identical to the current defect. The
> flex item's `min-height: auto` content floor keeps it from shrinking, and
> these roots carry `min-w-0` but never `min-h-0`. Only `flex-1 ... min-h-0`
> yields `clipped=0, scrolls=true`. Do not "just delete `h-full`".

> **Only THREE children need an edit — verified against source, not assumed.**
> `MarkdownPreviewView.tsx:46` and `PreviewOverlayView.tsx:24` are ALREADY
> `flex-1 flex flex-col min-h-0`; they clipped only because their parent was not
> a flex column, so D1 alone fixes them. Do not edit them. `OpenSpecPreview.tsx`
> does not exist — it is a function in `App.tsx` returning `MarkdownPreviewView`.

- [x] 4.1 `SettingsPanel.tsx:1064`: root `flex-1 flex flex-col min-w-0 h-full`
      → `flex-1 flex flex-col min-w-0 min-h-0`. REPLACE `h-full` with
      `min-h-0`; dropping it alone leaves the surface broken.
- [x] 4.2 `DirectorySettings.tsx:98`: same root, same replacement.
- [x] 4.3 `ZrokInstallGuide.tsx:133`: root is `flex flex-col h-full` with **no
      `flex-1`** — unlike 4.1/4.2 this is an ADDITION, not a swap. →
      `flex-1 flex flex-col min-h-0`. Replacing `h-full` with `min-h-0` alone
      would leave it with no grow and a shorter box than today.
- [x] 4.3a `DirectorySettings` has THREE mount contexts, not one: the flush
      overlay (`App.tsx:2615`), the live chain (`App.tsx:1882`), and mobile via
      `renderFolderSettings` (`App.tsx:2229`). 4.2 edits its root globally —
      verify all three, not just the overlay.
      **Coverage note:** the flush overlay and the mobile mount are asserted
      (route table + F10). The live-chain mount (`App.tsx:1882`) shares the same
      root element and was verified by reading, not by a rendered assertion.
- [x] 4.4 MOBILE: `SettingsPanel` and `ZrokInstallGuide` also mount directly in
      `MobileShell`'s detail panel (`App.tsx:2428-2431`), which is
      `absolute inset-0 … flex flex-col`. Verify BOTH at a mobile viewport
      (<768w or <600h) after 4.1/4.3: header pinned, body scrolls internally,
      no page-level scroll, no clipped footer. These roots are shared across
      both shells — an overlay-only fix that regresses mobile is not a fix.
- [x] 4.4a After each root edit, confirm the surface reports `clipped=0` AND a
      working scroller. A root that still reports `scrolls=false` is missing
      `min-h-0` somewhere in ITS OWN descendant chain, not in the panel.
- [x] 4.5 Re-run the 2.3 gate: all overlay routes green. Land 3.x and 4.x
      TOGETHER — measured: the panel-level flex change ALONE leaves every
      surface clipping exactly as before (3095 px, no scroller). Neither half
      is a partial improvement; 3.x without 4.x ships zero user-visible fix.

## 5. Remove the orphans this change creates (D4)

- [x] 5.1 **DO NOT touch `App.tsx`'s plugin-slot `h-[92vh]` wrapper.** It is a
      definite-height PIN, not a duplicated flex context (design D5). Plugin
      claim bodies are `absolute inset-0` (`slot-consumers.tsx:801`) and
      contribute ZERO intrinsic height, so under D1's height-indefinite panel
      the claim collapses to 0 — the exact failure its comment records and
      `kb-folder-slot.spec.ts` caught. Instead: extend its comment to say why
      D1 does not make it redundant, so the next reader does not delete it.
- [x] 5.2 `OpenSpecArtifactDialog.tsx`: delete the `h-[85vh] flex flex-col`
      wrapper (safe — its child `MarkdownPreviewView` is flow content with a
      non-zero intrinsic height, unlike the plugin slot). Verify the URL-less
      dialog path explicitly — it is deliberately separate from the route path
      and does not inherit its verification (design R8).
- [x] 5.2a `OpenSpecArtifactDialog.tsx`: pass `onBack={onClose}` to all three
      `MarkdownPreviewView` branches so the child owns dismissal, and delete
      the `closeInset` passes plus the now-false comment "No back button: the
      host Dialog supplies the standard close". Without this, D2 leaves this
      dialog with NO visible way to close.
- [x] 5.2b `MarkdownPreviewView`'s back button tooltip is hardcoded to the
      `session.backToChat` ("Back to chat") string. Correct for the chat popout,
      wrong inside an artifact reader. Parameterise the label (or supply a
      dialog-appropriate default) as part of 5.2a — 5.2a is what first makes
      this string user-visible in that dialog.
- [x] 5.3 `MarkdownPreviewView.tsx`: delete the `closeInset` prop and its
      `pr-12`. Confirm no remaining callers (5.2a removes the last ones).
- [x] 5.4 Do NOT remove `AgentToolRenderer`'s or `FlowAgentCard`'s `h-[70vh]`
      — deliberate stable-height pins, not workarounds (design D5). Add a
      one-line comment to each recording why it survives, so the next reader
      does not "finish the job".

## 6. Regression scenarios — folded from `test-plan.md`

All L3, all in `tests/e2e/overlay-layout.spec.ts` unless noted. Same exemplars
and ε as §2B. Mobile rows use `tests/e2e/gateway-board-mobile.spec.ts` for the
viewport pattern.

- [x] 6.1 Plugin routes must not collapse. `/folder/<cwd>/automations` and
      `/folder/<cwd>/goals`, whose claim bodies are `absolute inset-0` with zero
      intrinsic height · overlay displayed after D1 · panel height ≥ 0.5 ×
      viewport height AND claim content non-empty. Highest-severity regression
      in this change. (test-plan #F1)
- [x] 6.2 KB folder slot tripwire. The KB folder slot route · overlay displayed
      · existing `tests/e2e/kb-folder-slot.spec.ts` stays green — it is what
      originally caught the collapse. (test-plan #F2)
- [x] 6.3 ✕ is suppressed everywhere flush. Each of the 9 flush surfaces ·
      overlay displayed · zero elements matching the container's `-close` testid
      inside the panel. (test-plan #F3)
- [x] 6.4 Dismissal stays VISIBLE. Each of the 9 flush surfaces, incl.
      `OpenSpecArtifactDialog` after its `onBack` · overlay displayed · ≥1
      visible enabled interactive element inside the panel whose activation
      leaves the surface. (test-plan #F4)
- [x] 6.5 Viewport independence. `/settings/general` and
      `/folder/<cwd>/view?path=README.md` · opened at 1440×900, 1280×800 and
      1024×640 · 2.8's assertion holds at all three. 1024×640 is the boundary
      case nearest the mobile cutoff. (test-plan #F6)
- [x] 6.6 Mobile shell shares the edited roots. `/settings/general` and
      `/tunnel-setup` at 390×844 (MobileShell path, not the overlay) · opened ·
      header pinned, body scrolls internally, no page-level scroll, footer
      reachable. (test-plan #F7)
- [x] 6.7 Deepest `h-full` in the chain. The settings INSTRUCTIONS editor
      (`InstructionsPage.tsx:405`) inside the flush dialog · opened via the
      instructions tab · 2.8's assertion holds. Never measured before.
      (test-plan #F8)
- [x] 6.8 `h-[70vh]` pin holds under growth. `AgentToolRenderer` popout with a
      transcript that grows after mount · entries stream in · panel height
      constant ±4 px. (test-plan #F9)
- [x] 6.9 `DirectorySettings` in all three mount contexts. Flush overlay
      (`App.tsx:2615`), live chain (`App.tsx:1882`), mobile
      (`renderFolderSettings`, `App.tsx:2229`) · each rendered · header +
      content visible and internally scrollable in all three. (test-plan #F10)
- [x] 6.10 Initial focus. Each of the 9 flush surfaces · overlay opens ·
      `document.activeElement` is a descendant of the panel AND is not the panel
      element itself. (test-plan #F11)
- [x] 6.11 Resize while open. Tall flush surface open at 1440×900 · viewport
      resized to 1024×640 without closing · panel re-clamps, 2.8's assertion
      still holds, no content becomes unreachable. (test-plan #F12)
- [x] 6.12 Artifact dialog in all three branches. `OpenSpecArtifactDialog` in
      loading (`isWaitingForReplay`), not-found, and loaded states · dialog
      opened per branch · all three render a visible dismissal control and
      satisfy 2.8. A fix applied to only the loaded branch is the likely error.
      (test-plan #X1)
- [x] 6.13 Unsaved-edits guard survives. `/settings/general` with a dirty draft ·
      Escape, and separately backdrop click · discard prompt on both paths. Do
      NOT assert a back arrow on the Instructions page — it passes
      `onBack={isDesktop ? undefined : backToTree}` and renders none on desktop;
      its guard is `leaveOverlay` (`InstructionsPage.tsx:66`). (test-plan #X5)
- [x] 6.14 Visual check where the ✕ used to sit: no hole or crowding on the six
      converted surfaces. Human judgment, no automatable observable.
      (test-plan: manual-only)
- [x] 6.15 Re-measure `AgentToolRenderer` and `FlowAgentCard` against the 1.2
      baseline at short AND tall content. Not a manifest row — this is the
      baseline-diff step that tells you WHICH scenario regressed when one fails.
      **Recorded:** see 1.2 — the pin is asserted structurally instead of by a
      baseline diff, because a definite height cannot drift.
- [x] 6.16 Run the full suite and the E2E harness per the project's
      pipe-once-then-grep procedure.
## 7. Specs and documentation

      **Result:** `npm test` 16 190 tests, 0 failures. Browser E2E: the new gate
      (50 tests) plus every overlay/dialog-adjacent spec pass. Three specs fail
      on this harness INDEPENDENTLY of this change — `automation-fanout`,
      `bus-client-goal-plugin-action`, `change-summary-table`,
      `file-preview-survives-churn` — each reproduced on a baseline build with
      this change's source reverted. The full suite exceeds Playwright's 15-min
      `globalTimeout` on this host and was therefore run in batches.
- [x] 7.1 Confirm the delta specs match what was built — `dialog-system` AND
      `dialog-primitive` (both carry a flush requirement and both omit the ✕
      from their dismissal requirement) plus `shell-overlay-route`
      (reachability). Amend the deltas if implementation diverged; do not amend
      the code to match a stale delta silently.
- [x] 7.1a A THIRD spec touches this behaviour: `url-routing/spec.md:358`
      specifies dismissal of converted surfaces as "backdrop click, `Esc`, or
      its close affordance". Judged still true — after 5.2a every converted
      surface has its OWN close affordance, so the sentence reads correctly
      against the child's control rather than the container's ✕. Confirm that
      reading at implementation time; ship a `url-routing` delta if the
      sentence turns out to mean the container control.
- [x] 7.1b Verify each MODIFIED requirement in the deltas carries EVERY
      scenario from the main spec, not just the changed ones. `openspec
      archive` treats a MODIFIED block as the complete replacement, so an
      omitted scenario is silently DELETED from the shipped spec. (Caught in
      review: the `dialog-primitive` Dismissal delta had dropped "Escape over a
      stacked overlay" and "Open state is controlled by the parent".)
- [x] 7.2 Update the `packages/client-utils/src/AGENTS.md` row for `Dialog.tsx`:
      new `flush` layout contract, `showClose`, and `See change:`.
- [x] 7.3 Add a `tests/e2e/AGENTS.md` row for `overlay-layout.spec.ts` stating
      it is the generic reachability gate for ALL overlay routes, plus its
      companion `.AGENTS.md` if the row exceeds the 200-char threshold.
- [x] 7.4 Update rows for every touched source file in its nearest directory
      `AGENTS.md`. Derive the list from `git diff --name-only`, do NOT copy it
      from here — every hand-maintained enumeration in this change has been
      wrong at least once. At minimum it includes `Dialog.tsx`,
      `ui-primitives.ts` (its row at
      `packages/shared/src/dashboard-plugin/AGENTS.md` documents `UiDialogProps`
      and goes stale), `App.tsx`, `MarkdownPreviewView.tsx`,
      `OpenSpecArtifactDialog.tsx`, `SettingsPanel.tsx`, `DirectorySettings.tsx`,
      `ZrokInstallGuide.tsx`, `AgentToolRenderer.tsx`, `FlowAgentCard.tsx`.
- [x] 7.5 Run `kb dox lint` and clear any `stale` / `missing` /
      `over-threshold` findings this change introduced.

## 8. Review gates

- [x] 8.1 `doubt-driven-review` on the primitive diff BEFORE it stands — the
      claim under test is "non-flush is behaviour-identical and short flush
      content still shrinks to fit", across every dialog in the app.
- [x] 8.2 `review-code` on the full diff once tests are green.
- [x] 8.3 Re-verify the two review-critical claims before merge: the plugin
      routes still render (D5 pin intact) and `OpenSpecArtifactDialog` still
      has a visible dismissal (5.2a applied). Both were defects introduced by
      an earlier revision of this plan and caught only in doubt-review; they
      are the two places a careless rebase would silently reintroduce.
