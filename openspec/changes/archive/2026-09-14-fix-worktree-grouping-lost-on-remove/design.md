## Context

See proposal.md — Why. Relevant current state:

- `packages/server/src/git-worktree/git-worktree-compose.ts` — `composeWorktreePayload(wire, cachedBase)` is a pure tri-state mapper: `undefined` → no change, `null` → clear, object → merge cached `base`. It has no knowledge of the session's current value.
- `packages/server/src/event-wiring.ts` `git_info_update` handler (~L1720): calls the composer, maps `null` → in-memory `undefined`, sets `gitWorktreeReported = true` whenever the composer returned non-`undefined` (INCLUDING the cleared case — this is what makes a non-worktree session reject-capable for OpenSpec auto-attach, design D8 of `scope-openspec-auto-attach-to-session-cwd`). Then rekeys sidebar order via `maybeRekeyOrder`.
- `packages/server/src/session/session-scanner.ts` `sessionFromMeta`: `gitWorktree` is reconstructed from persisted `mainPath`/`name` only when `isPlausibleWorktreeMainPath(mainPath)` (no `.git` segment + `statSync(<mainPath>/.git)` succeeds). Read-time filter; `.meta.json` never rewritten.
- `git_info_update` wire shape (`packages/shared/src/protocol.ts`) carries NO `cwd`. `memory-session-manager.register()` overwrites `cwd` and does NOT carry over `gitWorktree` from an existing record (only tokens/cost/tags/notifyLog/attachedProposal/context), so every registration starts with `gitWorktree = undefined`; the field is set only by `git_info_update` within that registration. The bridge's poll uses a `cachedCwd` snapshot captured once per registration (`bridge.ts` `handleSessionChange` → `git-poll.ts`), so a cwd change can only surface as a new `session_register`. The "cwd switched" wording in the `protocol.ts` doc comment describes that re-register.
- `openspec-locality.ts` `candidateRoots` includes `session.gitWorktree?.mainPath`; `gitWorktreeReported` gates whether a session is reject-capable. Both read the field; neither is changed.
- On disk the broken records have the `gitWorktree` key ABSENT (57 absent / 0 explicit `null` — `sessionToMeta` writes `undefined`, dropped by `JSON.stringify`). 55 have cwd at the worktree root, 2 in a subdirectory (`.worktrees/ab-impl/ctrl-recommended`).
- `session-scanner`'s stale-cache path (jsonl newer than `cachedAt`) rewrites `.meta.json` from the PRIOR meta + jsonl stats before calling `sessionFromMeta`; anything `sessionFromMeta` derives stays in memory.
- Extension side: `git-poll.ts` → `sendGitInfoIfChanged` diffs `JSON.stringify(gitWorktree)` against the last sent; `detectWorktree()` → `undefined` when `checkoutRoots` says `isLinkedWorktree: false`, which is what a residual `.worktrees/<name>` dir (no `.git` file, still inside the main repo tree) yields.
- Dashboard-created worktrees always live at `<mainPath>/.worktrees/<name>` (`git-worktree-ops`), and `resolveSessionGroupPath` groups by `gitWorktree.mainPath` before `cwd`.

## Goals / Non-Goals

**Goals:**
- Stop the live clear (root cause) and heal the already-persisted 57 records (symptom) with no data migration.
- Keep both fixes server-local and pure/unit-testable.

**Non-Goals:**
- No extension change. The bridge's answer is *correct* for the question it asks; making `detectWorktree` remember prior state would duplicate the guard in a second process with less context.
- No `.meta.json` rewrite / backfill script. The scanner inference is idempotent at every startup, so persistence buys nothing.
- No change to the `gitWorktreeReported` semantics or OpenSpec auto-attach *logic* (observable difference: a retained `mainPath` keeps the parent repo in `candidateRoots` — intended, see Risks).
- No nested-worktree support (`<X>/.worktrees/<A>/.worktrees/<B>` where B is a worktree of A) — not a layout the dashboard creates.
- No handling of foreign layouts (`git worktree add ../sibling`) at load time — those records were never produced by the dashboard's own removal race in measurable numbers.

