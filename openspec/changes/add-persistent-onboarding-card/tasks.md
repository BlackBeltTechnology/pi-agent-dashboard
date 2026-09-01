## 0. Read first

- [ ] 0.1 Read `test-plan.md` — it is the manifest and the source of truth for automated-vs-manual. Every test task below carries its scenario id; do not add or drop tests without updating the manifest
- [ ] 0.2 Read `design.md` D2a before writing any mount code — the obvious `{!allDone && <OnboardingCard/>}` is the one implementation that silently breaks the latch on the happy path
- [ ] 0.3 Note the contrast trap recorded in `mockups/ux-review.md`: `#fff` on `--accent-primary` measures 3.68:1 in dark and fails AA. The card's CTA uses `--bg-primary` on `--severity-info-fg`

## 1. Shared derivation hook (TDD first)

- [ ] 1.1 Write the failing 16-row decision-table test for `useOnboardingSteps` in `packages/client/src/hooks/__tests__/useOnboardingSteps.test.tsx` — see `packages/client/src/hooks/__tests__/useProvidersReady.test.ts` for hook-test harness glue. Triple: every combination of `providersReady ∈ {t,f}` × `pinnedCount ∈ {0,1}` × `sessionsCount ∈ {0,1}` × `latch ∈ {set,unset}` with `providersLoading=false` · hook evaluated · each row returns the tuple fixed by the gate order in design.md D1 (test-plan #E1)
- [ ] 1.2 Write the failing boundary test — Triple: `pinnedCount` 0→1 and `sessionsCount` 0→1 with `providersReady=true` · hook evaluated at each boundary · `step2` flips pending→done at `pinnedCount=1`, `step3` flips pending→done at `sessionsCount=1` (test-plan #E2)
- [ ] 1.3 Write the failing hidden-session test — Triple: `providersReady=true`, `pinnedCount=1`, both sessions `hidden:true` · hook evaluated · `step3="pending"`, `allDone=false`, latch key absent (test-plan #E3)
- [ ] 1.4 Write the failing ended-session test — Triple: as #E3 but one session `hidden:false, status:"ended"` · hook evaluated · `step3="done"` (test-plan #E4)
- [ ] 1.5 Write the failing mixed-regression test — Triple: `providersReady=false`, `pinnedCount=1`, `sessionsCount=1` · hook evaluated · `step1="pending"`, `step2="locked"`, `step3="done"`, `allDone=false` (test-plan #E5)
- [ ] 1.6 Write the failing loading-suppression test — Triple: `providersLoading=true` with the user in fact fully configured · hook evaluated then readiness resolves · `resolved=false` first, card renders nothing throughout, never appears-then-disappears (test-plan #F6)
- [ ] 1.7 Write the failing both-surfaces-agree test — Triple: identical inputs with both surfaces mounted · rendered together · step states identical across all 16 #E1 rows (test-plan #F8)
- [ ] 1.8 Implement `packages/client/src/hooks/useOnboardingSteps.ts` with the exact signature in design.md D1 — inputs as arguments (never an internal `useProvidersReady()` call), `resolved` derived from `providersLoading`, gate order per D1
- [ ] 1.9 Verify: `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log` then `grep -nE 'FAIL|Error|✗|✘|Tests +[0-9]+ (failed|passed)' /tmp/pi-test.log`

## 2. Latch persistence

- [ ] 2.1 Write the failing latch-write test — Triple: latch key absent, `providersReady=true`, `pinnedCount=1`, `sessionsCount` 0→1 · rerender with the new count · `localStorage["dashboard:onboarding-session-started"] === "1"` (test-plan #E6)
- [ ] 2.2 Write the failing idempotence test — Triple: latch already `"1"` · hook rendered 3× with `sessionsCount=1` including StrictMode double-invoke · final stored value is `"1"`. Assert the VALUE, never a write call count — design.md D2 forbids call-count assertions (test-plan #E7)
- [ ] 2.3 Write the failing latch-survives test — Triple: latch set, `providersReady=true`, `pinnedCount=1`, `sessionsCount=0` · hook evaluated · `step3="done"`, `allDone=true` (test-plan #E8)
- [ ] 2.4 Write the failing no-masking test — Triple: latch set, `providersReady=false` · hook evaluated · `step1="pending"`, `allDone=false` (test-plan #E9)
- [ ] 2.5 Write the failing same-commit test — Triple: latch absent, `providersReady=true`, `pinnedCount=1`, `sessionsCount=0` · `setSessions` + `navigate` applied in ONE batched commit · latch key present afterwards and still present after remount with `sessionsCount=0` (test-plan #F5)
- [ ] 2.6 Write the failing storage-read-throws test — Triple: `localStorage.getItem` throws · hook evaluated · latch treated as absent, no throw propagates, step ③ derives from `sessionsCount` alone (test-plan #X1)
- [ ] 2.7 Write the failing storage-write-throws test — Triple: `localStorage.setItem` throws · `sessionsCount` 0→1 · no throw, hook still reports `step3="done"` for the live count (test-plan #X2)
- [ ] 2.8 Implement the latch read + write-when-absent inside the hook, both wrapped so any storage error is swallowed
- [ ] 2.9 Verify tests pass

## 3. Dispatcher — `provider-auth-event` (PREREQUISITE, split out)

The dispatcher moved to its own change, **`dispatch-provider-auth-event`** — it
fixes a live bug in the shipped `LandingPage` and does not depend on anything
here. Scenarios #D1–D5 and #X5 moved with it.

- [ ] 3.1 GATE: verify `dispatch-provider-auth-event` has landed before continuing — `rg -n "provider-auth-event" packages/client/src/components/settings/` must show at least one `dispatchEvent`. If it does not, stop and land that change first; the card will display a stale ① without it
- [ ] 3.2 Write the failing endpoint-failure test — Triple: `/api/providers` rejects while `/api/provider-auth/status` returns one authenticated entry · hook evaluated · `step1="done"` (test-plan #X6)
- [ ] 3.3 Verify tests pass

## 4. LandingPage consumes the hook

- [ ] 4.1 Record the green baseline of `packages/client/src/components/__tests__/LandingPage.test.tsx` before touching the component
- [ ] 4.2 Write the failing latched-zero label test — Triple: latch set, visible `sessionsCount=0`, `pinnedCount=1` · step ③ rendered on both surfaces · label reads "First session complete" and the string `0 active session` appears nowhere (test-plan #E16)
- [ ] 4.3 Write the failing loading-window test — Triple: `providersLoading=true` · LandingPage rendered · hero present, no element in a pending/done/locked step state (test-plan #F7)
- [ ] 4.4 Write the failing legacy-path test — Triple: `LandingPage` rendered with NO onboarding props · rendered · minimal π placeholder renders and no hook-order warning is emitted (test-plan #R2)
- [ ] 4.5 Write the failing order-independence test — Triple: `LandingPage.test.tsx` with a latch-writing case forced to run first · full file executed in that order · every existing assertion still passes (test-plan #R1)
- [ ] 4.6 Add a `localStorage` reset to the suite's `beforeEach` so 4.5 can pass — the suite currently has no cleanup and passes only by file order
- [ ] 4.7 Delete the inline derivation at `LandingPage.tsx:119-127` and read state from `useOnboardingSteps()`, calling the hook BEFORE the legacy early return at `:104-113` (a hook after a conditional return is a rules-of-hooks violation)
- [ ] 4.8 Add the `providersLoading` prop and the count-free "First session complete" label with a new i18n key and English fallback
- [ ] 4.9 Verify the pre-existing suite still passes, with no assertion changed except the step-③ latch case (test-plan #R3)

## 5. OnboardingCard component

- [ ] 5.2 Write the failing unconditional-mount test (this also covers the plain visibility assertion — checklist shown when `allDone=false`, no visible content when `allDone=true`) — Triple: shell rendered with `allDone=false` then inputs flipped so `allDone=true` in one commit · single state commit · `OnboardingCard` remains MOUNTED, renders no visible content, latch write still occurred (test-plan #F4)
- [ ] 5.3 Write the failing no-dismiss test — Triple: card expanded in any incomplete state · rendered · no control exists whose action removes the card without completing onboarding (test-plan #F15)
- [ ] 5.4 Write the failing CTA tests — Triple: `step1="pending"` · CTA activated · `navigate` called with exactly `/settings/providers` (test-plan #E13); and `step3="pending"` with `firstPinnedCwd="/tmp/x"` · CTA activated · `onSpawnSession("/tmp/x")` called once (test-plan #E14)
- [ ] 5.5 Write the failing locked-step test — Triple: `pinnedCount=0` · step ③ rendered · CTA disabled and hint names a pinned folder as the unmet prerequisite (test-plan #E15)
- [ ] 5.6 Write the failing focus test — Triple: card expanded with focus before it in DOM order · repeated `Tab` · focus traverses the card and reaches an element after it; card exposes a labelled complementary landmark (test-plan #F13)
- [ ] 5.7 Write the failing width-cap test — Triple: viewport width 320px · card rendered expanded · width ≤ `viewport − 2rem`, no horizontal overflow (test-plan #E17)
- [ ] 5.8 Write the failing layering contract test — Triple: card + `WorktreeInitStack` class contracts · both rendered · card's z-index class is numerically below `WorktreeInitStack`'s and below the toast layer. This is a documented PROXY for the real stacking observable, not the observable itself (test-plan #E18)
- [ ] 5.9 Implement `packages/client/src/components/shell/OnboardingCard.tsx` — expanded rendering, `fixed bottom-4 right-4 z-30`, `w-[320px] max-w-[calc(100vw-2rem)]`, surface `--bg-secondary` + `--border-secondary`, returning `null` internally when `allDone` or `!resolved`
- [ ] 5.10 Apply the severity tokens per design.md D7 — `--severity-success-fg` done, `--severity-info-fg`/`-bg` active, `--severity-neutral-*` locked, CTA fill `--severity-info-fg` with `--bg-primary` label. Introduce NO new CSS custom properties
- [ ] 5.11 Apply the shared `.focus-ring` utility to every interactive element; do not hand-roll a focus style
- [ ] 5.12 Add i18n keys for the card header, the `n of 3` progress string, and the collapse/expand labels; reuse the existing `landing.*` step keys rather than duplicating them
- [ ] 5.13 Verify tests pass

## 6. Collapse behaviour

- [ ] 6.1 Write the failing preference×breakpoint decision-table test — Triple: 4 combinations of persisted preference ∈ {absent, "1", "0"} × `useMediaQuery("(min-width: 640px)")` ∈ {t,f} · card rendered · persisted preference wins when present, otherwise expanded iff the query is true (test-plan #E10)
- [ ] 6.2 Write the failing matchMedia-absent test — Triple: no persisted preference, `window.matchMedia` undefined · card rendered · renders expanded, does not throw (test-plan #E11)
- [ ] 6.3 Write the failing pill-progress test — Triple: step states done/done/pending · pill rendered · conveys `2 of 3` and exposes an expand control (test-plan #E12)
- [ ] 6.4 Write the failing persistence test — Triple: card expanded with no persisted preference · collapse then remount · renders collapsed (test-plan #F14)
- [ ] 6.5 Write the failing collapse-write-throws test — Triple: `localStorage.setItem` throws a quota error · user collapses the card · card collapses, no throw, preference absent on next mount so the breakpoint default applies (test-plan #X3)
- [ ] 6.6 Write the failing collapse-read-throws test — Triple: `localStorage.getItem` throws · card mounted · breakpoint default applied, no throw (test-plan #X4)
- [ ] 6.7 Implement the collapsed pill and the persisted preference under `dashboard:onboarding-collapsed`, using `useMediaQuery("(min-width: 640px)")` with the jsdom-absent-means-wide convention from `InstructionsPage.tsx:99-105`
- [ ] 6.8 Verify tests pass

## 7. Shell mounting

- [ ] 7.1 Write the failing both-branches test — Triple: shell rendered at a mobile width and a desktop width · each branch rendered · card present in both with the same props (test-plan #F10)
- [ ] 7.2 Mount `<OnboardingCard>` UNCONDITIONALLY in `App.tsx` beside `<WorktreeInitStack />` at both sites (`:2419` mobile, `:2471` desktop). Never gate the mount on `allDone` — see design.md D2a
- [ ] 7.3 Replace `sessionsCount={sessions.size}` at `:2268` (ONE site since the `ShellContent` extraction — `renderLanding` is shared by both variants) with a hidden-filtered visible-session count, and pass the same count to the card
- [ ] 7.4 Thread `providersLoading` from the existing `useProvidersReady()` at `:561` into both surfaces
- [ ] 7.5 Thread the composer-clearing offset prop, derived from `!!selectedId`, into the card at both mount sites
- [ ] 7.6 Verify tests pass

## 8. Browser-level scenarios (Playwright)

- [ ] 8.1 Write the failing step-① survival spec in `tests/e2e/onboarding-card.spec.ts` — see `tests/e2e/blackhole-settings.spec.ts` for settings-route navigation harness glue and `tests/e2e/global-setup.ts` for the `.pi-test-harness.json` `dashboardPort` convention (never hardcode `:18000`). Triple: fresh dashboard with no credentials and no folders · click step ① CTA so the route becomes `/settings/providers` · onboarding card still in the DOM with steps ② and ③ still listed (test-plan #F1)
- [ ] 8.2 Write the failing step-③ survival spec — Triple: credentials set, 1 pinned folder, 0 sessions · click step ③ CTA so the route becomes `/session/:id` · card remains until `allDone`, then converges to rendering no content (test-plan #F2)
- [ ] 8.3 Write the failing no-navigation-readiness spec — Triple: card visible with step ① pending and the user on `/settings/providers` · save a provider API key and stay on the page · card converges to step ① done and step ② pending with NO route change (test-plan #F3)
- [ ] 8.4 Write the failing coexistence spec — Triple: onboarding incomplete with no session/folder/settings route active · landing route rendered · both the LandingPage step cards and the persistent card are present (test-plan #F9)
- [ ] 8.5 Write the failing composer-clearance spec — see `tests/e2e/editor-pane.spec.ts` for `boundingBox` geometry glue. Triple: onboarding incomplete with a session selected and the composer at single-line height · session route rendered · card bounding box does not intersect the composer bounding box (test-plan #F11)
- [ ] 8.6 Write the failing no-offset spec — Triple: onboarding incomplete with no session selected · settings route rendered · card renders at its default offset (test-plan #F12)
- [ ] 8.7 Run the E2E tier per `qa/README.md`: `docker/test-up.sh`, `npm run test:e2e`, then `docker/test-down.sh` — teardown always runs

## 9. Verification and docs

- [ ] 9.1 Confirm every automated row in `test-plan.md` maps to exactly one task above — 47 automated rows, 47 test tasks
- [ ] 9.2 Run the full suite: `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log` then grep the summary pattern; zero failures
- [ ] 9.3 Run `npm run quality:changed` and clear any Biome findings the change introduced
- [ ] 9.4 Invoke the `review-code` discipline skill on the diff before commit
- [ ] 9.5 Invoke the `code-simplification` discipline skill against the hook extraction — confirm the result is smaller than the two-copy alternative and did not add a third layer
- [ ] 9.6 Add rows for `OnboardingCard.tsx` to `packages/client/src/components/shell/AGENTS.md` and `useOnboardingSteps.ts` to `packages/client/src/hooks/AGENTS.md`; update `LandingPage.tsx.AGENTS.md` to record that the derivation moved out
- [ ] 9.7 Rebuild and restart for manual verification: `npm run build && curl -X POST http://localhost:8000/api/restart`

## 10. Manual verification (deferred post-merge)

- [ ] 10.1 Visual placement quality — card at 375 / 768 / 1440 in light and dark: does it read as a standing reminder rather than an alert, and clear surrounding chrome (test-plan: manual-only)
- [ ] 10.2 Duplication on the landing route — is the accepted D3 duplication tolerable in practice (test-plan: manual-only)
- [ ] 10.3 Real transient-overlay stacking — with ≥2 concurrent worktree inits and onboarding incomplete, does `WorktreeInitStack` visually win the shared corner (test-plan: manual-only)
