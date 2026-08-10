# Make the mutation harness restore survive process death

## Why

`scripts/mutation-harness.mjs` deliberately writes broken code into real
production source files, runs a test against the mutated tree, and restores the
original bytes. The restore lives in a `finally` block
(`verifyTeeth`, lines 103-107) whose own comment states the intent:

> Always restore, even if the runner threw — a mutated tree left on disk is far
> worse than a failed check.

That is correct for a *thrown* error and wrong for a *killed process*. `finally`
never executes when the process dies without unwinding — OOM kill, an outer
timeout, a `SIGKILL`, or the machine sleeping. Each mutation is a full
`execFileSync("npx", ["vitest", ...])` invocation, and the caller
`scripts/__tests__/async-semantics-mutation.test.mjs` allows `PER_TARGET_TIMEOUT
= 240_000` per target. A long, memory-hungry, kill-prone step is exactly the
shape that loses its `finally`.

This is not theoretical. On 2026-08-10 two separate runs were killed and left
mutations on disk for roughly 4.5 hours:

| repo | file | residue |
|---|---|---|
| `develop` | `packages/server/src/embed-lifecycle/visitor-session-registry.ts` | `/* mutated: timeout no longer rejects */` |
| `.worktrees/os-purge-replay-cache-on-reset-paths` | `packages/extension/src/prompt-bus.ts` | `/* mutated: cancel no longer settles */` |

The consequences are worse than a failed check, which is the exact outcome the
comment set out to avoid:

- **Silent corruption of unrelated work.** The residue appears as an
  unattributable one-line edit in `git status`. Any `git add -A` — the common
  case in this repo's own workflows — commits deliberately broken code. The
  `prompt-bus.ts` residue makes prompt cancellation never settle; the
  `visitor-session-registry.ts` residue makes an acquire timeout never reject.
  Both are exactly the class of bug this repo's promise-rule ladder exists to
  prevent.
- **Wasted debugging.** Both residues were mistaken for another agent's
  in-progress work, then for A/B-harness fixtures, before being traced. The
  failing tests contradict the committed code, so the investigation starts from
  a false premise.
- **Cross-worktree blast radius.** `repoRoot` is resolved by the caller from its
  own `import.meta.url` and passed in, so residue lands in whichever of the 11
  worktrees ran the suite. A clean `develop` says nothing about the worktrees.

## What Changes

- Journal every mutation to disk **before** the source file is written, and
  reconcile leftovers on the next run. A journal survives `SIGKILL`; a `finally`
  does not. The journal is a **directory of per-entry files** written
  temp-then-rename, so a torn write can never destroy the recovery data of a
  file that is already mutated.
- Restore from the journaled **pre-mutation bytes**, never from git. The file
  may legitimately carry uncommitted work at mutation time, so
  `git checkout -- <path>` would destroy it.
- Fail closed: a run that discovers a stale journal restores what it can,
  reports every path loudly along with how to unblock a conflict, and fails
  non-zero rather than proceeding on a tree of unknown provenance.
- Run reconciliation from a **root-level vitest `globalSetup`**, so it completes
  before any project fork loads a source file and aborts the entire run rather
  than one `it`. The harness is a library and has no `process.exit` of its own.
- Keep the existing `finally` as the fast path, and add `SIGINT`/`SIGTERM`
  restore that terminates rather than resuming. The journal is the backstop, not
  a replacement.

Out of scope: replacing the harness with Stryker (rejected in the harness
header as disproportionate), and changing which mutations run.

## Impact

- Affected code: `scripts/mutation-harness.mjs`,
  `scripts/__tests__/async-semantics-mutation.test.mjs`, `vitest.config.ts`
  (root `globalSetup`), `.gitignore`.
- Affected specs: adds capability `mutation-harness-crash-safety`.
- No production runtime code changes; this is test infrastructure only.

## Discipline Skills

`systematic-debugging` (the failure is a crash-ordering bug and must be
reproduced by simulated process death, not argued), `review-code` (the change
writes to real source files, so the fix itself needs a critical pass).
