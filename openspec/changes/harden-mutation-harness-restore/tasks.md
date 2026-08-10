# Tasks

## 1. Reproduce the failure

- [ ] 1.1 Write a test that spawns the harness in a child process, waits until a
      mutation is on disk, then `SIGKILL`s the child — asserting the source file
      is left mutated. This must FAIL to reproduce today's bug only after the
      fix; today it documents the defect.
- [ ] 1.2 Confirm the existing `finally` path still restores on a thrown error,
      so the fix is proven to be additive rather than a replacement.

## 2. Journal write path

- [ ] 2.1 Add a journal directory resolved from `repoRoot` (not cwd), so a run
      in a worktree journals into that worktree.
- [ ] 2.2 In `applyMutation`, write the journal entry (`{ path, originalBytes }`)
      and flush it to disk BEFORE `fs.writeFileSync` mutates the source.
- [ ] 2.3 Record the mutated bytes too, so reconciliation can detect a file that
      changed after the kill.
- [ ] 2.4 Remove the journal entry after the existing `finally` restore succeeds.
- [ ] 2.5 Add the journal directory to `.gitignore`.

## 3. Reconciliation path

- [ ] 3.1 On harness start, scan the journal before any mutation runs.
- [ ] 3.2 For each entry whose on-disk content matches the recorded mutated
      bytes, restore the recorded original bytes.
- [ ] 3.3 For each entry whose on-disk content matches NEITHER the mutated nor
      the original bytes, leave the file untouched and report the conflict.
- [ ] 3.4 Exit non-zero when anything was reconciled, reporting every path.
- [ ] 3.5 Proceed silently when the journal is empty or absent.

## 4. Signal handling (fast path, not the backstop)

- [ ] 4.1 Restore on `SIGINT`/`SIGTERM` so an interactive Ctrl-C recovers without
      needing the next run.
- [ ] 4.2 Verify this does NOT mask the journal path — `SIGKILL` must still be
      covered by reconciliation.

## 5. Tests

- [ ] 5.1 Killed-process test from 1.1 now passes: the next harness run restores
      the file.
- [ ] 5.2 Uncommitted-work test: mutate a file with unstaged edits, kill, and
      assert reconciliation restores the unstaged edits (NOT the committed
      version).
- [ ] 5.3 Conflict test: after a kill, edit the file by hand, then assert
      reconciliation refuses to overwrite and exits non-zero.
- [ ] 5.4 Clean-start test: empty journal produces no reconciliation output and
      the mutation checks run normally.
- [ ] 5.5 Journal-ordering test: a kill between the journal write and the source
      write leaves the source unmodified and reconciles to a no-op.

## 6. Verification

- [ ] 6.1 `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log` then grep for
      the failure summary.
- [ ] 6.2 `npm run quality:changed`.
- [ ] 6.3 Confirm `scripts/__tests__/async-semantics-mutation.test.mjs` still
      passes end to end (the harness must keep its teeth).
- [ ] 6.4 Grep every worktree for `mutated:` residue and confirm hits appear only
      inside the harness test's own string literals.
- [ ] 6.5 Run `review-code` before commit.

## 7. Documentation

- [ ] 7.1 Add/update the `scripts/AGENTS.md` row for `mutation-harness.mjs`
      noting the journal + reconciliation contract.
- [ ] 7.2 Note the crash-safety contract in the harness file header, replacing
      the current "always restore" claim which is only true for thrown errors.
