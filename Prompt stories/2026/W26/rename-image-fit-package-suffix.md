---
session: 019ef724
week: 2026/W26
type: development
model: "@fast"
premium: false
premium_reason: ""
upgrade_status: n/a
openspec_changes: [rename-image-fit-package-suffix]
proposal_excerpt: "The repo splits packages into two runtime kinds, but the npm naming only half-encodes it:"
---

# How we did it: Rename `pi-image-fit` → `pi-image-fit-extension` — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The kickoff was a single slash command: `/skill:openspec-apply-change rename-image-fit-package-suffix`. The user wanted the pre-planned OpenSpec change **implemented end-to-end** — rename the npm package `@blackbelt-technology/pi-image-fit` to `@blackbelt-technology/pi-image-fit-extension` so the package name encodes its runtime kind (extension), while leaving the runtime brand (`[pi-image-fit]`), tmpdir, `PI_IMAGE_FIT_*` env vars, and `displayName` untouched. The *real* objective, once the one steering turn landed, was **implement + ship**: apply the change, then run it all the way through PR, CI, CodeRabbit, squash-merge, and worktree cleanup — deferring only the post-publish `npm deprecate` step to the human.

## 2. TL;DR playbook

1. Run `/skill:openspec-apply-change <change>` from inside the worktree; the skill resolves itself from the **main repo root** (worktree convention).
2. Read the change context, then edit code/manifest/test-fixture files first — **delegate all `docs/` edits to a subagent** in caveman style (Documentation Update Protocol).
3. Run `npm test 2>&1 | tee /tmp/pi-test.log`; triage failures into **rename-caused** (fix now) vs **environmental** (pre-existing, out of scope).
4. Fix the one real consequence the tests enforce: the `publish.yml` `PACKAGES=()` allowlist must list the new name.
5. `openspec validate <change>` + a stray-grep for the old name (empty = pass).
6. On the steering cue "mark done, I'll do it later, use ship-change": check the deferred task box and invoke **`/skill:ship-change`**.
7. Before the ship gate, `npm install` to resolve the missing dep (`jimp`) so the full test suite goes green; verify the lockfile diff is **only** the rename.
8. Sync the delta spec into `openspec/specs/`, archive the change, commit, push, open PR against `develop`.
9. `gh pr checks <pr> --watch`; confirm CodeRabbit "Review completed" with 0 actionable threads; `gh pr merge --squash --delete-branch`.
10. Clean up: delete remote branch, `git worktree remove`, force-delete the local branch (squash rewrites history → "not fully merged" is expected).

## 3. How the collaboration unfolded

**Phase A — Discovery & context load.** The AI recognized it was in a worktree and resolved the apply-change skill from the parent repo root. It ran `openspec status --json`, read the change's context files, and reported progress at **0/12 tasks** before touching anything.

- *Why it worked:* grounding in the change's own task list turned a vague "apply it" into a concrete, checkable sequence.

**Phase B — Surgical edits.** Package identity first: `package.json` name, `recommended-extensions.ts` id+source (kept `displayName` as `pi-image-fit`), README H1 + `pi install` line, then the four test-fixture updates. Docs (`faq.md`, two file-index docs) were handed to a `general-purpose` subagent in caveman style.

- *Decision point:* the human never had to intervene here — the AI correctly split "code the main agent edits directly" from "docs a subagent writes."

