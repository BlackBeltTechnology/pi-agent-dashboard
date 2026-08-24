---
session: 019f1679
week: 2026/W27
type: development
model: "@fast"
premium: true
premium_reason: "heavy steering (6 user prompts); large facts sheet (~10107 tok)"
upgrade_status: pending
openspec_changes: [fix-parallel-e2e-docker-collisions]
proposal_excerpt: "The `parallelize-test-harness` change made the **manual** path (`docker/test-up.sh` run by hand) parallel-worktree-safe: stable per-worktree ports in disjoint windows + a unique compose project name. But the **managed…"
---

# How we did it: Fix parallel e2e Docker collisions — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The kickoff was a single skill invocation: `/skill:openspec-apply-change fix-parallel-e2e-docker-collisions`. The **real** objective, from the attached proposal, was to close a parallelism gap: the *manual* docker test-harness path had already been made worktree-safe (disjoint per-worktree port windows + a unique compose project name), but the **managed** Playwright path — the one `global-setup.ts` spawns automatically — still collided when two worktrees ran e2e at once. It reused a shared image tag and probed `:0` for ports instead of honoring the per-worktree state file. The task: make the managed path isolate ports **and** image tags per worktree, verify it live against Docker, then ship it through CI + CodeRabbit into `develop`.

## 2. TL;DR playbook

