---
session: 019f103b
week: 2026/W27
type: development
model: "@fast"
premium: true
premium_reason: "heavy steering (6 user prompts)"
upgrade_status: pending
openspec_changes: [fix-doctor-windows-launch-test]
proposal_excerpt: "On Windows, `packages/electron/src/lib/doctor.ts:381` builds a probe command of the form:"
---

# How we did it: Fix the Windows Doctor "Server launch test" false positive — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The session opened with:

> "Current proposal is: fix-doctor-windows-launch-test The code improved a lot from the proposal. Validate."

The real objective, once the steering turns filled it in: **land the Windows Doctor
fix end-to-end.** On Windows, `doctor.ts` built its Server-launch probe as
`import "C:\…\cli.ts"`, which Node rejects with `ERR_UNSUPPORTED_ESM_URL_SCHEME` — a
false-positive failure in the Doctor "Server launch test". The full arc: validate
that the proposal's fix was actually implemented (it wasn't), implement it, prove it
with a unit test, decide whether CI can exercise it, then commit → PR → monitor CI →
ship via the `ship-change` skill onto `develop`.

## 2. TL;DR playbook

1. **Validate before trusting the proposal.** Grep the target file for the exact
   symbols the proposal promises (`pathToFileURL`, `buildServerLaunchTestCmd`, the
   test file). Diff against the base branch. Report "the code *around* it changed but
   the fix is absent" honestly — don't assume "improved a lot" means "done".
2. **Run `/skill:openspec-apply-change <change>`** to implement against the tasks.md.
3. **Implement the fix as a pure, testable helper.** Extract
   `buildServerLaunchTestCmd({ nodeBin, jitiUrl, testCli })` that emits
   `JSON.stringify(pathToFileURL(testCli).href)` → `file://` form; leave the call
   site template unchanged.
