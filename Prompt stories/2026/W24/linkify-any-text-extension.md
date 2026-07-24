---
session: 019ec010
week: 2026/W24
type: development
model: "@fast"
premium: true
premium_reason: "heavy steering (6 user prompts)"
upgrade_status: pending
openspec_changes: [linkify-any-text-extension]
proposal_excerpt: "The tool-output/markdown linkifier (packages/client/src/lib/linkify-tool-output.ts) detects file references via a hardcoded extension allowlist (EXTS ~19 entries). This is both too narrow and buggy:"
---

# How we did it: linkify-any-text-extension — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The user kicked off with a single slash command: `/skill:openspec-apply-change linkify-any-text-extension`. The *real* objective, spelled out in the change's proposal, was to fix the dashboard's tool-output linkifier: `packages/client/src/lib/linkify-tool-output.ts` detected file references using a hardcoded ~19-entry extension allowlist (`EXTS`/`EXT_GROUP`). That allowlist was both **too narrow** (unlisted extensions like `.toml` were never linked) and **buggy** — three concrete defects: (A) `.json` truncated to `.js` because of enumerated-alternation prefix collision, (B) dot-directories like `.pi`/`.github` were missed, and (C) parent-traversal paths (`../../foo.ts`) mis-matched. The full ask, once the follow-up prompts landed, was end-to-end: implement the TDD change, archive it, ship it as a PR, satisfy CI + CodeRabbit, and clean up the worktree.

## 2. TL;DR playbook

1. **Kick off with the apply skill:** `/skill:openspec-apply-change linkify-any-text-extension` — it selects the change, reads context files, and drives TDD task-by-task.
2. **Write the failing tests first** (Task 1.x): add the new edge cases to `__tests__/linkify-tool-output.test.ts`, then run *scoped* with `HOME=$(mktemp -d) npx vitest run <test-file>` and confirm they fail.
3. **Implement minimally** (Task 2.x): replace the enumerated allowlist with a generic token `EXT = [A-Za-z][A-Za-z0-9]{0,15}`; grep for every `EXT_GROUP` reference (incl. the `file_uri` branch) so none are orphaned.
4. **Prove green in isolation:** re-run the linkify suite (unit + fuzz + perf). Treat full-suite flakes (perf under parallel load, unrelated `pi-image-fit` canvas/jimp failures) as environmental — confirm via `git status` that only your files changed.
5. **Build + restart** so the live UI serves the fix: `npm run build` then `POST /api/restart`; poll `/api/health` for the new uptime.
6. **Archive:** `/skill:openspec-archive-change linkify-any-text-extension` — sync the delta spec into the main spec (watch for renamed requirement headers), then move to the dated archive folder.
7. **Ship:** stage only your files (exclude local `.pi/settings.json` env edits), commit, push, `gh pr create`, and poll `gh pr checks` until green.
8. **Resolve CodeRabbit** feedback, then `gh pr merge --squash --delete-branch`; finish worktree/branch teardown **manually** from the main repo when the auto-cleanup checkout step fails.

## 3. How the collaboration unfolded

**Phase 1 — Apply (TDD implementation).** The AI selected the change, read all context + source/test files, and worked the tasks in order: added 8 failing tests first, confirmed the red, then replaced the allowlist grammar with a generic extension token plus a relative-segment class (`RDIR`). It grepped for lingering `EXT_GROUP` references and caught one in the `file_uri` branch that would otherwise have broken the build. *Why it worked:* strict test-first discipline meant every bug (json-truncation, dot-dirs, `../` traversal) had a red test proving the fix. **Decision point:** the human's first prompt delegated the whole implementation to the skill — no micro-management needed.

**Phase 2 — Green + deploy.** Full-suite runs surfaced noise: a perf test that failed only under parallel load and unrelated `pi-image-fit` failures. The AI re-ran the perf test in isolation (62 ms vs 250 ms budget) and used `git status` to prove those were pre-existing/environmental, not regressions. Then `npm run build` + `POST /api/restart`, polling health for the new bundle. *Why it worked:* isolating the flaky test instead of chasing it saved a dead-end debug loop.

