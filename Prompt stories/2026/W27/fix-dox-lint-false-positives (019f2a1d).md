---
session: 019f2a1d
week: 2026/W27
type: other
model: "@fast"
premium: false
premium_reason: ""
upgrade_status: n/a
openspec_changes: [fix-dox-lint-false-positives]
proposal_excerpt: "`kb dox lint` over-reports drift, and its `--fix` path would **delete valid documentation rows**. Running it on this repo today:"
---

# How we did it: Verifying an already-shipped change instead of re-implementing it — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The operator opened with a hunch, not a task: **"Maybe its implemented already"** — pointing
at the OpenSpec change `fix-dox-lint-false-positives` (a fix so `kb dox lint` stops
over-reporting drift and so its `--fix` path never deletes valid AGENTS.md documentation
rows). The *real* objective that emerged: **don't re-implement — verify whether the work
already shipped, and if the on-disk OpenSpec artifacts are stale, reconcile them without
regressing the merged spec.** The session ended not with new feature code but with a
cleanup commit removing a stale duplicate change dir.

## 2. TL;DR playbook

1. **Treat "maybe it's already done" as a verification task, not a build task.** Read the
   proposal + tasks first: `cat openspec/changes/<name>/proposal.md .../tasks.md`.
2. **Look for the implementation directly** — grep the target module and its tests for the
   named symbols/behaviors (`resolveRowPath`, `# DOX —` scope guard).
3. **Run the regression tests** scoped to the feature: `npx vitest run <testfile> -t "dox"`.
   Green + the named test cases present = shipped.
4. **Confirm real-world impact**, not just green tests — run the actual CLI
   (`kb dox lint --json`) and compare the issue count to the proposal's "before" number.
5. **Before archiving, diff the active dir against any existing archive** with the same
   change name — the archive may be the *more complete* version.
6. **If `openspec archive` regresses a good merged spec, revert the spec to HEAD** and
   delete the stale active dir instead.
7. **Commit only the cleanup** (the staged deletions), with a message that cites the PR
   the change actually shipped in.

## 3. How the collaboration unfolded

**Phase 1 — Discovery (is it already done?).** The AI read the proposal/tasks, then grepped
`packages/kb` for the two defect fixes. It found both already present in `dox.ts`:
Defect A's `resolveRowPath(agentsDir, cwd, rp)` (dir-relative resolution with repo-root
fallback) and Defect B's `# DOX —` heading scope guard (`inDox` flag) that ignores prose
tables. *Why it worked:* grepping for the exact symbols named in the proposal is the fastest
"did this ship?" probe.

**Phase 2 — Verify (tests + real impact).** It ran the dox test suite — 16 tests green,
including the two named regression cases (`kb.test.ts:538` dir-relative resolution,
`:554` non-DOX prose table). Then it ran `kb dox lint --json` live: issue total dropped to
132 from the proposal's 1226, with the 991 false-positive orphans gone. *Why it worked:*
proving the CLI's real output moved against the proposal's stated "before" number is
stronger evidence than a passing unit test.

**Phase 3 — The trap (archive regressed the spec).** Here the human said **"yes"** (archive
it). The AI ran `openspec archive` — and immediately caught that a **2026-07-03 archive of
the same change already existed and was the more complete version** (it had the `reindex.ts`
scope + Option B root-fallback). The active dir was a **stale tracked duplicate**, and the
archive run had just applied that stale, less-complete delta *over* the good merged spec.

**Phase 4 — Reconcile & clean up.** The AI reverted `openspec/specs/markdown-knowledge-base/spec.md`
back to HEAD (undoing the regression), `git rm`'d the stale active dir, verified the real
archive was intact, and confirmed the change had shipped as **PR #224 (`15fc52ef5`)**. On
the human's **"commit"**, it committed the deletions as `c840afb91` with a message citing
the PR.

## 4. Prompts that worked

