## Why

A `visibility: hidden` automation run is supposed to stay off the session
board. It does — until the server restarts. After that, every finished run
renders as an ordinary ended card in its folder for `archiveAfterDays` (default
30). A weekly `consolidate-hermes-memory` automation produces two runs every
Monday in `$HOME`, so a folder the user never opened shows six-plus stale cards.

The board filter is `packages/client/src/lib/session/session-grouping.ts:282`:

```ts
if (s.kind === "automation" && s.automationRun?.visibility !== "shown" && !showHidden) return false;
```

`kind` is the load-bearing term, and it never survives to disk.

`SessionMeta` declares `kind` (`session-meta.ts:155`) and `automationRun`
(`:180`), documenting them as *"Persisted so a run session restored on cold
start keeps its automation grouping + effective board visibility"*.
`session-scanner.ts:229` restores `kind: meta.kind`. But `sessionToMeta()` —
the FULL-OVERWRITE projection whose own header warns that *"Any dashboard-owned
field omitted here is silently WIPED on the next save of any other field"* —
enumerates neither. The spawn seam merges them in via `mergeSessionMeta`; the
first routine debounced save wipes them. `automationRun` is doubly lost:
`session-scanner.ts` contains no reference to it at all, so even a persisted
value would not be read back.

Measured on a live install: **0 of 4607** `.meta.json` files carry `kind` or
`automationRun`.

| Consumer | Behaviour once the identity is wiped |
|---|---|
| `filterSessions` (`session-grouping.ts:282`) | gate is false → a hidden run renders as a normal board card |
| `AutomationBadge` (`AutomationBadge.tsx:19`) | returns `null` on `kind !== "automation"` → badge vanishes |
| `predicates.ts:11` (`session?.kind === "automation"`) | manifest predicate fails → plugin slot contributions do not mount |
| ended-run correlation after restart | `automationRun.runId` unrecoverable from the sidecar (a *live* run is unaffected — `event-wiring.ts:1409-1426` re-applies the stamp from the pid registry on register) |

The existing guard is blind in exactly the right place:
`meta-key-byte-identity.test.ts:59` passes `kind` through `sessionToMeta` but
asserts only `recover`, so the wipe passes CI.

## What Changes

- `sessionToMeta()` enumerates `kind` and `automationRun`, with the same
  "MUST be enumerated, full-overwrite" note its neighbours carry.
- `sessionFromMeta()` restores `automationRun` (it already restores `kind`).
- The byte-identity guard round-trips both fields through `sessionToMeta` and
  fails if either is dropped.

Both fields serialize to no key when undefined, so a plain user session's
sidecar stays byte-identical (invariant E5 holds).

Non-goals — deliberately parked, not forgotten:

- **Archiving service sessions when they end.** Investigated and dropped from
  this change: it buys only live-set residency, which this defect never
  involved, and the obvious predicate (`lifecyclePolicy === "ephemeral"`)
  collides with `embed-session-lifecycle`'s acquire ladder, which is specified
  to *resume* an ended ephemeral session.
- **Reclaiming the already-orphaned sidecars.** This fix is forward-only: runs
  whose identity was already wiped stay on the board until they age out at
  `archiveAfterDays`. A targeted reclaim is possible (the automation run-store
  maps `runId → sessionId`, so the affected sessions are identifiable without
  heuristics) but is a separate change with its own blast-radius decision — the
  broad `ephemeral` predicate would touch 579 sidecars on this install.

## Capabilities

### New Capabilities
<!-- None. This change makes existing declared behaviour actually happen. -->

### Modified Capabilities
- `meta-json-session-cache`: a session's plugin classification and run identity
  are durable across an unrelated save and are restored on cold start — today
  they are declared persisted but are wiped by the next routine write.

## Impact

- `packages/server/src/session/session-to-meta.ts` — enumerate `kind`,
  `automationRun`.
- `packages/server/src/session/session-scanner.ts` — restore `automationRun`
  in `sessionFromMeta`.
- `packages/server/src/__tests__/meta-key-byte-identity.test.ts` — round-trip
  assertion for both fields.
- Behavioural note: after this lands, restored sessions start carrying
  `kind: "automation"` again. Two consumers change behaviour as a result and
  should be confirmed, not assumed: `predicates.ts:11` (slot contributions
  mount for restored runs) and `FlowGraph.tsx:310` (projects `kind` into the
  graph node payload).

## Discipline Skills

- `review-code` — small but load-bearing persistence change; reviewed before
  commit.
- `systematic-debugging` — used to reach the root cause (0/4607 sidecars carry
  the field, and the guard test is blind at the projection); re-applied if
  restored runs still render on the board after the fix, which would indicate a
  second identity-loss path.
- `doubt-driven-review` — applied during planning. Two cycles; cycle 2 is what
  reduced this change to its current size by showing that `kind` alone closes
  the board filter and that the archive machinery was unnecessary scope.
