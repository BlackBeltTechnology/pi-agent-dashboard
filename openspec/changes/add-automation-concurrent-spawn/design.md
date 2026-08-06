## Context

See proposal.md — Why. Current state in `packages/automation-plugin/src/server/`:

- `scheduler.ts` fires → `runner.ts` applies concurrency per `automationKey` (`scope:name`) → `engine.startRunFor` resolves the model, writes ONE `running` record via `run-store.startRun`, and spawns ONE session stamped `automationRun.runId`.
- `index.ts` correlates the spawned session strictly by the host-applied `runId` stamp, buffers assistant text on `turn_end`, flushes `result.md` on `agent_end`, and calls `engine.onSessionDeath` on `ctx.onSessionEnded`.
- Run records live at `<scope>/.pi/automation/runs/<runId>/{run.json,result.md}`; retention prunes to 100 per automation.
- Dispatch is resolved once per run by `buildRunDispatch(automation, registry, ctx)` from `config.action`.

Constraint: the correlation key is a single `runId` per session. Fan-out must keep the same one-session-one-runId invariant, so children — not the parent — own the session stamps.

## Goals / Non-Goals

**Goals:**
- One trigger fire → N concurrently-spawned sessions, each with its OWN action (flow/skill) and its own run id, result, stop, and finalization path.
- Reuse the existing per-session correlation, capture, stop, and reaper machinery unchanged per child.
- Keep the single-`action:` path byte-identical in behavior and on-disk layout compatible with existing records.

**Non-Goals:**
- Ordering, dependency, or data hand-off between children (no DAG — that is what flows themselves are for).
- Cross-automation global concurrency budget beyond the per-fire bound.
- Retry of a failed child.

## Decisions

**1. Two-level run records (parent occurrence + child runs), not N flat runs.**
`run-store` gains a parent record at `runs/<parentRunId>/run.json` with a `children: string[]`, and child records at `runs/<parentRunId>/<childRunId>/{run.json,result.md}`. Alternative considered: N sibling top-level runs with a shared `fireId`. Rejected — retention pruning counts top-level dirs, so a `count: 8` automation would evict 8× faster and the Automation view would need to re-group by `fireId` on every read. Nesting makes "one occurrence = one prunable unit" true by construction.

**2. Children carry the session stamp; the parent never spawns.**
`startRunFor` becomes: resolve model once → resolve the child list → write the parent record → for each child write its record and call the existing spawn path with `automationRun.runId = childRunId`. Everything downstream in `index.ts` (correlation, `turn_end` buffering, `agent_end` flush, `onSessionDeath`) keeps working per child with zero change to its keying. Alternative: a composite `parentRunId#index` stamp — rejected, it forces every consumer to parse the key.

**3. Child resolution is a pure function.**
`resolveChildren(automation, bound) → ChildSpec[]` expands `action:` | `actions:[]` × `count` and truncates at the bound, returning `{ specs, truncated }`. Pure and unit-testable without spawn I/O; the bound warning is data, not a log side effect.

**4. Parent finalization is a counter, not a scan.**
The engine holds per-parent `{ remaining, statuses[], findings }`; each child finalization decrements and, on zero, writes the parent once and calls `runner.completeRun(key)` — so the fire-level `skip`/`queue` policy releases only when the WHOLE occurrence is done. Alternative: re-read child `run.json`s on each completion — rejected as O(N) fs churn and racy against concurrent writes.

**5. `concurrency` stays fire-scoped; fan-out is a separate axis.**
Existing `concurrency` semantics are untouched (they key on `automationKey`, now tracking the parent runId). Fan-out width is governed only by `actions`/`count` and `maxConcurrentSpawns`. This avoids overloading one field with two orthogonal meanings.

**6. Bound = truncate + warn, not fail.**
A scheduled automation that silently stops firing is worse than one that runs fewer children. The parent record carries `warning` text; the UI shows it on the parent row.

**7. `stopRun(parentRunId)` fans out; `stopRun(childRunId)` is single.**
Reuses the existing `abortSpawnedRun({sessionId?, spawnToken?})` primitive per child — including the pre-register `spawnToken` path — then finalizes each child and lets decision 4's counter finalize the parent.

**8. Schema keeps `action:` as the canonical single form.**
`actions:` is additive and mutually exclusive with `action:`; internally both normalize to `ChildSpec[]` immediately after parse, so only the parser knows about two shapes.

## Risks / Trade-offs

- **N sessions per fire can exhaust host resources (CPU/PTY/model rate limits).** → `maxConcurrentSpawns` bound with a conservative settings default; truncation is recorded, not silent.
- **Nested run dirs break consumers that glob `runs/*/run.json`.** → Parent records carry an explicit `children` array and a discriminating marker; readers treat a record without it as a legacy flat run. Enumerate children via the parent, never by globbing depth.
- **A parent can hang forever if one child never terminates.** → The existing stale-run reaper (`maxRunAgeMs`) is applied to CHILD records; a reaped child decrements the parent counter like any other finalization.
- **Partial-failure semantics are lossy** (`error` if any child errored hides that others succeeded). → Per-child statuses stay visible in the UI and on disk; the aggregate is a summary only.
- **More concurrent worktrees when `mode: worktree`.** → Each child gets its own worktree exactly as a separate automation would; disk cost is proportional to the bound and documented.

## Migration Plan

Purely additive. No data migration: existing flat `runs/<runId>/` records remain readable; new fires write the parent/child layout. Rollback = revert the change; already-written nested records become unreadable-as-runs but harm nothing (they are historical results on disk).

## Open Questions

- Default value for `maxConcurrentSpawns` (proposed `4`) — tunable in settings after landing; does not affect specs or task breakdown.
