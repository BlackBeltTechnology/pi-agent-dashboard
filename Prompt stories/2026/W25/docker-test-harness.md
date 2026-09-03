---
session: 019ee68a
week: 2026/W25
type: development
model: "@fast"
premium: false
premium_reason: ""
upgrade_status: n/a
openspec_changes: [docker-test-harness]
proposal_excerpt: "Testing pi-dashboard on the host collides with the real, running dashboard four ways:"
---

# How we did it: Build & ship the docker test harness — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The session opened with a terse `rebese to develop` (rebase the worktree onto
`develop`), but the real objective surfaced in the second prompt:
`/skill:openspec-apply-change docker-test-harness`. The user wanted the
**docker-test-harness** OpenSpec change implemented end-to-end — a disposable,
fully-isolated containerized pi-dashboard for manual browser QA that does **not**
collide with the real running dashboard (the proposal's four collisions: mDNS
discovery, shared ports, the gateway bind, and the host `~/.pi` state). Then, in a
single numbered prompt, the user asked to take it all the way home: archive + sync,
open a PR, wait for CI, fix CodeRabbit, merge, delete the branch, delete the worktree.

## 2. TL;DR playbook

1. `git rebase origin/develop` on the worktree branch first (clean base before any work).
2. Run `/skill:openspec-apply-change docker-test-harness` and let the model read the
   change's `proposal.md` / `tasks.md` / `design.md` + the existing `docker/` files to
   match conventions before writing a line.
3. Implement task-by-task; check off `tasks.md` boxes with `sed` as each lands.
4. **Do the static build/validate loop before touching Docker**: `bash -n` on every
   shell script, `docker compose config` to validate the overlay, verify pinned
   download URLs resolve with `curl -sIL` *before* kicking off a multi-minute build.
5. Build the image, then run the harness against an **isolated throwaway project**
   under `$HOME` (Docker Desktop shares `/Users`), snapshotting host state for a
   byte-identical before/after comparison to prove isolation.
6. Fix build-blockers as they appear (they were mostly **pre-existing docker-packaging
   bugs**, not the new change) and note each as strictly necessary.
7. Archive + sync the change, commit, push, `gh pr create --base develop`.
8. Poll CI with `gh pr checks` / `gh run view`; when green, fetch CodeRabbit threads,
   triage by severity, fix each, re-validate, push.
9. Confirm CodeRabbit re-review is "No actionable comments" and CI green, then
   `gh pr merge --squash --delete-branch`, and `git worktree remove` from the main repo.

## 3. How the collaboration unfolded

**Phase 1 — Rebase & load the change (Discovery).** The model rebased cleanly, then
loaded the `openspec-apply-change` skill, read the change artifacts, and confirmed the
prerequisite `docker-packaging` change had already landed (archived). It read the
existing `docker/` files to match conventions rather than inventing new ones — the
decision that kept the overlay consistent with the base image.

**Phase 2 — Implement task-by-task (Build).** Tasks 0–5 (Dockerfile tool installs,
`compose.test.yml` isolation overlay, `test-entrypoint.sh`, `test-up/down.sh`, git+jj
fixtures, docs) were written in order with `tasks.md` checkboxes flipped via `sed` as
each completed. Two self-caught design calls mattered: fixtures shipped as **plain
committed files** initialized into real repos at runtime (a committed nested `.git`
breaks the outer repo), and an overlayfs bug — `upperdir`/`workdir` must share one
filesystem, so two separate tmpfs mounts (`EXDEV`) were collapsed into a single tmpfs.

**Phase 3 — Live e2e verification (Verify).** With Docker up, the model verified the
pinned `gh`/`jj` URLs resolved *before* the long build, then hit a cascade of
**pre-existing docker-packaging build bugs**: zrok checksum grep pattern (the manifest
now prefixes `./`), jj tarball member name (`./jj`), missing `tsconfig.base.json`,
missing root `scripts/` + `patches/` in the COPY. Each was diagnosed to root cause and
fixed as strictly necessary to build. Then the container kept exiting 0 — `pi-dashboard
start` detaches a daemon and returns, so the entrypoint had to launch the daemon, run
the smoke check, then keep PID 1 alive by waiting on `server.pid`. Isolation was proven
by byte-identical host snapshots before/after.

**Phase 4 — Ship (archive → PR → CI → CodeRabbit → merge).** Archive + sync, commit,
push, PR #144 against `develop`. CI passed (8m); CodeRabbit raised 7 findings
(1 Critical, 4 Major, 2 Minor), each triaged and fixed — the standout being
CAP_SYS_ADMIN made conditional via a new `compose.test.cap.yml` layered only in overlay
mode. Re-validated in both overlay and copy modes, pushed, waited for green CI +
"No actionable comments", squash-merged with branch delete, removed the worktree.

## 4. Prompts that worked

- **The goal prompt** — `/skill:openspec-apply-change docker-test-harness`. Naming the
  skill *and* the change let the model self-serve all context (proposal, tasks, design)
  without a back-and-forth. A stronger kickoff would bundle the rebase: *"Rebase onto
  develop, then apply docker-test-harness end-to-end; verify against an isolated
  throwaway project."*
