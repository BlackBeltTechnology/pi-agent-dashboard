## Why

Issue #820: the worktree-init hook (`POST /api/git/worktree/init`) inherits the dashboard server's own V8 ceiling (`NODE_OPTIONS=--max-old-space-size=1536`, stamped by `server-launcher.ts`). Heavy Node work in the hook — this repo's `pnpm install` → `packages/client` `prepare` → `vite build`, peaking at ~3.1 GB RSS — aborts with a V8 OOM (`exit 134`, `init failed (script_nonzero_exit)`) on a host with plenty of RAM. The server's heap cap is meant for the server process only; terminals and spawned sessions already strip it, the init hook does not.

## What Changes

- `runInitHook` (script flavor), `evaluateGate`, and the agent-flavor headless-pi spawn in `packages/server/src/git-worktree/worktree-init.ts` build their default child env as `stripDashboardHeapFlag({ ...process.env })` instead of `process.env`.
- Reuses the existing provenance-gated strip (`packages/shared/src/heap-flags.ts`): only the token named by `PI_DASHBOARD_HEAP_FLAG` is removed; the marker is removed too; operator-set heap flags and unrelated `NODE_OPTIONS` entries are preserved; `NODE_OPTIONS` is deleted when nothing remains.
- An explicit `opts.env` passed by a caller is used verbatim (unchanged contract).
- Deliberate deviation from the issue text: the issue suggests stripping *any* `--max-old-space-size`. That would eat an operator's deliberate pin and contradicts design D4 of `bound-session-heap-and-gc-telemetry`; the marker-based strip already used for terminals is the consistent choice.
- Out of scope: auditing other server child-process spawns (already covered for terminals and sessions).

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `heap-limits`: add a requirement that the dashboard's own heap flag SHALL NOT reach worktree-init hook processes (script run, gate, agent spawn), mirroring the existing terminal requirement.

## Impact

- Code: `packages/server/src/git-worktree/worktree-init.ts` (3 spawn sites, one shared env helper).
- Tests: `packages/server/src/__tests__/worktree-init.test.ts`.
- No API, protocol, config, or dependency change. Server-only → `/api/restart` after landing.
- Compatibility: hooks that relied on the inherited 1536 MB cap now get Node's default heap (or the operator's own pin). Rollback = revert the commit.

## Discipline Skills

None apply — no auth/untrusted input, no latency budget, no new endpoint, no irreversible step. Standard `review-code` before commit.
