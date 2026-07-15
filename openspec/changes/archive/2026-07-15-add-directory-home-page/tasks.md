# Tasks — add-directory-home-page

## Implementation

- [x] Add `DirectoryHomeView.tsx` (`packages/client/src/components/`) — vertically-centered `CommandInput` presentation with local draft state and NO `selectedId`; folder-name header; existing-session list; terminals/editor/settings quick actions; no model picker in v1 (design D2/D5).
- [x] Implement the spawn-mode `onSend` adapter in `DirectoryHomeView`: calls `handleSpawnSession(cwd, undefined, { initialPrompt: text })` (correct 3-arg form; 2nd arg is `attachProposal`), disables send while a spawn from this page is in flight (design D6).
- [x] Add the pinned-directory guard with a `pinnedDirectoriesLoaded` gate: loading state until the list arrives, "not pinned" notice + pin CTA for non-pinned cwds, prompt surface for pinned cwds (design D4).
- [x] Register `useRoute("/folder/:encodedCwd")` in `App.tsx` and render `DirectoryHomeView` in BOTH the desktop and mobile route chains; extend `getMobileDepth`'s `hasFolderRoute` derivation to include the bare route (design D1 + D1a).
- [x] Add the distinct "open" affordance on pinned-directory rows in `SessionList.tsx` (`renderGroup`): navigates to `/folder/:encodedCwd`, `stopPropagation` so it neither toggles collapse nor starts a drag-reorder; pinned rows only (design D3).

## Tests

- [x] L1: spawn-mode adapter passes the correct args — see `packages/client/src/components/__tests__/FolderSpawnButtons.test.tsx` for the spawn-call harness. Triple: home page for pinned `<cwd>`, prompt `"do X"` (input) · user sends (trigger) · `handleSpawnSession` called with `(<cwd>, undefined, { initialPrompt: "do X" })` (observable). (test-plan #E1)
- [x] L1: empty prompt does not spawn — see `FolderSpawnButtons.test.tsx`. Triple: prompt `""`/whitespace (input) · activate send (trigger) · no `spawn_session` sent (observable). (test-plan #E2)
- [x] L1: send disabled while a spawn is in flight — see `packages/client/src/components/__tests__/CommandInput.test.tsx` for send-control state harness. Triple: prior spawn not yet correlated (input) · activate send again (trigger) · control disabled, no second `spawn_session` (observable). (test-plan #E3)
- [x] L1: pinned guard rejects a non-pinned cwd — see `packages/client/src/components/__tests__/LandingPage.test.tsx` for prop-driven state rendering. Triple: `pinnedDirectories=["/a"]` loaded, cwd `/b` (input) · render (trigger) · not-pinned notice + pin CTA, no prompt (observable). (test-plan #E4)
- [x] L1: cold load does not flash not-pinned — see `LandingPage.test.tsx`. Triple: `pinnedDirectoriesLoaded=false`, cwd `/a` (pinned) (input) · render then loaded=true (trigger) · loading first, then prompt; notice never flashes (observable). (test-plan #E5)
- [x] L1: bare route does not shadow deeper folder routes — see existing route-match unit tests near `packages/client/src/__tests__/` (mirror the nearest `useRoute`/match test). Triple: path `/folder/<enc>/terminals` (input) · matching evaluated (trigger) · bare `/folder/:encodedCwd` match false while `/terminals` match true (observable). (test-plan #E6)
- [x] L1: open affordance navigates without toggling collapse — see `packages/client/src/components/__tests__/SessionList.test.tsx` for row-interaction harness. Triple: expanded pinned row (input) · activate open affordance (trigger) · `navigate("/folder/<enc>")` called, collapse state unchanged (observable). (test-plan #F2)
- [x] L1: populated folder renders content — see `LandingPage.test.tsx`. Triple: pinned `<cwd>` with 2 sessions (input) · render (trigger) · header + 2 sessions + terminals/editor/settings quick actions + prompt present (observable). (test-plan #F3)
- [x] L1: empty folder renders centered prompt, no second onboarding surface — see `LandingPage.test.tsx`. Triple: pinned `<cwd>`, 0 sessions (input) · render (trigger) · centered prompt present, session list empty, no LandingPage surface (observable). (test-plan #F4)
- [x] L3: click-open → type → send → lands in new session — see `tests/e2e/editor-pane.spec.ts` for folder-route + navigation harness (read `dashboardPort` from `.pi-test-harness.json`, never hardcode `:18000`). Triple: pinned folder in sidebar (input) · activate open affordance → type `"hello"` → send (trigger) · URL converges to `/session/<newId>` for a new session in `<cwd>` whose first prompt is `"hello"` (observable). (test-plan #F1)
- [x] L3: mobile back from the home page pops to the predecessor — see `tests/e2e/editor-pane.spec.ts` (mobile viewport pattern). Triple: mobile, navigated to `/folder/<enc>` from sidebar (input) · trigger back (trigger) · pops to predecessor, not depth-0 (observable). (test-plan #F5)

## Validate

- [x] Manual: directory home page layout reads as a focal "start here" — the prompt is vertically centered and visually dominant on an empty folder (test-plan: manual-only #F6).
- [x] `openspec validate add-directory-home-page` passes.
- [x] `npm run quality:changed` passes (Biome + tsc + vitest on the diff).
