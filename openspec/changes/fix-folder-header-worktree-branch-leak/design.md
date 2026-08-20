## Context

The folder header's git identity is resolved through a three-step ladder in `GroupGitInfo` (`packages/client/src/components/session/SessionCard.tsx`):

```
folderGitMap[cwd]            ← authoritative (server folder-HEAD poll/watcher)
  ?? sessions.find(s => s.gitBranch)?.gitBranch   ← positional child fallback
  ?? fetchedBranch           ← one-shot GET /api/git/branches seed
```

`group.sessions` is ordered by `sortSessionsByOrder(g.sessions, orderMap.get(g.cwd))` (`session-grouping.ts:157`), i.e. by the server's per-folder `orders` list. Worktree sessions are folded into the main folder's group (`resolveSessionGroupPath`: `pin > gitWorktree.mainPath > cwd`), and `maybeRekeyOrder` (`event-wiring.ts:254-269`) moves the session id **to the front** of the newly-resolved key when `git_info_update` establishes its worktree identity (`rekey(..., { toFront: true })`). So a new worktree session reliably occupies position 0 of the *main* folder group and wins the fallback. The same `find` result also supplies `branchUrl`, `prNumber`, `prUrl` (`SessionCard.tsx:319-321`).

Step 1 of the ladder is missing far more often than the shipped spec assumes. `refreshOne` broadcasts only on first-seen-or-change (`folder-head-poll.ts`), `git_head_update` is the sole writer of `folderGitMap` (`useMessageHandler.ts:686`), and `App.tsx` initialises it empty. Measured against a live server, a fresh browser WebSocket received **0** `git_head_update` in 75 s (a full 60 s poll cycle) alongside 68 `session_updated`.

Constraint: worktree-under-parent grouping is deliberate (`simplify-session-card-ordering`, Decision D8 explicitly permits a worktree session to surface at the top of its tier) and is **not** up for revision here. Likewise `maybeRekeyOrder`'s `toFront` behaviour is intended product behaviour ("new session at top").

## Goals / Non-Goals

**Goals:**
- The folder header never renders a git identity belonging to a different checkout, under any session ordering.
- The authoritative folder-HEAD value is present from first paint for every browser, including reconnects and reloads.
- A folder group key entering the observed set gets its HEAD read without waiting a full poll interval, and a key that re-enters after being unobserved is not served a stale cached value.

**Non-Goals:**
- Changing `resolveSessionGroupPath` precedence or un-grouping worktree sessions.
- Changing `sortSessionsByOrder`, the `orders` list, or `maybeRekeyOrder`'s front-insertion.
- Lowering `pollIntervalSeconds`, or adding a second broadcast path for folder HEADs.
- Any change to git behaviour — `addWorktree` is already correct and is not touched.

## Decisions

### D1 — Eligibility by cwd identity, not by "is a worktree session"

`GroupGitInfo` considers a child session eligible for the fallback only when `pathKey(session.cwd, platform) === pathKey(props.cwd, platform)` (both helpers already re-exported from `session-grouping.ts`). Branch, `branchUrl`, `prNumber` and `prUrl` are all read from that single eligible session.

*Why the cwd-identity form rather than "exclude `gitWorktree?.mainPath` children":*
- It states the actual invariant — *only a session rooted at this folder can report this folder's HEAD* — instead of enumerating one way to violate it.
- It keeps the **pinned-worktree-folder** case correct. `resolveSessionGroupPath` checks the pin first, so a pinned worktree directory groups its session under its own cwd, where that session's branch *is* the folder's branch. A `mainPath`-based exclusion would wrongly blank it.
- It does not depend on `gitWorktree` having arrived. `gitWorktree.mainPath` is populated by a later `git_info_update`; a predicate keyed on it is only correct in steady state, whereas `cwd` is present from registration.

*Why the whole tuple moves together:* `branchUrl`/`prNumber`/`prUrl` currently come from the same `find`. Filtering only the branch would leave the header showing folder A's branch beside folder B's PR pill — a worse failure than today's. A worktree-only folder therefore loses its (borrowed) PR pill; that pill was describing a different checkout.