## Decisions

### D1 — Guard in the pure composer, not in the handler
`composeWorktreePayload(wire, cachedBase, prior)` gains a third parameter: the session's current in-memory `gitWorktree`. New rule, evaluated first: `wire === null && prior !== undefined` → return `prior` (unchanged object, so the handler's `gitUpdates.gitWorktree = prior` is a no-op set and the broadcast carries the same value). All other branches unchanged.
Why here: the composer is already the single place that interprets the wire tri-state, it is pure, and `git-worktree-compose.test.ts` exists. Putting the `if` in `event-wiring.ts` would leave the composer's contract ("`null` → clear") lying about what actually happens.
Alternative rejected: return `undefined` for the guarded case ("no change"). That would skip `gitWorktreeReported = true`, which is wrong — the bridge DID report worktree state; the session must stay reject-capable. Returning `prior` keeps `worktreeReported` true and costs at most one redundant `session_updated` broadcast per bridge re-send (the bridge dedups the whole git tuple, so `null` is re-sent only when branch/PR/status also change or after a reconnect cache reset — not every tick).

### D2 — Guard condition is "prior set", nothing more
The proposal originally scoped the guard to "same cwd". `git_info_update` has no cwd, and the only path that changes a session's cwd is `register()`, which resets `gitWorktree` — so `prior` can only be non-undefined if THIS registration's bridge already resolved parentage for THIS cwd. The condition collapses to `prior !== undefined`. The only set→null transition that is *not* removal-underneath is a user manually deleting `.git` inside their worktree while keeping the dir — which is the same failure mode and should be grouped the same way. `git worktree repair` / moving the worktree produce object→object, untouched by the guard.

### D2b — `register()` carries `gitWorktree` over on same-cwd reattach
Without this, the guard has a hole: server restart / bridge reconnect / dashboard resume while a removed-worktree session is still alive → scanner (or in-memory record) has parentage → `register()` drops it → bridge `resetReconnectCaches` forces a re-send → residual dir yields `null` → `prior === undefined` → cleared → persisted absent. Full-rebuild restarts on `ship-it` days make this window common. Fix: in the `existing ? {...}` carry-over block add `gitWorktree: existing.cwd === params.cwd ? existing.gitWorktree : undefined`. Different cwd → reset, so a session file resumed elsewhere starts unresolved. Consequence: a scanner-INFERRED value now survives reattach and the guard protects it — which is exactly the healing case (the inference only fires for `.worktrees/` under a real repo). `hidden` already uses the same reattach-preserve pattern in this block.
Alternative rejected: make the bridge re-send an object it cannot compute (residual dir has no `.git`) — an extension change with no source of truth.

