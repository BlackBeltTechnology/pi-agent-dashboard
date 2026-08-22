# Tasks — add-route-backed-overlay-dialogs

Groups 1–2 are **already implemented and verified** (2335 tests green, `tsc`
clean, zero new `kb dox lint` findings). They are the contract and manifest
layer; `presentation` is inert until group 4 lands a consumer.

Groups 3+ are unstarted. **Sequencing note (R5) — RESOLVED, cycle 2:**
`collapse-pairing-into-gateway` has NOT landed and has not started (0/62 tasks, no
worktree, only its planning commit `44dba2291` on develop; `PairingView.tsx` and
`QrCodeDialog.tsx` are both still on disk). Waiting for a 62-task change is not
viable, so **task 5.5 is mandatory** — and is generalised rather than
special-cased (see 5.5). That change will rebase around group 5's
`SettingsPanel.tsx` edits.

## 1. Plugin claim contract — `presentation`

- [x] 1.1 Add `presentation?: "page" | "dialog"` to `PluginClaim` in `packages/shared/src/dashboard-plugin/manifest-types.ts`, documenting the default (`"dialog"`) and the mobile opt-out (D3a)
- [x] 1.2 Add `presentation` to `ClaimEntry` in `packages/dashboard-plugin-runtime/src/slot-registry.ts`
- [x] 1.3 Validate `presentation` in `packages/dashboard-plugin-runtime/src/manifest-validator.ts` — FATAL on an unrecognised value, not warn-and-default (D3)
- [x] 1.4 Emit `presentation` from the registry codegen in `packages/dashboard-plugin-runtime/src/vite-plugin/index.ts`
- [x] 1.5 Regenerate `packages/client/src/generated/plugin-registry.tsx` with `NODE_ENV=production` (dev-mode regen injects the `demo` fixture plugin)

## 2. Bundled manifests declare reachable back targets

- [x] 2.1 Write `packages/shared/src/__tests__/overlay-claims-declare-depth.test.ts` — scans every bundled manifest for missing `depth`, `depth: 2` without `parentPath`, and uninterpolable `parentPath`; includes a vacuity guard. Verify it fails before the fixes
- [x] 2.2 `goal-plugin`: board → `depth: 2` + `parentPath: /folder/:encodedCwd`; detail → `depth: 2` + `parentPath: /folder/:encodedCwd/goals`
- [x] 2.3 `kb-plugin`: `depth: 2` + `parentPath: /folder/:encodedCwd`
- [x] 2.4 `subagents-plugin`: `depth: 2` + `parentPath: /session/:sessionId`
- [x] 2.5 Re-parent the automation run monitor to `/folder/:encodedCwd/automations/run/:sid` so its `parentPath` is interpolable (D4b); update `AutomationRunMonitor.tsx`, `client/index.tsx`, `docs/architecture.md`, and the `route-descriptor.ts` stale example
- [x] 2.6 Update the tests that pinned the old shape: `route-descriptors.test.ts` (degradation case → synthetic path), `back-target.test.ts` (cold-load now resolves to the board), `back-regression.test.ts`
- [x] 2.7 Confirm the guard test is green and no new `kb dox lint` findings were introduced
- [x] 2.8 **Regression fix.** The first attempt declared the Goals/KB boards `depth: 1`, which was WORSE than declaring nothing: the omitted-depth default is 2, which satisfies the strictly-shallower history fast-path against a depth-1 folder, while an explicit 1 loses it and resolves to `/`. Corrected to `depth: 2` + `parentPath`
- [x] 2.9 `automation-plugin`: board → `depth: 2` + `parentPath: /folder/:encodedCwd` for consistency with Goals/KB; update the shipped `back-target.test.ts` / `back-regression.test.ts` fixtures and the `url-routing` scenario that pinned `depth: 1 → /`
- [x] 2.10 Add `packages/client/src/lib/nav/__tests__/overlay-claim-back-targets.test.ts` — walks the REAL generated registry and resolves each nested claim's back action through `computeBackTarget`/`goBack` on both the in-app and cold-load paths. Catches the `depth: 1`-under-a-depth-1-parent and uninterpolable-`parentPath` classes, which the manifest-scan test cannot. **Known limit:** the expectation is derived from the claim's own declared `parentPath`, so a semantically wrong but interpolable `parentPath` still passes

## 3. Route-backed overlay renderer

