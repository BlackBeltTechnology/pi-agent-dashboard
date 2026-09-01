## Context

See proposal.md — Why. Current state in `packages/automation-plugin/src/server/`:

- `scheduler.ts` fires → `runner.ts` applies concurrency per `automationKey` (`scope:name`) → `engine.startRunFor` resolves the model, writes ONE `running` record via `run-store.startRun`, and spawns ONE session stamped `automationRun.runId`.
- `index.ts` correlates the spawned session strictly by the host-applied `runId` stamp, buffers assistant text on `turn_end`, flushes `result.md` on `agent_end`, and calls `engine.onSessionDeath` on `ctx.onSessionEnded`.
- Run records live at `<scope>/.pi/automation/runs/<runId>/{run.json,result.md}`; retention prunes to 100 per automation.
- Dispatch is resolved once per run by `buildRunDispatch(automation, registry, ctx)` from `config.action`.

Constraint: the correlation key is a single `runId` per session. Fan-out must keep the same one-session-one-runId invariant, so children — not the parent — own the session stamps.

**Verified constraints from the current code (a doubt-review pass confirmed each against source).** These bound the decisions below:

- `run-store.runDir(scopeBase, runId)` resolves ONLY top-level `runs/<runId>`. `finishRun`, `listRuns`, `listStaleRunningRuns`, and `pruneRuns` all key off it. A nested child path is invisible to every one of them (`finishRun` would `readRecord`→`null` and silently write nothing).
- `engine.finishAndRelease` (the shared choke point for `onSessionEnded`, `onSessionDeath`, `stopRun`, spawn failure, and the reaper) ends with `runner.completeRun(ctx.key)` **unconditionally**.
- `routes.ts` `/result` joins `runs/<runId>/result.md` flat; `client/api.ts` fetches the same shape.
- `routes.ts` `unknownActionKind` inspects only `config.action.kind`, and the `/create`/`/update` prompt-normalization branch reads `config.action.kind` directly (throws on an `actions:`-only config).
- `startRun` is called without a `sessionId`; on-disk records never carry one today — only the in-memory `RunContext` does.
- `finishRun` derives `findings` by counting them out of the freshly-written `result.md`, and auto-archives when the result is empty.
- The `spawnToken` is assigned to the `RunContext` only in the `.then` after `spawnSession` resolves, leaving an unkillable spawn window.
- `pruneRuns` deletes run dirs recursively with no liveness check.

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

**1a. Nesting is NOT free — a child-aware run-id resolver is the enabling primitive.**
Decision 1 is incompatible with "the existing store path is unchanged": every store consumer resolves top-level only (see verified constraints). So `run-store` gains one internal resolver and every consumer routes through it:

- `resolveRunDir(scopeBase, runId): string | null` — returns `runs/<runId>` when that dir holds a `run.json`, else searches one level down (`runs/*/<runId>/run.json`) and returns the child dir, else `null`. One level only; the layout is exactly two-deep by construction.
- **Consumers that MUST route through it** (each gets a test): `finishRun`, `readRecord` callers, `listRuns`, `listStaleRunningRuns`, `pruneRuns`, and the `/result` route + `client/api.ts`.
- `listRuns` returns parents (with `children`) and legacy flat records at the top level; children are enumerated via the parent's `children` array, never by globbing depth.
- `pruneRuns` continues to count and delete TOP-LEVEL dirs only, so one occurrence stays one prunable unit.

Without 1a the child records are written but never finalized — the exact failure the doubt pass surfaced.

**2. Children carry the session stamp; the parent never spawns.**
`startRunFor` becomes: resolve model once → resolve the child list → write the parent record → for each child write its record and call the existing spawn path with `automationRun.runId = childRunId`. Everything downstream in `index.ts` (correlation, `turn_end` buffering, `agent_end` flush, `onSessionDeath`) keeps working per child with zero change to its keying. Alternative: a composite `parentRunId#index` stamp — rejected, it forces every consumer to parse the key.

**3. Child resolution is a pure function.**
`resolveChildren(automation, bound) → ChildSpec[]` expands `action:` | `actions:[]` × `count` and truncates at the bound, returning `{ specs, truncated }`. Pure and unit-testable without spawn I/O; the bound warning is data, not a log side effect.

**4. Parent finalization is a counter, not a scan.**
The engine holds per-parent `{ remaining, statuses[], findings }`; each child finalization decrements and, on zero, writes the parent once and calls `runner.completeRun(key)` — so the fire-level `skip`/`queue` policy releases only when the WHOLE occurrence is done. Alternative: re-read child `run.json`s on each completion — rejected as O(N) fs churn and racy against concurrent writes.

**4a. `completeRun` ownership moves to the parent — child finalization MUST NOT release the runner slot.**
`finishAndRelease` today calls `runner.completeRun(ctx.key)` unconditionally. Left as-is, the FIRST child to finish releases the fire slot while siblings still run: a `concurrency: queue` automation would drain its queue early and a single-child stop would free the slot (violating the fire-scoped semantics of decision 5). So `finishAndRelease` splits: the child path finalizes the child record and decrements the parent counter but does NOT call `completeRun`; only the parent-finalization path calls it, exactly once. A legacy flat run (no parent) keeps calling it directly, so single-action behavior is byte-identical.

**4b. The parent record is written directly, not through `finishRun`.**
`finishRun` derives `findings` by counting them out of the `result.md` it just wrote, and auto-archives on an empty result. The parent has no `result.md` of its own and its findings are a SUM over children. Parent finalization therefore writes the parent record directly (status, `endedAt`, summed `findings`, optional `warning`), skipping the result-derivation and auto-archive branches, then triggers retention pruning once for the occurrence.

