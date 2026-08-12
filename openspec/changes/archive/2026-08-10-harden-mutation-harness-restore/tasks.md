# Tasks

## 1. Reproduce the failure

- [x] 1.1 Write a test that spawns the harness in a child process, waits until a
      mutation is on disk, then `SIGKILL`s the child. Assert the FULL sequence:
      the source is left mutated immediately after the kill (the `finally` never
      ran), and a subsequent `reconcile()` restores it. Residue after a kill is
      expected by design — recovery is the next run's job, not the dead
      process's.
- [x] 1.2 Confirm the existing `finally` path still restores on a thrown error,
      so the fix is proven to be additive rather than a replacement.

## 2. Journal write path

- [x] 2.1 Add a `.mutation-journal/` directory resolved from `repoRoot` (not
      cwd), so a run in a worktree journals into that worktree.
- [x] 2.2 Split the journal write out of `applyMutation` as its own callable
      step (design D8), and write the entry BEFORE `fs.writeFileSync` mutates
      the source.
- [x] 2.3 Write ONE entry file per mutation, temp-then-`fs.linkSync` (NOT
      `renameSync`, which would silently clobber an existing entry) — never a single shared file rewritten per mutation
      (design D1a).
- [x] 2.4 Store `{ path, originalBytes, mutatedBytes }` with `path`
      repo-relative and both byte fields base64 of the raw `Buffer`, so
      restoration is byte-exact and survives `git worktree move` (design D1a).
- [x] 2.5 Remove the journal entry after the existing `finally` restore succeeds.
- [x] 2.6 Refuse to journal a mutation for a source file that already has an
      entry — exclusive create, no overwrite, no source write (design D7).
- [x] 2.7 Add `.mutation-journal/` to `.gitignore`.

## 3. Reconciliation path

- [x] 3.1 Export `reconcile(repoRoot)` from the harness; it scans the journal
      and returns/throws rather than calling `process.exit` (the harness is a
      library — design D4).
- [x] 3.2 For each entry whose on-disk content matches the recorded mutated
      bytes, restore the recorded original bytes.
- [x] 3.3 For each entry whose on-disk content matches NEITHER the mutated nor
      the original bytes, leave the file untouched and report the conflict.
- [x] 3.4 Treat an unparseable entry, and an entry whose source file no longer
      exists, as conflicts: touch nothing, keep the entry, report it
      (design D1b, D3 row 4).
- [x] 3.5 Include the unblock instruction in every conflict report — restore the
      file to a recorded side, or delete the named entry (design D3a).
- [x] 3.6 Report every restored path loudly on a clean restore, and let the run
      PROCEED; fail non-zero only when an entry could not be cleanly resolved
      (design D4).