### D3 — Load-time inference next to the existing plausibility filter
In `sessionFromMeta`, `gitWorktree` becomes:
1. persisted + plausible → use it (today);
2. else `inferWorktreeFromCwd(meta.cwd)`: require `isAbsolute(cwd)`; split into segments; find the FIRST segment equal to `.worktrees` with a following segment → `X = join(segments before it)`, `name = the following segment`; require `X` to be non-empty AND absolute (on POSIX `/.worktrees/x` splits to `["", ".worktrees", "x"]` and `X` would be `""` → `statSync(".git")` relative to the server cwd); return `{ mainPath: X, name }` iff `isPlausibleWorktreeMainPath(X)`. No match / empty `X` → no stat at all (a relative `.worktrees/foo` would otherwise resolve `./.git` against the SERVER's cwd — the dashboard repo — and fabricate parentage). First-segment split handles a session whose cwd is a subdirectory of the worktree (`detectWorktree` supports that: name from `thisCheckout`, not cwd). Known limitation: for a nested `<X>/.worktrees/<A>/.worktrees/<B>` where B is a worktree OF A, a live bridge would report `mainPath = A`; inference returns `X`. Not a dashboard-produced layout (Non-Goals);
3. else `undefined`.
Reuses `isPlausibleWorktreeMainPath` unchanged (it already does the one `statSync(<X>/.git)` and the `.git`-segment reject), so the inference inherits the same rules and known limitations. Cost: one extra stat per boot for records that fail step 1 and match the path shape — the 57 today, forever (they are ended and never re-stamped; D4 accepts this), plus nothing new once the guard stops producing such records. `name` is taken from the path, matching what `detectWorktree` would have produced for a dashboard-created worktree (`name = basename(worktreePath)`). For a worktree created with a slash in its name (`ab-impl/ctrl-recommended`) the inferred `name` is only the first segment (`ab-impl`) — display-only degradation, grouping (by `mainPath`) is correct.
Alternative rejected: probe `git worktree list` from `<X>` to verify the worktree is registered — a subprocess per record at startup, and the worktree is by definition already removed for exactly the records we are repairing.

### D4 — `.meta.json` stays untouched
Consistent with the phantom-repair precedent (`add-git-checkout-root-resolver`): read-time repair, revert = stop inferring. The next live bridge in a still-existing worktree re-stamps meta anyway; for removed worktrees there is nothing to re-stamp and the inference runs every boot at negligible cost.

## Risks / Trade-offs

- [Guard makes a false-positive parentage sticky] → `prior` comes from one of three sources, all validated: a resolved object the bridge sent (passed `git-checkout-root-resolution`), persisted meta that passed `isPlausibleWorktreeMainPath`, or a D3 inference (dashboard layout + `<X>/.git` stat). With D2b all three survive a same-cwd reattach and are then null-immune. The guard never creates parentage, only refuses to drop it; the false-positive surface is D3's (next bullet), unchanged by the guard.
- [Old bridge (never sends `gitWorktree`) reattaching in the same cwd now retains persisted/inferred parentage instead of dropping it] → Benign: the value came from a validated source and the cwd is unchanged; the "older bridge → not a worktree" rule is about an absent wire field, which still yields no parentage for a session that never had any. Accepted.
- [D2b carries the in-memory value without re-running the plausibility stat] → If the parent repo vanishes mid-server-lifetime a reconnect re-arms a stale `mainPath` until the next boot, where the scanner drops it. Grouping-only, self-healing. Accepted (consistent with `hidden`/`tags` carry-over, which are not re-validated either).
- [Sidebar order entries for the 57 healed sessions were persisted under their own-cwd key] → After healing they resolve under `<X>`; the old keys are orphaned and the healed sessions' in-folder order resets to scan order once. Cosmetic, ended sessions. Accepted.
- [`gitWorktreeBase` is likewise not carried over on reattach] → Pre-existing gap (base is spawn-flow-only, lost on reattach); out of scope here, noted for a follow-up.
- [`bridge-session-state-poll` main spec + `protocol.ts` comment say `null` makes the server clear] → Both updated in this change (wording only; bridge behaviour and wire shape unchanged).
- [Retained `mainPath` changes OpenSpec auto-attach outcomes for removed-worktree sessions] → `candidateRoots` keeps the parent repo, so a change listed there stays `present` and the deleted-proposal bypass keeps working. That is the correct answer for a worktree session whose proposal lives in the parent; today's narrowing to cwd was a side effect of the bug. Accepted; no logic change.
- [Worktree pill / other `gitWorktree`-driven client affordances persist after removal] → The session WAS a worktree session; the pill names its parent. `cwdMissing` already conveys the dir is gone. Accepted.
- [Inference groups a non-worktree dir named `.worktrees/<x>` under `<X>`] → Requires `<X>/.git` to exist AND the record to have no valid persisted parentage; the dashboard's own convention owns that path shape. Accepted.
- [Redundant `session_updated` broadcast per poll after removal] → Value unchanged, client diff is a no-op; bounded by session end. Accepted over the `undefined` return (D1).
- [`cwdMissing` still true for swept worktrees] → Unchanged behaviour: the card groups correctly but its resume button stays disabled, which is right.

## Migration Plan

Deploy = server restart (`POST /api/restart`, jiti). On the first restart the scanner heals all 57 existing records; no script. Rollback = revert the four code files (`git-worktree-compose.ts`, `event-wiring.ts`, `memory-session-manager.ts`, `session-scanner.ts`); records persisted without `gitWorktree` regress to folder cards, nothing else changes.
