# test-plan — add-route-backed-overlay-dialogs

Stage: `apply` (tasks.md present) → **SOFT gate**. Unfillable Triple slots are
marked `[NEEDS CLARIFICATION]` inline and banner-listed below rather than
blocking.

Levels: **L1** `packages/*/src/**/__tests__/*.test.ts` (vitest) · **L2**
`qa/tests/*.sh|.ps1` (process/CLI smoke, NO rendered-UI asserts) · **L3**
`tests/e2e/*.spec.ts` (Playwright vs the docker harness; port is hash-derived
into `.pi-test-harness.json` `dashboardPort` — never hardcode `:18000`).

## Clarification banner

| # | Slot | Question |
|---|---|---|
| ~~C1~~ | observable | **CLOSED by the D1 revision (option C).** The backdrop is a scrim over the pinned background underlay — the frozen launching route in-app, or `computeBackTarget(currentRoute)` on a cold load. The "lower-priority branch" objection is resolved by amending `shell-overlay-route:99,145` and `url-routing:5,7` to forbid a branch **derived from the current location**; the underlay is derived from a frozen path. S-07's observable is now pinnable. |
| C2 | trigger | **Dismissal unwind depth.** D1a says dismissal SHALL "unwind the surface's own pushed entries, or navigate directly to the tracked launching route" — two different mechanisms with different observables (does the forward entry survive? is scroll restored?). S-09/S-10 assert the destination only until one is chosen. |
| C3 | input | **Dirty-guard owner** (design Open Question 1): renderer-level (every overlay gets it) vs panel-level (only surfaces with a dirty concept). Decides whether S-14 applies to plugin claims at all. |
| C4 | input | **Resource scope-switch shape** (design Open Question 2): one panel with a filter control vs two entry points with the scope preset. S-21/S-22 assert behaviour common to both; the distinguishing scenario cannot be written yet. |
| C5 | threshold | **No latency/memory budget is stated anywhere** in proposal or design. S-26/S-27 use provisional thresholds; they are guesses, not spec-derived, and must be confirmed or the rows dropped. |

## Scenarios

### Claim contract — `presentation` (decision table + EP)

| id | class | technique | level | disposition | input · trigger · observable |
|---|---|---|---|---|---|
| S-01 | edge-case | EP (valid partition) | L1 | automated | claim manifest with `presentation: "dialog"` · manifest validator runs · validation succeeds, normalised claim carries `presentation === "dialog"` |
| S-02 | edge-case | EP (valid partition) | L1 | automated | claim with `presentation: "page"` · validator runs · succeeds, `presentation === "page"` on the `ClaimEntry` |
| S-03 | edge-case | EP (invalid partition) | L1 | automated | claim with `presentation: "modal"` · validator runs · throws `ManifestValidationError` naming claim index and the accepted values; NOT defaulted to `"dialog"` |
| S-04 | edge-case | EP (omitted) | L1 | automated | claim with no `presentation` key · validator runs · succeeds; the shell renders it as a dialog (default applied at render, not baked into the manifest) |
| S-05 | error-handling | invalid type | L1 | automated | claim with `presentation: 42` (non-string) · validator runs · throws `ManifestValidationError`, does not coerce |
| S-06 | edge-case | codegen round-trip | L1 | automated | manifest declaring `presentation: "page"` · `NODE_ENV=production` registry codegen runs · generated `plugin-registry.tsx` emits `presentation: "page"` as a top-level `ClaimEntry` field, and contains no `demo` fixture plugin |

### Overlay container rendering

