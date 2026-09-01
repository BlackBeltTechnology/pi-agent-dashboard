---
session: 019ef60c
week: 2026/W26
type: development
model: "@fast"
premium: false
premium_reason: ""
upgrade_status: n/a
openspec_changes: [parallelize-test-harness]
proposal_excerpt: "The disposable test harness (`docker-test-harness`) hardcodes host ports `18000` / `18999` and runs under a single implicit compose project name (`docker`, the basename of the compose dir). That was fine for one insta…"
---

# How we did it: Parallelize the Docker test harness — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The kickoff was a single skill invocation:

```
/skill:openspec-apply-change parallelize-test-harness
```

The real objective, spelled out in the change's proposal: the disposable Docker
test harness hardcoded host ports (`18000`/`18999`) and ran under one implicit
compose project name, so **two git worktrees running the harness at once collided**
— same ports, same stack name, same `:18000` contract. The task was to make the
harness *parallel-worktree-safe*: derive a stable-but-unique port pair and compose
project name per worktree, keep single-instance defaults unchanged, and prove it
with a real two-worktree live run. The lone steering turn (`Use skill ship-change`)
then extended the goal from "implement + verify" to "land it on `develop` through
CI + CodeRabbit."

## 2. TL;DR playbook

1. Run `/skill:openspec-apply-change parallelize-test-harness`; let it read the
   proposal, design, and all 29 tasks before touching code.
2. Extract the pure logic first: create `docker/lib-ports.sh` with `derive_hash` /
   `derive_project` (`cksum`-based), `is_free` (bash `/dev/tcp`, **no** `nc`/`lsof`),
   and `find_free_in_window` (wrap-scan, window size = 1000 = disjoint windows).
3. Rewire `test-up.sh` to hash `HOST_CWD` → port pair (dashboard 18000–18999,
   gateway 19000–19999) + `pi-dash-test-<hash>` project via `-p`; honor the
   `DASHBOARD_PORT`+`PI_GATEWAY_PORT` override **as a pair** (exactly one → `exit 1`);
   write `.pi-test-harness.json`.
4. Rewire `test-down.sh` to re-derive the project from `$PWD` (survive a
   missing/corrupt state file), and de-hardcode `compose.test.yml` env.
5. Fix the Playwright chain: probe the port **once**, write it back into
   `process.env` so each worker inherits it instead of re-probing.
6. Write `scripts/__tests__/test-up-port-derivation.test.mjs` (runs under the
   existing `scripts` vitest project); verify with `shellcheck -x` + the unit test.
7. Run the real Docker validation: two worktree dirs up → distinct ports/projects →
   selective teardown → stable-port re-run → `npm run test:e2e` both legs.
8. `Use skill ship-change`: run the verify gate, archive + sync specs, commit, push,
   watch CI, triage CodeRabbit (apply safe fixes, defer with reasons), squash-merge,
   remove the worktree.

## 3. How the collaboration unfolded

**Phase 1 — Load full context (no premature edits).** The AI resolved the openspec
apply skill, pulled `openspec status --json`, and read every context file plus the
files it would modify before writing a line. It also cheaply pre-validated the
`cksum` derivation math (`printf … | cksum`) so the port scheme was proven before any
script existed. *Why it worked:* the design's invariants (disjoint 1000-wide windows)
were confirmed empirically first, so the implementation was transcription, not
guesswork.

**Phase 2 — DRY-first implementation.** Rather than duplicate port logic across
`test-up.sh` and `test-down.sh`, the AI extracted a sourced `docker/lib-ports.sh`.
Notably it chose bash `/dev/tcp` for the free-port check instead of `nc`/`lsof` — no
external tool dependency. It then rewrote the two scripts, `compose.test.yml`,
`.gitignore`, and the whole Playwright lifecycle (`lifecycle.ts`, `global-setup.ts`,
`global-teardown.ts`, `playwright.config.ts`).

**Phase 3 — Cheap verify before expensive verify.** Before spinning containers, the
AI ran `shellcheck -x`, `bash -n`, and the 9-case unit test, and load-tested the
Playwright config import chain with a bare `node --input-type=module` probe (no
Docker). *Decision point:* it explicitly flagged that tasks 8.1–8.5 are slow,
side-effectful real-Docker runs and did them deliberately last.

**Phase 4 — Real two-worktree validation caught the actual bug.** Two worktree dirs
(`/tmp/wt-a`, `/tmp/wt-b`) came up on distinct ports/projects (8.1 ✓), selective
teardown left B alive (8.2 ✓), re-up reused the same port (8.3 ✓). Then
`npm run test:e2e` failed with `ERR_CONNECTION_REFUSED`. Root cause: each Playwright
**worker process** re-evaluated the config and re-probed a *different* free port than
the container had bound. Fix: decide the port once, write it into `process.env` so
workers inherit it. Re-run → green.

**Phase 5 — Ship (triggered by the one steering turn).** `ship-change` ran the verify
gate, hit 17 red tests, and correctly diagnosed them as a missing local `jimp` dep in
`pi-image-fit` (unrelated; `npm install` → 72/72). It synced the MODIFIED requirement
into the main spec, archived the change, committed, pushed to existing PR #158,
watched CI, triaged 8 CodeRabbit comments (applied 5, deferred 3 with documented
reasons), survived a flaky `DiagnosticsSection` clipboard test via targeted re-run,
squash-merged, and removed the worktree.

## 4. Prompts that worked

