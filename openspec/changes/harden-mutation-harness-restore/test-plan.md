# Test Plan — harden-mutation-harness-restore

Stage: design   Generated: 2026-08-11

All four clarifications (C1 missing-file outcome, C2 fail-closed blast radius,
C3 perf budget, C4 concurrency contract) were resolved at the HARD gate and
folded into `design.md` / `specs/**` before this catalog was written. No
`[NEEDS CLARIFICATION]` markers remain.

**Level note.** Every automatable scenario here is L1. The capability is a
filesystem protocol inside a Node script with no rendered UI, no install/OS
surface, and no browser observable — routing any of it to L2/L3 would be
downgrading a precise assertion into a smoke check. Two rows are `manual-only`
because their only honest observable is a human reading a report.

The L1 home is `scripts/__tests__/*.test.mjs` (the `scripts` vitest project,
`pool: "forks"`). The nearest harness exemplar for all of them is the existing
`scripts/__tests__/async-semantics-mutation.test.mjs` — it already builds
`repoRoot` from `import.meta.url`, drives `verifyTeeth`, and asserts fail-closed
behaviour (`refuses an ambiguous anchor rather than guessing`).

**Fixture rule (applies to every row).** No scenario may mutate a real tracked
production file. Each test builds a throwaway `repoRoot` under `fs.mkdtempSync`
holding a fake source file, and points the harness at it. A test for a
crash-safety mechanism that leaves residue when *it* is killed would be the
original bug wearing a lab coat.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | R1 / journal-before-source | state-transition (legal edge) | L1 | automated | temp repoRoot, source file with known bytes, one mutation | journal write step called, source write step NOT yet called | a journal entry exists on disk AND the source file bytes are byte-identical to before |
| E2 | R1 / entry removed on normal restore | state-transition (legal edge) | L1 | automated | temp repoRoot, one mutation, runner stubbed to return immediately | `verifyTeeth` completes normally | `.mutation-journal/` contains zero entries AND a following `reconcile()` returns nothing restored, nothing conflicted |
| E3 | R1 / one entry per mutation | decision-table | L1 | automated | temp repoRoot, mutation A journaled and applied on disk | mutation B is journaled while A is still applied | two distinct entry files exist; A's entry parses and still resolves to A's original bytes |
| E4 | R1 / torn write cannot destroy a live entry | fault-injection (abort) | L1 | automated | temp repoRoot, entry A live; a stray partial/garbage file placed in `.mutation-journal/` | `reconcile()` runs | A is reported as a conflict (garbage entry, D1b) AND entry A itself is still parseable and untouched |
| E5 | R1 / byte-exact restore | BVA (encoding boundary) | L1 | automated | temp repoRoot, source file whose bytes start with a UTF-8 BOM and contain a lone surrogate / invalid UTF-8 sequence | mutation applied, process killed, `reconcile()` runs | restored file `Buffer` equals the original `Buffer` byte-for-byte (`Buffer.compare === 0`), BOM intact |
| E6 | R1 / journal path is repo-relative | EP (valid partition) | L1 | automated | temp repoRoot, one mutation journaled | the whole temp repoRoot directory is renamed, then `reconcile()` runs against the new path | the entry still resolves and restores — no absolute path baked in |
| E7 | R3 / clean start is silent | EP (empty partition) | L1 | automated | temp repoRoot with absent `.mutation-journal/`, and separately an empty one | `reconcile()` runs | returns no restored paths and no conflicts, emits no reconciliation report, does not throw |
| E8 | R5 / second concurrent run refused | decision-table | L1 | automated | temp repoRoot, an existing journal entry for `foo.ts` | a second journal write is attempted for `foo.ts` | the second write throws AND `foo.ts` on disk is unmodified AND the first entry is unchanged |

### Frontend-quirk

None — this capability has no rendered surface. (Recording the absence
deliberately: routing a filesystem protocol to Playwright to fill a table row
would be the "don't downgrade to smoke" failure in the other direction.)

### Performance

