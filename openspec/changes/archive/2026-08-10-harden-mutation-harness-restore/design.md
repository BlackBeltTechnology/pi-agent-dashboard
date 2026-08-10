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

Before mutating a source file, write one journal **entry file** and close it.
Reconcile at the start of the next run.

*Why not a signal handler alone?* Handlers cover `SIGINT`/`SIGTERM` but not
`SIGKILL`, which is what an OOM killer sends. The observed residue survived for
4.5 hours, so the real-world kill is the uncatchable kind. Signal handlers are
kept (task 4) as a nicety, not as the mechanism.

*Why not an in-memory-only restore?* That is what exists today and is exactly
what was lost.

### D1a: A journal DIRECTORY of per-entry files, written atomically

The journal is a directory, `.mutation-journal/` under `repoRoot`, holding one
file per in-flight mutation — **not** a single shared JSON file rewritten per
mutation.

The distinction is the whole point of the change. A shared file is rewritten
while an *earlier* mutation is still live on disk, so a kill during that rewrite
can truncate the recovery data for a file that is currently broken — the exact
failure D1 exists to prevent, reintroduced one layer down. Per-entry files scope
any torn write to an entry whose source file has not been touched yet (the entry
always precedes its source write).

Each entry is written to a temp file and published with `fs.linkSync`, so a
reader never observes a half-written entry. `linkSync` rather than `renameSync`
is deliberate: rename silently clobbers an existing target, while link fails
with `EEXIST` — which is what makes the same-file refusal in D7 possible at all.

Entries record `{ path, originalBytes, mutatedBytes }` where `path` is
**repo-relative** (absolute paths break under `git worktree move`) and both byte
fields are **base64 of the raw `Buffer`**. The harness's own
`readFileSync(abs, "utf8")` decodes and strips a BOM; round-tripping through
that decode is not byte-exact restoration. Irrelevant for today's TypeScript
targets, wrong the first time a target carries a BOM or non-UTF-8 bytes, and the
spec says *bytes*.

### D1b: An unreadable entry is a conflict, never a silent delete

A journal entry that is missing, unparseable, or fails its own shape check is
treated as D3 row 3: report it, fail the run, do not touch the source file and
do not remove the entry. Deleting an entry the harness cannot understand throws
away the only record that a file may still be mutated.

### D1c: An entry is untrusted input — containment before any write

Reconciliation's whole job is to overwrite the file an entry names, so the entry
decides what gets written where. `path.join(repoRoot, "../../x")` leaves the
tree, and type-checking the field says nothing about where it points. Every
entry path is therefore resolved and required to stay under `repoRoot`; one that
does not is a conflict like any other — reported, never obeyed.

The journal is gitignored local state rather than a network input, so this is
defence in depth against a corrupted, hand-edited, or stale-format entry, not a
threat model. It costs two lines and removes an arbitrary-file-write primitive
from a script that runs on every `npm test`. Raised by CodeRabbit on PR #455.

### D2: Restore from journaled bytes, never from git

`git checkout -- <path>` is the obvious one-liner and is wrong. A mutated file
may hold uncommitted work — the harness mutates whatever is on disk, not `HEAD`.
Restoring from git would silently destroy that work, converting a recoverable
annoyance into data loss. The journal must therefore carry the literal
pre-mutation bytes.

This also matters because the residue is discovered *by* a dirty `git status`;
a fix that resolves dirtiness by discarding it would be actively harmful.

The journal therefore carries base64-encoded raw bytes (D1a), not decoded text.

### D3: Three-way reconciliation, fail closed on conflict

On reconcile, compare on-disk content against the journal:

| on-disk state | action |
|---|---|
| matches `mutatedBytes` | restore `originalBytes` — the expected residue case |
| matches `originalBytes` | drop the entry — already restored, nothing to do |
| matches neither | leave the file alone, report, fail the run |
| file does not exist | treat as row 3 — report, fail the run, keep the entry |

The missing-file row is reachable: the operator checks out a branch without that
file, or deletes it, between the kill and the next run. Recreating it from
`originalBytes` would resurrect a file the operator deliberately removed, and a
silent drop would discard the only record that the file was mid-mutation. It is
the same class of ambiguity as row 3 and gets the same refusal.

The third row is the important one. Someone may have edited or hand-fixed the
file between the kill and the next run (this is what happened in the observed
incident). Blindly writing `originalBytes` would clobber that intervention.
Refusing is the only safe response, and it is loud rather than silent.

### D3a: A conflict must name its own unblock path

