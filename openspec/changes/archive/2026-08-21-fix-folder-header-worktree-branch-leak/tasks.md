## 1. Client — eligible-child resolution (D1)

- [x] 1.1 In `packages/client/src/components/session/SessionCard.tsx`, replace `GroupGitInfo`'s `sessions.find((s) => s.gitBranch)` with an eligible-child lookup: a child is eligible only when `pathKey(session.cwd, platform) === pathKey(cwd, platform)`, with `platform` from `inferPlatform([cwd, ...sessions.map((s) => s.cwd)])` (both re-exported from `lib/session/session-grouping.js`).
- [x] 1.2 Source the whole git-identity tuple from that one eligible session: `gitBranch`, `gitBranchUrl`, `gitPrNumber`, `gitPrUrl` — never mixed across sessions, and all absent when no child is eligible.
- [x] 1.3 Confirm the `useEffect` REST-seed guard (`if (session?.gitBranch) …`) keys off the ELIGIBLE child, so a folder with only ineligible children still issues its `GET /api/git/branches` seed.

## 2. Server — connect snapshot (D2, D3)

- [x] 2.1 Add a read-only accessor over the folder-HEAD diff cache in `packages/server/src/git-worktree/folder-head-poll.ts` returning `Array<{ cwd, branch }>`; it must not mutate the cache.
- [x] 2.2 Expose the snapshot on the `DirectoryService` interface in `packages/server/src/directory-service.ts`, returning an empty array when the lazily-created `folderHeadPoll` is null (created in `startPolling`, nulled on stop).
- [x] 2.3 In `packages/server/src/pairing/browser-gateway.ts`, emit the snapshot as unicast `git_head_update` messages inside the existing `if (directoryService)` connect block, next to `buildOpenSpecConnectSnapshot`. Guard with `typeof … === "function"` (precedent: `preferencesStore.getDisplayPrefs`) so hand-built `DirectoryService` fakes keep working.

## 3. Server — refresh on entry (D4) and cache retention (D5)

- [x] 3.1 Add `refreshFolderHeadsForEnteringKeys()` to `directory-service.ts`: recompute the group-key set through a SINGLE shared recompute path (also used by the periodic tick), refresh only keys absent from the previously computed set, via the poll's existing bounded fan-out.
- [x] 3.2 Debounce the entry refresh (~500 ms) so a registration burst collapses into one fan-out.
- [x] 3.3 Call the entry refresh from `packages/server/src/event-wiring.ts` `maybeRekeyOrder`, so a worktree's parent folder key is refreshed when `git_info_update` establishes the worktree identity.
- [x] 3.4 Call the entry refresh from the `session_register` handler UNGATED by the existing `isNewCwd` check — that check is false whenever an ended session already carries the cwd, while the poll set skips ended sessions.
- [x] 3.5 Call the entry refresh from `directoryService.onDirectoryAdded`, which the pin path (`browser-handlers/directory-handler.ts`) already invokes, so pinning a session-less directory refreshes its key.
- [x] 3.6 Do NOT evict cache entries when a key leaves the poll set; correct the stale doc comment in `folder-head-poll.ts` that calls the poll set "the set of paths the client renders as folder groups" (workspace-only and ended-only folders render without being in it).

## 4. Tests — L1 unit (vitest)