4. **Write cross-platform assertions.** `pathToFileURL("C:\\…")` only yields
   `file:///C:/…` on win32; on POSIX it percent-encodes as a relative path. Assert
   the invariants true everywhere (scheme prepended, no raw `import "C:\`) and gate
   the exact `file:///C:/…` string behind `runIf(win32)`.
5. **Answer "can CI test this?" with the workflow reality**, not a guess: grep
   `.github/workflows/` for `runs-on` / `windows` / `vitest`. Conclusion here: the
   win32 assertion skips on Ubuntu and no Windows runner runs vitest today.
6. **Commit → push → `gh pr create --base develop` → poll `gh pr checks`.** Dispatch
   the Electron CI leg you care about: `gh workflow run ci-electron.yml -f legs=win32`.
7. **Triage red CI against your diff.** If a failure is in a file your branch never
   touched, prove it pre-existing on `develop` and rebase onto green — don't "fix"
   someone else's breakage.
8. **Ship via `/skill:ship-change`**: defer manual QA smokes, run the verify gate,
   archive + sync specs, squash-merge, delete branch, remove worktree.

## 3. How the collaboration unfolded

**Phase 1 — Validate (skeptical).** The AI grepped `doctor.ts` for
`pathToFileURL`/`importSpec`/`buildServerLaunchTestCmd`, checked for the test file,
and ran `git diff main -- doctor.ts` (empty). It reported the uncomfortable truth: the
surrounding code had been refactored into `runServerLaunchTest`, but the actual bug
fix was **not** present and all tasks.md checkboxes were unchecked. *Why it worked:*
it verified against the code, not the prose claim — the single most valuable move in
the session.

**Phase 2 — Implement (apply-change).** Driven by `openspec-apply-change`, it added
the `pathToFileURL` import, extracted the pure helper, and wrote
`doctor-launch-test.test.ts`. *Decision point:* it discovered the `-e` shell-escaping
and the POSIX-vs-win32 divergence of `pathToFileURL`, and rewrote the test to assert
cross-platform invariants + a win32-gated exact-string check rather than a brittle
literal.

**Phase 3 — CI feasibility (steering #2).** Asked "is it possible to test with CI?",
the AI didn't hand-wave — it grepped the workflows and produced a table showing
`ci.yml` is ubuntu-only (win32 test skips) and the Windows runners only do
install/packaging smokes, then proposed a scoped `windows-latest` vitest leg.

**Phase 4 — Commit, PR, monitor (steering #3).** Ran the advisory CodeRabbit gate,
committed, pushed, opened PR #186 against `develop`, polled `gh pr checks`, and
dispatched the `win32` Electron leg.

**Phase 5 — Red-CI triage.** Two red flags appeared. The AI isolated each: (a)
`recommended-routes.test.ts` expected manifest length `15` but got `18` — a
**pre-existing drift on develop** from an unrelated `feat(recommended)` commit; (b)
the arm64 Electron leg failed because `windows-latest` runners are x64 and can't
silent-install an arm64 `Setup.exe`. The x64 leg (matching runner arch) passed
end-to-end. It documented both on the PR as environmental.

**Phase 6 — Rebase & ship (steering #4 "1", #5 "use ship-change").** When the human
picked "fix the develop breakage as its own PR", the AI investigated and found PR #187
had *already* fixed the count to `18` upstream — so it did the simpler correct thing:
rebased #186 onto now-green `develop`, force-pushed, went green. Then ran
`ship-change`: deferred the two manual VM smokes, ran the verify gate (full-suite
local failures traced to timing/parallel flakes — the same commit was green on CI),
archived + synced the `doctor-diagnostic` delta, squash-merged as `17e69044`, and
cleaned up the worktree.

## 4. Prompts that worked

- **The goal prompt** — *"Current proposal is: X. The code improved a lot from the
  proposal. Validate."* Effective because it explicitly requested **validation**, not
  blind continuation — which surfaced that the fix was actually missing. A stronger
  version: *"Validate whether the proposal's fix is actually implemented in the code;
  grep for the exact promised symbols and diff against base before trusting any 'it
  improved' claim."*
- **High-leverage follow-ups** (short, unlocked a lot):
  - `/skill:openspec-apply-change fix-doctor-windows-launch-test` — one line, drove
    the whole implementation against tasks.md.
  - *"is it possible to test with CI?"* — forced a grounded workflow audit instead of
    an assumption.
  - *"commit and create PR. Monitor CI and execute Electron CI"* — batched the entire
    ship-prep into one instruction.
  - *"1"* — a single character that picked an option cleanly (the AI had numbered the
    choices, so this worked; see §5 for why numbering matters).
  - *"I will do it later. Use ship-change skill"* — deferred manual QA and named the
    exact skill to run.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Take "the code improved a lot" at face value | "Validate." | Always diff + grep the promised symbols against base before continuing an apply |
| Stop after implementing (no CI thought) | "is it possible to test with CI?" | Add a CI-feasibility check to the apply loop for platform-specific fixes |
| Need an explicit go for commit/PR/Electron CI | "commit and create PR. Monitor CI and execute Electron CI" | Let the ship instruction batch these; pre-number any option menus so a one-char reply resolves |
| Consider "fix the develop breakage as its own PR" | picked "1", then AI found it was already fixed upstream | Before fixing a red test on your branch, check whether HEAD `develop` already resolved it — rebase beats re-fixing |
| Want to keep going toward merge | "I will do it later. Use ship-change skill" | Name the exact skill (`ship-change`) and explicitly defer manual QA smokes |

Quality bars the human imposed implicitly: **honest verdicts** (the AI reported "fix
absent" rather than papering over it) and **distinguishing your diff from ambient
breakage** (never claim your change caused a red check without proving the counter).

## 6. Skills, tools & memory created — and why they're effective

No new skill or memory was created — the session was a clean composition of existing
skills: `openspec-apply-change` (implement), `ship-change` (land), plus the advisory
CodeRabbit gate. One subagent was spawned (`general-purpose`) to add the file-index
rows for the new test + `doctor.ts` export, honoring the Documentation Update Protocol
(delegate `docs/` writes).

**The repeatable pattern worth a skill** (if it recurs): *"triage a red PR check
against your own diff"* — isolate the failing assertion, `git diff --name-only
origin/develop...HEAD` to see if your branch even touches it, confirm the breakage
pre-exists on `develop`, then rebase onto green rather than authoring a fix. This
distinguishes ambient CI rot from a real regression and saved a needless throwaway PR
here.

## 7. Pitfalls & dead ends

- **Trusting "the code improved a lot."** The proposal's fix was entirely absent
  despite surrounding refactors. → Always grep the exact promised symbols and
  `git diff <base>` before continuing.
- **`pathToFileURL` is platform-specific.** On POSIX, `C:\…` is treated as a relative
  path and percent-encoded, so `file:///C:/…` only materializes on win32. → Assert
  cross-platform invariants (scheme prepended, no raw `import "C:\`) and gate the exact
  Windows string behind `runIf(win32)`.
- **arm64 Electron leg fails on `windows-latest`.** GitHub's Windows runners are x64,
  so an arm64 NSIS `Setup.exe` can't silent-install its arm64 binary
  (`pi-dashboard.exe not found after 150s`). → Expect this; validate on the x64 leg
  whose arch matches the runner.
- **Full-suite local test failures ≠ regression.** 22+ failures (concentrated in an
  unrelated `image-fit-extension`, plus a `doctor-route` timing assertion `4211 < 3000`)
  were parallel/teardown contention on the dev machine. → Re-run the suspicious files
  **in isolation** (they passed) and trust that CI ran the exact commit green.
- **Squash-merge `--delete-branch` aborted mid-way.** `gh` tried to check out
  `develop` locally (already used by the parent worktree) — a known branch-collision
  pitfall. The remote merge succeeded; the remote branch had to be deleted explicitly
  afterward, and the shell CWD (the now-deleted worktree) needed an explicit working
  dir to finish cleanup.
- **A worktree based on stale `develop`** (manifest still 15) can't fix a
  current-`develop` (manifest 18) problem — spin a fresh worktree off latest
  `develop`, or just rebase.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** the OpenSpec change name, `gh` authenticated, the base
branch (`develop`), a worktree off *latest* `develop`.

1. `grep` target file for the proposal's promised symbols + `git diff <base>` → prove
   whether the fix exists.
2. `/skill:openspec-apply-change <change>` — implement as a pure helper.
3. Write cross-platform-safe tests; gate OS-specific assertions with `runIf(win32)`.
4. Grep `.github/workflows/` to state precisely what CI does/doesn't exercise.
5. CodeRabbit gate → commit → push → `gh pr create --base develop`.
6. `gh pr checks <n>` poll; `gh workflow run ci-electron.yml -f legs=win32`.
7. For any red check: prove it's your diff or pre-existing on `develop`; rebase onto
   green rather than re-fixing upstream breakage.
8. `/skill:ship-change` — defer manual QA, verify-in-isolation, archive + sync specs,
   squash-merge, clean up worktree (delete remote branch explicitly if `gh` aborts).

**Final artifacts:** `packages/electron/src/lib/doctor.ts` (helper
`buildServerLaunchTestCmd` + `pathToFileURL`),
`packages/electron/src/lib/__tests__/doctor-launch-test.test.ts` (new), archived change
`openspec/changes/archive/2026-06-29-fix-doctor-windows-launch-test/`, PR #186 squash-
merged to `develop` as `17e69044`.

---

_Generated from session `019f103b-7808-73ba-9268-8bf2e98b5386` · `/Users/robson/Project/pi-agent-dashboard` · 2026-06-29. Source extract: session facts sheet for fix-doctor-windows-launch-test._
