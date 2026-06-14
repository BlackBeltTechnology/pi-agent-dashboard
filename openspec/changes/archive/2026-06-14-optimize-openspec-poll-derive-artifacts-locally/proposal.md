# Derive OpenSpec artifact status locally to kill the per-change CLI spawn storm

## Why

The periodic OpenSpec poll spawns `openspec status --change <name> --json`
**once per change, per cwd, every tick**. On this machine that is 66 active
changes in `pi-agent-dashboard` alone (~96 across 11 pinned dirs). At
`maxConcurrentSpawns: 3` that is ~22 serial CLI batches → 5–8s ticks.

Live evidence (`~/.pi/dashboard/server.log`):

```
[openspec-poll] slow tick: 5805ms … 8277ms (threshold 5000ms)
[gateway] heartbeat timeout, WS state=3 ...
```

Slow ticks recur every interval and coincide with WS heartbeat timeouts —
the spawn storm + the synchronous `statSync`/`readdirSync` mtime-gate scan
(`perChangeArtifactPaths`, run on the main thread for every change in every
cwd) starve the event loop, so bridges drop and the dashboard appears to
"block." `optimize-openspec-poll-burst` (archived) added the semaphore,
jitter, and mtime gate but did not remove the per-change spawn itself.

The per-change spawn only supplies the **per-artifact breakdown**
(proposal/design/tasks/specs · done/ready). That breakdown is already
derivable locally from data we own:

- `openspec list --json` already returns `completedTasks` / `totalTasks` per
  change (change-level progress, 1 spawn per cwd).
- `tasks` done → `parseTasksMarkdown()` (we own this parser).
- `design` done → `openspec-design-evidence.ts` probe (exists).
- `specs` done → `openspec-specs-evidence.ts` probe (exists).
- `proposal` present → file exists.

## What changes

### 1. Periodic poll derives artifact status from local files

`directory-service.ts` Step 2 (per-change status) stops calling
`runOpenSpecStatus` on the gated/periodic path. Instead a new pure helper
`deriveArtifactStatus(changeDir, listEntry, probes)` computes the same
`{ artifacts: [{id, status}], isComplete }` shape `buildOpenSpecData`
already consumes, using:
- `completedTasks` / `totalTasks` from the `list` entry,
- `parseTasksMarkdown` for the `tasks` artifact,
- the existing design + specs evidence probes,
- `proposal.md` existence for the `proposal` artifact.

Net spawns per cwd per tick: **1** (`openspec list`) instead of **1 + N**.

### 2. CLI `status` retained only for user-initiated force-refresh

`refreshOpenSpec(cwd)` (the OpenSpec card Refresh button, `force=true`) keeps
calling `runOpenSpecStatus` as the authoritative source — the escape hatch
when local derivation and the CLI disagree.

### 3. Parity test guards the derivation

A test asserts `deriveArtifactStatus(...)` matches `runOpenSpecStatus(...)`
artifact-for-artifact across the repo's own active changes, so drift from the
CLI's semantics is caught in CI.

### 4. Raise default poll interval (relief, separate from structural fix)

`DEFAULT_OPENSPEC_POLL.pollIntervalSeconds` 30 → 60. Already user-tunable;
the bump reduces baseline churn for large change sets even after the storm is
gone.

## Impact

- Affected specs: `server-openspec-polling`
- Affected code: `packages/server/src/directory-service.ts`,
  `packages/shared/src/openspec-poller.ts` (new `deriveArtifactStatus`),
  `packages/shared/src/config.ts` (default interval)
- No protocol change: `OpenSpecData` shape unchanged, broadcast keyed by cwd
  unchanged.
- Risk: derivation may diverge from CLI artifact semantics → mitigated by the
  parity test + the force-refresh CLI fallback.