None. Per C3, the clean-path cost is structurally one directory `stat`; the
shape assertion that matters is covered by E7 (`reconcile()` on an absent
journal reads no source file), not by a latency threshold.

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | R1 / recoverable after SIGKILL | fault-injection (abort) | L1 | automated | a real child process running the harness against a temp repoRoot, killed with `SIGKILL` once its mutation is confirmed on disk | child is dead; a fresh `reconcile()` runs | before reconcile the source file holds the mutated bytes; after reconcile it holds the pre-mutation bytes exactly |
| X2 | R2 / uncommitted work survives | fault-injection (abort) | L1 | automated | temp git repo; file committed, then given unstaged edits; harness mutates it; process killed | `reconcile()` runs | file content equals the **unstaged** pre-mutation content, NOT `HEAD`; `git diff` still shows the user's edit |
| X3 | R2 / conflict is refused | fault-injection (abort) | L1 | automated | after a kill leaves residue, the file is hand-edited to a third distinct content | `reconcile()` runs | the file is byte-unchanged from the hand-edit AND the entry still exists AND the call fails non-zero naming that path |
| X4 | R2 / conflict report names its unblock | fault-injection (abort) | L1 | automated | the X3 conflict state | `reconcile()` runs | the failure message names the entry file under `.mutation-journal/` and states both exits (restore to a recorded side, or delete that entry) |
| X5 | R2 / unreadable entry is a conflict | fault-injection (corrupt input) | L1 | automated | a `.mutation-journal/` entry containing invalid JSON / a valid-JSON object missing `mutatedBytes` | `reconcile()` runs | no source file is written, the entry is NOT deleted, the call fails non-zero naming the entry |
| X6 | R2 / journaled file no longer exists | fault-injection (missing dependency) | L1 | automated | a live journal entry whose source file has been deleted from the tree | `reconcile()` runs | the file is NOT recreated AND the entry is NOT removed AND the call fails non-zero naming the path |
| X7 | R1 / kill between journal and source write | state-transition (illegal edge) | L1 | automated | journal entry written, source write never reached (E1's state) | `reconcile()` runs | the entry resolves via D3 row 2 (on-disk matches `originalBytes`) — the file is left byte-unchanged, the entry is dropped, no conflict, no failure |
| X8 | R3 / a conflict blocks every project | fault-injection (abort) | L1 | automated | a conflicting journal entry present at run start | the root `globalSetup` executes | `globalSetup` throws; the run reports zero executed test files across all projects, not merely a failed `scripts` project |
| X9 | R3 / a clean restore does NOT block the run | state-transition (legal edge) | L1 | automated | a cleanly recoverable journal entry present at run start | the root `globalSetup` executes | it does not throw; the restored path appears in the run output; the suite proceeds and executes tests |
| X10 | R3 / reconcile precedes every project fork | state-transition (ordering) | L1 | automated | a recoverable entry for a source file that another vitest project imports | a full run starts | the restore completes before any project fork loads that module — the importing project observes the restored bytes, never the mutated ones |
| X11 | R4 / SIGINT restores and stops | fault-injection (signal) | L1 | automated | a child harness process against a temp repoRoot, mid-mutation | child receives `SIGINT` | the source file is restored, its journal entry is gone, the child exits non-zero, and it reports NO result for the in-flight mutation |
| X12 | R1 / the existing `finally` still restores on a throw | state-transition (legal edge) | L1 | automated | temp repoRoot; the test runner stubbed to throw | `verifyTeeth` is called | the throw propagates AND the source file is restored AND the journal entry is removed — the journal is proven additive, not a replacement |
| X13 | R6 / a live owner's mutation is untouchable | state-transition (illegal edge) | L1 | automated | a child harness process holding a mutation on disk, still running | `reconcile()` runs in a different process | the entry is skipped — not restored, not conflicted — the file keeps its mutated bytes, the entry remains, and `globalSetup` does not throw |

### Manual-only

| id | requirement | technique | level | disposition | surface | trigger | expected observable |
|----|-------------|-----------|-------|-------------|---------|---------|---------------------|
| M1 | R2 / D3a report is actionable | human judgment | — | manual-only | the conflict report text | an operator who did not write this change reads it cold | [judgment: the operator can clear the conflict from the message alone, without opening the source] |
| M2 | R1 / no residue at landing time | human sweep | — | manual-only | all 11 worktrees | grep for `mutated:` after the change lands | [judgment: hits appear only inside the harness test's own string literals — pre-existing residue is out of the journal's reach by construction] |

---

## Coverage summary

- Requirements covered: 6/6 (R1 recoverable-after-death, R2 non-destructive
  reconciliation, R3 fail-closed, R4 interrupt-restores-and-stops, R5
  concurrent-run-refused, R6 in-flight-mutation-untouched)
- Scenarios by class: edge 8 · perf 0 · frontend 0 · error 13 · manual 2
- Scenarios by level: L1 21 · L2 0 · L3 0 · manual-only 2
- Scenarios by disposition: automated 21 · manual-only 2

> **X13 was added during implementation, not planning.** The harness's own X15
> teeth checks failed once reconciliation was wired into the root `globalSetup`:
> `runTestFile` spawns `npx vitest`, that child inherits the global setup, and it
> reconciled away the mutation its parent had just applied. Planning missed it
> because D4 reasoned about *other* projects racing the reconcile and not about
> the harness's own child being a vitest run too. See design D4b.

## New infra needed

- **A test seam between the journal write and the source write** (design D8).
  E1 and X7 are unwritable without it — `applyMutation` is today a single
  read → check → write with no interior. This is already tasked (2.2); flagging
  it here because two scenarios are blocked until it exists.
- **A killable child-harness fixture** for X1 and X11 (spawn the harness as a
  real process against a temp repoRoot, poll until the mutation is observable on
  disk, then signal it). No such fixture exists in `scripts/__tests__/`.
- No new test level or harness: everything routes to the existing `scripts`
  vitest project.