*Alternatives:* (a) stop folding worktree sessions under the parent — rejected, reverses a deliberate shipped decision; (b) sort the fallback to prefer eligible children — rejected, still permits the wrong value when none exists; (c) server strips `gitBranch` from worktree sessions — rejected, the card's own `GitInfo` needs it.

### D2 — Deliver the connect snapshot as unicast `git_head_update` messages, not a new message type

On browser connect, replay the cached folder-HEAD map as a loop of `sendTo(ws, { type: "git_head_update", cwd, branch })`.

*Why:* the client already handles `git_head_update` idempotently (map upsert), so this is zero protocol surface and zero client change. It mirrors the connect block in `browser-gateway.ts`, which already unicasts `sessions_snapshot`, `pinned_dirs_updated`, `favorite_models_updated`, `workspaces_updated`, `display_prefs_updated`, the reachability replay, and the openspec snapshot. Cardinality is the number of folder group keys (order 10), once per connect.

*Alternatives:* (a) a `folder_heads_snapshot` batch message — rejected: new protocol type + new client case for a payload this small; revisit if group counts reach the hundreds; (b) extending `sessions_snapshot` — rejected, conflates two independently-owned caches.

### D3 — Build the snapshot exactly like `buildOpenSpecConnectSnapshot`

`DirectoryService` gains a folder-HEAD snapshot accessor; `browser-gateway.ts` calls it inside the existing `if (directoryService) { … }` connect block (`browser-gateway.ts:581-582`), next to `buildOpenSpecConnectSnapshot(directoryService, …)`.

*Why:* the gateway **already receives and uses** `directoryService` (positional param, `browser-gateway.ts:251`) precisely to build a connect snapshot from a server-side cache. Reusing that established shape needs no new constructor parameter — the gateway takes positional params, not an options object, so adding a getter would mean a 19th positional argument and touching every test call site. A `Pick<DirectoryService, …>`-typed helper keeps existing stubs valid, matching how `buildOpenSpecConnectSnapshot` is typed.

*Correction to an earlier draft of this design:* `getLastBindReachability` is a **static import** (`browser-gateway.ts:13`), not an injected getter — it is not the precedent it was claimed to be.

*Null-safety:* `folderHeadPoll` is created lazily in `startPolling` and set to `null` on stop (`directory-service.ts:1050`, `:1070`). The accessor SHALL return an empty list when the poll does not exist, so a browser connecting before polling starts (or after shutdown) receives no folder-HEAD entries rather than dereferencing null.

*Stub-safety (load-bearing, not type-level):* the connect handler runs against hand-built fakes — `makeFakeDirectoryService` (`__tests__/helpers/load-fixtures.ts:194-215`) casts a fixed field set through `as unknown as DirectoryService`, and `subscribeWs` fires the real connection handler. A new accessor called unconditionally would throw `TypeError: not a function` there. The call site MUST therefore use the existing `typeof x === "function"` guard convention already applied to `preferencesStore.getDisplayPrefs` (`browser-gateway.ts:561`). A `Pick<>` type alone does NOT keep those fakes valid — it is a compile-time claim about a runtime object that lacks the method.

*Invariant:* the accessor is a pure read. The snapshot must not touch the diff cache — mutating it would suppress a later legitimate broadcast to all browsers.

### D4 — Refresh on entry, keyed on the observed set, from three real trigger sites

Directory-service exposes `refreshFolderHeadsForEnteringKeys()`: recompute the group-key set, keep only keys **not in the previously computed key set** (i.e. keys the server was not observing), and `refreshOne` those through the same bounded fan-out the poll uses. Debounced (~500 ms) and invoked from three sites that between them cover every way a key enters the set:

- `event-wiring.ts` `maybeRekeyOrder` (`:262-269`) — the `git_info_update` path where a worktree's parent folder key first becomes known;
- the `session_register` handler, **ungated** — deliberately NOT behind the existing `isNewCwd` check (`event-wiring.ts:1416-1419`), which is false whenever an *ended* session already carries that cwd (`listAll()` includes ended sessions) while `computeFolderGroupKeys` skips ended sessions. A folder whose only prior sessions ended is therefore absent from the poll set yet fails `isNewCwd` — gating on it would miss exactly the case the delta's "Newly seen folder group key" scenario requires;
- `directoryService.onDirectoryAdded` — which the pin path already calls (`browser-handlers/directory-handler.ts:49`), covering a pinned directory entering the set with no session at all.

