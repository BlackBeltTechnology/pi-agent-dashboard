## Why

Deferred follow-up #3 from `collapse-superseded-tool-execution-updates`.

The collapse gate retains up to **2** `tool_execution_update` events per
`toolCallId`: the pinned creating tick (first-wins `type`/`description`) and the
newest tail. Once `tool_execution_end` arrives for that call, the tail update is
in principle redundant — the end event carries the final `details`.

It was NOT dropped in the parent change, on purpose. Dropping it is only safe if
the end event's `details` are equivalent to the final update's `details` for
EVERY producer version in the field, and that equivalence was never verified.
Shipping it unverified risks silently losing the last rendered subagent state —
exactly the failure the parent change's `subsumes()` superset gate was built to
prevent.

## What Changes

- Verify, empirically and per producer version, whether `tool_execution_end`
  `details` are a superset of the final `tool_execution_update` `details`.
  Note the parent change established these resolve from DIFFERENT places:
  updates from `data.partialResult.details`, ends from top-level `data.details`.
  The reducer treats them as distinct branches.
- Only if equivalence holds: drop the retained tail update on
  `tool_execution_end`, reusing the existing `subsumes()` superset gate rather
  than a new bespoke predicate.
- If equivalence does NOT hold for some version: keep the tail and record why,
  so this is not re-proposed on the same reasoning.

## Impact

- Affected specs: event-store retention.
- Affected code: `packages/server/src/persistence/memory-event-store.ts`
  (`collapseSuperseded` / `dropIfSuperseded`), store + replay-equivalence tests.
- Gated on: cross-version verification against `pi-dashboard-subagents`. This is
  a correctness precondition, not a task ordering preference.

## Discipline Skills

- `doubt-driven-review` — the decision to drop a retained event is irreversible
  for that session's replay; the review belongs BEFORE the drop lands.