- **The goal prompt — "Maybe its implemented already."** Weak on its own, but effective
  *because it reframed the whole task as verification*. It stopped the AI from building
  something that already existed. **Stronger version:** *"Before implementing
  `fix-dox-lint-false-positives`, verify whether it already shipped — check the code, the
  tests, and the live `kb dox lint` output against the proposal's before/after numbers."*
- **"yes"** — a high-leverage unlock that let the AI proceed to archive. Its value here is
  that it triggered the discovery of the stale-duplicate trap.
- **"commit"** — one word to land the reconciled cleanup once the human had seen the summary.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Reach for implementation on an OpenSpec change | Opening with "maybe it's already implemented" | Making "verify-first" the default for any change whose code area you haven't confirmed is empty |
| Trust `openspec archive` to be safe | (caught by the AI itself, unlocked by "yes") | Diffing the active change dir against any same-named archive **before** archiving |
| Leave a regressed spec after a bad archive | Implicit quality bar: don't regress the merged spec | Reverting the spec to HEAD and removing the stale active dir rather than keeping the archive output |

The key correction was self-applied but only possible because the operator kept scope tight
("maybe already done" → "yes" → "commit") and let the AI surface the duplicate rather than
rushing a new implementation.

## 6. Skills, tools & memory created — and why they're effective

No skill or memory was created this session. **The workflow is repeatable and worth a skill:**
*"verify-an-openspec-change-before-implementing"* — read proposal → grep target module for
named symbols → run scoped regression tests → run the live CLI and compare to the proposal's
before/after → diff active dir vs any same-name archive before archiving → if archive
regressed a merged spec, revert to HEAD and delete the stale active dir → commit cleanup
citing the shipping PR. It removes the biggest waste here (re-building shipped work) and the
biggest risk (an `openspec archive` on a stale duplicate silently regressing a good spec).

## 7. Pitfalls & dead ends

- **`openspec archive` on a stale active dir regresses the merged spec.** Two commands
  failed en route (an over-eager `diff -rq` / a `git checkout && git rm` combo). If you see
  a same-named archive dated earlier than your active dir, **stop** — the archive is likely
  the real, more-complete version and your active dir is a leftover duplicate.
- **Fix:** `git checkout HEAD -- openspec/specs/<capability>/spec.md` to undo the regression,
  then `git rm -rf openspec/changes/<name>/` to drop the stale active dir. Verify the archive
  dir is intact and OpenSpec still validates before committing.
- **Green tests aren't proof of impact.** Always run the actual CLI (`kb dox lint --json`)
  and compare to the proposal's stated numbers — that's what confirmed the 1226→132 drop.

## 8. Reproduce it faster — checklist

- [ ] `cat openspec/changes/<name>/proposal.md .../tasks.md` — get the named symbols + before/after numbers.
- [ ] `grep -n "<symbol>" <target-module> <target-tests>` — is it already implemented?
- [ ] `npx vitest run <testfile> -t "<feature>"` — regression tests present and green?
- [ ] Run the live CLI (`kb dox lint --json`) and compare issue count to the proposal.
- [ ] `diff` active change dir vs any same-named `openspec/changes/archive/*` before archiving.
- [ ] If `openspec archive` regressed a spec: `git checkout HEAD -- <spec>`, then `git rm -rf` the stale active dir.
- [ ] Commit only the cleanup, citing the PR/commit the change actually shipped in.

**Key inputs:** the OpenSpec change name; write access to the repo; `openspec` CLI + `vitest`.
**Final artifacts:** cleanup commit `c840afb91` (removes stale duplicate
`openspec/changes/fix-dox-lint-false-positives/`); spec stays at the merged **PR #224
(`15fc52ef5`)** version; archive `openspec/changes/archive/2026-07-03-fix-dox-lint-false-positives/`
intact; 16 dox tests green.

---

_Generated from session `019f2a1d-2d45-7885-ab32-e70c0f755918` · `/Users/robson/Project/pi-agent-dashboard` · 2026-07-04. Source extract: session facts sheet (mktemp)._