*Why the observed-set predicate rather than "absent from the diff cache":* the cache is never evicted, so "absent from cache" means "never seen since boot" — it would skip a key that left the set and came back, which is the stale case D4 exists to close.

*Bookkeeping ownership (single writer):* the "previously computed key set" is updated by ONE recompute function, called by both the periodic tick and every debounced entry trigger. Two independent updaters mutating it would let a trigger-side recompute mark a key as "previously seen" that no refresh ever read.

*Known bound, specced not hidden:* a key that leaves and re-enters between two recomputations was never observed as departed, so the trigger skips it and the next periodic cycle converges it (≤ one interval). Closing that window fully would require observing set-leave, i.e. eviction — rejected in D5 for a stronger reason. The delta states this bound explicitly rather than promising unconditional freshness.

*Why not "the session-change path":* an earlier draft of this design assumed directory-service already had a registration/git-info hook. It does not — it sees sessions only through `sessionManager.listAll()` on periodic ticks plus one initial tick (`directory-service.ts:1053`). Worse, at `session_register` the server does **not** yet know `gitWorktree.mainPath` (the bridge sends it in a later `git_info_update`, per `event-wiring.ts:382-383`), so a registration-only hook would miss the worktree-parent case — the exact reported symptom. `maybeRekeyOrder` is the correct site because it already fires precisely when a session's resolved folder key changes.

*Client-side platform:* D1's `pathKey` comparison needs a platform. `GroupGitInfo` does not receive one today; it derives one locally via `inferPlatform([cwd, ...sessions.map((s) => s.cwd)])` — the same helper `groupSessionsByDirectory` uses. Note the inference INPUT differs (group-local paths vs all sessions + pinned dirs + workspace folders), so on a pathologically mixed-platform path set the two could disagree. Passing the grouping's inferred platform down as a prop is the safe alternative if that ever proves reachable; group-local inference is chosen for now because a single group's paths share a root by construction.

*Concurrency:* the refresh reuses the poll's `mapBounded` cap rather than firing N unbounded reads, preserving the "no synchronous git-read burst" property from `attribute-openspec-poll-eventloop-stalls`.

*Accepted race:* an entry-refresh can overlap an in-flight poll turn for the same new key, and both may observe a cache miss before either writes — producing two identical `git_head_update` broadcasts. The client's handler is an idempotent map upsert, so a duplicate is inert; adding an in-flight lock is not worth the complexity. This is a duplicate *message*, not a second broadcast *path* — `refreshOne` remains the single read → diff → broadcast funnel.

*Watcher attach is deliberately not accelerated:* watcher lifecycle continues to reconcile on `tickFolderHeads`. The entry refresh reads HEAD once; the watcher for that key attaches on the next tick. Accelerating attach would duplicate the reconcile logic for a ≤60 s window in which the poll already covers correctness.

### D5 — Do NOT evict the diff cache on set-leave; the entry read is what defeats staleness

An earlier draft of this design added eviction when a key leaves the poll set. **Rejected.** The poll set is not the set of folders the client renders, despite what `computeFolderGroupKeys`'s doc comment says:

- workspace folders render regardless of session count (`groupSessionsByDirectoryWithWorkspaces` — "every folder in a workspace's `folders[]` appears here regardless of pin state or session count"), while `computeFolderGroupKeys` only covers non-ended sessions' group paths plus pinned dirs;
- `sessionManager.listAll()` includes ended sessions and the client groups them, while the poll set explicitly drops ended-only folders.

Evicting on set-leave would therefore strip the connect snapshot for folders the user is still looking at, regressing them to the child-fallback/REST-seed path — the very hole D2 exists to close.

Staleness is defeated by D4's **read on entry**, not by eviction: a key re-entering the observed set is re-read, and `refreshOne`'s diff broadcasts if the HEAD moved while unobserved. Keeping the cache is strictly better — it retains an authoritative value for still-rendered folders and costs one map entry per distinct folder seen since boot.