- [x] 3.1 Build the route-backed overlay renderer: desktop `Dialog` over a scrim over a **pinned background underlay**, mobile falls through to `MobileShell` depth. This is a NEW mechanism — `OpenSpecArtifactDialog` is local-state and is not a reusable precedent (D1)
- [x] 3.1a Capture and freeze the background path at navigation time. wouter has no `location.state` background idiom — render the underlay through a nested `<Router hook={memoryLocation({ path, static: true }).hook}>` so it reads the frozen path, never `window.location` (D1)
- [x] 3.1b Cold-load background: no captured background → synthesize from `computeBackTarget(currentRoute)`; `/` → card list. Never render a second branch derived from the current location (D1)
- [ ] 3.2 Implement dismissal as "leave this surface", NOT a single `history.back()` — unwind the surface's own pushed entries or navigate to the tracked launching route (D1a)
- [ ] 3.3 Implement the cold-load dismissal path: no tracked predecessor → resolve the target from the `RouteDescriptor` table, never a no-op
- [ ] 3.4 Ensure lazy mount on match and full unmount on dismissal — no retained subscriptions or polling behind a closed overlay (R4)
- [x] 3.5 Confirm exactly ONE branch is derived from the current location; the underlay is derived from the frozen path only. `shell-overlay-route:99,145` and `url-routing:5,7` are amended to "derived from the current location" — verify the amended wording holds, not the old wording
- [x] 3.6 ~~Backdrop treatment~~ **RESOLVED by D1 revision** (scrim over the pinned underlay, in-app and cold-load alike). Closes test-plan C1
- [ ] 3.9 Make the underlay `aria-hidden`, outside the overlay focus trap, and non-interactive; retain its scroll position for the overlay's lifetime (D1 cost)
- [ ] 3.10 Handle a frozen background path that goes invalid mid-overlay (session ends / folder removed): underlay may go stale behind the scrim, but dismissal SHALL still resolve through normal route matching (D1 open question)
- [x] 3.7 Use an existing `--z-*` token rather than a raw z-index so `scripts/z-layer-lint.mjs` stays green
- [x] 3.8 Unit-test the renderer against the `url-routing` "Route-backed overlay container" scenarios

## 4. Plugin overlays render as dialogs

- [x] 4.1 Make `ShellOverlayRouteSlot` in `packages/dashboard-plugin-runtime/src/slot-consumers.tsx` select its container from the claim's effective `presentation` — converts Automation, Goals, KB, and the subagent popout (D2). `flows-plugin` declares no such claim. **NOT a single edit (D2a):** the container is INJECTED via a `dialogContainer` prop, because `client-utils` (home of `Dialog`) already depends on this package and importing it back would be a cycle. Defaults to the page container when nothing is injected
- [x] 4.2 Preserve the existing height-propagation wrapper contract for both containers
- [x] 4.3 Honour `presentation: "page"` on desktop **and** mobile (D3a) — full viewport, outside the `MobileShell` panel. Desktop falls out of 4.1 (no dialog container → page path); mobile via new `useShellOverlayRoutePresentation` + an early return in App.tsx before `MobileShell`. **Caveat:** the mobile branch itself is only covered by `tsc` and the hook unit tests — no bundled claim declares `presentation: "page"`, so it has no runtime exercise until 4.7 adds an e2e canary
- [x] 4.4 Confirm the mobile path still walks the depth table, so group 2's declarations remain load-bearing (D4) — and that the SAME declarations now also feed the cold-load underlay (3.1b). First half already covered by `overlay-claim-back-targets.test.ts` (drives the real `goBack` over every registry claim) and by App.tsx wiring `pluginOverlayMatched` into `hasOverlayRoute` → mobile depth 2; second half pinned by the new `overlay-claim-underlay.test.ts`
- [x] 4.5 Document `presentation` for plugin authors so the opt-out is discoverable (R3) — in `packages/dashboard-plugin-skill/.pi/skills/dashboard-plugin-scaffold/references/manifest-schema.md` (author-facing claim-field reference) plus runtime-internal facts in `docs/architecture.md`. Scope note: `shell-overlay-route` fields (`path`/`sessionParam`/`depth`/`parentPath`) were entirely undocumented for authors, so the full field set was added rather than `presentation` alone
- [x] 4.6 Enforce the reachable-back-target rules: every bundled claim declares an explicit `depth`; `depth: 2` requires `parentPath`; every `parentPath` is interpolable from its own path's `:params`; and a claim nested under `/folder/:cwd` or `/session/:id` must not declare `depth: 1`. **NOT in `validateManifest` (wording corrected, cycle 2):** the spec keeps `depth`/`parentPath` optional in the claim contract and states the runtime degradation to `/` "remains a safety net for third-party manifests" — making it fatal there would break third-party plugins that load today with a warning, and would still not satisfy the spec, which requires a repository scan test over BUNDLED manifests plus a non-vacuity assertion. Implemented as `bundled-overlay-claims.test.ts`
- [ ] 4.7 Extend e2e coverage of `shell-overlay-route` claims beyond the automation board (`tests/e2e/automation-fanout.spec.ts:94` is the only existing one); `blackhole-plugin`, the assumed canary, declares only a `settings-section` claim

