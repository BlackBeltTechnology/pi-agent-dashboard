## Why

57 of 495 worktree sessions (~12%; ~40% on `ship-it` days) render as their own top-level `/…/.worktrees/<name>` folder card instead of collapsing under the parent repo. Root cause: when `ship-it`/`ship-change` runs `git worktree remove` **from inside the session's own cwd**, the `.git` file disappears but a residual directory (`node_modules`, build output) survives until the sweep. The next bridge git poll asks `checkoutRoots({cwd})`, which now — correctly, for the question asked — resolves the residual dir as a *subdirectory of the main repo* (`isLinkedWorktree: false`), so `detectWorktree()` returns `undefined` and the bridge sends `git_info_update { gitWorktree: null }`. The server clears `session.gitWorktree`, the session ends, `sessionToMeta()` full-overwrites `.meta.json` with the `gitWorktree` key absent (`undefined` is dropped by JSON), and every restart thereafter groups the session by its own cwd. Sessions whose dir vanished *entirely* before the poll are unaffected (`git rev-parse` fails → nothing sent), which is why it is a timing race and not 100%.

## What Changes

- **Server guard — worktree parentage is immutable once resolved.** `composeWorktreePayload` gains the session's *prior* `gitWorktree`. A wire `null` arriving while `gitWorktree` is already set SHALL be ignored (parentage kept, `gitWorktreeReported` still set) — while the cwd is unchanged, `null` after set can only mean the worktree was removed underneath it. A wire `null` with no prior value still clears as today. Wire object / undefined unchanged.
- **Same-cwd reattach keeps parentage.** `register()` today drops in-memory `gitWorktree` on every re-register; combined with the bridge's reconnect cache reset that re-opens the clear whenever a server restart / reconnect / resume lands in the removal window. `register()` SHALL carry `gitWorktree` over when `existing.cwd === params.cwd` and drop it otherwise.
- **Load-time repair for existing records.** `session-scanner` extends the existing read-time filter: when persisted `gitWorktree` is absent/implausible AND `cwd` is absolute and contains a non-leading `.worktrees` segment (split at the first one: `<X>/.worktrees/<name>[/...]`, so subdirectory cwds heal too) AND `<X>/.git` stats successfully, synthesize `{ mainPath: X, name }`. One `statSync` per record, no subprocess, `.meta.json` never rewritten (revert = stop synthesizing). Fires only for the `.worktrees/` layout the dashboard itself creates; foreign layouts keep status quo.
- No wire-protocol shape, `.meta.json` format, extension, or client change. The *documented meaning* of wire `null` narrows ("server clears" → "server clears unless parentage already resolved"): `bridge-session-state-poll` scenario wording and the `protocol.ts` doc comment are updated.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `git-context`: "Worktree identity propagation through session protocol" — the server SHALL NOT clear an already-resolved `gitWorktree` on a `git_info_update` carrying `gitWorktree: null`; same-cwd re-register preserves it, different-cwd re-register resets it; new scenarios for removed-underneath and reattach. The requirement's pre-existing claim that `session_register` carries `gitWorktree` is corrected (the bridge sends it in the `git_info_update` immediately after register).
- `session-grouping`: "Cold-start grouping parity for worktree/workspace sessions" — the "Legacy session without persisted parentage" scenario changes: a restored session lacking parentage whose cwd sits under `<X>/.worktrees/<name>` with `<X>/.git` present SHALL group under `<X>`; only when that inference fails does it fall back to its own cwd.
- `bridge-session-state-poll`: "Change-detected git forwarding" — wording only; the present→absent scenario no longer asserts that the server clears on `null` (server-side application is owned by `git-context`). Bridge behaviour unchanged.

## Impact

- `packages/server/src/git-worktree/git-worktree-compose.ts` — add `prior` input; pure, unit-tested.
- `packages/server/src/event-wiring.ts` — `git_info_update` handler passes `session.gitWorktree` into the composer (one call-site).
- `packages/server/src/session/memory-session-manager.ts` — `register()` carry-over list gains `gitWorktree` guarded by cwd equality.
- `packages/shared/src/protocol.ts` — doc comment on `git_info_update.gitWorktree` (no shape change).
- `packages/server/src/session/session-scanner.ts` — `.worktrees/` inference next to `isPlausibleWorktreeMainPath`.
- Tests: `git-worktree-compose` unit (null-after-set kept; null-with-nothing-set cleared + reported; the existing `null → null` case gains the explicit no-prior arg); `memory-session-manager` unit (same-cwd reattach keeps `gitWorktree`; different-cwd drops it); `session-scanner` unit (synthesized; subdirectory cwd; implausible persisted replaced; relative/leading cwd declined without stat; parent `.git` missing → undefined; non-`.worktrees` cwd → undefined; plausible persisted wins).
- OpenSpec auto-attach: no logic change, but a retained `mainPath` stays in `candidateRoots`, so a removed-worktree session keeps resolving changes from its parent repo (today the clear narrowed it to cwd). This is the intended outcome — the session's proposal lives in the parent repo. One manual/QA scenario: spawn worktree session → `git worktree remove` from inside it → wait a poll → card stays under repo.
- Docs: `packages/server/src/git-worktree/AGENTS.md` + `git-worktree-compose.ts.AGENTS.md` sidecar ("`null` (bridge cleared)" becomes conditional), `packages/server/src/session/AGENTS.md` + `session-scanner.ts.AGENTS.md`; `docs/architecture.md` grouping note if it describes the null-clear path (via DocScribe).
- Heals the 57 existing sidebar folder cards (55 at worktree root + 2 in a subdirectory) on next server restart with no data migration.

## Discipline Skills

- `doubt-driven-review` — grouping is user-visible and the guard makes a persisted field sticky; stress-test "is there any legitimate set→null transition within one session" before it stands.
- `review-code` — non-trivial server change before commit.

No auth/untrusted-input/secrets surface, no latency budget, no new endpoint — `security-hardening`, `performance-optimization`, `observability-instrumentation` do not apply.
