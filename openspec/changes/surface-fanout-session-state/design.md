## Context

See proposal.md — Why.

The investigated work-source path asks the source for at most the effective bound (`engine.ts:896-899`, call at `engine.ts:982`) and starts one child for every returned handle (`engine.ts:960-978`). Items beyond the bound remain unleased, which preserves later-fire eligibility, but current logs state only the taken count (`engine.ts:974-978`). The source result therefore loses the information needed to distinguish 4 leased out of 4 available from 4 leased out of 6.

Fire admission and child width are separate existing mechanisms. A scheduler trigger submits one fire (`scheduler.ts:124-132`); the runner applies `skip | queue | parallel` to overlapping fires keyed by automation (`runner.ts:77-120`). After admission, the engine leases up to the effective bound and starts every returned handle concurrently (`engine.ts:1157-1175`, `engine.ts:960-978`).

Run persistence already creates a `running` parent with `children: []` and appends each child as `running` (`run-store.ts:141-198`). The run-list route returns parents with `children` and attached `childRuns` (`routes.ts:191-202`). No run-lifecycle WebSocket broadcast exists; config update is the only relevant broadcast.

The spawn bound is already complete: `packages/automation-plugin/src/server/index.ts:217-220` reads `PI_AUTOMATION_MAX_CONCURRENT_SPAWNS`; `resolve-children.ts:54-73` resolves plugin config before environment before hard default `4`; `engine.ts:1145-1154` applies the per-automation override; schemas already cover the field. This change must not add or alter that configuration path.

## Goals / Non-Goals

**Goals:**

- Preserve bounded leasing while exposing an authoritative deferred count.
- Persist enough parent/child state for deterministic polling-based batch progress and per-item child attribution.
- Make inter-fire admission and intra-fire width impossible to conflate in contracts and operator documentation.

**Non-Goals:**

- Add a run-lifecycle WebSocket event or another push transport.
- Change lease eligibility, retry behavior, fire scheduling, or parent finalization.
- Add another concurrency setting or change existing bound precedence/defaults.
- Add a dashboard-client progress component; this change pins the server contract consumed by such a component.

## Decisions

### 1. The work source returns an atomic lease summary

Change the generic work-source `next(bound)` result from a bare handle list to a lease summary containing `handles` and `deferredCount`. The source computes `deferredCount` at the same point it selects handles, before any spawn starts. The engine derives `leasedCount` from `handles.length`.

This keeps the count authoritative for the exact source snapshot used by the fire. Alternative: ask the source for a separate pending count after `next`. Rejected because concurrent source changes can make the count describe a different snapshot. Alternative: request all handles and truncate in the engine. Rejected because it expands the lease and would change deferred items from unleased work into discarded/truncated work.

The abstraction and fields remain domain-neutral. Source implementations may inspect domain data internally, but generic automation code receives only handles and counts.

### 2. Persist counts on the parent and log them once

Add `leasedCount` and `deferredCount` to the parent run record for work-source fires. Write both values, including zero, when creating the parent. Persist each leased handle's stable generic key as `workItemKey` on the child record created for that handle. Emit one structured operator log line for the fire with automation identity, parent run id, leased count, deferred count, and effective bound.

Persistence gives REST consumers and post-run diagnosis the same durable fact. The log gives immediate visibility without polling. Alternative: log only. Rejected because the information would disappear from run history. Alternative: parent record only. Rejected because operators diagnosing scheduler behavior commonly start with server logs and would still lack an immediate signal.

A non-zero deferred count is informational, not a warning about failure or truncation: those items were never leased and remain eligible for a later fire.

### 3. Pin the existing run-list response as the lifecycle read model

Keep the current route model: each top-level parent includes `status`, ordered `children`, and attached `childRuns`; each attached child includes its persisted lifecycle fields, especially `runId`, `status`, available session identity, and the generic `workItemKey` copied from its leased handle. The key is stable for that child through terminal settlement. The route returns partial startup honestly: a running parent with zero or some children is valid while child records are being appended. Each poll is a current persisted snapshot, so consumers compute the running count from attached children with `status === "running"` and map each child/session to its item using `workItemKey`.

Alternative: delay parent visibility until all children are appended. Rejected because it hides the batch during the startup window and contradicts persisted state. Alternative: add an aggregate `runningCount`. Rejected because it duplicates child state and creates consistency risk; the count is directly derivable. Alternative: expose only an anonymous count. Rejected because it cannot tell an operator which leased item belongs to which child session.

### 4. Polling is the lifecycle delivery contract; push is explicitly deferred

Do not add a run-lifecycle WebSocket message. Consumers poll the run-list route and converge on the next successful response. This is sufficient for the requested “batch started, N running” rendering and avoids introducing event ordering, reconnect replay, and REST/WS consistency semantics in an observability clarification.

Alternative: broadcast every parent/child transition. Rejected for this change because a correct push contract requires sequence/replay rules and a client subscription lifecycle, substantially expanding scope. A later change may add push without weakening the polling contract.

### 5. Documentation names two independent concurrency axes

Document `concurrency` as the admission policy for successive fires of one automation. Document `maxConcurrentSpawns` as the lease/spawn width inside one admitted fire. Include a `concurrency: queue` example where four leased handles start concurrently and only a second overlapping fire waits.

Do not alter runtime concurrency logic. The existing configuration precedence and hard default remain referenced as already satisfied rather than re-specified or reimplemented.

## Risks / Trade-offs

- **A source reports a stale or incorrect deferred count.** → Compute handles and count in one source operation; test boundary values and mutation-free snapshots.
- **Partial child startup makes successive polls differ.** → Specify partial parent state as valid and require convergence to persisted records, not atomic all-child visibility.
- **Polling introduces bounded display latency and request traffic.** → Accept as the explicit scope trade-off; reuse the existing run-list endpoint and client cadence rather than add another transport.
- **Existing consumers omit new count and attribution fields.** → Additive fields preserve compatibility; historical records may lack them while every new work-source child carries `workItemKey`.
- **Operators misread deferred work as failure.** → Use `deferred` terminology and document that items remain unleased and eligible, never “truncated” or “failed.”

## Migration Plan

The run-record fields and lease-summary shape are additive at persistence/API boundaries. Existing historical parent records may lack `leasedCount` and `deferredCount`, and historical child records may lack `workItemKey`; readers SHALL tolerate absence as “not recorded,” not infer zero or an item identity. New work-source fires always write explicit counts and every new work-source child records its key.

Deploy source-interface updates and engine consumption together in the automation plugin. Rollback restores the previous source return shape; records written with additive fields remain readable by older code because unknown JSON properties are ignored.