## 5. Convert core surfaces

- [x] 5.0 **(added, cycle 2)** Extract `ShellContent` so the content branch re-derives under a frozen Router — the underlay is structurally impossible while App body fixes all 17 `useRoute` matches against the live URL. Desktop + mobile call sites use it, and `sessionDetail` is now `renderSessionDetail(id)` (shadowed `selected*` locals, no hooks inside, so conditional invocation is safe), so a frozen `/session/:id` underlay renders that session. **Untested gap:** no test yet drives App with a non-live session id — `ShellContent` unit tests cover branch selection, the App wiring is covered only by `tsc` until the group 8 e2e
- [x] 5.1 `/settings/:page/:sub?` onto the overlay renderer — DESKTOP only. The settings-panel spec requires a `MobileShell` depth-1 detail panel with swipe-back on mobile, so the mobile branch is unchanged by design. Validated against the docker harness: `blackhole-settings` 10/10, `overlay-layering` + `navigation` green. Gated on `!firstLaunchModal` — see the code comment for why
- [x] 5.2 `/folder/:cwd/settings/:page` onto the overlay renderer (desktop; mobile keeps its depth panel, as for 5.1). Required widening `isOverlayRoute` to the seven spec-listed surfaces — `isModalRoute` knows only two and must NOT be widened (it drives history semantics). Also fixed `ResourceTrustDialog` to join the shared escape stack. Harness: 29/29 green
- [x] 5.3 `/folder/:cwd/view?path=`, `/pi-view?url=`, `/pi-resource?path=` onto the overlay renderer (reparent `PreviewOverlayView`; desktop only, mobile keeps its depth panel). One container for all three. Forced design addendum **D1d**: the underlay and the dismissal target are two different values — `/pi-resource` is opened FROM a settings page, so dismissing to the background would drop the user out of settings, violating D5. `overlay-background.ts` now tracks `launcher` (cross-surface predecessor) alongside `captured`. Harness: 39 passed, 3 pre-existing failures reproduced on origin/develop
- [x] 5.4 `/tunnel-setup` as its own route-backed overlay; REPLACES rather than stacks on settings (D5). Verified in `tests/e2e/route-backed-overlay.spec.ts` (S-12 + S-12b mirror), proven fails-closed by forcing settings to mount at `/tunnel-setup` — turns S-12/S-13 red. **S-13 is cold-load only**: no in-app affordance navigates to `/tunnel-setup` anywhere in the repo, so 'dismiss returns to `/settings/gateway`' has no user path to drive today; the launcher resolution is pinned at unit level instead (D1d). Pre-existing `zrok-v2-tunnel.spec.ts` passes unchanged, confirming the container swap needs no `goto` edits
- [x] 5.5 **MANDATORY (R5 resolved).** Navigation to a route the OPEN overlay already owns switches the surface in place instead of remounting. **Needed NO code change** — the container is rendered as a plain conditional with no `key`, so React preserves the mount across an in-panel navigation, and the frozen background is held by a `useMemo` on (path, search) that an in-overlay move does not churn. The rule was satisfied by construction; what it lacked was any test proving it, which is 5.5a. `PairingView.tsx:168`'s one-time-code TTL is safe by the same mechanism
- [x] 5.5a Tested the GENERAL rule in `tests/e2e/route-backed-overlay.spec.ts`: an in-panel navigate to a sibling settings page preserves BOTH the container mount and the underlay (DOM-expando remount probe — visibility would pass either way and prove nothing), still exactly one dialog. Proven fails-closed by keying the container on location: turns ONLY this test red. The 'non-owned target dismisses' half has no in-app path to drive — the underlay is `inert`, so nothing behind the overlay is clickable; that branch is pinned by route matching (S-12b) and dismissal (S-13) instead, and there is a test asserting the inertness that makes it so
- [x] 5.6 **Wording corrected (cycle 2) — 'delete the duplicate full-page path' was wrong.** The two readers are not duplicates: `OpenSpecPreview` drives its tabs through the URL and serves the deep link AND mobile (pinned by E9), while `OpenSpecArtifactDialog` is deliberately URL-less (pinned by F1/F2/F7); `url-routing` also requires the route's deep link be preserved exactly. Deleting either deletes a pinned behaviour. Done instead: the ROUTE gets a `RouteBackedOverlay` on desktop keeping `OpenSpecPreview` as its content, mobile keeps the full page, the ephemeral dialog is untouched — which delivers D6's actual goal. D6 rewritten with the evidence. Follow-up left open: both readers wrap `useOpenSpecReader` + `MarkdownPreviewView` with near-identical waiting/not-found branches; collapsing that shared BODY is safe but is a no-user-effect refactor and this change is already large
- [x] 5.7 Confirmed `/folder/:cwd/openspec`, `/session/:id/diff`, `/session/:id/editor` and `/pair` are untouched — and PINNED rather than grepped: a new `5.7 — routes that stay full pages` block asserts each is not an overlay route, that their descriptor depths are unchanged, and that diff/editor still resolve back to their owning session. Proven fails-closed (widening the openspec rule to the board turns 4 tests red). `/pair` needs no test — `main.tsx` branches on it BEFORE `<App/>` mounts (D8) and the file is byte-identical to develop
- [x] 5.8 **Zero depths changed.** The only descriptor edit in the whole change adds `computeParent: parentFolder` to `/folder/:cwd/settings` and `/folder/:cwd/settings/:page`, narrowing a parent that previously degraded to `/`; both stay depth 1, so no path moved. Pinned by the depth assertions in the 5.7 block

