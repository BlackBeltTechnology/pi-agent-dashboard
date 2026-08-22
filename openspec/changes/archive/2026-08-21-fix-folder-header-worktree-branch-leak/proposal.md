## Why

Creating a git worktree makes the **main folder's** sidebar header display the **worktree's** branch (`os/foo` instead of `develop`), and it only corrects itself by accident. The main checkout's HEAD is never touched — `addWorktree` runs only `git worktree add [-b <branch>] <path> <base>` — so this is a pure display defect, but it misreports which branch the user's main checkout is on.

Two independent defects combine:

1. **The fallback answers a question it cannot know.** `GroupGitInfo` resolves the folder branch as `sessions.find((s) => s.gitBranch)` — positionally, the first child of `group.sessions`, which `groupSessionsByDirectory` orders via `sortSessionsByOrder(g.sessions, orderMap.get(g.cwd))` (`session-grouping.ts:157`). Worktree sessions are folded into the main folder group by `resolveSessionGroupPath` (`pin > gitWorktree.mainPath > cwd`), and `maybeRekeyOrder` (`event-wiring.ts:254-269`) moves a session id **to the front** of the newly-resolved order key the moment `git_info_update` establishes its worktree identity — `rekey(oldKey, newKey, sessionId, { toFront: true })`, documented as "matching the 'new session at top' intent". A freshly created worktree session therefore lands at position 0 of the *main* folder's order and deterministically wins the fallback. Observed live: worktree session ids sit at positions 1, 5 and 6 of `orders["/…/pi-agent-dashboard"]`; had position 0 not been a main-checkout session, the header would read `os/lazy-load-session-history`. A folder whose only children are worktree sessions has **no correct answer available** in the fallback path at all.

   The same `find` result also feeds `branchUrl`, `prNumber` and `prUrl` (`SessionCard.tsx:319-321`), so the header borrows the worktree's branch link and PR pill along with its branch.

2. **The authoritative value is missing far more often than the current spec assumes.** `git_head_update` is the only writer of the client's folder-git map, the server broadcasts it only on first-seen-or-change, and there is no connect-time snapshot. Measured against a live server: a fresh browser WebSocket received **0 `git_head_update` messages in 75 s** (a full 60 s poll cycle) while receiving 68 `session_updated` and 17 `openspec_update`. For any browser that connects after the server has cached a folder, `folderBranch` stays `undefined` **indefinitely** and the positional fallback is permanently load-bearing.

Recovery today is accidental — a newer main-folder session taking position 0, or a genuine HEAD change producing the first real broadcast. The periodic poll never fixes it, because the diff cache suppresses the rebroadcast.

## What Changes

- **Fallback restricted to children rooted at the folder itself.** When no folder-HEAD entry exists, `GroupGitInfo` SHALL only consider child sessions whose own `cwd` is the folder group's `cwd`. A session rooted elsewhere — a worktree child folded in via `gitWorktree.mainPath` — cannot speak for this folder's HEAD under any ordering. The whole git-identity tuple (branch, branch URL, PR number, PR URL) SHALL come from that one eligible session rather than being mixed across sessions. With no eligible child, resolution falls through to the existing `GET /api/git/branches` seed rather than asserting a wrong branch. **BREAKING** relative to the current `folder-head-refresh` spec, which explicitly blesses the unfiltered fallback ("No folder-git entry preserves prior behavior"). Expressing the rule as *cwd identity* rather than "exclude worktree sessions" keeps the pinned-worktree-folder case correct: there the worktree session's cwd IS the folder cwd, so it stays eligible.
- **Folder-HEAD snapshot on browser connect.** The server SHALL send its cached folder-HEAD map to a newly connected browser, so the authoritative value is present from first paint instead of only after the next genuine change. Removes the permanent-staleness hole for reloaded tabs.
- **Refresh a folder key when it enters the poll set.** On session registration, on the `git_info_update` re-key that first exposes a worktree's parent folder, and on pinning a directory, the server SHALL refresh that key without waiting for the next periodic cycle (default 60 s). Entry is judged against the previously computed key set, not against "never seen before": a folder whose earlier sessions have all ended is absent from the poll set while still being a known cwd, and its HEAD may have changed externally while unobserved.

Not in scope: changing worktree grouping (`resolveSessionGroupPath` precedence), the ordering rules in `sortSessionsByOrder` / `maybeRekeyOrder`'s `toFront` behaviour, or the poll cadence.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `folder-head-refresh`: three requirement changes — (a) the child-session fallback in "Folder header renders the folder's own HEAD with precedence over child-session branches" becomes a cwd-identity rule covering the whole git-identity tuple, replacing the current "preserves prior behavior" scenario; (b) a new requirement for a connect-time folder-HEAD snapshot to newly connected browsers; (c) the poll requirement gains refresh-on-entry for keys entering the observed set and eviction for keys leaving it.

## Impact

- `packages/client/src/components/session/SessionCard.tsx` — `GroupGitInfo` git-identity resolution (the `sessions.find((s) => s.gitBranch)` fallback and the `branchUrl` / `prNumber` / `prUrl` reads that share it).
- `packages/server/src/git-worktree/folder-head-poll.ts` — read-only accessor over the diff cache for the connect snapshot; refresh of keys entering the poll set. The cache is deliberately NOT evicted on set-leave.
- `packages/server/src/directory-service.ts` — expose the folder-HEAD snapshot on the `DirectoryService` interface, returning an empty set when the lazily-created poll does not exist (the poll object itself is what is nulled on stop, so the null-guard lives here, not in `folder-head-poll.ts`); own the previously-computed key set behind a single recompute path shared by the periodic tick and the entry triggers.
- `packages/server/src/event-wiring.ts` — invoke the entry-refresh from the `git_info_update` re-key path (`maybeRekeyOrder`), which is where a worktree's parent folder key first becomes known, and from the `session_register` handler **ungated** by the existing `isNewCwd` check (that check is false whenever an ended session already carries the cwd, while the poll set skips ended sessions). At `session_register` the server does not yet know `gitWorktree.mainPath` — the bridge sends it separately in `git_info_update` — so registration alone is not sufficient either.
- `packages/server/src/browser-handlers/directory-handler.ts` — the pin path already calls `onDirectoryAdded`; the entry-refresh rides that call so pinning a session-less directory refreshes its key.
- `packages/server/src/pairing/browser-gateway.ts` — folder-HEAD connect snapshot, built in the same connect block that already calls `buildOpenSpecConnectSnapshot(directoryService, …)`, behind a `typeof … === "function"` guard so hand-built `DirectoryService` fakes in existing tests keep working.
- No new protocol type: the snapshot reuses the existing `git_head_update` message, so `packages/shared/src/browser-protocol.ts` is unchanged.
- Tests: `packages/client/src/components/__tests__/SessionCard.test.tsx`, `packages/server/src/__tests__/folder-head-poll.test.ts`, `folder-head-integration.test.ts`, and the gateway connect-snapshot suite.
- No git behaviour, no migration, no user data. Purely read-path display correctness.

## Discipline Skills

- `doubt-driven-review` — the change inverts a scenario the shipped `folder-head-refresh` spec explicitly blesses; the precedence semantics deserve an adversarial pass before the spec delta stands. (Ran during planning: two fresh-context reviewers, findings reconciled into this proposal, the design and the spec delta.)
- `review-code` — non-trivial multi-package change (client render path + server broadcast path); review before commit once tests are green.
- `observability-instrumentation` is deliberately NOT triggered: no new endpoint, job, or external call — the connect snapshot reuses the existing browser WebSocket.