- **The goal prompt — `/skill:openspec-apply-change parallelize-test-harness`.** A
  bare skill invocation works *because the proposal/design/tasks already exist*. The
  leverage is in the upstream spec, not the prompt. Lesson: front-load the change
  artifacts so the apply prompt can be one word.
- **The high-leverage follow-up — `Use skill ship-change`.** Four words that
  converted "code is done" into "code is on `develop`," delegating the entire
  CI/CodeRabbit/merge/worktree-cleanup dance to a skill. Stronger next-time version:
  `Use skill ship-change; this branch bundles the scenario-design skill too — ship the
  whole branch.` (The AI had to *ask* about that bundling ambiguity mid-ship.)

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Stop after implement + verify | "Use skill ship-change" | State the finish line up front ("apply **and** ship") |
| Treat red tests as a blocker | (AI self-diagnosed) missing `jimp` dep, ran `npm install` | Note in the ship skill: verify-gate reds may be missing-local-dep, not regressions |
| Pause on a branch/scope ambiguity | The branch bundled `scenario-design` skill + this change; AI used `ask_user` before pushing | Tell it the branch scope in the ship prompt |
| Consider deferring the slow Docker validations | Ran all of 8.1–8.5 for real anyway | Keep the "no green without the real two-worktree run" bar explicit |

The quality bar the human implicitly imposed and the AI honored: **prove
parallelism with an actual concurrent two-worktree run**, not just unit tests — which
is exactly what surfaced the per-worker re-probe bug.

## 6. Skills, tools & memory created — and why they're effective

No new skill/memory was created; the session *consumed* three existing skills
(`openspec-apply-change`, `ship-change`, and the delegated docs subagent) and one
subagent (`general-purpose` for the file-index doc update, kept out of the main
context per the docs-in-caveman-style protocol).

The reusable artifact worth remembering is **`docker/lib-ports.sh`** itself: a pure,
sourced helper that makes hash-derived port/project allocation testable in isolation
(9 unit cases) and shareable between `test-up`/`test-down`. If anything, the
*pattern* — "extract pure derivation into a sourced lib, unit-test it, then source it
from both entry scripts" — is the repeatable move; a `parallel-harness-port-derivation`
skill could capture the disjoint-window math (window size == modulo base) so nobody
re-derives it.

## 7. Pitfalls & dead ends

- **Playwright per-worker port re-probe.** The top-level `await probeFreePort()` in
  `lifecycle.ts` runs *once per worker process*, so workers probed different ports
  than the container bound → `ERR_CONNECTION_REFUSED`. **Fix:** probe once, write the
  result into `process.env`, let workers inherit.
- **Red verify gate from a missing local dep.** `pi-image-fit` threw
  `Jimp is not a constructor` in 17 tests — `jimp` simply wasn't in local
  `node_modules` (CI does a clean install, so CI was fine). **If you hit this:** run
  `npm install` and re-check the lockfile is unchanged before assuming a regression.
- **`gh pr merge --squash --delete-branch` "errors" but actually merged.** The merge
  succeeded server-side (`state: MERGED`); the error was `gh` trying to switch local
  branches, blocked because `develop` is checked out in the parent worktree. **Verify
  with `gh pr view --json state`** before retrying; delete the remote branch manually.
- **SC2034 false positives** on the sourced lib's constants — annotate/`shellcheck`-
  disable; they're consumed by the sourcing script.
- **CI flake** (`DiagnosticsSection` clipboard `waitFor` timing) — re-run the failed
  job rather than "fixing" a passing file.

## 8. Reproduce it faster — checklist

Inputs to have ready:
- A completed OpenSpec change (`proposal.md`, `design.md`, `tasks.md`) for the harness.
- Docker daemon up with a built `pi-dashboard:local` image (avoids a multi-minute rebuild).
- `gh` authenticated; the feature branch already has an open PR (or let ship-change open one).

Steps:
1. `/skill:openspec-apply-change parallelize-test-harness` — read all context first.
2. Create `docker/lib-ports.sh` (`derive_hash`/`derive_project`/`is_free` via
   `/dev/tcp`/`find_free_in_window`, window==modulo base==1000).
3. Rewire `test-up.sh` (`-p pi-dash-test-<hash>`, paired override → `exit 1` on one),
   `test-down.sh` (`$PWD` re-derive), `compose.test.yml`, `.gitignore`.
4. Fix Playwright: probe port once → `process.env` → workers inherit.
5. `shellcheck -x` + `npx vitest run --project scripts …test-up-port-derivation…`.
6. Real Docker: two worktrees → distinct ports/projects → selective down → stable re-up
   → `npm run test:e2e` (managed + `PW_E2E_USE_RUNNING` attach legs).
7. `Use skill ship-change` (name the branch scope): gate → archive+sync → commit →
   push → CI → CodeRabbit triage → squash-merge → worktree remove.

Final artifacts produced:
- `docker/lib-ports.sh`, `scripts/__tests__/test-up-port-derivation.test.mjs` (new)
- Edited: `docker/test-up.sh`, `docker/test-down.sh`, `docker/compose.test.yml`,
  `tests/e2e/{lifecycle,global-setup,global-teardown}.ts`, `playwright.config.ts`,
  `docker/TESTING.md`, `openspec/specs/docker-test-harness/spec.md`
- PR #158 squash-merged to `develop` as `969d2462`.

---

_Generated from session `019ef60c-7c3b-774d-8cf7-44516495c3b8` · `/Users/robson/Project/pi-agent-dashboard` · 2026-06-23. Source extract: session facts sheet (parallelize-test-harness)._
