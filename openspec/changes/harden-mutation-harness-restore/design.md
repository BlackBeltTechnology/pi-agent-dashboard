# Design

## Context

`scripts/mutation-harness.mjs` is a deliberate, manifest-driven mutation runner
written because pulling in Stryker for a handful of files was judged
disproportionate. It is correct in every respect except crash safety: it writes
broken code into tracked production files and relies on a `finally` block to put
them back.

The failure is not a logic error. `verifyTeeth` is well-formed; the comment on
line 104 states precisely the right goal. The defect is a category mistake about
what `finally` guarantees — it unwinds a *thrown* error, not a *dead process*.

## Goals / Non-Goals

**Goals**

- A killed harness leaves the tree recoverable, and the next run recovers it.
- Recovery never destroys uncommitted work.
- A run on an unreconciled tree cannot silently report a result.

**Non-Goals**

- Replacing the harness with an off-the-shelf mutation framework.
- Changing the mutation manifest or which files are covered.
- Preventing the kill itself (the OOM behaviour of the suite is a separate
  concern, tracked by `os/fix-e2e-harness-memory-exhaustion`).

## Decisions

### D1: Journal-before-write, reconcile-on-next-start

Write `{ path, originalBytes, mutatedBytes }` to a journal file and flush it
before mutating the source. Reconcile at the start of the next run.

*Why not a signal handler alone?* Handlers cover `SIGINT`/`SIGTERM` but not
`SIGKILL`, which is what an OOM killer sends. The observed residue survived for
4.5 hours, so the real-world kill is the uncatchable kind. Signal handlers are
kept (task 4) as a nicety, not as the mechanism.

*Why not an in-memory-only restore?* That is what exists today and is exactly
what was lost.

### D2: Restore from journaled bytes, never from git

`git checkout -- <path>` is the obvious one-liner and is wrong. A mutated file
may hold uncommitted work — the harness mutates whatever is on disk, not `HEAD`.
Restoring from git would silently destroy that work, converting a recoverable
annoyance into data loss. The journal must therefore carry the literal
pre-mutation bytes.

This also matters because the residue is discovered *by* a dirty `git status`;
a fix that resolves dirtiness by discarding it would be actively harmful.

### D3: Three-way reconciliation, fail closed on conflict

On reconcile, compare on-disk content against the journal:

| on-disk matches | action |
|---|---|
| `mutatedBytes` | restore `originalBytes` — the expected residue case |
| `originalBytes` | drop the entry — already restored, nothing to do |
| neither | leave the file alone, report, exit non-zero |

The third row is the important one. Someone may have edited or hand-fixed the
file between the kill and the next run (this is what happened in the observed
incident). Blindly writing `originalBytes` would clobber that intervention.
Refusing is the only safe response, and it is loud rather than silent.

### D4: A non-empty journal invalidates the run

If reconciliation had to do work, the harness exits non-zero without running its
checks. A mutation result computed on a tree that was in an unknown state is not
trustworthy, and the whole point of this harness is trustworthiness of a
negative result. Fail closed, matching the harness's existing stance on an
ambiguous anchor (it "refuses to guess").

### D5: Journal location is derived from `repoRoot`

`repoRoot` already resolves relative to the harness file, which is why residue
is per-worktree. The journal follows the same rule so a worktree reconciles its
own residue and never reaches across into a sibling. It is gitignored — a
journal is transient local state, and committing one would itself be residue.

## Risks / Trade-offs

- **The journal is one more thing that can be stale.** Mitigated by D3: an entry
  that no longer matches reality is reported rather than applied.
- **Reconciliation runs on every harness start**, adding a directory scan. The
  harness already spends minutes per target on full vitest invocations, so the
  cost is not measurable.
- **A kill between the source write and the journal delete** leaves an entry
  whose file already matches `originalBytes`. D3 row 2 makes that a no-op.
- **Residue predating this change** is not in any journal and will not be
  auto-recovered. The `find-stray-mutation-residue` project skill covers manual
  detection; the grep in task 6.4 confirms the tree is clean at landing time.