| id | class | technique | level | disposition | input · trigger · observable |
|---|---|---|---|---|---|
| S-07 | frontend-quirk | state-transition | L3 | automated | desktop viewport at `/session/<id>` · navigate to `/settings/general` · settings surface renders in a dialog over a scrim over the pinned underlay; URL is exactly `/settings/general` |
| S-08 | frontend-quirk | invariant | L3 | automated | desktop viewport, opened `/settings/general` from `/session/<id>` · surface rendered · session detail IS present as the underlay, `aria-hidden` + non-interactive, and is derived from the FROZEN path — exactly one branch is derived from the current location (**rewritten by the D1 revision; the pre-revision row asserted the opposite**) |
| S-08b | edge-case | cold-load boundary | L3 | automated | fresh `page.goto("/settings/security")`, no captured background · render · the underlay is synthesized from `computeBackTarget("/settings/security")`, not blank and not a second URL-derived branch |
| S-08c | error-handling | frozen-path invalidation | L3 | automated | overlay open with `/session/<id>` pinned as background · that session ends while the overlay is open · underlay may go stale behind the scrim, but dismissal still resolves through normal route matching and does not hang or blank the app |
| S-09 | frontend-quirk | state-transition | L3 | automated | opened `/settings/general` from `/session/<id>` · press `Esc` · URL returns to `/session/<id>` and chat renders `[NEEDS CLARIFICATION: trigger — C2 unwind mechanism]` |
| S-10 | frontend-quirk | state-transition (illegal edge) | L3 | automated | opened `/settings/general` from `/session/<id>`, then navigated in-panel to `/settings/plugins/<id>` (a history PUSH) · press `Esc` once · URL returns to `/session/<id>`, NOT `/settings/general`; surface fully dismissed |
| S-11 | edge-case | cold-load boundary | L3 | automated | fresh `page.goto("/settings/security")`, no in-app predecessor · invoke dismissal · target resolved from the `RouteDescriptor` table; dismissal is not a no-op and does not leave the surface open |
| S-12 | frontend-quirk | state-transition | L3 | automated | at `/settings/gateway` · navigate to `/tunnel-setup` · exactly one route-backed overlay is mounted; the settings surface is NOT mounted simultaneously |
| S-13 | frontend-quirk | state-transition | L3 | automated | opened `/tunnel-setup` from `/settings/gateway` · dismiss · URL returns to `/settings/gateway` and settings renders |

### Dirty-state guard

| id | class | technique | level | disposition | input · trigger · observable |
|---|---|---|---|---|---|
| S-14 | error-handling | state-transition (guarded edge) | L3 | automated | settings Instructions page with an unsaved edit · click the backdrop · a discard prompt appears; edit is NOT discarded without confirmation `[NEEDS CLARIFICATION: input — C3 guard owner]` |
| S-15 | error-handling | state-transition | L3 | automated | same, unsaved edit · press `Esc` · discard prompt appears |
| S-16 | edge-case | negative case | L3 | automated | settings open with NO unsaved edits · press `Esc` · surface closes immediately, no prompt |
| S-17 | error-handling | regression pin | L3 | automated | opened settings from `/session/<id>`, unsaved edit · dismiss, then confirm discard · URL becomes `/session/<id>`, NOT `/` (today `SettingsPanel.tsx:899` hardcodes `setPendingNav("/")`) |
| S-18 | error-handling | coverage gap pin | L3 | automated | `/folder/<cwd>/settings/instructions` with an unsaved edit (own dirty state, does not thread through `SettingsPanel`) · dismiss via backdrop · discard prompt appears |

### Back-target correctness (the defect class that already bit twice)

| id | class | technique | level | disposition | input · trigger · observable |
|---|---|---|---|---|---|
| S-19 | edge-case | boundary (depth predicate) | L1 | automated | claim `path: "/folder/:encodedCwd/thing"`, `depth: 1`, predecessor `/folder/<cwd>` (depth 1) · `goBack` · resolves to `/` — pins WHY nested claims must not declare depth 1 (strictly-shallower fast-path fails) |
| S-20 | edge-case | registry walk, both paths | L1 | automated | every `shell-overlay-route` claim in the generated registry that is nested under `/folder/:cwd` or `/session/:id` · resolve back on the in-app path (tracked parent) and the cold-load path (no predecessor) · both resolve to the claim's owning parent; neither yields `/` |
| S-21 | edge-case | uninterpolable parent | L1 | automated | claim `path: "/x/run/:sid"`, `parentPath: "/folder/:encodedCwd/y"` · manifest scan test runs · fails, reporting `:encodedCwd` cannot be supplied by the claim's own path |
| S-22 | edge-case | vacuity guard | L1 | automated | manifest scan returns an empty claim list (discovery bug) · scan test runs · test FAILS rather than passing over zero claims |
| S-23 | frontend-quirk | state-transition | L3 | automated | mobile viewport, opened `/folder/<cwd>/goals` from `/folder/<cwd>` · swipe-back · returns to `/folder/<cwd>`, NOT `/` |
| S-24 | edge-case | three-level hierarchy limit | L1 | automated | at `/folder/<cwd>/automations/run/<sid>` (depth 2) with the board (depth 2) as tracked predecessor · `goBack` · navigates to the board via `computeParent`; `history.back()` is NOT used (pins the accepted R7 trade-off) |