## 6. Dirty-state guard (R1 — highest severity)

- [x] 6.1 Failing tests written first at both levels: `overlay-dismiss-guard.test.tsx` (backdrop, Escape and ✕ each intercepted; clean surface unaffected; guard released on save and on unmount) and 3 tests in `InstructionsPage.test.tsx`. Proven fails-closed — disarming the guard turns exactly the two dirty tests red
- [x] 6.2 `SettingsPanel` arms the container guard via `useOverlayDismissGuard(isDirty, requestBack)`, routing backdrop/Escape/✕ through the SAME prompt as the back arrow. Container seam is `overlay-dismiss-guard.tsx` — panel-level opt-in per C3, so plugin claims are unaffected and the container stays ignorant of what "dirty" means
- [x] 6.3 The popstate guard's hardcoded `setPendingNav("/")` is now `setPendingNav(BACK_SENTINEL)`, so a confirmed discard returns to the LAUNCHING route instead of evicting to the card list (D1b). The back arrow already used the sentinel — only the browser-back path was still hardcoded
- [x] 6.4 `InstructionsPage` arms the guard itself through a local `useOverlayLeaveConfirm` hook (it owns its dirty state and does not thread through `SettingsPanel`). `DirectorySettings` needed no change — it holds no dirty state, contrary to the task's original wording
- [x] 6.5 Clean-surface dismissal pinned at both levels: unit (guarded panel while clean, and a panel that never opts in) and e2e (`dismissing a CLEAN settings overlay leaves immediately, with no prompt`)

## 7. Resource surface dedupe

- [x] 7.1 `ScopedResourceGrid` (`packages/client/src/components/resource/ScopedResourceGrid.tsx`) is now the single wiring: it derives the scope set, filter visibility, the `◇ global` pill and the `/pi-resource` file-view target from the matched route, so both entry points cannot disagree about what folder scope means. The caller keeps the `usePiResources` fetch (the folder nav counts share it). Retired the two byte-identical page→type maps in favour of one `RESOURCE_PAGE_TYPE`, and dropped `DirectorySettings`' now-orphaned `onViewFile` prop plus its 3 call sites. Survey correction: `ResourceGridPanel` was ALREADY shared — the duplication was the call-site wiring, not the component
- [x] 7.2 All ten paths verified by `tests/e2e/resource-scope-routes.spec.ts` (S-25): each renders the resource type its OWN path names, asserted on `data-type` rather than mere grid presence, and the URL is unchanged (no redirect, no fallthrough)
- [x] 7.3 Exactly one `resource-grid-panel` per matched route, asserted in the same spec — a second mount would mean the underlay is rendering a live grid behind the dialog. Scope-preset assertions included and proven fails-closed: forcing global scope turns exactly the 5 folder tests red while the 5 global stay green

## 8. Verification

