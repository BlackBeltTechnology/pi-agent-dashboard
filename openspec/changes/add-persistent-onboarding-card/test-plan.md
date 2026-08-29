# Test Plan — add-persistent-onboarding-card

Stage: design   Generated: 2026-08-12

HARD gate cleared — five unfillable slots were resolved by decision before this
file was written (breakpoint query, latched-zero label, composer offset model,
layering observable, dispatcher scope). All Triples below are concrete; no
`[NEEDS CLARIFICATION]` markers remain.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | Shared derivation | decision-table (16 rows) | L1 | automated | every combination of `providersReady ∈ {t,f}` × `pinnedCount ∈ {0,1}` × `sessionsCount ∈ {0,1}` × `latch ∈ {set,unset}`, `providersLoading=false` | `useOnboardingSteps(...)` evaluated | each row returns the `step1/step2/step3/allDone` tuple fixed by the gate order in design.md D1 |
| E2 | Shared derivation | BVA (count boundary) | L1 | automated | `pinnedCount=0` then `1`; `sessionsCount=0` then `1`, `providersReady=true` | hook evaluated at each boundary | `step2` flips `pending→done` at `pinnedCount=1`; `step3` flips `pending→done` at `sessionsCount=1` |
| E3 | Shared derivation — visible-session semantics | EP (valid/invalid partition) | L1 | automated | `providersReady=true`, `pinnedCount=1`, session set = 2 sessions both `hidden:true` | hook evaluated | `step3="pending"`, `allDone=false`, latch key absent from `localStorage` |
| E4 | Shared derivation — visible-session semantics | EP | L1 | automated | same as E3 but one session `hidden:false, status:"ended"` | hook evaluated | `step3="done"` — ended sessions count, hidden ones do not |
| E5 | Shared derivation — mixed regression | decision-table (illegal-looking combo) | L1 | automated | `providersReady=false`, `pinnedCount=1`, `sessionsCount=1` | hook evaluated | `step1="pending"`, `step2="locked"`, `step3="done"`, `allDone=false` |
| E6 | Step ③ latches | state-transition (legal edge) | L1 | automated | latch key absent, `providersReady=true`, `pinnedCount=1`, `sessionsCount` `0→1` | rerender with the new count | `localStorage["dashboard:onboarding-session-started"] === "1"` |
| E7 | Step ③ latches | state-transition (idempotence) | L1 | automated | latch key already `"1"` | hook rendered 3× with `sessionsCount=1`, incl. StrictMode double-invoke | final stored value is `"1"`; assertion is on **value**, never on write call count |
| E8 | Step ③ latches | state-transition (illegal edge) | L1 | automated | latch key set, `providersReady=true`, `pinnedCount=1`, `sessionsCount=0` | hook evaluated | `step3="done"`, `allDone=true` |
| E9 | Step ③ latches — no masking | state-transition (illegal edge) | L1 | automated | latch key set, `providersReady=false` | hook evaluated | `step1="pending"`, `allDone=false` — latch does not mask a prerequisite regression |
| E10 | Card collapse | decision-table (preference × breakpoint) | L1 | automated | 4 combos of persisted preference ∈ {absent, `"1"`, `"0"`} × `useMediaQuery("(min-width: 640px)")` ∈ {t,f} | card rendered | persisted preference wins when present; otherwise expanded iff the query is `true` |
| E11 | Card collapse | boundary (matchMedia absent) | L1 | automated | no persisted preference, `window.matchMedia` undefined | card rendered | renders expanded, does not throw |
| E12 | Collapsed pill progress | EP | L1 | automated | step states `done/done/pending` | pill rendered | pill conveys `2 of 3` and exposes an expand control |
| E13 | Step ① CTA route | decision-table | L1 | automated | `step1="pending"` | CTA activated | `navigate` called with exactly `/settings/providers` |
| E14 | Step ③ CTA | decision-table | L1 | automated | `step3="pending"`, `firstPinnedCwd="/tmp/x"` | CTA activated | `onSpawnSession("/tmp/x")` called once |
| E15 | Step ③ locked | decision-table | L1 | automated | `pinnedCount=0` | step ③ rendered | CTA disabled, hint names a pinned folder as the unmet prerequisite |
| E16 | Latched-zero label | EP (the 0 partition) | L1 | automated | latch set, visible `sessionsCount=0`, `pinnedCount=1` | step ③ rendered on both surfaces | label reads "First session complete"; the string `0 active session` appears nowhere |
| E17 | Card placement — width cap | BVA | L1 | automated | viewport width 320px | card rendered expanded | card width ≤ `viewport − 2rem`; no horizontal overflow |
| E18 | Card layering | contract-assertion (**proxy**) | L1 | automated | card + `WorktreeInitStack` class contracts | both rendered | card's z-index class is numerically below `WorktreeInitStack`'s (`z-30` < `z-40`) and below the toast layer |