### Resource surface dedupe

| id | class | technique | level | disposition | input · trigger · observable |
|---|---|---|---|---|---|
| S-25 | edge-case | decision table (scope × path) | L3 | automated | each of the 10 paths `/settings/{skills,agents,extensions,prompts,themes}` and `/folder/<cwd>/settings/{same 5}` · open each · each renders the resource type named in its path; none 404s or falls through to the card list `[NEEDS CLARIFICATION: input — C4 scope-switch shape]` |
| S-26 | edge-case | invariant | L3 | automated | any resource route open as an overlay · surface renders · exactly one `ResourceGridPanel` is mounted for that route |
| S-27 | edge-case | decision table | L3 | automated | `/settings/skills` vs `/folder/<cwd>/settings/skills` · open each · global shows global scope with the scope filter hidden; folder shows local+global with the filter present |

### Lifecycle / performance

| id | class | technique | level | disposition | input · trigger · observable |
|---|---|---|---|---|---|
| S-28 | performance | resource-release invariant | L1 | automated | a converted surface holding a live subscription · dismiss it · the surface unmounts and its subscription is released (assert unsubscribe call, not a timer). **Re-scoped by the D1 revision:** scope is release-on-dismiss only — an OPEN overlay now deliberately retains the pinned underlay's subscriptions, so "nothing live behind an open overlay" is NOT asserted |
| S-29 | performance | tail latency | L3 | automated | desktop, session open · open and dismiss the settings overlay 20× · p95 open-to-rendered stays under a stated budget `[NEEDS CLARIFICATION: threshold — C5 no budget stated in spec]` |
| S-30 | performance | soak / leak | L2 | automated | open+dismiss each converted surface 100× in one session · measure RSS before/after · growth stays under a stated budget `[NEEDS CLARIFICATION: threshold — C5]` |

### URL-preservation gate (the change's falsification test)

| id | class | technique | level | disposition | input · trigger · observable |
|---|---|---|---|---|---|
| S-31 | edge-case | full-suite invariant | L3 | automated | the existing e2e suite, unmodified · run against the converted build · passes with ZERO `goto(...)` target edits — any required edit falsifies D1 and stops the change (task 8.2) |
| S-32 | error-handling | fault injection | L3 | automated | deep-link `/folder/<cwd>/view?path=<missing-file>` as an overlay · open · the overlay renders its error/fallback state rather than a blank dialog or an unhandled rejection |

### Pairing (contract 4 — must not regress)

| id | class | technique | level | disposition | input · trigger · observable |
|---|---|---|---|---|---|
| S-33 | error-handling | state-transition + TTL | L3 | automated | a live one-time pairing code issued from the gateway surface · navigate away to another converted overlay and back · the code is either still valid within its TTL or cleanly re-issued; never silently dead |
| S-34 | edge-case | route-guard invariant | L1 | automated | every converted route path · check against `guardPairingUrls` · no pairing affordance is reachable on a path that bypasses the guard |

### Manual-only

| id | class | technique | level | disposition | input · trigger · observable |
|---|---|---|---|---|---|
| S-35 | frontend-quirk | subjective judgment | — | **manual-only** | each converted surface on a real phone · open and dismiss · the slide-in and swipe-back feel native, with no visual jank at the dialog/depth-panel boundary |
| S-36 | frontend-quirk | subjective judgment | — | **manual-only** | the settings overlay at desktop widths · open · the scoped container reads as an overlay rather than a cramped page; content is not visually truncated |

## New infra needed

None. S-30 is the only row without an obvious existing home — it extends the
`qa/` smoke tier with an RSS measurement, which that tier already supports.

## Coverage notes

- **C1 is closed** by the D1 revision, so what renders behind the dialog is now
  specified and directly assertable (S-08, S-08b). The six L3 rows that asserted
  URL and DOM-absence facts still hold, except S-08, which the revision inverts:
  it previously asserted the underlay was ABSENT.
- **New risk from the revision:** the underlay is a live tree on a frozen path.
  S-08c covers invalidation; the memory cost of the double mount is only
  indirectly covered by S-30, whose budget is still unstated (C5).
- **S-19/S-20/S-24 exist because the declaration-only guard test passed while the
  implementation regressed.** They assert resolved outcomes, not declarations.
