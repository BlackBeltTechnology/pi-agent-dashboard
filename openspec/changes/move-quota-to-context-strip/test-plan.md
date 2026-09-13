# Test Plan — move-quota-to-context-strip

Stage: apply   Generated: 2026-09-12

Requirement refs: **SS** = `specs/dashboard-shell-slots` (composer-context-group), **CV** = `specs/chat-view` (composer strip), **PQ** = `specs/provider-quota-surfacing` (widget), **PQ-D** = PQ dialog requirement.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | PQ no-data | EP (empty partition) | L1 | automated | `/api/quota` → `providers: []`, `session.model = "anthropic/claude-x"` | render `QuotaWidget` | container empty: no `quota-context-group`, no `quota-no-adapter-note`, no console error |
| E2 | PQ ≥1 window | EP (zero-window partition) | L1 | automated | `providers: [{provider:"anthropic", windows: []}]` | render | container empty (zero-window provider filtered, no group) |
| E3 | PQ every window inline | BVA (1 vs 2 windows) | L1 | automated | `anthropic` with windows `5h 14%` and `7d 32%` | render | `quota-chip-anthropic` text contains `5h`, `14%`, `7d`, `32%`; exactly 2 bar elements |
| E4 | PQ session provider ring | decision-table (found) | L1 | automated | `session.model="anthropic/claude-x"`, providers `[openai-codex, anthropic]` (registry order) | render | first chip is `quota-chip-anthropic` with `data-session-provider="true"`; `quota-chip-openai-codex` has `data-dimmed="true"`; no note |
| E5 | PQ no-adapter note | decision-table (defined, absent) | L1 | automated | `session.model="google-vertex/gemini-x"`, providers `[anthropic]` | render | `quota-no-adapter-note` text `gemini-x · no quota`, is not a `<button>`, precedes `quota-chip-anthropic`; that chip has `data-dimmed="true"` and no `data-session-provider` |
| E6 | PQ undefined provider | decision-table (undefined) | L1 | automated | `session.model = undefined`, providers `[anthropic, openai-codex]` | render | no chip has `data-session-provider` or `data-dimmed`; no note |
| E7 | PQ undefined provider | BVA (no `/`) | L1 | automated | `session.model = "my-alias"`, providers `[anthropic]` | render | same observable as E6 |
| E8 | PQ model id after first `/` | BVA (multiple `/`) | L1 | automated | `session.model = "google-vertex/publishers/google/models/gemini-x"`, providers `[anthropic]` | render | note text `publishers/google/models/gemini-x · no quota`; `providerForModel` returns `google-vertex` |
| E9 | PQ `providerForModel` | EP | L1 | automated | `"anthropic/x"`, `"openai-codex/x"`, `undefined`, `"my-alias"`, `"a/b/c"` | call helper | `anthropic`, `openai-codex`, `undefined`, `undefined`, `a` |
| E10 | PQ stale | decision-table (stale flag) | L1 | automated | `anthropic` with `stale: true`, windows `[5h 14%]` | render | `quota-chip-anthropic` has `data-stale="true"`, contains the `not live` text, bar fill uses the muted severity |
| E11 | PQ chip has no model id | negative | L1 | automated | `session.model="anthropic/claude-sonnet-4"`, providers `[anthropic]` | render | `quota-chip-anthropic` text does not contain `claude-sonnet-4` |
| E12 | SS priority ordering | decision-table (2 claims) | L1 | automated | two `composer-context-group` claims: plugin `b` priority 10, plugin `a` priority 20 | render `ComposerContextGroupSlot` | DOM order: `a`'s node before `b`'s node |
| E13 | SS empty contribution | EP | L1 | automated | one claim whose component returns `null` | render slot | slot container has zero child elements (no divider, no label) |
| E14 | SS `shouldRender` predicate | decision-table | L1 | automated | claim with `shouldRender` predicate returning `false` for `session.id === "s1"` | render slot with session `s1` | claim node absent; with `s2` present (mirror of the `ContentInlineFooterSlot` case) |
| E15 | SS `ComposerContextGroup` primitive | EP | L1 | automated | `<ComposerContextGroup label="Quota" testId="g">child</ComposerContextGroup>` | render | root `[data-testid=g]` has classes `inline-flex` + `shrink-0`; contains an `aria-hidden` divider, then `[data-testid=g-label]` with text `Quota` and `uppercase` class, then `child` |
| E16 | SS taxonomy | type-level | L1 | automated | `SLOT_DEFINITIONS["composer-context-group"]` | existing taxonomy test | `multiplicity === "many"`, `payloadTier === "react-only"`; `SlotPredicateInput<"composer-context-group">` is `DashboardSession` (compile-time assertion in existing type test) |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | CV position | DOM-order | L1 | automated | `ComposerSessionActions` with worktree session + a fake `composer-context-group` claim rendering `<ComposerContextGroup label="Quota" testId="quota-context-group">` + a `session-card-badge` claim | render | `compareDocumentPosition`: `composer-git-group` precedes `quota-context-group` precedes the STATUS group label |
| F2 | CV not streaming-gated | state-transition (streaming) | L1 | automated | same as F1, session `status = "streaming"`, fake group contains a `<button>` | render | fake group's button `disabled === false`; `Explore` / `Archive` `disabled === true`; refresh enabled |
| F3 | CV guard | decision-table (all host groups off) | L1 | automated | session with `gitWorktree` undefined, `openspecHasDir=false`, `openspecPending=false`, no badge claim, one `composer-context-group` claim | render | strip renders (not `null`) and contains the fake group; with the claim removed → renders `null` (existing behaviour) |
| F4 | CV host markup unchanged | regression | L1 | automated | existing `ComposerSessionActions.test.tsx` cases | run suite | all existing assertions on `composer-git-group`, `composer-git-group-label`, OpenSpec buttons still pass |
| F5 | SS/CV no claim | EP | L1 | automated | `ComposerSessionActions` with no `composer-context-group` claim | render | no element with class `inline-flex shrink-0` besides host groups; strip child count equals pre-change count |
| F6 | PQ re-derived on model change | state-convergence | L1 | automated | render with `session.model="anthropic/x"`, providers `[anthropic, openai-codex]`; rerender with `session.model="openai-codex/y"` | rerender | after rerender first chip is `quota-chip-openai-codex` with `data-session-provider="true"`; `quota-chip-anthropic` has `data-dimmed="true"` — no click, no timer |
| F7 | PQ + CV end-to-end | rendered UI (stubbed API) | L3 | automated | harness session open; `page.route("**/api/quota")` → `{providers:[{provider:"anthropic", windows:[{label:"5h",usedPercent:14,...},{label:"7d",usedPercent:32,...}]}], unavailable:[]}` | open chat view | inside `composer-context-strip`: `quota-context-group` visible, `quota-chip-anthropic` text has `14%` and `32%`; `content-inline-footer` region contains no `quota-chip-*` |
| F8 | PQ-D click opens dialog | rendered UI | L3 | automated | as F7 | click `quota-chip-anthropic` | `role=dialog[aria-modal]` visible with the Anthropic card; `Escape` closes it |
| F9 | CV wrap safety | rendered UI (viewport) | L3 | automated | as F7, viewport `900×800`, session with worktree so OPENSPEC + GIT + QUOTA render | open chat view | `quota-context-group-label` bounding-box `y` equals the `y` of the first `quota-chip-*` (same line); group `x` ≥ 0 |
| F10 | CV strip on 375px | visual | — | manual-only | 2 providers enabled, viewport 375px | human looks | [judgment: strip wraps acceptably, quota group readable; note any horizontal clipping — accepted trade-off in design Risks] |
| F11 | PQ live model switch | rendered UI (bridge) | — | manual-only | live session, switch model in composer selector `anthropic → openai-codex` | human observes | [judgment: ring moves within one render; depends on live bridge `session.model` update — not stubbable in harness] |
| F12 | PQ visual parity with host groups | visual | — | manual-only | quota group next to GIT | human looks | [judgment: label size/colour/divider gutter indistinguishable from GIT group] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | PQ degrade | fault-injection (abort) | L1 | automated | `/api/quota` fetch rejects (network error) | render `QuotaWidget` | renders nothing; no thrown error; no `quota-context-group` |
| X2 | PQ degrade | fault-injection (malformed) | L1 | automated | `/api/quota` → `{}` (no `providers` key) | render | renders nothing; no thrown error |
| X3 | PQ degrade in strip | fault-injection (abort, rendered) | L3 | automated | `page.route("**/api/quota")` → `route.abort()` | open chat view | `composer-context-strip` visible with GIT group; no `quota-context-group`; page has no uncaught exception (`page.on("pageerror")` count 0) |
| X4 | PQ i18n | localization | L1 | automated | `catalog["zh-CN"]` and `catalog["hu"]` | key-parity test (existing pattern) | new keys (`quota`, `noQuota`, chip aria key) present in both locales |

### Performance

_None — no latency/throughput budget in the spec; the widget renders ≤7 chips from an already-polled endpoint._

---

## Coverage summary

- Requirements covered: 4/4 (SS slot req, SS taxonomy, CV strip req, PQ widget req + PQ dialog req)
- Scenarios by class: edge 16 · perf 0 · frontend 12 · error 4
- Scenarios by level: L1 25 · L2 0 · L3 4 · — 3
- Scenarios by disposition: automated 29 · manual-only 3

## New infra needed

- none. L3 rows use the existing `page.route` stub pattern (`tests/e2e/blackhole-settings.spec.ts`) and the existing `composer-context-strip` assertion (`tests/e2e/route-backed-overlay.spec.ts`).