- [x] 3.7 Proceed silently when the journal is empty or absent.
- [x] 3.6a Refuse any entry whose path resolves outside `repoRoot` before
      reading or writing it — reconciliation overwrites what it resolves, so a
      corrupted entry could otherwise clobber any file the user can write
      (CodeRabbit finding, PR #455).
- [x] 3.7a Record the owning pid on every entry, and SKIP — neither restore nor
      conflict — any entry whose owner is still alive (design D4b). Without this
      the harness's own `npx vitest` child reconciles its parent's live mutation
      and every mutation reports as survived.
- [x] 3.8 Wire `reconcile` into a root-level vitest `globalSetup` in
      `vitest.config.ts` so it completes before ANY project fork loads a source
      file, and throws on a conflict to abort the whole run (design D4).
- [x] 3.9 Add a `--reconcile` CLI entry to `scripts/mutation-harness.mjs` for
      the manual unblock path, outside vitest.

## 4. Signal handling (fast path, not the backstop)

- [x] 4.1 Restore on `SIGINT`/`SIGTERM` so an interactive Ctrl-C recovers without
      needing the next run.
- [x] 4.2 The handler restores, removes its entries, and TERMINATES non-zero — it
      never resumes the in-flight check against a restored file (design D4a).
- [x] 4.3 Verify this does NOT mask the journal path — `SIGKILL` must still be
      covered by reconciliation.

## 5. Tests

All rows below are the `automated` scenarios of `test-plan.md`, folded one task
per row. Every one is L1, authored in the `scripts` vitest project
(`scripts/__tests__/*.test.mjs`).

**Harness exemplars** (copy glue from these, do not invent):
see `scripts/__tests__/async-semantics-mutation.test.mjs` for driving the
harness API and asserting fail-closed behaviour; see
`scripts/__tests__/repair-meta-source.test.mjs` for the `mkdtempSync`
temp-root fixture pattern with `rmSync` teardown.

**Fixture rule:** no test may mutate a real tracked source file — every one
builds a throwaway `repoRoot` under `mkdtempSync` (test-plan "Fixture rule").

- [x] 5.0 Add the shared temp-repoRoot fixture helper (fake source file +
      manifest + teardown) that the rows below build on; see
      `scripts/__tests__/repair-meta-source.test.mjs`.
- [x] 5.1 Journal precedes the source write — input: temp repoRoot with a known
      source file and one mutation · trigger: journal step called, source write
      step not yet called · observable: an entry exists on disk AND the source
      bytes are byte-identical to before. (test-plan #E1) See
      `scripts/__tests__/async-semantics-mutation.test.mjs`.
- [x] 5.2 A normal restore leaves no entry — input: temp repoRoot, one mutation,
      runner stubbed to return · trigger: `verifyTeeth` completes normally ·
      observable: `.mutation-journal/` is empty AND a following `reconcile()`
      reports nothing restored and nothing conflicted. (test-plan #E2) See
      `scripts/__tests__/async-semantics-mutation.test.mjs`.
- [x] 5.3 One entry per mutation — input: temp repoRoot with mutation A journaled
      and applied · trigger: mutation B is journaled while A is still applied ·
      observable: two distinct entry files exist AND A's entry still parses and
      resolves to A's original bytes. (test-plan #E3) See
      `scripts/__tests__/async-semantics-mutation.test.mjs`.
- [x] 5.4 A torn entry cannot destroy a live one — input: entry A live plus a
      partial/garbage file in `.mutation-journal/` · trigger: `reconcile()` runs ·
      observable: the garbage entry is reported as a conflict AND entry A is
      still parseable and untouched. (test-plan #E4) See
      `scripts/__tests__/repair-meta-source.test.mjs`.
- [x] 5.5 Restore is byte-exact — input: source file starting with a UTF-8 BOM
      and containing invalid UTF-8 bytes · trigger: mutate, kill, `reconcile()` ·
      observable: `Buffer.compare(restored, original) === 0`, BOM intact.
      (test-plan #E5) See `scripts/__tests__/repair-meta-source.test.mjs`.
- [x] 5.6 Entry paths are repo-relative — input: temp repoRoot with one mutation
      journaled · trigger: rename the whole temp repoRoot, then `reconcile()`
      against the new path · observable: the entry still resolves and restores.
      (test-plan #E6) See `scripts/__tests__/repair-meta-source.test.mjs`.
- [x] 5.7 A clean start is silent — input: temp repoRoot with an absent journal,
      and separately an empty one · trigger: `reconcile()` runs · observable: no
      restored paths, no conflicts, no reconciliation output, no throw.
      (test-plan #E7) See `scripts/__tests__/async-semantics-mutation.test.mjs`.
- [x] 5.8 A second concurrent run is refused — input: an existing entry for
      `foo.ts` · trigger: a second journal write is attempted for `foo.ts` ·
      observable: the second write throws AND `foo.ts` is unmodified AND the
      first entry is unchanged. (test-plan #E8) See
      `scripts/__tests__/async-semantics-mutation.test.mjs`.
- [x] 5.9 Add the killable child-harness fixture (spawn the harness as a real
      process against a temp repoRoot, poll until the mutation is observable on
      disk, then signal it) — no exemplar exists in `scripts/__tests__/`; nearest
      child-process glue is `scripts/__tests__/verify-published-imports.test.mjs`.
      Required by 5.10 and 5.20. (test-plan: New infra needed)
- [x] 5.10 Recoverable after `SIGKILL` — input: a child harness process against a
      temp repoRoot, killed with `SIGKILL` once its mutation is on disk ·
      trigger: a fresh `reconcile()` · observable: mutated bytes before,
      pre-mutation bytes exactly after. (test-plan #X1) See 5.9's fixture.
- [x] 5.11 Uncommitted work survives — input: temp git repo, file committed then
      given unstaged edits, mutated, process killed · trigger: `reconcile()` ·
      observable: content equals the UNSTAGED pre-mutation content not `HEAD`,
      and `git diff` still shows the user's edit. (test-plan #X2) See
      `scripts/__tests__/repair-meta-source.test.mjs`.
- [x] 5.12 A conflict is refused — input: residue after a kill, then the file
      hand-edited to a third distinct content · trigger: `reconcile()` ·
      observable: the file is byte-unchanged AND the entry still exists AND the
      call fails non-zero naming that path. (test-plan #X3) See
      `scripts/__tests__/async-semantics-mutation.test.mjs`.
- [x] 5.13 A conflict report names its unblock — input: the 5.12 conflict state ·
      trigger: `reconcile()` · observable: the message names the entry file under
      `.mutation-journal/` and states both exits (restore to a recorded side, or
      delete that entry). (test-plan #X4) See
      `scripts/__tests__/async-semantics-mutation.test.mjs`.
- [x] 5.14 An unreadable entry is a conflict — input: an entry with invalid JSON,
      and one valid-JSON but missing `mutatedBytes` · trigger: `reconcile()` ·
      observable: no source file written, the entry NOT deleted, fails non-zero
      naming the entry. (test-plan #X5) See
      `scripts/__tests__/repair-meta-source.test.mjs`.
- [x] 5.15 A journaled file that no longer exists is a conflict — input: a live
      entry whose source file has been deleted · trigger: `reconcile()` ·
      observable: the file is NOT recreated, the entry is NOT removed, fails
      non-zero naming the path. (test-plan #X6) See
      `scripts/__tests__/repair-meta-source.test.mjs`.
- [x] 5.16 A kill between journal and source write reconciles to a no-op — input:
      5.1's state (entry written, source write never reached) · trigger:
      `reconcile()` · observable: on-disk matches `originalBytes`, the file is
      byte-unchanged, the entry is dropped, no conflict and no failure.
      (test-plan #X7) See `scripts/__tests__/async-semantics-mutation.test.mjs`.
- [x] 5.17 A conflict blocks every project — input: a conflicting entry present at
      run start · trigger: the root `globalSetup` executes · observable:
      `globalSetup` throws and the run executes zero test files across ALL
      projects, not merely a failed `scripts` project. (test-plan #X8) See
      `scripts/__tests__/repair-meta-source.test.mjs`.
- [x] 5.18 A clean restore does NOT block the run — input: a cleanly recoverable
      entry at run start · trigger: the root `globalSetup` executes · observable:
      it does not throw, the restored path appears in the output, and the suite
      proceeds. (test-plan #X9) See
      `scripts/__tests__/repair-meta-source.test.mjs`.
- [x] 5.19 Reconcile precedes every project fork — input: a recoverable entry for
      a source file another vitest project imports · trigger: a full run starts ·
      observable: the importing project observes the restored bytes, never the
      mutated ones. (test-plan #X10) See
      `scripts/__tests__/async-semantics-mutation.test.mjs`.
- [x] 5.20 `SIGINT` restores and stops — input: a child harness process
      mid-mutation · trigger: the child receives `SIGINT` · observable: the file
      is restored, its entry is gone, the child exits non-zero, and NO result is
      reported for the in-flight mutation. (test-plan #X11) See 5.9's fixture.
- [x] 5.21 The existing `finally` still restores on a throw — input: temp
      repoRoot with the runner stubbed to throw · trigger: `verifyTeeth` is
      called · observable: the throw propagates AND the source is restored AND
      the entry is removed — proving the journal is additive, not a replacement.
      (test-plan #X12) See
      `scripts/__tests__/async-semantics-mutation.test.mjs`.
- [x] 5.24 A mutation may not escape the tree — input: a manifest mutation whose
      `source` resolves outside `repoRoot` · trigger: `beginMutation()` ·
      observable: throws before any read or write, the outside file unchanged,
      no journal entry. (test-plan #X15) See
      `scripts/__tests__/mutation-journal.test.mjs`.
- [x] 5.23 Reconciliation stays inside the tree — input: an entry whose `path`
      resolves outside `repoRoot` · trigger: `reconcile()` · observable: reported
      as a conflict, the outside file byte-unchanged, nothing restored.
      (test-plan #X14) See `scripts/__tests__/mutation-journal.test.mjs`.
- [x] 5.22 A live owner's mutation is untouchable — input: a child harness
      process holding a mutation on disk, still running · trigger: `reconcile()`
      in a different process · observable: the entry is skipped (not restored,
      not conflicted), the file keeps its mutated bytes, the entry remains, and
      `globalSetup` does not throw. (test-plan #X13) See 5.9's fixture.

## 6. Verification

- [x] 6.1 `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log` then grep for
      the failure summary.
- [x] 6.2 `npm run quality:changed`.
- [x] 6.3 Confirm `scripts/__tests__/async-semantics-mutation.test.mjs` still
      passes end to end (the harness must keep its teeth).
- [x] 6.4 Grep every worktree for `mutated:` residue and confirm hits appear only
      inside the harness test's own string literals. (test-plan #M2, manual-only)
- [x] 6.5 Have someone who did not write this change read a conflict report cold
      and confirm they can clear it from the message alone, without opening the
      source file. (test-plan #M1, manual-only)
- [x] 6.6 Run `review-code` before commit.

## 7. Documentation

- [x] 7.1 Add/update the `scripts/AGENTS.md` row for `mutation-harness.mjs`
      noting the journal + reconciliation contract.
- [x] 7.2 Note the crash-safety contract in the harness file header, replacing
      the current "always restore" claim which is only true for thrown errors.
- [x] 7.3 Record the single-writer assumption (one harness run per worktree at a
      time, design D7) in the harness header, and the durability level promised
      (page cache, not `fsync` — design D6).
