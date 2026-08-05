# Break the 17 module import cycles

> Rung 1c of the local-review-gate ladder (see commit `4b71d80d2` for the split
> rationale; the predecessor change `cleanup-lint-debt-mechanical` was retired).
>
> **Rewritten after adversarial review.** The first draft rested on a
> type-only-vs-value-cycle distinction that is empty in practice, proposed a fix
> ("move the type") that applies to none of the 17, hypothesised a cause that the
> probe falsifies, and reserved a right to "report and stop" that would have
> deadlocked the entire ladder.

## Why

`noImportCycles` reports **17 circular import chains** at repo-root scope: 13 in
`packages/client`, 2 in `packages/server`, 2 in `packages/flows-plugin`. Nothing
in the current gate can see them — Biome runs `preset: none` with this rule off,
and neither `tsc --noEmit` nor vitest treats a cycle as an error.

Cycles make module evaluation order significant. They produce `undefined`
bindings at import time depending on which module the bundler enters first, which
is the classic "works in dev, breaks in the production bundle" defect — and the
one class of finding in this ladder that is genuinely architectural rather than
hygienic.

`add-typeaware-lint-gate` cannot flip `noImportCycles` to `error` until this
reports zero.

## What the probe actually shows

Reproduce with (no probe config — the `--config-path` form fails Biome's ignore-file
resolution):

```bash
npx biome lint --only=lint/suspicious/noImportCycles . --max-diagnostics=20000
```

Two findings from review changed this change's shape:

- **Every flagged import is a value import** — components (`FlowAgentDetail`,
  `DiffPanel`, `MarkdownContent`, `FileLink`, `CappedViewer`, `DiffViewer`),
  hooks (`useFileOpenRouting`), and functions (`formatCost`, `blockEvents`,
  `isLoopback`, `isExternalHref`). Not one is `import type`. The repo already
  runs `useImportType: warn`, which converts type-only imports, so the
  "type-only cycle" category this change was originally built around is
  **empty**. There is no cheap half.
- **The `event-reducer` hypothesis is falsified.** Zero of the 17 involve
  `event-reducer`. They cluster in `components/preview` (5),
  `components/tool-renderers` (3), `components/editor-pane` (3),
  `components/diff` (2), client root (2), `tunnel` (1), `auth` (1) — a
  **UI-component** coupling pattern, not a state-management one.

| Package | Cycles |
|---|---|
| `packages/client` | 13 |
| `packages/server` | 2 |
| `packages/flows-plugin` | 2 |
| **total** | **17** |

## What Changes

- **Diagnose each of the 17 chains against its real fix.** Since all are value
  cycles, the available techniques are: extract the shared value into a third
  module, invert the dependency, merge two modules that are genuinely one unit,
  or lazy-import at the call site. "Move the type" is **not** among them.
- **Prefer extraction over indirection.** A new module that exists only to break
  a cycle is an indirection layer; a new module that names a concept both sides
  genuinely share is an extraction. The `code-simplification` discipline applies
  to telling these apart.
- **Handle the UI-component cluster as a cluster.** 13 of 17 are React components
  importing each other across `preview` / `tool-renderers` / `editor-pane` /
  `diff`. That is very likely one shared registry/routing concern pulled in four
  directions, not 13 independent defects. Diagnose the cluster before editing any
  member of it.
- **Respect `isolatedModules`.** `tsconfig.base.json` sets
  `isolatedModules: true` and `moduleResolution: bundler`. Any extraction that
  re-exports a type must use `export type` — a value-position re-export of a type
  is a hard compile error, not a lint warning.
- **This change must reach zero. It has no escape hatch.** It sits on the
  critical path: `add-typeaware-lint-gate` blocks on all four cleanup rungs, so a
  rung that reserves the right to stop early deadlocks the ladder. If a cycle
  genuinely requires a decomposition larger than this change, that is a **spec
  gap that must be resolved here** — by expanding this change, or by splitting
  that one cycle into its own change that this one blocks on — not by leaving the
  count above zero.
- **No severity flips.** `add-typeaware-lint-gate` owns those.

## Capabilities

### New Capabilities

*(none)*

### Modified Capabilities

- `code-quality-loop` — discharges the ratchet precondition for `noImportCycles`.
  Note this is a codebase edit, not a requirement change; if the delta cannot name
  a concrete requirement that changes, this section should be empty and the
  change carries only tasks.

*(The previously-listed conditional modification of `event-reducer-decomposition`
is **removed** — the probe shows no `event-reducer` involvement.)*

## Verification

The existing oracle is insufficient and this must be stated plainly: `tsc --noEmit`
does not fail on cycles, and vitest exercises modules through the test entry
point, not the production bundle entry point. **Neither catches an
evaluation-order regression introduced by breaking a cycle.**

Credible verification therefore needs at least:

- `npx biome lint --only=lint/suspicious/noImportCycles .` → zero.
- A **production bundle build** (`npm run build`) plus a smoke path through the
  affected UI surfaces — the E2E harness (`tests/e2e/`) is the existing home.
- For any cycled module with **import-time side effects**, an explicit test
  before the edit. Import-time side effects are the only case where reordering is
  observable, so identifying them is part of diagnosis, not an afterthought.

## Non-Goals

- Dependency declarations (`cleanup-undeclared-dependencies`), promise handling
  (`cleanup-client-plugin-promises`, `cleanup-async-semantics-server-extension`),
  severity flips (`add-typeaware-lint-gate`).
- Rewriting the component architecture. Extract what the cycle requires; do not
  redesign `preview`/`editor-pane` because the cycle exposed them.

## Impact

- `packages/client/**` (13 chains, concentrated in 4 component directories),
  `packages/server/**` (2 — `tunnel`, `auth`), `packages/flows-plugin/**` (2).
  File count exceeds chain count; each cycle spans ≥2 modules.
- **Behaviour risk is narrow but real.** Breaking a cycle changes module
  evaluation order, observable wherever a module has import-time side effects.
- No protocol, persistence, or public API change intended.

## Open Questions

- **Is the 13-cycle client cluster one defect or thirteen?** If the four
  component directories are cycling through a shared registry, the honest fix is
  one extraction, not 13 edits. This is the single question that decides whether
  this change is small or large, and it should be answered by inspection of the
  cluster **before** `tasks.md` is written.
- **Which cycled modules have import-time side effects?** These are the only ones
  where the fix is observable; they need a test first.
- **Does any cycle require a decomposition beyond this change's scope?** If yes,
  it must be split into a blocking change — not deferred, since this rung cannot
  leave the count above zero.

## Discipline Skills

- `systematic-debugging` — diagnose each chain from the actual import graph, not
  from the file names in the diagnostic.
- `code-simplification` — distinguishing extraction from indirection is the core
  judgement of this change.
- `doubt-driven-review` — a structural fix to a value cycle is expensive to
  reverse once merged.
- `review-code` — structural edits across three packages.
- `scenario-design` — the bundle-order regression risk needs real scenarios; the
  default oracle provably does not cover it.