> **E18 is knowingly a proxy.** The real observable — which element wins at the
> overlapping pixel — needs Playwright plus a staged pair of concurrent worktree
> inits, which no harness stages today. Recorded as a decision, not an oversight:
> the assertion verifies the *contract* the design relies on, not the rendered
> stacking result. If a stacking regression ever ships, this test will not catch it.

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | Card survives step ① navigation | state-transition | L3 | automated | fresh dashboard, no credentials, no folders | click step ① CTA → route becomes `/settings/providers` | onboarding card still in the DOM, steps ② and ③ still listed |
| F2 | Card survives step ③ navigation | state-transition | L3 | automated | credentials set, 1 pinned folder, 0 sessions | click step ③ CTA → route becomes `/session/:id` | card remains until `allDone`, then converges to rendering no content |
| F3 | Readiness without navigation | state-convergence | L3 | automated | card visible with step ① pending, user on `/settings/providers` | save a provider API key; stay on the page | card converges to step ① done + step ② pending with **no route change** |
| F4 | Unconditional mount | state-transition (the D2a trap) | L1 | automated | shell rendered with `allDone=false`, then inputs flipped so `allDone=true` in one commit | single state commit | `OnboardingCard` component remains mounted; renders no visible content; latch write still occurred |
| F5 | Latch written on the completing commit | state-transition | L1 | automated | latch absent, `providersReady=true`, `pinnedCount=1`, `sessionsCount=0` | `setSessions` + `navigate` applied in **one** batched commit | latch key present afterwards; still present after remount with `sessionsCount=0` |
| F6 | Loading suppression | state-convergence | L1 | automated | `providersLoading=true`, user in fact fully configured | hook evaluated, then readiness resolves | `resolved=false` first; card renders nothing throughout; never appears-then-disappears |
| F7 | LandingPage during loading | state-convergence | L1 | automated | `providersLoading=true` | LandingPage rendered | hero present; no element in a pending/done/locked step state |
| F8 | Both surfaces agree | invariant | L1 | automated | identical inputs, both surfaces mounted | rendered together | the step states rendered by each are identical for all 16 E1 rows |
| F9 | Card + LandingPage coexist | state-transition | L3 | automated | onboarding incomplete, no session/folder/settings route active | landing route rendered | both the LandingPage step cards and the persistent card are present |
| F10 | Mounted in both shell branches | decision-table | L1 | automated | shell rendered at a mobile width and at a desktop width | each branch rendered | card present in both, with the same props |
| F11 | Composer clearance | geometric invariant | L3 | automated | onboarding incomplete, a session selected, composer at single-line height | session route rendered | card bounding box does not intersect the composer bounding box |
| F12 | No composer offset off-session | geometric invariant | L3 | automated | onboarding incomplete, no session selected | settings route rendered | card renders at its default offset (no raised class/offset applied) |
| F13 | Focus is not trapped | state-transition | L1 | automated | card expanded, focus before it in DOM order | repeated `Tab` | focus traverses the card and reaches an element after it; card exposes a labelled complementary landmark |
| F14 | Collapse persists across reload | state-transition | L1 | automated | card expanded, no persisted preference | collapse, then remount the component | renders collapsed |
| F15 | No dismiss control | invariant | L1 | automated | card expanded in any incomplete state | rendered | no control whose action removes the card without completing onboarding |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | Failure-tolerant latch read | fault-injection (throw) | L1 | automated | `localStorage.getItem` throws | hook evaluated | latch treated as absent; no throw propagates; step ③ derives from `sessionsCount` alone |
| X2 | Failure-tolerant latch write | fault-injection (throw) | L1 | automated | `localStorage.setItem` throws | `sessionsCount` `0→1` | no throw; hook still reports `step3="done"` for the live count |
| X3 | Failure-tolerant collapse write | fault-injection (quota) | L1 | automated | `localStorage.setItem` throws a quota error | user collapses the card | card collapses; no throw; preference absent on next mount so the breakpoint default applies |
| X4 | Failure-tolerant collapse read | fault-injection (throw) | L1 | automated | `localStorage.getItem` throws | card mounted | breakpoint default applied; no throw |
| X6 | Provider endpoint failure | fault-injection (abort) | L1 | automated | `/api/providers` rejects, `/api/provider-auth/status` returns one authenticated entry | hook evaluated | `step1="done"` — one endpoint failing does not hide the other's credentials |