Row 3 leaves both the file and the entry in place, so every subsequent run
re-reports it and fails again — permanently, with no human in CI. That is the
correct safety posture only if the operator is told how to clear it, so the
conflict report names the two exits explicitly: reconcile the file by hand to
either recorded side, or delete the named entry under `.mutation-journal/` to
assert the file is intentionally in its current state.

This also covers a false conflict: a kill lands between the journal write and
the source write (D1's ordering), the operator later edits the file for an
unrelated reason, and reconciliation now sees a file matching neither side of an
entry for a mutation that was **never applied**. Safe, blocking, and
indistinguishable from a real conflict without the unblock instruction.

### D4: A CONFLICT invalidates the run; a clean restore only warns

The fail-closed line is drawn at *ambiguity*, not at *residue*.

| reconcile outcome | run |
|---|---|
| nothing to do (empty/absent journal) | proceeds silently |
| entry owned by a live process (D4b) | **proceeds**, entry untouched |
| every entry cleanly restored (D3 rows 1-2) | **proceeds**, reporting each restored path loudly |
| any conflict (D3 rows 3-4, or an unreadable entry) | **fails non-zero, nothing runs** |

The original formulation — *any* non-empty journal invalidates the run — was too
blunt once reconciliation moved ahead of every project (below). A clean restore
completes *before* any test file is loaded, so the tree it hands over is in a
known state; refusing to run on it would brick the whole suite for a condition
the harness just fixed. A conflict is different: the tree is genuinely of
unknown provenance and nothing downstream can be trusted. That is where the
refusal belongs — matching the harness's existing stance on an ambiguous anchor
(it "refuses to guess").

A clean restore is still **loud** — every restored path is reported. It records
that a previous run died mid-mutation, which is information the operator needs
even though this run is safe.

**The mechanism is not `process.exit`.** `mutation-harness.mjs` is a *library*
imported by `scripts/__tests__/async-semantics-mutation.test.mjs`; it has no
exit to take. Two weaker placements were considered and rejected:

- *Reconcile inside `verifyTeeth`.* A failing `it` does not stop later `it`s, so
  target 1's reconcile failure still lets targets 2-4 mutate and check the tree.
  That is not "without running its mutation checks".
- *Reconcile at the mutation test file's module scope.* Correct for that one
  file, but the residue is repo-wide. The root config runs `test.projects`
  concurrently (`packages/extension` and `scripts` both `pool: "forks"`,
  `maxWorkers: "50%"`), so the extension's own forks load `prompt-bus.ts` —
  possibly the mutated bytes — before the `scripts` fork ever reaches its
  reconcile, and the restore `writeFileSync` can race a concurrent module read.

So reconciliation runs as a **root-level vitest `globalSetup`**, which completes
before any project fork loads a source file, and **throws on a conflict** —
aborting the whole run, not one test. `reconcile()` is also exported and exposed
as `node scripts/mutation-harness.mjs --reconcile` so the unblock path (D3a) and
CI hooks do not have to go through vitest.

The cost of the root-level placement is accepted deliberately: a conflict blocks
**every** `npm test` on that worktree, not just the mutation test. That is the
point — residue in `prompt-bus.ts` makes the extension's own suite lie, and a
suite that lies is worse than a suite that refuses. The blast radius is bounded
by restricting it to conflicts (the table above), which a human can always clear
via D3a.

### D4b: An entry owned by a LIVE process is in-flight, not residue

Discovered during implementation, and it invalidates D4 as first written.

`runTestFile` shells out to `npx vitest run <testFile>`. That child is itself a
vitest run, so it loads the **root** config — `globalSetup` included. With
reconciliation wired there, the child reconciled the mutation its own parent had
just applied, ran the target test against **restored** code, saw it pass, and
the harness concluded every mutation had survived. The crash-safety fix silently
removed the harness's teeth; its own X15 checks caught it.

An env flag telling the child to skip would fix that one path and miss the
general case: a developer running a plain `npm test` in another terminal while a
harness run is mid-mutation would restore the mutation just the same, and the
harness would report a false survivor with nothing to indicate why.

So entries carry the **owning pid**, and reconciliation *skips* — neither
restores nor conflicts — any entry whose owner is still alive. Residue is by
definition what a process left behind when it *stopped* existing; a live owner's
mutation is work in progress and belongs to that process.

`process.kill(pid, 0)` is the liveness probe (`EPERM` counts as alive: the pid
exists, it just belongs to another user). Pid reuse is the known weakness, and it cuts
one way that is NOT benign: if a dead owner's pid has been recycled by an
unrelated process, the entry is skipped, so the run proceeds against a tree that
still carries the mutation instead of failing closed. It recovers on a later run
once the pid stops resolving.

Closing that properly needs an owner identity that cannot be recycled — the
process start time alongside the pid — and Node exposes no portable way to read
another process's start time. A `pid` + random-token pair does not help either,
since the token is only as trustworthy as the liveness probe that reads it. The
alternative, treating every entry as residue, reintroduces exactly the
self-clobbering this decision exists to stop. So the collision window is
accepted and recorded here rather than papered over.

Note this narrows D7's collision guard rather than replacing it: a second run
still *refuses* on an existing entry (it is about to mutate the same file), and
reconciliation still declines to clean up after a run that is still going.

### D4a: The signal handler restores and then dies — it does not resume

A `SIGINT`/`SIGTERM` handler that restores the tree and lets the in-flight check
continue would run that check against a *restored* file and report the mutation
as survived — a false negative produced by the safety mechanism itself. The
handler restores, removes its entries, and terminates non-zero. It is a fast
path for an interactive Ctrl-C, never a way to keep going.

### D5: Journal location is derived from `repoRoot`

`repoRoot` is resolved by the *caller* — `async-semantics-mutation.test.mjs`
derives it from its own `import.meta.url` — and passed into the harness, which
is why residue is per-worktree. The journal directory is derived from that same
`repoRoot`, so a worktree reconciles its own residue and never reaches across
into a sibling. `.mutation-journal/` is gitignored — a journal is transient
local state, and committing one would itself be residue.

### D6: Durability means "written and closed", not `fsync`

The promise is survival of **process death**: `SIGKILL`, OOM kill, an outer
timeout, a sleeping machine. A `writeFileSync` that has returned is already in
the page cache and survives every one of those. `fsync` on the entry and on the
parent directory would additionally survive power loss or a kernel panic, which
is outside the observed incident set and outside this change. The spec says
"written and closed before" rather than "durably written" so the level being
promised is not ambiguous.

### D7: One harness run per worktree at a time — and a collision is a contract

Two overlapping harness runs in one worktree (a `vitest --watch` alongside a
one-off, two terminals, CI on the same checkout) would mutate the same
production files and share one journal directory. This change does **not**
introduce a lock; it assumes a single writer.

The collision behaviour is nonetheless a **promise, not a side effect**:
exclusive-mode entry creation (D1a) means the second run fails on an existing
entry for a file it is about to mutate. Two runs silently interleaving their
restores is the failure this whole change exists to prevent — one run's restore
landing after the other's mutation reproduces the residue exactly. So the
refusal is specified and tested rather than left to be inferred from the
`wx` flag, which a later refactor could drop without noticing.

### D8: A deterministic seam for the ordering scenario

"Killed between the journal write and the source write" cannot be tested by
racing a real kill against two adjacent synchronous writes. `applyMutation`
today is a straight read → anchor-check → write with nothing to grab onto, so
the journal write and the source write become separately callable: a test can
write the entry, assert the source file is untouched, and run `reconcile()` — no
process kill, no timing. The genuine `SIGKILL` case is covered once, at a coarse
grain, by spawning a real child harness process and killing it.

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
- **A kill inside a single source write** (between `O_TRUNC` and the write
  syscall) leaves a partial file matching neither recorded side, so D3 row 3
  refuses it and the operator restores by hand from the reported entry. Outside
  the incident set, and the alternative — writing the source atomically too —
  buys little for a file that is about to be overwritten again anyway.
- **The ownership check (D4b) is invisible to the harness's own mutation sweep.**
  Mutating it away is self-erasing: with ownership disabled, the child vitest's
  `globalSetup` reconciles the parent's mutation of `mutation-harness.mjs`
  itself, so the tests run against restored code and the mutation reports as
  survived. Verified instead by disabling the check directly and observing
  test-plan #X13 go red. Any future mutation targeting the journal's own
  machinery inherits this blind spot and must be checked the same way.
- **`reconcile()` now runs on every `npm test`**, not only on a mutation run,
  because the `globalSetup` is root-level (D4). It is a directory `stat` on the
  clean path.
- **A vitest worker-timeout kill sends `SIGTERM` to the fork only**, orphaning
  the harness's `npx vitest` child (`runTestFile`), which then runs against a
  tree the D4 signal handler has already restored. Pre-existing, unchanged by
  this design, and harmless — the orphan's result is discarded with its parent.