- **High-leverage follow-up** — the single numbered list
  (`1. archive and sync 2. create PR 3. Wait for CI 4. Fix coderabbit issues
  5. Merge PR 6. delete branch 7. delete worktree`). One prompt encoded the entire
  ship pipeline; the model executed all seven without further steering.
- **`go on`** — a one-word unblock that let the model continue the ship sequence
  through the CI wait without re-confirming each step.

## 5. Steering & corrections (what to watch for)

The remarkable thing about this session: **almost no human correction was needed** —
the model self-steered. The "steering" was really scope expansion, and the redirections
were the model catching its own bugs. Bake these in as guardrails:

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| stop at 19/24 tasks when Docker was down | (nothing — user later said "go on") | state up front "run the live e2e when Docker is available; don't stop at static validation" |
| treat build failures as its own change's fault | self-diagnosed them as pre-existing docker-packaging bugs | tell it "the base image may have latent build bugs; fix them as strictly-necessary and note them" |
| ship without severity triage | (self-imposed) triaged 7 CodeRabbit findings by Critical/Major/Minor | state the quality bar: "address every CodeRabbit finding, triaged by severity, re-validate before re-push" |

Scope expansions the user imposed: the numbered ship list turned "implement" into
"implement + archive + PR + CI + review + merge + cleanup".

## 6. Skills, tools & memory created — and why they're effective

No new skill or memory was created this session — the work rode existing rails:

- **`openspec-apply-change`** — the spine. It made the change self-describing so the
  model could implement task-by-task and check boxes deterministically.
- **Documentation Update Protocol + subagents** — 3 `general-purpose` subagents were
  spawned solely to add/update `docs/file-index-docker.md` rows (per the rule that
  `docs/` writes are delegated). Effective because it keeps the main context focused on
  implementation while docs stay compliant.

**Recommended skill to create:** a `docker-harness-e2e-verify` project skill capturing
the reproducible verification recipe — isolated `$HOME` throwaway project, host-state
snapshot, `PID 1` daemon-wait pattern, and the overlay-vs-copy-mode dual run. This
session rediscovered all of it live; a skill would remove the trial-and-error.

## 7. Pitfalls & dead ends

- **Container exits 0 immediately** — `pi-dashboard start` detaches a daemon and
  returns. Fix: entrypoint must launch it, smoke-check, then `wait` on the
  `~/.pi/dashboard/server.pid` PID to hold PID 1.
- **Launcher's 30s readiness timeout fires on a loaded VM** (jiti cold-start ~36s).
  The detached child survives (`detached:true`+`unref()`), so don't treat the
  launcher's timeout-exit as fatal — make your own health poll authoritative.
- **overlayfs `EXDEV` at mount** — `upperdir` and `workdir` must be on the *same*
  filesystem; back them with one tmpfs, not two.
- **Pre-existing docker-packaging build bugs** blocked the build: zrok checksum grep
  (manifest now `./`-prefixed → use `grep -E "[ /]${asset}\$"`), jj tarball member is
  `./jj`, and the COPY omitted `tsconfig.base.json` + root `scripts/` + `patches/`.
- **Probing too early** gives `HTTP 000` / stale files — wait past the cold-start
  window (>36s here) before curling `/api/health` or tearing down.
- **Heredoc-in-`$()` with backticks** broke the `gh pr create` body — write the PR body
  to a file (`/tmp/pr-body.md`) and pass `--body-file`.
- **`|| true` masks `npm install -g` failures** (CodeRabbit Critical) — group the
  version probes so an install failure actually fails the build.

## 8. Reproduce it faster — checklist

- [ ] Rebase the worktree onto `origin/develop`.
- [ ] `/skill:openspec-apply-change docker-test-harness`; let the model read all change
      artifacts + existing `docker/` files first.
- [ ] Implement task-by-task, flip `tasks.md` boxes with `sed`.
- [ ] Static loop: `bash -n` every script, `docker compose config`, `curl -sIL` pinned
      URLs — all before the long build.
- [ ] Build, then verify against an isolated `$HOME` throwaway project with a host-state
      snapshot; run both overlay and copy modes.
- [ ] Use the daemon-wait PID-1 entrypoint pattern; poll health past the cold-start.
- [ ] Archive + sync, commit, push, `gh pr create --base develop --body-file`.
- [ ] Poll CI; fix CodeRabbit findings triaged by severity; re-validate; push.
- [ ] On green CI + "No actionable comments": `gh pr merge --squash --delete-branch`,
      then `git worktree remove` from the main repo.

**Key inputs to have ready:** a running Docker daemon (Docker Desktop sharing `/Users`),
`gh` auth for PR + checks, the OpenSpec change already scaffolded, and a scratch
`$HOME/pi-harness-test` project.

**Final artifacts:** `docker/compose.test.yml`, `docker/compose.test.cap.yml`,
`docker/test-entrypoint.sh`, `docker/test-up.sh`, `docker/test-down.sh`,
`docker/fixtures/sample-git|sample-jj/`, `docker/TESTING.md`, README pointer,
`openspec/specs/docker-test-harness/spec.md`; merged via PR #144.

---

_Generated from session `019ee68a-d763-7a68-87fd-3a8a7ede0ca6` · `/Users/robson/Project/pi-agent-dashboard` · 2026-06-22. Source extract: `/tmp/facts-1784848825N.md`._