- [x] 4.1 Eligible child wins over a front-ordered worktree child — see `packages/client/src/components/__tests__/SessionCard.test.tsx`. Triple: group `/repo`, sessions [worktree `/repo/.worktrees/os-foo` `os/foo`, main `/repo` `develop`], no folder-git entry · render `GroupGitInfo` · rendered branch is `develop` (test-plan #E1).
- [x] 4.2 No eligible child falls through to the REST seed — see `SessionCard.test.tsx`. Triple: all sessions under `/repo/.worktrees/*`, no folder-git entry, seed returns `develop` · render · no child branch rendered, seed value shown (test-plan #E2).
- [x] 4.3 Pinned worktree folder renders its own session's branch — see `SessionCard.test.tsx`. Triple: pinned folder `/repo/.worktrees/os-foo` with a session at the same cwd `os/foo`, no folder-git entry · render · `os/foo` rendered (test-plan #E3).
- [x] 4.4 Git-identity tuple never mixes sessions — see `SessionCard.test.tsx`. Triple: eligible main child `develop` with no PR, ineligible worktree child with `gitPrNumber: 42` + urls · render · `develop` shown, no PR number/url/branch url rendered (test-plan #E4).
- [x] 4.5 Folder-HEAD entry still outranks a front-ordered worktree child — see `SessionCard.test.tsx`. Triple: folder-git map `/repo → develop`, first session worktree `os/foo` · render · `develop` (test-plan #E5).
- [x] 4.6 Null folder-HEAD entry still renders the non-git state — see `SessionCard.test.tsx`. Triple: folder-git map `/repo → null` · render · dimmed / "Init git" state (test-plan #E6).
- [x] 4.7 Eligibility uses `pathKey`, not raw string equality — see `SessionCard.test.tsx`. Triple: group `/repo`, child cwd `/repo/` branch `develop` · render · child eligible, `develop` rendered (test-plan #E7).
- [x] 4.8 Key absent from the previous set is refreshed before any tick — see `packages/server/src/__tests__/folder-head-integration.test.ts` (the entry trigger's previous-set bookkeeping lives in `directory-service`, not the poll object). Triple: previous set `{/a}`, session registers resolving to `/b`, `readHead("/b") → main` · entry trigger · `git_head_update {/b, main}` broadcast with no periodic tick run (test-plan #E8).
- [x] 4.9 Key already in the previous set is not re-broadcast on entry — see `folder-head-integration.test.ts`. Triple: previous set `{/a}`, session registers resolving to `/a` · entry trigger · no additional broadcast (test-plan #E9).
- [x] 4.10 Registration into an ended-only folder counts as entry — see `packages/server/src/__tests__/folder-head-integration.test.ts`. Triple: `/a` has only ended sessions so `isNewCwd` is false but `/a` is absent from the key set; a new session registers at `/a` · `session_register` · `/a` read and broadcast before the next tick (test-plan #E10).
- [x] 4.11 Pinning a session-less directory refreshes its key — see `folder-head-integration.test.ts`. Triple: `/c` has no sessions and is not in the key set · `/c` pinned · `/c` refreshed and broadcast before the next tick (test-plan #E11).
- [x] 4.12 Worktree parent key entering on re-key is refreshed — see `folder-head-integration.test.ts`. Triple: session at `/repo/.worktrees/os-foo` with no `gitWorktree`, `/repo` not in the set · `git_info_update` supplies `mainPath=/repo` · `/repo` refreshed before the next tick (test-plan #E12).
- [x] 4.13 Observed re-entry is re-read rather than served stale — see `folder-head-integration.test.ts`. Triple: `/a` cached `develop`, sessions end, a recomputation observes the departure, HEAD becomes `feature`, new session registers at `/a` · entry trigger · broadcast `feature` (test-plan #E13).
- [x] 4.14 Unobserved leave/re-enter converges on the next cycle — see `folder-head-integration.test.ts`. Triple: `/a` leaves and re-enters between two recomputations with HEAD changed to `feature` · entry trigger then one periodic cycle · trigger may skip, the cycle broadcasts `feature` (test-plan #E14).
- [x] 4.15 Cache is retained when a key leaves the set — see `folder-head-poll.test.ts`. Triple: `/a` cached `develop`, `/a` leaves the key set · recompute, then a browser connects · `/a` still present in the connect snapshot (test-plan #E15).
- [x] 4.16 Fresh browser receives the cached folder heads — see `packages/server/src/__tests__/browser-gateway-snapshot-on-connect.test.ts`. Triple: cache `/repo → develop` · a browser connects · it receives `{cwd:"/repo", branch:"develop"}` (test-plan #E16).
- [x] 4.17 Snapshot is unicast and cache-pure — see `browser-gateway-snapshot-on-connect.test.ts`. Triple: cache `/repo → develop`, browser A connected · browser B connects · B receives the entry, A receives nothing, diff cache unchanged (test-plan #E17).
- [x] 4.18 Connect before polling starts sends no entries — see `browser-gateway-snapshot-on-connect.test.ts`. Triple: no folder-HEAD poll exists · a browser connects · zero folder-HEAD entries, connection succeeds (test-plan #E18).
- [x] 4.19 Cached non-git folder is delivered as null — see `browser-gateway-snapshot-on-connect.test.ts`. Triple: cache `/notgit → null` · a browser connects · receives `{cwd:"/notgit", branch:null}` (test-plan #E19).
- [x] 4.20 Entry fan-out honours the concurrency cap — see `folder-head-poll.test.ts`. Triple: 12 keys enter at once with an instrumented `readHead` recording in-flight count · one debounced entry trigger · peak concurrency ≤ 4 and all 12 refreshed (test-plan #E20).
- [x] 4.21 Connect handler tolerates a `DirectoryService` fake without the accessor — see `packages/server/src/__tests__/helpers/load-fixtures.ts` `makeFakeDirectoryService` + `browser-gateway-snapshot-on-connect.test.ts`. Triple: fake lacking any folder-HEAD accessor · a browser connects · no throw, `sessions_snapshot` and the openspec snapshot still delivered (test-plan #E21).
- [x] 4.22 REST-seed failure must not resurrect an ineligible branch — see `SessionCard.test.tsx`. Triple: `GET /api/git/branches` rejects for a folder with no eligible child · render · no worktree branch rendered (test-plan #X1).
- [x] 4.23 `readHead` throwing on an entering key degrades to null — see `folder-head-poll.test.ts`. Triple: `readHead` throws for an entering key · entry trigger · `branch: null` broadcast once, no propagation (test-plan #X2).
- [x] 4.24 Snapshot accessor after shutdown yields empty — see `folder-head-integration.test.ts` (the null-guard lives in `directory-service`). Triple: polling stopped so the poll object is null · a browser connects · empty set, no `TypeError`, connection completes (test-plan #X3).

## 5. Tests — L3 Playwright e2e (docker harness)

- [x] 5.1 Main folder header never shows a worktree branch across worktree creation — see `tests/e2e/manage-worktrees.spec.ts` for worktree-surface harness glue and `tests/e2e/folder-status-capsule.spec.ts` for folder-header locators. Triple: folder with a main session on `develop` · create a worktree so its session joins the group and is re-keyed to the front · header converges to `develop` and never displays the worktree branch at any point (test-plan #F1).
- [x] 5.2 Worktree-only folder header has no branch link and no PR pill — see `tests/e2e/folder-status-capsule.spec.ts`. Triple: folder group whose only sessions are worktree sessions · render the sidebar · branch-link and PR-pill elements absent from the DOM (test-plan #F2).
- [x] 5.3 Reload shows the parent branch from first paint — see `tests/e2e/folder-status-capsule.spec.ts`. Triple: worktree session grouped under its parent, server cache warm · reload the page · header shows the parent's branch without waiting for a HEAD change (test-plan #F3).
- [x] 5.4 No-eligible-child folder renders the dimmed icon only — see `tests/e2e/folder-status-capsule.spec.ts`. Triple: folder with no eligible child, REST seed in flight · render the sidebar · dimmed branch icon, no branch text, no "Init git" label, no new affordance (test-plan #F4).
- [x] 5.5 Out-of-band checkout still converges the header — see `tests/e2e/git-panel.spec.ts` for out-of-band git mutation glue. Triple: folder with a main session and a worktree session, watcher attached · `git checkout` another branch in the main checkout out of band · header converges to the new branch (test-plan #F5).

## 6. Manual verification (deferred post-merge)

- [x] 6.1 Eyeball the worktree-only folder header after the PR pill and branch link are gone: the header layout leaves no visual gap or misalignment where the pill used to sit (test-plan: manual-only).

## 7. Archive preparation

- [x] 7.1 Before archiving, pre-rename the scenario heading `#### Scenario: No folder-git entry preserves prior behavior` to `#### Scenario: No folder-git entry excludes children rooted elsewhere` in `openspec/specs/folder-head-refresh/spec.md` — `openspec archive` compares scenario NAME SETS and aborts otherwise. Record the pre-rename in the archive commit message.
- [x] 7.2 After `openspec archive --sync`, grep the synced `openspec/specs/folder-head-refresh/spec.md` (including the `## Purpose` preamble, which the sync does not rewrite) for stale text about the child-session fallback.