**Phase C — Test triage.** `npm test` surfaced failures. The AI split them cleanly: `JimpMime` errors were **environmental** (jimp not installed in the fresh worktree — a string rename can't cause them), while `publish-allowlist-complete.test.ts` was a **real** rename consequence. It fixed `publish.yml` line 306 and re-ran only the 42 rename-affected tests to confirm green.

- *Why it worked:* refusing to "fix" unrelated red tests kept the diff surgical and in-scope.

**Phase D — The steering turn → ship.** The human said "mark done, I will do it later, use ship-change skill." The AI checked task 4.1 (the `npm deprecate` post-publish step) and switched to the ship pipeline: `npm install` to make the gate honestly green, verified the lockfile diff, synced the new `package-naming-convention` spec, archived, committed, pushed, opened **PR #165**.

**Phase E — CI, merge, cleanup.** Watched CI (green in 8m15s), confirmed CodeRabbit had 0 actionable threads, squash-merged (SHA `a35a373`), then cleaned up remote branch + worktree + local branch. When its own cwd vanished with the removed worktree, it switched to the parent repo (and finally the sandbox) to finish cleanup.

## 4. Prompts that worked

- **The goal prompt** — `/skill:openspec-apply-change rename-image-fit-package-suffix`. Effective because the *planning* was already captured in the OpenSpec change; the prompt just names it and lets the skill drive a 12-task checklist. A good kickoff when a change is already proposed.
- **High-leverage follow-up** — "mark done, I will do it later, use ship-change skill." One short sentence that (a) resolved the only non-actionable task by explicit deferral and (b) chained straight into shipping. It removed the "what about task 4?" ambiguity and authorized the whole ship pipeline in nine words.

Stronger reusable version of the follow-up: *"Task 4.1 (npm deprecate) is a post-publish step — check it as deferred and run ship-change."* — names the exact task and why it's deferred, so the AI never guesses.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Pause at the non-actionable `npm deprecate` task (needs published package) and treat it as blocking | "mark done, I will do it later" | State up front: post-publish tasks are deferred/checked, not blockers |
| Stop after "implementation complete" | "use ship-change skill" | Say "apply **and ship**" in the goal prompt so the AI chains apply → ship without waiting |

The session needed only **one** steering turn — a sign the OpenSpec change was well-scoped and the apply/ship skills carried the rest.

## 6. Skills, tools & memory created — and why they're effective

No new skills or memories were created — the workflow reused existing project skills, which is the point:

- **`openspec-apply-change`** — turns a proposed change into a task-by-task implementation with built-in doc-delegation and validation. Invoke when a change is proposed and ready to build.
- **`ship-change`** — the apply→PR→CI→CodeRabbit→merge→cleanup pipeline. Invoke once implementation is done and the gate is (honestly) green.
- **`general-purpose` subagent for docs** — enforces the caveman-style Documentation Update Protocol without polluting the main agent's context. Invoke for every `docs/` edit.

If anything *should* be captured: a one-line memory that **fresh worktrees lack installed optional deps (e.g. `jimp`) → run `npm install` before trusting the test gate**, so future ship runs don't misread environmental red as a regression.

## 7. Pitfalls & dead ends

- **Environmental test red ≠ your bug.** `JimpMime`/jimp failures came from a worktree with no `node_modules/jimp`. A string rename can't cause them. Fix: `npm install`, re-run — don't "repair" unrelated tests.
- **The rename has one enforced consequence.** `publish-allowlist-complete.test.ts` fails until `publish.yml`'s `PACKAGES=()` array lists the new name. If a rename test goes red, check the allowlist first.
- **Squash-merge → "branch not fully merged."** After `gh pr merge --squash`, `git branch -d` refuses; the change *is* landed (history was rewritten). Use `git branch -D`.
- **Your cwd can disappear.** `git worktree remove` on the directory you're standing in kills the shell's cwd. Recover by `cd` to the parent repo, or run the final commands via the sandbox with an explicit working dir.
- **Skill resolution in a worktree.** Resolve OpenSpec skills from the **main repo root**, not the checkout.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** a proposed OpenSpec change name; `gh` authenticated; the worktree checked out; the main repo root reachable for skill resolution.

- [ ] `/skill:openspec-apply-change <change>` (from the worktree; skill resolves at repo root)
- [ ] Edit code + manifest + test fixtures directly; delegate `docs/` to a subagent (caveman style)
- [ ] `npm test 2>&1 | tee /tmp/pi-test.log` → split rename-caused vs environmental failures
- [ ] Fix `publish.yml` `PACKAGES=()` allowlist to the new name
- [ ] `openspec validate <change>` + stray-grep old name (empty = pass)
- [ ] Defer post-publish tasks (`npm deprecate`) — check the box, don't block
- [ ] `npm install` (resolve optional deps like `jimp`) → full suite green; verify lockfile diff is only the rename
- [ ] `/skill:ship-change`: sync spec → archive → commit → push → PR vs `develop`
- [ ] `gh pr checks --watch`; CodeRabbit 0 actionable threads; `gh pr merge --squash --delete-branch`
- [ ] Cleanup: delete remote branch, `git worktree remove`, `git branch -D`
- [ ] **After publish:** run `npm deprecate @blackbelt-technology/pi-image-fit "renamed to @blackbelt-technology/pi-image-fit-extension"`

**Artifacts produced:** PR #165 (squash-merged, SHA `a35a373`); renamed package + manifest/fixtures/README/`publish.yml`/lockfile/3 docs; new `openspec/specs/package-naming-convention` spec; archived change at `openspec/changes/archive/2026-06-24-rename-image-fit-package-suffix/`.

---

_Generated from session `019ef724-f48f-7160-b317-f513aac28630` · `pi-agent-dashboard` · 2026-06-24. Source extract: session facts sheet._