**Phase 3 — Archive + spec sync** (steering #1: `openspec-archive-change`). The delta spec had two MODIFIED requirements, one of which **renamed** its header ("by known extension" → "by extension"). A subagent was delegated to sync but stalled; the AI did the sync directly, handling the rename as a rename (not a duplicate-add), then archived to the dated folder.

**Phase 4 — Ship + CI** (steering #3: `commit, create PR and monitor CI`). The AI excluded the unrelated local `.pi/settings.json` edit, committed, pushed, opened PR #106, and polled `gh pr checks` / `gh run view` through the ~6-7 min full test suite until green.

**Phase 5 — Review + merge** (steering #4 + #5). CodeRabbit flagged one issue: a `docs/file-index-client.md` row too narrative for the repo's caveman style. The AI delegated the caveman rewrite to a subagent (per docs protocol), pushed, replied on the thread, waited for the re-review, then squash-merged. The `--delete-branch` auto-cleanup failed on its local checkout step, so the AI completed remote-branch + worktree + local-branch teardown manually.

## 4. Prompts that worked

- **The goal prompt** — `/skill:openspec-apply-change linkify-any-text-extension`. Effective because the change already existed with a proposal + tasks; the skill turned one line into a full TDD run. *Stronger version for a cold start:* pre-stage the OpenSpec change (proposal + tasks + delta spec) so the apply skill has a spec to drive.
- **`commit, create PR and monitor CI`** — a high-leverage 5-word prompt that unlocked the entire ship phase (stage → commit → push → PR → poll).
- **`there are coderabbit issue. fix it.`** — pointed the AI at the review surface without spelling out the fix; it fetched the comments itself and routed the caveman rewrite through the correct subagent.
- **`merge PR, delete branch and worktree`** — one prompt for the whole teardown; the AI handled the auto-cleanup failure gracefully.
- **`it stuck`** — a 2-word nudge that rescued a stalled subagent; the AI immediately fell back to doing the sync directly.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Wait on a stalled sync subagent | `it stuck` | Set a subagent timeout expectation; fall back to direct work when a delegated step hangs |
| Stop after implementation | `/skill:openspec-archive-change …` then `commit, create PR and monitor CI` | State the full lifecycle up front: "apply → archive → PR → merge → cleanup" in one kickoff |
| Leave review feedback unaddressed | `there are coderabbit issue. fix it.` | Add "resolve all CodeRabbit threads before merge" to the ship checklist |
| Need explicit merge/cleanup | `merge PR, delete branch and worktree` | Make merge + worktree teardown an implicit part of the ship goal |

Quality bars the user imposed implicitly: TDD (tests first), caveman-style docs rows, and clean worktree teardown. None of these needed re-explaining once the skills carried them.

## 6. Skills, tools & memory created — and why they're effective

No new skills or memories were created this session — the work rode entirely on existing project skills:

- **`openspec-apply-change`** — turns a spec'd change into a task-by-task TDD run. *Effective* because it enforces red-first tests and marks task completion, removing manual bookkeeping. Invoke it whenever an OpenSpec change is ready to implement.
- **`openspec-archive-change`** (+ implicit delta-spec sync) — moves a completed change to the dated archive and folds delta requirements into the main spec. *Effective* because it catches renamed requirement headers as renames, not duplicates.
- **Subagent delegation for docs** — caveman-style `docs/file-index-client.md` rewrites are routed through a `general-purpose` subagent per repo protocol, keeping the main context clean.

*Recommendation:* the manual worktree-teardown-after-failed-`--delete-branch` sequence is repeatable enough to deserve a short skill or memory: "when `gh pr merge --delete-branch` fails on its local checkout, run `git push origin --delete <branch>` + `git worktree remove --force <path>` + `git branch -D <branch>` from the main repo."

## 7. Pitfalls & dead ends

- **Vitest needs `HOME`:** bare `npx vitest run` failed; the fix is `HOME=$(mktemp -d) npx vitest run <test-file>`. Always scope + set HOME.
- **Orphaned `EXT_GROUP` reference:** after swapping the allowlist, the `file_uri` branch still referenced the old group and broke the suite. **Grep for every occurrence** of a symbol before assuming a rename is complete.
- **Full-suite flakes are not regressions:** the perf test failed under parallel load but passed in isolation (62 ms); `pi-image-fit` failures were pre-existing canvas/jimp env issues. Isolate the suspect test and check `git status` before debugging.
- **Renamed spec requirement headers:** a by-name MODIFIED match won't find an old header if the requirement was renamed — handle it as a rename, not a duplicate-add.
- **`gh pr merge --delete-branch` local checkout fails** when the main worktree already holds `develop`. The merge still succeeds on GitHub; complete branch/worktree teardown manually.
- **Local `.pi/settings.json` env edits** creep into `git status` — exclude them explicitly when staging.

## 8. Reproduce it faster — checklist

**Inputs to have ready:**
- A spec'd OpenSpec change (proposal + tasks + delta spec) named e.g. `linkify-any-text-extension`.
- A dashboard server running locally (for build + restart + `/api/health`).
- `gh` authenticated for PR + CodeRabbit.

**Checklist:**
- [ ] `/skill:openspec-apply-change <change>` — TDD run; tests first, confirm red.
- [ ] Implement minimally; `grep` for every old symbol before assuming a rename is done.
- [ ] `HOME=$(mktemp -d) npx vitest run <test-file>` — prove green in isolation; treat env/parallel flakes as noise (verify via `git status`).
- [ ] `npm run build` + `POST /api/restart`; poll `/api/health`.
- [ ] `/skill:openspec-archive-change <change>` — sync delta → main spec (handle renamed headers), archive.
- [ ] Stage only your files (exclude `.pi/settings.json`); commit, push, `gh pr create`; poll `gh pr checks` until green.
- [ ] Resolve CodeRabbit threads (route caveman docs rewrites through a subagent); wait for re-review.
- [ ] `gh pr merge --squash --delete-branch`; on local-checkout failure, tear down remote branch + worktree + local branch manually from the main repo.

**Final artifacts produced:**
- `packages/client/src/lib/linkify-tool-output.ts` (generic `EXT` grammar)
- `packages/client/src/lib/__tests__/linkify-tool-output.test.ts` (+8 cases)
- `openspec/specs/tool-output-linkification/spec.md` (synced)
- `openspec/changes/archive/2026-06-13-linkify-any-text-extension/`
- PR #106 (squash commit `bd2b9e3c`) merged to `develop`

---

_Generated from session `019ec010-4252-77f9-a1d1-05af62a4ef36` · `/Users/robson/Project/pi-agent-dashboard` · 2026-06-13. Source extract: `/tmp/facts-1784847634N.md`._