**4c. Child `sessionId` is persisted on the record, not just in memory.**
Today `startRun` never writes a `sessionId` — only the in-memory `RunContext` holds it. The per-child monitor link and the child status row need it on disk, so the child record is updated with its `sessionId` when the session registers (the same point the engine binds the `RunContext`).

**5. `concurrency` stays fire-scoped; fan-out is a separate axis.**
Existing `concurrency` semantics are untouched (they key on `automationKey`, now tracking the parent runId). Fan-out width is governed only by `actions`/`count` and `maxConcurrentSpawns`. This avoids overloading one field with two orthogonal meanings.

**6. Bound = truncate + warn, not fail.**
A scheduled automation that silently stops firing is worse than one that runs fewer children. The parent record carries `warning` text; the UI shows it on the parent row.

**7. `stopRun(parentRunId)` fans out; `stopRun(childRunId)` is single.**
Reuses the existing `abortSpawnedRun({sessionId?, spawnToken?})` primitive per child — including the pre-register `spawnToken` path — then finalizes each child and lets decision 4's counter finalize the parent. `stopRun` resolves its argument via decision 1a's resolver, so it accepts either a parent or a child run id.

**7a. The unkillable spawn window is closed (in scope).**
The `spawnToken` is currently assigned to the `RunContext` only after `spawnSession` resolves, so a stop landing inside that window calls `abortSpawnedRun({})` — no sessionId, no token — and the child survives the stop, registers later, and runs on past an already-finalized parent. Fan-out multiplies this window by N and makes the parent stop hit it routinely, so it is fixed here rather than inherited: the child context records a `stopRequested` flag, and the spawn continuation aborts immediately (using the freshly-returned token) when it observes the flag. A stop in the window is therefore honored on token arrival instead of being dropped.

**7b. Retention pruning will not delete a live occurrence (in scope).**
`pruneRuns` deletes recursively with no liveness check, so a busy automation can prune a parent whose children are mid-flight (a later child write then resurrects a half-deleted dir). Pruning skips any top-level record still `running`, which under fan-out is exactly "the occurrence is live".

**8. Schema keeps `action:` as the canonical single form.**
`actions:` is additive and mutually exclusive with `action:`; internally both normalize to `ChildSpec[]` immediately after parse, so only the parser knows about two shapes. **`count` is honored on the single `action:` block too** — `action:` with `count: 3` resolves to 3 children, exactly as the same entry under `actions:` would. `action:` without `count` stays one child, so existing files are unaffected.

**9. Validation and config surfaces are extended alongside the schema.**
`actions:` is invisible to several existing surfaces, and leaving them alone breaks the isolate-invalid-automations contract:

- `routes.unknownActionKind` inspects only `config.action.kind` — it must validate every `actions:` entry and name the offending index, so `/create` and `/update` cannot persist a config that `/list` would later mark invalid.
- The `/create`/`/update` prompt-normalization branch reads `config.action.kind` directly and must handle an `actions:`-only config instead of assuming `action` exists.
- `automation-writer.ts` must serialize `actions:` + per-entry `count`, and `configSchema.json` is `additionalProperties: false`, so `maxConcurrentSpawns` and the settings default need explicit schema entries.

## Risks / Trade-offs

- **N sessions per fire can exhaust host resources (CPU/PTY/model rate limits).** → `maxConcurrentSpawns` bound with a conservative settings default; truncation is recorded, not silent.
- **Nested run dirs break consumers that glob `runs/*/run.json`.** → Parent records carry an explicit `children` array and a discriminating marker; readers treat a record without it as a legacy flat run. Enumerate children via the parent, never by globbing depth.
- **A parent can hang forever if one child never terminates.** → The existing stale-run reaper (`maxRunAgeMs`) is applied to CHILD records; a reaped child decrements the parent counter like any other finalization. Two corrections the doubt pass forced: the reaper's `listStaleRunningRuns` sweep is top-level-only today and must enumerate child records (via decision 1a); and because a parent is never in the engine's `pending` map, an aged parent would otherwise fall into the "pre-existing on-disk orphan" branch and be force-finalized `error` while its children are still legitimately running. The sweep therefore never orphan-finalizes a record that has live children — the parent finalizes only through decision 4's counter.
- **Partial-failure semantics are lossy** (`error` if any child errored hides that others succeeded). → Per-child statuses stay visible in the UI and on disk; the aggregate is a summary only.
- **More concurrent worktrees when `mode: worktree`.** → Each child gets its own worktree exactly as a separate automation would; disk cost is proportional to the bound and documented.

## Migration Plan

Purely additive. No data migration: existing flat `runs/<runId>/` records remain readable; new fires write the parent/child layout. Rollback = revert the change; already-written nested records become unreadable-as-runs but harm nothing (they are historical results on disk).

- **`concurrency: parallel` has a pre-existing runner defect** (the `active` map keeps only the latest parallel run, so an earlier occurrence's `completeRun` can delete a still-running sibling's slot), and the unstamped-host `onSessionRegistered` FIFO-per-cwd fallback races when N children share one cwd. → Neither is fixed here: the stamped correlation path is always taken for automation spawns, and the `parallel` defect predates fan-out. Both are recorded as known-amplified risks; the spawn-window and prune races (7a/7b) ARE fixed because fan-out makes them routine rather than rare.

## Open Questions

- Default value for `maxConcurrentSpawns` — **resolved: `4`**. Tunable in settings after landing; does not affect specs or task breakdown.
