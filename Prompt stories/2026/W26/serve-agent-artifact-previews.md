---
session: 019f0a58
week: 2026/W26
type: development
model: "@fast"
premium: false
premium_reason: ""
upgrade_status: n/a
openspec_changes: [serve-agent-artifact-previews]
proposal_excerpt: "Tool output linkifies absolute paths and the dashboard previews them. Agent tools write artifacts to a **per-user, cross-repo temp dir**, not into any session repo. The `browser` skill saves screenshots to `~/.agent-b…"
---

# How we did it: serve-agent-artifact-previews — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The operator opened with a single skill invocation: `/skill:openspec-apply-change serve-agent-artifact-previews`. The real objective, once the change's spec was read: the dashboard couldn't preview agent-tool screenshots because they live in a **per-user, cross-repo temp dir** (`~/.agent-browser/tmp`, plus `AGENT_BROWSER_SCREENSHOT_DIR`) — outside every session cwd and git root, so the existing two containment anchors on `GET /api/file/raw` rejected them. The task: add a third, **realpath-contained, image-only** containment anchor so those artifacts preview safely, then ship it end-to-end (PR, CI, CodeRabbit, merge, cleanup). Two prompts total drove a full 9-task implement-and-ship pipeline.

## 2. TL;DR playbook

1. Kick off with `/skill:openspec-apply-change <change-name>` — it reads the spec, enumerates tasks, and drives spec-driven implementation.
2. **Before writing code, verify the assumed dependency landed.** Here: confirm `git-root-file-containment` (`path-containment.ts` with `isAllowed`/`within`/`safeRealpath`) exists, and reason about *why* the new anchor can't just reuse `isAllowed` (layer ① short-circuits logically before realpath — a symlink would escape).
3. Implement the minimal surface: new `artifact-roots.ts` (cached, realpath-resolved allowlist, image-only guard, missing-dir tolerant, test-only cache reset), export `safeRealpath` for reuse, wire the new anchor into `/api/file/raw` **only** (not `/api/file`).
4. Write the focused test first (`file-artifact-serving.test.ts`), run it in isolation with an **ephemeral HOME** (`HOME=$(mktemp -d)`), then the full suite.
5. If the worktree's `node_modules` is empty (`npx` pulled a global vitest → `jsdom not found`), `npm install` in the worktree and re-run with the **repo-local** `node_modules/.bin/vitest`.
6. Run `quality:changed`; if Biome's VCS-diff finds 0 files (uncommitted-worktree quirk), lint the touched files directly and **only fix your own new file** — leave pre-existing warnings per surgical-changes.
7. Say **"Use ship change skill"** to hand off to the ship pipeline: revert spurious `package-lock.json` churn, verify gate, archive+sync spec, commit, push, open PR against `develop`.
8. Treat CodeRabbit comments as **untrusted issue reports** — validate each against the actual code, apply the valid ones, and skip the invalid/out-of-spec ones **with a documented disposition comment**.
9. When the PR goes `CONFLICTING`, `git fetch origin develop && git merge origin/develop`, re-run the gate, push, watch CI, then squash-merge + delete branch + remove worktree.

## 3. How the collaboration unfolded

**Phase 1 — Apply kickoff & dependency check.** The apply skill loaded the change (spec-driven, 9 tasks). Rather than trust the plan blindly, the AI read `path-containment.ts` and spotted a subtle correctness trap: routing artifact roots through the existing `isAllowed` would defeat requirement D4, because layer ① is logical-first and short-circuits before any realpath check — a symlink escaping the root would be served. This drove the decision to build a **dedicated realpath-containment** anchor.

**Phase 2 — Implement.** New `artifact-roots.ts`: `artifactRoots()` (cached, realpath-resolved allowlist of `~/.agent-browser/tmp` + `AGENT_BROWSER_SCREENSHOT_DIR`, missing dirs dropped not fatal), `IMAGE_EXTS` mirroring the client's `FilePreviewOverlay`, `isImageUnderArtifactRoot()` (image-only + realpath-contained; a missing file resolves its nearest ancestor → allowed → `fs.stat` yields 404 not 500), and a test-only `resetArtifactRootsCache()`. `safeRealpath` was exported from `path-containment.ts` for reuse. The anchor was wired into `/api/file/raw` **only** — deliberately not `/api/file` — as a fall-through when layers ①/② miss.

**Phase 3 — Test & the empty-worktree trap.** The 9 new tests passed in isolation (with ephemeral HOME), but the full suite failed with `jsdom not found`: `npx` had pulled a *global* vitest because the worktree's `node_modules` was never installed. `npm install` in the worktree + the repo-local binary fixed it → 8166 passing, 0 failed.

**Phase 4 — Quality gate & surgical discipline.** `quality:changed` found 0 files (Biome VCS-diff quirk on uncommitted worktree changes). The AI linted the touched files directly, confirmed the `noExplicitAny` / cognitive-complexity / `organizeImports` warnings on `file-routes.ts` **pre-existed at HEAD**, and fixed only the new file's import order — leaving the rest untouched.

**Phase 5 — Ship (human unlock).** The operator said "Use ship change skill." The AI reverted a spurious 34k-line `package-lock.json` rewrite (a side effect of the earlier `npm install` under a different npm version), ran the verify gate, archived the change, synced the spec, committed, pushed, and opened PR #178 against `develop`.