### Integration — dispatcher

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|

### Regression

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| R1 | Suite order-independence | shared-state fault | L1 | automated | `LandingPage.test.tsx` with a latch-writing case forced to run first | full file executed in that order | every existing assertion still passes — proves a `localStorage` reset exists between cases |
| R2 | Legacy LandingPage path | invariant | L1 | automated | `LandingPage` rendered with **no** onboarding props | rendered | minimal π placeholder renders; no hook-order warning is emitted |
| R3 | Existing LandingPage suite | invariant | L1 | automated | the pre-change suite | executed | passes unchanged except the step-③ latch assertion and the new loading-window case |

### Manual

| id | requirement | technique | level | disposition | surface | human check | note |
|----|-------------|-----------|-------|-------------|---------|-------------|------|
| M1 | Visual placement quality | visual/subjective | — | manual-only | card at 375 / 768 / 1440, light + dark | does the card read as a standing reminder rather than an alert, and clear surrounding chrome | no automatable observable |
| M2 | Duplication on the landing route | visual/subjective | — | manual-only | landing route with onboarding incomplete | is the accepted D3 duplication tolerable in practice | the decision this change explicitly upheld; worth a human look post-merge |
| M3 | Real transient-overlay stacking | visual/subjective | — | manual-only | ≥2 concurrent worktree inits with onboarding incomplete | does `WorktreeInitStack` visually win the shared corner | the real observable E18 only proxies |

---

## Coverage summary

- Requirements covered: 9/9
- Scenarios by class: edge 18 · frontend-quirk 15 · error-handling 6 · integration 5 · regression 3 · manual 3
- Scenarios by level: L1 41 · L2 0 · L3 6 · manual-only 3
- Scenarios by disposition: **automated 47** · **manual-only 3**

No L2 rows: this change touches no install, spawn, process, or multi-OS runtime
surface, so the qa/ smoke tier has nothing to assert. Routing a UI change there
would violate the rendered-UI-vs-smoke boundary.

## New infra needed

- None for the automated rows. All L1 rows extend existing vitest suites; all six
  L3 rows extend the existing Playwright + docker-harness tier.
- **Not built (deliberate):** a harness capable of staging ≥2 concurrent worktree
  inits, which is what a real E18 would need. M3 carries that check manually
  instead.

---

## Moved out of this change

Scenarios **X5, D1, D2, D3, D4, D5** covered the `provider-auth-event` dispatcher.
The dispatcher was split into its own change, `dispatch-provider-auth-event`,
because it fixes a live bug in the shipped `LandingPage` independently of this
work. Those rows now live in `openspec/changes/dispatch-provider-auth-event/test-plan.md`
with their ids preserved. #X6 (endpoint-failure readiness) stays here — it is a
`useOnboardingSteps` input test, not a dispatcher test.