- [x] 8.1 CI is the gate, now CONFIRMED by observation rather than assumed: `playwright.config.ts:20` sets `globalTimeout: 15 * 60_000`, so a local full run stops at exactly 15.0m with ~396 tests unrun. Ran the suite in 6 shards instead. Every failure was chased to a baseline built from the exact merge-base (`22fe62c79`) — **25 tests across 7 areas are red on develop already**: `openspec-board-drop*` (17), `openspec-artifact-dialog` F3/F4 (2), `editor-pane` (2), `file-preview-survives-churn` (1), `automation-fanout` F5 (1), `bus-client-goal-plugin-action` (1), `change-summary-table` (1). Zero failures attributable to this change. Session-spawning specs additionally fail under machine load and pass on a fresh harness — sharded runs against one long-lived harness are NOT a trustworthy signal
- [x] 8.2 **D1 holds.** No `goto(...)` target needed editing: `git diff origin/develop...HEAD -- tests/e2e` deletes zero lines, and every added `goto` is inside a spec this change ADDED (`route-backed-overlay`, `resource-scope-routes`). The `blackhole-settings` diff is purely additive (0 deleted lines). Existing specs walk the same URLs against dialog containers, which is the whole claim
- [x] 8.3 **"Containers change, URLs do not" holds against the route table.** `back-target.ts` changes ZERO `pattern:` entries (the only edit adds `computeParent` to the two folder-settings rows; depth unchanged), `route-builders.ts` is untouched, and no `goto(...)` target moved (8.2). Mutual exclusion verified at `App.tsx:2456`: the desktop content region is gated on `!settingsMatch && !tunnelSetupMatch && !folderSettingsMatch && !previewOverlayOpen && !openspecPreviewMatch`, so a converted route renders in the overlay or the content region, never both
- [x] 8.4 No pairing affordance moved onto an unguarded path and TLS `urls[]` handling is untouched: the diff contains zero pairing/QR/bearer/TLS lines (the only `pair` hits are `(path, search)` comments), `/pair` never enters the router (D8), and `guardPairingUrls` is applied to the payload inside `GatewayPairQR`, independent of container. Verified live rather than by inspection alone — 22/22 across `pairing-qr` (incl. the real `/pair` landing handshake), `gateway-qr-selector`, `gateway-url-action`, `gateway-primary-offer`, `gateway-readiness-board`
- [x] 8.5 Lazy mount + release on dismissal pinned by `overlay-lifecycle.test.tsx`: nothing mounts until the route matches; opening mounts the surface AND the underlay exactly once; dismissal runs effect cleanup for BOTH; an unrelated re-render remounts neither. Effect-cleanup counts are the observable, not DOM absence — R4's leak is an effect outliving its node. Proven fails-closed against the R4 anti-pattern (always-mounted container toggled by a prop): the lazy-mount and cleanup tests go red
- [x] 8.6 The renderer did NOT absorb the complexity — `RouteBackedOverlay` is 124 lines, `overlay-dismiss-guard` 62, `ScopedResourceGrid` 85, all at 0 biome findings. **But the honest answer is that App.tsx GREW by 185 lines (2517 → 2702) and the duplicate render sites persist**: `<DirectorySettings>` is still 3 and `<PreviewOverlayView>` still 6, exactly as on develop. The conversions added overlay wrappers ALONGSIDE the content-region copies rather than deleting them, and `ShellContent` moved route derivation out while the JSX stayed in App behind ~14 `renderX` callbacks. Correctness is guarded (8.3 mutual exclusion, and the e2e assert exactly one mount), but the duplication is gated, not removed. Logged as follow-up 9.5
- [x] 8.7 Independent read-only audit (`Audit` subagent) over the client, plugin-runtime and shared surface. **It found three defects I had missed, two of them in code written in this change.** Fixed here with red-first tests: (a) HIGH — `launcher` was cleared only by the explicit dismiss path, so leaving an overlay via browser Back stranded it and the NEXT overlay's Esc navigated to an abandoned surface; now cleared whenever a non-overlay route is captured. (b) HIGH — the dismiss guard was a single last-write-wins slot with unconditional deregistration, so an inner surface unmounting disarmed the outer one and the next Escape discarded unsaved settings silently (`SettingsPanel` + `InstructionsPage` is exactly that pairing); now an identity-scoped STACK where dismissal runs the topmost, matching the shared escape-stack. (c) MEDIUM — `dismissOverlay` was recreated every render and flowed into the guard context value; now `useCallback`. Also fixed a z-inversion this change caused: `SessionCard`'s `z-[60]` sheet sat strictly above every dialog once `Dialog` moved to the token, so it is now `z-dialog` (raw-z debt 42 → 41, baseline ratcheted). Remaining findings triaged below
- [ ] 8.8 Manual mobile pass: every converted surface still slides in as a depth panel with working swipe-back

