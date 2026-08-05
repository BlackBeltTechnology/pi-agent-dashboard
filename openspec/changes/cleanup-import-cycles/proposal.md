# Break the 17 module import cycles

> Rung 1c of the local-review-gate ladder. Split out of
> `cleanup-lint-debt-mechanical` after doubt-driven-review cycle 3: cycle-breaking
> is structural refactoring, not the mechanical manifest work it was bundled with.

## Why

`noImportCycles` reports **17 circular import chains**: 13 in `packages/client`,
2 in `packages/server`, 2 in `packages/flows-plugin`. Nothing in the current
gate can see them — Biome runs with `preset: none` and this rule off, and neither
`tsc --noEmit` nor vitest treats a cycle as an error.

Cycles are the one finding in this ladder that is genuinely *architectural*. They
make module evaluation order significant, produce `undefined` bindings at import
time under the wrong entry point, and are a leading cause of "works in dev, breaks
in the bundle" defects. A cluster of 13 in the client is also a signal in its own
right — it may indicate the `event-reducer` decomposition is incomplete.

This rung unblocks `add-typeaware-lint-gate`, which cannot flip `noImportCycles`
to `error` until this reports zero.

## Measured baseline

Re-derive before implementing; the count is a snapshot:

| Package | Cycles |
|---|---|
| `packages/client` | 13 |
| `packages/server` | 2 |
| `packages/flows-plugin` | 2 |
| **total** | **17** |

## What Changes

- **Diagnose each cycle before fixing it.** For every chain, determine whether it
  is (a) a *type-only* cycle — resolvable by moving a shared type or switching to
  `import type`, genuinely mechanical; or (b) a *value* cycle — real bidirectional
  runtime coupling, requiring a structural fix.
- **Fix type-only cycles by moving the type**, not by adding an indirection layer.
- **Escalate value cycles explicitly.** A value cycle broken by inserting a new
  abstraction usually trades a visible defect for a hidden one. Where the correct
  fix is a decomposition larger than this change, say so and surface it rather
  than forcing a local workaround.
- **No severity flips.** `add-typeaware-lint-gate` owns those.

## Capabilities

### New Capabilities

*(none)*

### Modified Capabilities

- `code-quality-loop` — discharges the ratchet precondition for `noImportCycles`.
- `event-reducer-decomposition` — **only if** the client cycles turn out to be
  symptoms of that decomposition being incomplete. Listed as conditional; the
  delta is written only if diagnosis confirms it.

## Non-Goals

- Dependency declarations or Biome overrides (`cleanup-undeclared-dependencies`).
- Promise handling (`cleanup-client-plugin-promises`,
  `cleanup-async-semantics-server-extension`).
- Any rule severity flip (`add-typeaware-lint-gate`).
- A general architecture refactor. If a cycle demands one, this change reports it
  and stops — it does not undertake it.

## Impact

- `packages/client/**` (13 chains), `packages/server/**` (2),
  `packages/flows-plugin/**` (2). File count is larger than chain count — each
  cycle spans at least two modules.
- **Behaviour risk is real but narrow.** Breaking a cycle changes module
  evaluation order. Where a module has import-time side effects, that is
  observable — so "behaviour-preserving" holds only for cycles with no
  import-time effects, which must be verified per cycle rather than assumed.
- No protocol, persistence, or public API change intended.

## Open Questions

- **How many of the 17 are type-only?** This is the whole risk profile of the
  change. If most are type-only, the change is small and safe; if most are value
  cycles, it may need to become a decomposition proposal instead. **This should
  be answered by a spike before `tasks.md` is written.**
- **Do the 13 client cycles cluster around `event-reducer`?** If so, the honest
  fix may be to finish that decomposition rather than break 13 cycles
  individually.
- **Do any cycled modules have import-time side effects?** Those are the only
  ones where reordering is observable, and they need a test before the edit.

## Discipline Skills

- `code-simplification` — breaking a cycle by adding an indirection layer is
  usually the wrong fix; prefer moving the shared type.
- `doubt-driven-review` — a structural fix to a value cycle is expensive to
  reverse once merged.
- `systematic-debugging` — diagnose each chain from evidence (the actual import
  graph) rather than from the file names in the diagnostic.
- `review-code` — structural edits across 3 packages.
