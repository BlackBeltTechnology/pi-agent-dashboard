# Cross-plugin work-source seam + targeted single-item run

## Why

The dashboard already has a work-source seam (`automation-work-source`) that
lets a `schedule.batch` automation fan out one child per leased item. But the
seam is only half-generic: **only the automation plugin can register a source**,
every source must vend **synchronously**, and there is **no way to process one
named item on demand**. The publish/collect doctrine already proven by
`automation-action-registry` and `automation-folder-scope-contribution` was
never applied to work-sources, so:

- a foreign plugin cannot contribute its own queue — it must *be* the
  automation plugin or go without;
- a source whose availability lives behind an async port (DB, REST, another
  plugin) cannot participate, because `next()` is synchronous;
- there is no "process this one item now" path — only whole-batch fan-out;
- `routes.ts` freezes `KNOWN_KINDS = new Set(["schedule"])`, so a valid
  `schedule.batch` automation shows **invalid** in `/list` and `/definition`
  while the scheduler happily fires it.

This change makes the seam fully generic, so any plugin can contribute a source
and any single item can be run on demand. It must land on today's `develop`,
which since the seam was first prototyped has landed the goal/spawn-correlation
detach (`pluginRef`/`lifecycle`) — so the engine graft must preserve that and
never revert to `automationRun`.

## What Changes

- **Cross-plugin registration seam.** New `work-source-contributions.ts`
  collector + `WorkSourceRegistry.addProvider`. Any plugin publishes
  `{ id, source }` under `automation.worksource.<id>`; the registry consults
  providers **lazily** on every `get`/`has`/`ids`, so load order is irrelevant
  and the publishing plugin keeps ownership of its lease-stateful instance.
  Locally-registered ids win a collision; a throwing provider is isolated.
- **Async vend widening.** `AsyncWorkSource` + `WorkSourceContext` so a source
  MAY resolve `next()`/`take()` asynchronously and receives the firing
  automation's `cwd`. Strictly a widening — every existing synchronous
  `WorkSource` still satisfies the contract unchanged.
- **Targeted single-item run.** `engine.runWorkItem(automation, key)` leases the
  ONE item whose idempotency key is `key` via the source's optional `take`; the
  lease itself is the single-flight guard (`in_flight` when already leased,
  `unsupported` when the source has no `take`). Exposed to other plugins as
  `automation:runWorkItem` and wired through `runWorkItemViaEngine`.
- **`/list` stops lying.** `routes.ts` validates `on.kind`/`on.source` against
  the **live** engine registries via `hooks.triggerKinds()` /
  `hooks.workSourceIds()`, falling back to a frozen set only for a bare test
  mount with no engine.

Non-goals: any concrete consumer source and its migration (a separate change);
any change to what an action *does*.

## Capabilities

### Modified Capabilities

- `automation-work-source`: adds cross-plugin provider registration, async vend
  with per-call context, targeted single-item run (`runWorkItem`/`take`), and
  live-registry validation of `on.source` in `/list`.

## Impact

- `packages/automation-plugin/src/server/work-source-contributions.ts` — **NEW**
  (collect half of the seam).
- `packages/automation-plugin/src/server/work-source-registry.ts` —
  `WorkSourceProvider` + `addProvider`, lazy consult with per-provider isolation.
- `packages/automation-plugin/src/shared/work-source.ts` — `WorkSourceContext`,
  optional `take`, `AsyncWorkSource`, `AnyWorkSource` union.
- `packages/automation-plugin/src/server/engine.ts` — `runWorkItem` (grafted
  onto develop's `pluginRef` engine; `automationRun` NOT reintroduced).
- `packages/automation-plugin/src/server/index.ts` — `consumeAll` wire,
  `triggerKinds`/`workSourceIds` route hooks, `runWorkItemViaEngine`,
  `automation:runWorkItem` provide.
- `packages/automation-plugin/src/server/routes.ts` — `FALLBACK_KINDS` + live hooks.
- **Already on `develop` (no code here):** `scanner.ts` + `automation-schema.ts`
  already thread work-source ids into validation; the base `schedule.batch`
  fan-out (`scheduleBatchTrigger`, `startWorkSourceFire`, `workSources`) already
  shipped via `automation-work-source-fanout`.