## 9. Follow-ups (explicitly out of scope)

- [ ] 9.1 File a separate change for the orphaned automation run monitor — re-parenting fixed its back action, but no in-app producer navigates to it, so it is reachable by URL only (D4b)
- [ ] 9.2 File a separate change for `/session/:id/diff` and `/session/:id/editor` as `SplitWorkspace` panes

- [ ] 9.5 Collapse the gated duplicate render sites in `App.tsx` (task 8.6). The conversions left the content-region copies in place behind `!<overlay>Match` guards, so `<DirectorySettings>` appears 3x and `<PreviewOverlayView>` 6x and App.tsx net-grew by 185 lines. Correctness is guarded and tested; the cost is maintenance. Needs its own change because collapsing them means deciding whether `ShellContent` should own the JSX rather than ~14 `renderX` callbacks.

- [ ] 9.6 **Underlay fidelity for the desktop folder editor** (audit 8.7, high). `folderViewContent` renders OUTSIDE `ShellContent` from a live-URL `folderEditorCwd`, so a preview opened from `/folder/:cwd/editor` shows the LandingPage behind the scrim instead of the editor. The editor already unmounted on that navigation before this change (the preview was a full page), so this is underlay fidelity, not a new unmount — but fixing it means moving the desktop editor block into `ShellContent`, which is the same shape as follow-up 9.5.
- [ ] 9.7 **`aria-hidden` covers only the underlay** (audit 8.7, medium). `Dialog` portals to `document.body`, so chrome rendered outside `RouteBackedOverlay` (sidebar, session list, toast hosts) stays in the accessibility tree beside an `aria-modal="true"` dialog. Keyboard is contained by `useFocusTrap`, so this is screen-reader-only — but `aria-modal` with visible sibling content is exactly the case AT support handles inconsistently. Needs a body-level inert/aria-hidden strategy owned by `Dialog`, which is repo-wide.
- [ ] 9.8 **`resolveBackground` reads module state during render** (audit 8.7, medium). `overlay-background`'s state is written in an App effect and read during render with no subscription. It works because the location change that matters also re-renders, but the invariant is implicit and one capture call site outside App would break it. Move to `useSyncExternalStore` or hoist the capture into App state.
- [ ] 9.9 **Overlay open/close remounts the chat subtree** (audit 8.7, low). The underlay is a different tree position, so opening and dismissing an overlay over `/session/:id` remounts chat twice (scroll, lazy Monaco, virtualisation). Profile a large session before acting.

## 10. Tests — folded from test-plan.md

Every `automated` row in `test-plan.md` maps to exactly one task here; every
`manual-only` row maps to one task in group 11. Each carries a harness-exemplar
pointer to copy glue from, the scenario Triple, and its manifest id.

### 10a. Claim contract — L1 (`packages/dashboard-plugin-runtime/src/__tests__/manifest-validator.test.ts`)