## Risks / Trade-offs

- **A worktree-only folder now shows "no branch" (and no PR pill) briefly instead of a wrong one** → the REST seed (`GET /api/git/branches`) still fires for that cwd, and D2+D4 make the authoritative value arrive promptly. Rendering *unknown* briefly beats rendering *confidently wrong*.
- **The REST seed's failure path pins `noGit: true` in the module-level `branchCache`** (`SessionCard.tsx` catch branch), so a worktree-only folder whose seed request fails renders "Init git" until a `git_head_update` arrives. D2 (connect snapshot) and D4 (entry refresh) both shorten that window; the pre-existing cache-poisoning behaviour is out of scope but noted.
- **Connect snapshot could mask a genuinely stale cache** → the cache is refreshed by the same poll + watcher as before, and D4's read-on-entry closes the unobserved-drift class.
- **Is the connect snapshot a "second broadcast path"?** (adjudicated) No. The non-goal forbids a second read → diff → broadcast *funnel* for folder-HEAD **state changes**; every such change still flows through `refreshOne` alone. D2 is a unicast replay of already-computed state to one socket, structurally identical to the `sessions_snapshot` / prefs / openspec replays that share that connect block. It performs no git read, no diff, and no fan-out. Recorded here because the wording admits a stricter reading.
- **N unicast messages per connect** → bounded by folder-group count (order 10), paid once per connection, alongside the several snapshots already sent there.
- **D4 fires on a registration storm** → debounced and filtered to keys not already observed, so a storm of sessions in known folders costs zero git reads.
- **Test stubs break** → the poll accessors are additive, and the gateway snapshot is built from the already-injected `directoryService` behind a `Pick<>` type, so no call site gains a parameter.

## Migration Plan

Pure read-path change: no data migration, no persisted state, no protocol version bump (D2 reuses an existing message). Deploy is the standard client build + server restart. Rollback is a straight revert of the touched modules.

**Archive-time note:** this change renames the scenario `No folder-git entry preserves prior behavior` inside a MODIFIED requirement. `openspec archive` compares scenario *name sets* and aborts with `MODIFIED failed for header … current spec contains scenario(s) not present in the modified block` (observed previously on this repo; recorded in the `openspec-archive-sync-traps` procedure). Pre-rename that heading in `openspec/specs/folder-head-refresh/spec.md` before archiving — a task covers this, and the archive commit message should record the pre-rename so it does not read as a drive-by edit.

## Open Questions

- ~~Should the header distinguish "unknown yet" from "non-git" for a folder with no eligible child before the REST seed resolves?~~ **Resolved during planning:** reuse the existing dimmed branch icon with no text and no new affordance — identical to any other unknown-branch folder. The "Init git" label stays gated on a confirmed non-git signal. Covered by test-plan #F4.
- D4's debounce window (500 ms) is a guess, not a measurement. If registration storms prove rare, the hook could be dropped once D1+D2 land — D1 alone already prevents the wrong value.
- `computeFolderGroupKeys`'s doc comment claims its output is "the set of paths the client renders as folder groups". That is stale: workspace-only and ended-only folders render without being in the set. Since this change rewrites the surrounding requirement paragraph anyway, the delta narrows the shipped sentence to "… from live sessions and pinned directories" rather than archiving a claim its own D5 rationale disproves. The source comment in `folder-head-poll.ts` should be corrected alongside the implementation.
- The poll cache is keyed by DISPLAY path (pinned display path wins on collision, `folder-head-poll.ts:78-92`) while the client looks up `folderGitMap.get(group.cwd)` by exact string (`SessionList.tsx:1295`). A pin/unpin or case drift can make a delivered entry unreachable. Pre-existing for broadcasts, but D2 makes the snapshot load-bearing on the same keying — worth a follow-up that canonicalizes the client lookup.
- `App.tsx:653` clears `folderGitMap`, but only inside `performServerSwitch`'s `clearInMemoryState`, which is paired with opening a socket to the new server — so the connect snapshot repopulates it. Not a regression path; recorded so a future reader does not re-derive it as one.
