## 1. Regression test: reproduce the husk (TDD, red first)

- [x] 1.1 `cli.test.ts` (or `indexer.test.ts`): `kb index` where **all** configured sources'
      dirs are missing SHALL exit non-zero AND leave **no file** at `dbPath` (currently
      leaves a 0-chunk 56K husk) — write it failing first
- [x] 1.2 Test: `kb index` interrupted mid-run (simulate a throw after `openStore`, before
      commit) leaves no committed DB at `dbPath`
- [x] 1.3 Test (N2 guard): a **successful** index of a present source set that contains no
      markdown writes a valid `dbPath` that DOES count as initialized — empty ≠ uninitialized;
      the gate MUST NOT re-fire on a legitimately empty index. Husk prevention comes from §2
      atomicity (no file on *failure*), NOT from treating empty-as-uninitialized

## 2. kb index atomicity + cleanup on failure

- [x] 2.1 In `packages/kb/src/cli.ts::runCmd`, make the `index` path atomic. Branch on whether
      `dbPath` already exists (single approach — NOT the "OR" of create-track+unlink; see
      design.md D1):
      - **First index (no `dbPath`)**: open the store on a temp path (`<dbPath>.tmp-<pid>`);
        `rename()` onto `dbPath` only after the run resolves. A failure/crash leaves only the
        temp orphan — the real path stays absent, so the gate correctly re-fires. This is the
        ONLY path that survives uncatchable termination (OOM/SIGKILL).
      - **Incremental (valid `dbPath` exists)**: index in-place. A mid-run failure leaves the
        prior DB non-empty/valid; a re-run completes it. No temp copy — preserves the in-DB
        `files` mtime/sha256 state that incremental skip needs.
      Do NOT use a create-track → `close()`+`unlink()`-on-failure approach: that cleanup is
      dead code under OOM/SIGKILL (the file is created by `new DatabaseSync` before the scan),
      leaving the husk it was meant to prevent.
- [x] 2.2 `packages/kb/src/sqlite-store.ts`: support opening at a temp path + a finalize-rename
      helper. WAL ordering is load-bearing: `wal_checkpoint(TRUNCATE)` + `close()` BEFORE
      `rename`, then move the single main file (sidecars empty/removed on clean close) — OR
      rename all three (`-wal`/`-shm`). Verify against `node:sqlite`; do NOT assume `close()`
      checkpoints
- [x] 2.3 Preserve incremental semantics: only a first-index run (which created the DB) may
      clean up on failure. A run over an existing valid DB leaves it **valid & queryable**
      (partially updated by committed batches, not pristine) on failure; a re-run completes it
- [x] 2.4 Tests: happy path still writes `dbPath` with correct chunk count; `--force` still
      rebuilds; a failed incremental run leaves the prior DB **valid & queryable** (assert it
      still answers a known query — NOT byte-identical; batched commits mutate it) (2.3)
- [x] 2.5 Orphan sweep: on index startup, `unlink` stale `<dbPath>.tmp-*` (+ sidecars) left by
      a prior SIGKILL'd first-index run, so temp husks don't accumulate. Cheap; guards the
      first-index path's litter (Non-Goal covers teardown litter, not this in-run orphan)

## 3. Missing source dir: config-source degrades, explicit --source errors

(N1: survivability ≠ silent semantics. A missing **config-declared** source is a degrade;
a missing **explicit `--source` arg** is a user typo that must still error — see design.md D3.)

- [x] 3.1 In `packages/kb/src/indexer.ts` (`walk` / `indexSource`), a **config-declared**
      source whose `dir` does not exist SHALL be skipped with a `console.warn`, not throw
      `ENOENT` (e.g. an optional workspace mount that may legitimately be absent)
- [x] 3.2 An **explicit `--source <dir>`** arg that does not exist SHALL still error (exit
      non-zero), not silently produce an empty index — a missing explicit path is a typo
- [x] 3.3 A partial config source set (≥1 present) SHALL produce a valid index of the present
      sources and a non-zero chunk count when any present source has files
- [x] 3.4 Tests: 3 config sources, 1 missing → index built from 2, warning emitted, exit 0;
      explicit `--source missing/` → exit non-zero; ALL config sources missing → exit non-zero
      AND no husk (ties back to 1.1, §2 atomicity holds)

## 4. Worktree-init gate coherence

- [x] 4.1 With §2's atomicity in place, `test ! -f .pi/dashboard/kb/index.db` is trustworthy
      again (file present ⟺ a successful index ran) — **keep the existing file-existence gate**.
      Do NOT harden it to probe non-emptiness: a legitimately empty source set produces a valid
      0-chunk DB (see 1.3/N2), so an "empty = needsInit" probe would re-fire forever on such a
      repo. Atomicity, not content-probing, is the coherence fix (design.md D2)
- [x] 4.2 Test/verify: a checkout whose init was interrupted (no `index.db`) re-fires init and
      recovers to a populated index; a completed init (file present) does not re-fire

## 5. Docs + verification

- [x] 5.1 Delegate to a docs subagent (caveman style): update the per-file rows for
      `packages/kb/src/cli.ts`, `indexer.ts`, `sqlite-store.ts` in their directory
      `AGENTS.md` with the failure-atomicity contract + `See change:` line
- [x] 5.2 `systematic-debugging`: confirm the husk reproduction from §1 is the committed
      regression guard
- [x] 5.3 `doubt-driven-review`: walk the crash/interrupt/rename transitions (temp DB
      orphaned on SIGKILL? WAL sidecars? concurrent index runs on one dbPath) before commit
- [x] 5.4 Run full suite (`npm test 2>&1 | tee /tmp/pi-test.log`), fix failures