1. **Kick off with the apply skill** naming the change: `/skill:openspec-apply-change fix-parallel-e2e-docker-collisions`. Let the AI read the proposal, design, and the actual implementation files (`lifecycle.ts`, `global-setup.ts`, `docker/test-*.sh`, `compose.test.yml`, `lib-ports.sh`) before touching anything.
2. **Implement task-by-task**, keeping the diff surgical: drop the `:0` port probe in favor of state-file/env derivation, export a per-worktree `TEST_IMAGE_TAG` (= compose project name), add a bounded `set -e`-safe bind-retry loop.
3. **Verify the actual subject of the change, not the incidental UI.** The sandbox had no Playwright Chromium (CDN blocked). Instead of fighting the browser, verify the **container-boot/collision path directly**: run two concurrent `test-up.sh -d --build` from two mkdtemp workspaces and assert distinct ports + tags + both healthy + no `port is already allocated`.
4. **Prove no stale-image reuse** (the "wrong-code guard"): bake a marker string into source, build a fresh tag, show the new image has it and an older image does not.
5. When ready to land, prompt: **`code-review and use ship-change skill`**. Run CodeRabbit on the diff, then archive + sync specs, commit, push, open the PR against `develop`.
6. **Watch CI and CodeRabbit; triage every finding against the real code.** Fix the valid ones, empirically settle the uncertain ones (e.g. spin up system Chrome to prove Playwright workers inherit `global-setup`'s `process.env` mutation).
7. **Re-run flakes, don't chase them.** Client-test flakes (`SettingsPanel`) unrelated to the diff → re-run the failed job, don't edit.
8. Squash-merge, delete the remote branch, then remove the worktree from the **parent** repo last (the session runs inside it).

## 3. How the collaboration unfolded

**Phase 1 — Discovery.** The AI selected the change, read the proposal/design, then opened every file it would touch plus `lib-ports.sh` and `compose.yml` to understand the port-derivation helpers and base image name. Effective because it built the *full* picture before the first edit, so the implementation landed in one clean pass.

**Phase 2 — Implement.** Six files edited task-by-task against `tasks.md`: sync `resolvePort()` (env or `18000/18999` default, no `:0` probe), `resolvePortsFromStateFile()`, `test-up.sh` bind-retry + `TEST_IMAGE_TAG` export, `compose.test.yml` image override, `test-down.sh` per-worktree image cleanup. A self-caught `set -e` hazard in the retry loop got fixed immediately (`|| status=$?` instead of a bare `&& break` list).

**Phase 3 — Live verification (the decision point).** Playwright couldn't run (no Chromium, CDN blocked). Rather than wire system Chrome into the very files under test, the AI verified the container/collision path directly — two concurrent builds → distinct ports (18895/18626), distinct tags, both healthy, no collision; a marker-injection test proved fresh builds don't reuse stale images; teardown removed only the per-worktree tag, never the base. This is the highest-leverage judgment call of the session: verify **the actual subject of the change**, not the incidental UI it doesn't touch.

**Phase 4 — Ship (steered by `code-review and use ship-change skill`).** CodeRabbit on the diff, archive + sync specs, commit, PR #208 against `develop`, watch CI.

**Phase 5 — Review loop.** CI green; CodeRabbit posted 7 substantive findings. Each triaged against the real code: 6 valid fixes applied (retry off-by-one, pipe/tee race, spec wording, strip inherited port pins, follow state-file rewrites on retry, port-bounds check), 1 (`baseURL`) empirically **disproved** with a system-Chrome probe. A Biome complexity warning was cleared by extracting the wait loop into a helper. Re-push, re-watch, resolve threads, squash-merge, worktree removed last.

## 4. Prompts that worked

- **The goal prompt** — `/skill:openspec-apply-change fix-parallel-e2e-docker-collisions`. Effective because it names the exact change, letting the apply skill load the proposal/design/tasks deterministically. Kickoff via the skill (not free-form prose) is the strong pattern.
- **`code-review and use ship-change skill`** — a single high-leverage follow-up that unlocked the entire land pipeline (review → archive → commit → PR → CI watch → merge → cleanup). Naming both the review gate and the ship skill in one line is the reproducible move.
- **`go on`** — used twice to unblock the AI at a check-in point (before the expensive Docker QA, and before the irreversible worktree removal). Effective *because* the AI paused to confirm before burning minutes or destroying its own cwd. Keep the check-in habit; a bare "go on" is enough to proceed.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Pause before the heavy Docker QA (4.1–4.3) to ask permission | `go on` (steering #3) | State up front "run all Docker verifications; don't stop to ask" when Docker is available. |
| Pause before the irreversible worktree removal | `go on` (steering #5) | Accept the pause — it's correct discipline before an action that invalidates the session cwd. |
| Not automatically start the review+ship pipeline after implementation | `code-review and use ship-change skill` | Say "when tasks are done, run code-review then ship-change" at kickoff. |
| Re-run the apply skill when a phase stalled | Re-issue `/skill:openspec-apply-change …` (steering #1, #2) | Trust the skill to resume; a plain re-invoke continues from the checked task state. |

Quality bars the human implicitly imposed: keep the diff surgical (the AI reverted an unrelated `package-lock.json` drift and a stray `jimp` install rather than commit them), and don't merge on flaky red (re-run, confirm flake, then merge).

## 6. Skills, tools & memory created — and why they're effective

No new skills or memories were created — this session **consumed** existing project skills (`openspec-apply-change`, `implement`'s review-changes, `ship-change`) rather than producing new ones. Two behaviors are worth codifying:

- **"Verify the subject, not the surface"** — when the sandbox can't run the full UI harness, verify the exact seam the change touches (here: container boot + port/tag isolation) with direct scripted probes, and empirically settle any uncertain seam (system Chrome to prove worker env inheritance) instead of hand-waving. This deserves a memory/skill note for any Docker/e2e change under a browser-less sandbox.
- **The `ship-change` "fix or report" discipline** — worktree `node_modules` drift (missing `jimp`) made local tests red though `develop` was green; the AI diagnosed it as drift (diff never touched `package-lock.json`), repaired the local install, and reverted the lockfile churn before committing. Reproducible: local red ≠ CI red when the cause is worktree drift in an untouched package.

## 7. Pitfalls & dead ends

- **Shared `/tmp` paths race across worktrees.** `review-changes.ts` writes to a shared `/tmp/cr-review.*`; a concurrent `os-improve-dashboard-attention-routing` session overwrote it, so the wrapper reported *another worktree's* 5 findings. If CodeRabbit findings look foreign, re-run directly on your diff to a **unique** output path and confirm the `review_context` branch/base match your worktree.
- **Playwright Chromium unavailable + CDN blocked.** Don't try to wire system Chrome into the files under test (fragile while uncommitted). Verify the non-UI path directly; use `channel: "chrome"` only for a throwaway probe.
- **`set -e` + bare `&& break` in a bash retry loop** terminates the script before `status=$?`. Capture with `|| status=$?`.
- **`npm install` in a worktree churns `package-lock.json`** (npm-version drift, stripped `libc` fields). Revert the lockfile before committing — CI uses `npm ci` off the locked versions anyway.
- **Stale CodeRabbit threads re-anchor to new commits.** After a fix push, GitHub may re-post the *same* verbatim findings on the new commit; verify the fix is in the current code, then resolve — don't re-fix.
- **`SettingsPanel` client test flakes** (render-timing `save-btn` lookup). Unrelated to an e2e/docker/spec diff → re-run the failed job, don't edit.
- **Removing the worktree kills your own cwd.** The session ran inside `.worktrees/os-fix-parallel-e2e-docker-collisions`; do the `git worktree remove` from the **parent** repo, last, after the merge is confirmed.

## 8. Reproduce it faster — checklist

- [ ] `/skill:openspec-apply-change <change-name>` — let it read proposal + design + all target files first.
- [ ] Implement task-by-task; keep the diff to exactly the files the change names.
- [ ] Type-check (`npx tsc --noEmit`) + `bash -n` the shell scripts after each edit.
- [ ] If the browser harness can't run, verify the **change's actual seam** with direct scripts: two concurrent `test-up.sh -d --build` → assert distinct ports/tags, both healthy, no `port is already allocated`; marker-injection test for fresh-build guard.
- [ ] `code-review and use ship-change skill` — run CodeRabbit **on a unique output path**, archive + sync specs, commit (revert any `package-lock.json`/`node_modules` drift first), PR against `develop`.
- [ ] Triage every CodeRabbit finding against real code; empirically settle uncertain ones; extract helpers to clear Biome complexity warnings.
- [ ] Re-run unrelated flakes (don't edit); squash-merge; delete remote branch; remove the worktree from the **parent** repo last.

**Inputs to have ready:** a working Docker daemon, the OpenSpec change scaffolded under `openspec/changes/<name>/`, CodeRabbit CLI authed, `gh` authed. **Artifacts produced:** edits to `tests/e2e/lifecycle.ts`, `tests/e2e/global-setup.ts`, `docker/test-up.sh`, `docker/compose.test.yml`, `docker/test-down.sh`, `tasks.md`; PR #208 squash-merged to `develop` as `6bb4990d`.

---

_Generated from session `019f1679` · `pi-agent-dashboard` · 2026-06-30. Source extract: deterministic `extract_session.ts` facts sheet._