- [x] 10.1 Valid `presentation: "dialog"` passes through to the normalised claim. Triple: claim with presentation dialog · validator runs · normalised claim carries presentation === "dialog" (test-plan #S-01). See `manifest-validator.test.ts`
- [x] 10.2 Valid `presentation: "page"` passes through. Triple: claim with presentation page · validator runs · `ClaimEntry.presentation === "page"` (test-plan #S-02). See `manifest-validator.test.ts`
- [x] 10.3 Unrecognised `presentation` is fatal, not warn-and-default. Triple: claim with presentation "modal" · validator runs · throws ManifestValidationError naming the accepted values (test-plan #S-03). See `manifest-validator.test.ts`
- [x] 10.4 Omitted `presentation` validates and is left undefined for the shell to default. Triple: claim with no presentation key · validator runs · succeeds, presentation undefined (test-plan #S-04). See `manifest-validator.test.ts`
- [x] 10.5 Non-string `presentation` is rejected rather than coerced. Triple: claim with presentation 42 · validator runs · throws ManifestValidationError (test-plan #S-05). See `manifest-validator.test.ts`
- [ ] 10.6 Registry codegen emits `presentation` and excludes the demo fixture. Triple: manifest with presentation page · NODE_ENV=production codegen runs · generated registry carries presentation top-level and contains no demo plugin (test-plan #S-06). See `packages/shared/src/__tests__/bundled-plugins-complete.test.ts` for the repo-scan idiom

### 10b. Overlay container — L3 (`tests/e2e/openspec-artifact-dialog.spec.ts` is the nearest dialog exemplar; `tests/e2e/overlay-layering.spec.ts` for layering; `tests/e2e/navigation.spec.ts` for route walking)

- [ ] 10.7 Settings renders in a dialog container on desktop. Triple: desktop viewport at /session/<id> · navigate to /settings/general · settings renders in a dialog, URL exactly /settings/general (test-plan #S-07, blocked on clarification C1). See `tests/e2e/openspec-artifact-dialog.spec.ts`
- [ ] 10.8 The underlay is the pinned background, not a second URL-derived branch. Triple: desktop at /settings/general opened from /session/<id> · surface rendered · session detail IS present as the underlay, `aria-hidden` and non-interactive, and is derived from the frozen path (navigating the URL to another overlay does not change it) (test-plan #S-08, rewritten by the D1 revision). See `tests/e2e/openspec-artifact-dialog.spec.ts`
- [ ] 10.8a Cold load synthesizes the underlay from the back target. Triple: fresh goto /settings/security, no predecessor · render · underlay matches `computeBackTarget("/settings/security")` (test-plan #S-08b, new). See `tests/e2e/navigation.spec.ts`
- [ ] 10.9 Esc returns to the launching route. Triple: opened /settings/general from /session/<id> · press Esc · URL returns to /session/<id> and chat renders (test-plan #S-09, see clarification C2). See `tests/e2e/navigation.spec.ts`
- [ ] 10.10 One dismissal leaves the surface even after an in-panel history push. Triple: opened /settings/general from /session/<id> then navigated to /settings/plugins/<id> · press Esc once · URL returns to /session/<id>, not /settings/general (test-plan #S-10). See `tests/e2e/plugin-settings-pages.spec.ts`
- [ ] 10.11 Cold-loaded surface dismisses via the descriptor table. Triple: fresh goto /settings/security with no predecessor · dismiss · resolves a defined target, not a no-op (test-plan #S-11). See `tests/e2e/navigation.spec.ts`
- [ ] 10.12 Route-backed surfaces replace rather than stack. Triple: at /settings/gateway · navigate to /tunnel-setup · exactly one overlay mounted, settings not mounted simultaneously (test-plan #S-12). See `tests/e2e/zrok-v2-tunnel.spec.ts`
- [ ] 10.13 Tunnel dismissal returns to settings. Triple: opened /tunnel-setup from /settings/gateway · dismiss · URL returns to /settings/gateway and settings renders (test-plan #S-13). See `tests/e2e/zrok-v2-tunnel.spec.ts`

### 10c. Dirty-state guard — L3 (`tests/e2e/plugin-settings-pages.spec.ts`)

- [ ] 10.14 Backdrop click with unsaved edits prompts. Triple: settings Instructions page with an unsaved edit · click backdrop · discard prompt appears, edit not discarded (test-plan #S-14, see clarification C3). See `tests/e2e/plugin-settings-pages.spec.ts`
- [ ] 10.15 Esc with unsaved edits prompts. Triple: same unsaved edit · press Esc · discard prompt appears (test-plan #S-15). See `tests/e2e/plugin-settings-pages.spec.ts`
- [ ] 10.16 Clean surface dismisses with no prompt. Triple: settings open with no unsaved edits · press Esc · closes immediately, no prompt (test-plan #S-16). See `tests/e2e/plugin-settings-pages.spec.ts`
- [ ] 10.17 Discard confirmation returns to the launching route, not the card list. Triple: opened settings from /session/<id>, unsaved edit · dismiss then confirm discard · URL becomes /session/<id>, not / (test-plan #S-17). See `tests/e2e/navigation.spec.ts`
- [ ] 10.18 Folder instructions editor is covered by the same guard. Triple: /folder/<cwd>/settings/instructions with an unsaved edit · dismiss via backdrop · discard prompt appears (test-plan #S-18). See `tests/e2e/directory-home.spec.ts`

### 10d. Back-target correctness — L1 (`packages/client/src/lib/nav/__tests__/overlay-claim-back-targets.test.ts`, `packages/client/src/lib/__tests__/back-target.test.ts`)

- [x] 10.19 A nested claim declared depth 1 resolves to `/`, pinning why nested claims use depth 2. Triple: claim /folder/:encodedCwd/thing depth 1, predecessor /folder/<cwd> depth 1 · goBack · resolves to / (test-plan #S-19). See `back-target.test.ts`
- [x] 10.20 Every nested registry claim resolves to its owning parent on both paths. Triple: each nested shell-overlay-route claim · resolve back in-app and cold-load · both reach the owning parent, neither yields / (test-plan #S-20). See `overlay-claim-back-targets.test.ts`
- [x] 10.21 An uninterpolable parentPath fails the manifest scan. Triple: claim /x/run/:sid with parentPath needing :encodedCwd · scan test runs · fails naming the unsuppliable param (test-plan #S-21). See `packages/shared/src/__tests__/overlay-claims-declare-depth.test.ts`
- [x] 10.22 The manifest scan is not vacuous. Triple: scan returns an empty claim list · scan test runs · fails rather than passing over zero claims (test-plan #S-22). See `overlay-claims-declare-depth.test.ts`
- [ ] 10.23 Mobile swipe-back from the Goals board returns to the folder. Triple: mobile, opened /folder/<cwd>/goals from /folder/<cwd> · swipe-back · returns to /folder/<cwd>, not / (test-plan #S-23). See `tests/e2e/gateway-board-mobile.spec.ts` for the mobile-viewport idiom
- [x] 10.24 Run monitor backs to its board via computeParent, pinning the R7 depth-model limit. Triple: at the run URL with the board as tracked predecessor · goBack · navigates to the board, history.back() not used (test-plan #S-24). See `packages/client/src/lib/__tests__/back-regression.test.ts`

### 10e. Resource dedupe — L3 (`tests/e2e/resource-activation-trust.spec.ts`)

- [ ] 10.25 All ten resource paths resolve to the type named in the path. Triple: each of the 10 settings/folder-settings resource paths · open each · renders its named type, none 404s or falls through (test-plan #S-25, see clarification C4). See `tests/e2e/resource-activation-trust.spec.ts`
- [ ] 10.26 Exactly one ResourceGridPanel mounts per matched route. Triple: any resource route open as an overlay · render · one grid mounted (test-plan #S-26). See `tests/e2e/resource-activation-trust.spec.ts`
- [ ] 10.27 Scope and filter follow the matched route. Triple: /settings/skills vs /folder/<cwd>/settings/skills · open each · global hides the filter, folder shows local+global with it (test-plan #S-27). See `tests/e2e/skill-provenance.spec.ts`

### 10f. Lifecycle and performance

- [ ] 10.28 A dismissed overlay releases its subscriptions. Triple: converted surface holding a live subscription · dismiss · unmounts and unsubscribes (assert the unsubscribe call, not a timer) (test-plan #S-28, re-scoped by the D1 revision to release-on-dismiss only — an OPEN overlay now deliberately retains the underlay's subscriptions). L1, see `packages/client/src/lib/__tests__/back-regression.test.ts` for the module-level harness idiom
- [ ] 10.29 Overlay open latency stays within budget. Triple: desktop with a session open · open+dismiss settings 20x · p95 open-to-rendered under the stated budget (test-plan #S-29, blocked on clarification C5). L3, see `tests/e2e/chat-render-perf.spec.ts`
- [ ] 10.30 Repeated open/dismiss does not leak. Triple: open+dismiss each converted surface 100x · measure RSS before/after · growth under the stated budget (test-plan #S-30, blocked on clarification C5). L2, see `qa/tests/16-e2e-memory-bound.sh`

### 10g. URL-preservation gate and resilience

- [ ] 10.31 The existing e2e suite passes with zero goto edits. Triple: unmodified e2e suite · run against the converted build · passes with no goto target changed; any required edit falsifies D1 and stops the change (test-plan #S-31). See the whole of `tests/e2e/`
- [ ] 10.32 A missing preview target renders the error state, not a blank dialog. Triple: deep-link /folder/<cwd>/view?path=<missing> as an overlay · open · error/fallback renders, no unhandled rejection (test-plan #S-32). See `tests/e2e/file-preview-survives-churn.spec.ts`

### 10h. Pairing (contract 4)

- [ ] 10.33 A live pairing code survives navigation across overlays. Triple: live one-time code from the gateway surface · navigate away to another overlay and back · code still valid within TTL or cleanly re-issued, never silently dead (test-plan #S-33). See `tests/e2e/pairing-qr.spec.ts`
- [ ] 10.34 No converted route bypasses the pairing guard. Triple: every converted route path · check against guardPairingUrls · no pairing affordance on a bypassing path (test-plan #S-34). L1, see `packages/server/src/__tests__/` for the guard's existing coverage

## 11. Manual verification (deferred post-merge)

- [ ] 11.1 On a real phone, open and dismiss each converted surface; the slide-in and swipe-back feel native with no jank at the dialog/depth-panel boundary (test-plan: manual-only)
- [ ] 11.2 At desktop widths the settings overlay reads as an overlay rather than a cramped page, with no visual truncation (test-plan: manual-only)