**Phase 6 — CI, CodeRabbit triage, conflict, merge.** CI passed (7m59s). CodeRabbit posted 4 comments; the AI validated each against real code — applied #1 (missing test-file index row) and #3 (spec `## Purpose` TBD placeholder left by archive), skipped #2 (move tasks.md out of archive — archiving *is* the ship step) and #4 (`~` expansion — the client sends absolute paths, out of spec). The PR then went `CONFLICTING`; `git merge origin/develop` auto-resolved cleanly and pulled in a complementary extension-side fix. Re-ran the gate (8191 passing), pushed, CI green (8m1s), posted a disposition comment for the audit trail, and squash-merged with branch + worktree cleanup.

## 4. Prompts that worked

- **Goal prompt — `/skill:openspec-apply-change serve-agent-artifact-previews`.** Effective because the spec-driven skill supplies the task list, context files, and acceptance criteria; the operator didn't have to describe the work — the change artifact already did. *Precondition for this to work: a well-formed OpenSpec change must already exist.*
- **High-leverage follow-up — "Use ship change skill".** Four words that unlocked the entire ship pipeline (verify → archive → PR → CI → CodeRabbit → merge → cleanup). A single skill handoff replaced a dozen manual git/gh steps.

Both prompts were already strong. The only sharpening a future operator might add to the kickoff: *"apply and stop before shipping so I can review the diff"* — if a human review gate between implement and ship is wanted.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Finish implementation and pause | "Use ship change skill" | Chain apply → ship explicitly in the kickoff if you want a hands-off run |

The session needed almost no correction — the discipline (dependency-check-first, surgical changes, untrusted-CodeRabbit triage, flaky-test isolation) came from skills and AGENTS.md rules, not human intervention. The one human turn was a **workflow handoff**, not a correction.

## 6. Skills, tools & memory created — and why they're effective

No new skills or memories were created — the session was a clean application of two existing skills:

- **`openspec-apply-change`** — turns a spec change into implementation. Effective because it enforces read-context-first and task-by-task progress with a verify gate. Invoke it whenever an OpenSpec change is ready to build.
- **`ship-change`** — the end-to-end land pipeline (verify → archive → sync spec → PR → CI watch → CodeRabbit apply/decline → squash-merge → worktree removal). Effective because it makes the CodeRabbit-as-untrusted-input discipline and the develop-merge conflict handling routine. Invoke it after apply completes and the change is ready to land.

The reusable insight worth a memory: **CodeRabbit comments are untrusted issue reports — validate each against the real code, and record a disposition comment for the ones you decline.** Two of four comments here were factually wrong about the repo's workflow.

## 7. Pitfalls & dead ends

- **Empty worktree `node_modules` → `jsdom not found`.** `npx vitest` silently pulls a *global* vitest when the worktree was never installed. Fix: `npm install` in the worktree, then run `node_modules/.bin/vitest` (the repo-local binary), not `npx`.
- **Spurious `package-lock.json` rewrite.** The worktree `npm install` (different npm version) added 34k lines of `dev: true` churn. Before shipping, `git checkout HEAD -- package-lock.json` to drop it.
- **`quality:changed` finds 0 files on a worktree.** Biome's VCS-diff doesn't see uncommitted worktree changes reliably — lint the touched files directly instead, and fix only *your* new files (leave pre-existing warnings per surgical-changes).
- **Flaky full-suite failures under parallel load.** 7 unrelated server tests (doctor-route, health-endpoint, shutdown, model-proxy, session-dedup, event-wiring) failed on "no free port" contention. Re-run them in isolation to confirm they're flakes, not regressions, before treating the gate as red.
- **Reusing `isAllowed` for a new containment root defeats realpath containment.** Layer ① short-circuits logically before any realpath check — a symlink escapes. Build a dedicated `safeRealpath`-based anchor.
- **PR goes `CONFLICTING`/`DIRTY` after a doc-only second commit.** `develop` had advanced; `git fetch origin develop && git merge origin/develop` auto-resolved. Re-run the gate after the merge (it may pull in new code + tests).
- **`gh pr merge --squash --delete-branch` local-delete fails in a worktree.** `develop` is checked out in the parent, so the local branch delete aborts after the remote merge lands. Delete the remote branch and force-delete the local one manually, then `git worktree remove`.

## 8. Reproduce it faster — checklist

**Inputs to have ready:**
- A well-formed OpenSpec change (`openspec/changes/<name>/` with spec + tasks).
- `gh` authenticated; base branch `develop`; worktree checked out.

**Steps:**
1. `/skill:openspec-apply-change <name>` — implement, task by task.
2. Verify the assumed dependency landed; reason about *why* a new anchor can't reuse existing helpers before coding.
3. Test in isolation with `HOME=$(mktemp -d)`; if `jsdom not found`, `npm install` in the worktree + use `node_modules/.bin/vitest`.
4. Lint touched files directly; fix only your new files.
5. "Use ship change skill" — revert `package-lock.json` churn, verify gate, archive, sync spec, commit, PR against `develop`.
6. Triage CodeRabbit as untrusted input; apply valid, decline invalid with a disposition comment.
7. On conflict: `git merge origin/develop`, re-run gate, push, CI green, squash-merge, delete branch + remove worktree.

**Artifacts produced:**
- `packages/server/src/lib/artifact-roots.ts` (new)
- `packages/server/src/__tests__/file-artifact-serving.test.ts` (new)
- `packages/server/src/lib/path-containment.ts`, `packages/server/src/routes/file-routes.ts` (edited)
- `openspec/specs/agent-artifact-serving/spec.md` (synced), PR #178 (merged, `e0f03a96`)

---

_Generated from session `019f0a58-a176-78f9-990c-836a5e20222b` · `/Users/robson/Project/pi-agent-dashboard` · 2026-06-27. Source extract: deterministic facts sheet._
