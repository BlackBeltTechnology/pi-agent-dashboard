---
session: 019e79e9
week: 2026/W22
type: development
model: "@fast"
premium: true
premium_reason: "heavy steering (9 user prompts); large facts sheet (~11153 tok)"
upgrade_status: pending
openspec_changes: [bump-pi-compat-to-0-78]
proposal_excerpt: "Pi has published two minor releases since the 0.75 floor was drafted: `0.76.0` (2026-05-27), `0.77.0` (2026-05-28), `0.78.0` (2026-05-29). The earlier proposal `bump-pi-compat-to-0-76` was drafted but never merged to…"
---

# How we did it: Bump pi compatibility floor 0.75 → 0.78 — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The operator opened with a single skill invocation:

> `/skill:openspec-apply-change bump-pi-compat-to-0-78`

The literal ask was "apply this OpenSpec change." The *real* objective, once the
steering turns landed, was broader: **raise the declared `piCompatibility` floor to
`0.78.0` across the server manifest and version lookup table, prove the bump resolves
cleanly through the real install paths (standalone npm + Docker bundle), rewrite the
now-dead Electron install tests to match the current bundle-only runtime, land it as a
PR with green CI, then archive the change and clean up the worktree.** The apply-change
skill was only the entry point; the value came from verification and the collateral
cleanup the bump exposed.

## 2. TL;DR playbook

1. **Kick off with the apply-change skill** in the change's worktree:
   `/skill:openspec-apply-change bump-pi-compat-to-0-78`.
2. **Edit the source-of-truth pins**: `packages/server/package.json` →
   `piCompatibility { minimum, recommended } = "0.78.0"` and
   `dependencies."@earendil-works/pi-coding-agent" = "^0.78.0"`; add the new
   `0.76/0.77/0.78 → Node floor` rows to
   `packages/shared/src/__tests__/bundled-node-meets-pi-floor.test.ts`.
3. **Regenerate `package-lock.json`** (`npm install --package-lock-only`) — the old
   lockfile still pinned `0.75.5`, which fails `^0.78.0` under `npm ci`. This is
   **required**, not cosmetic drift.
4. **Run the full vitest suite** (`npm test 2>&1 | tee /tmp/log | tail`) and confirm green.
5. **Ask the AI what the Electron build will actually ship** before assuming — it will
   produce a version-by-source table (bundled Node, pi-coding-agent, openspec, tsx, jiti,
   workspace pkgs). Catch dead code here: the `test-{electron,deb,desktop}-install*.sh`
   scripts still tested the deleted managed-dir/offline-cache bootstrap.
6. **Rewrite the dead tests against the bundle-only flow** (layout → pi-floor check →
   foreground spawn → `/api/health` → session spawn → shutdown) — do NOT `sed`-rename the
   old package scope; the stage-1 offline-cache assertion is dead, not stale.
7. **Run the real automation locally**: `scripts/test-standalone-npm-install.sh --port N`
   (no Docker) and `packages/electron/scripts/test-electron-install.sh` (Docker). Fix the
   small breakages the rewrite surfaces (missing `procps`, stale lockfile COPY, foreground
   vs `start` subcommand).
8. **Commit in logical chunks** (floor bump / test rewrite / dead-code cleanup), push with
   `-u`, open the PR (write the body to a file — heredoc + backticks confuse the shell),
   **monitor CI by manual polling** (MCP RPC caps at 120s), then after merge **archive the
   change + its superseded sibling** and remove the worktree.

## 3. How the collaboration unfolded

**Phase 1 — Apply the change (Discovery + core edits).** The AI resolved the
apply-change skill, read `proposal.md` + `tasks.md`, and executed the mechanical tasks:
bumped `piCompatibility` and the pi dependency in `packages/server/package.json`, added
the lookup-table rows, ran targeted then full tests (647 files, 6775 passing). It
correctly recognized that **Phase 2 (bundled-extensions) was vacuously satisfied** — that
directory had been deleted by a prior change (`eliminate-electron-runtime-install`) — and
annotated those tasks N/A rather than inventing work. *Why it worked:* the AI checked the
filesystem reality of each task instead of trusting the checkbox.

**Phase 2 — "What actually ships?" (the operator's first steer).** The operator asked
what versions the Electron build delivers. This forced the AI to trace `bundle-server.mjs`
and produce a concrete source-of-pin table — which is where the **dead test scripts**
surfaced. *Decision point:* the operator then asked whether existing Docker/CI tests could
verify tasks, redirecting the effort from "trust me" to "prove it."

**Phase 3 — Dead-code discovery + scope pushback.** The operator pointed at a lingering
`@mariozechner/pi-coding-agent` reference and said "fix it." The AI's key move was to
**refuse the naive fix**: renaming the package scope wouldn't help because the whole
offline-cache/managed-dir bootstrap those scripts tested was deleted — the very first
stage asserts a `manifest.json` that no longer exists. It laid out options (delete vs
rewrite), flagged the rewrite as a real scope expansion, and **checked in before touching
~600 lines**. The operator effectively approved by pushing it to keep going.

**Phase 4 — Rewrite + real smoke tests.** The AI rewrote three inner scripts from the
9-stage offline-install flow down to a 6-stage bundle-only flow, then ran the actual
automation: the standalone npm smoke (green, `mode=production` in 5s, `^0.78.0` → exactly
`0.78.0`) and the Docker bundle test (13/13 after fixing `procps`, the stale lockfile
COPY, and the foreground-vs-`start` daemonization). It **triaged out** the `.deb`
empty-makers build failure as a pre-existing, untouched infra bug — correctly resisting
scope creep.

**Phase 5 — Commit, PR, CI, merge, cleanup.** Three logical commits, pushed with `-u`,
PR #58 opened (body written to a file to dodge heredoc+backtick shell breakage). The AI
noted CI won't fire on a branch push alone (workflows gate on PR/develop), monitored the
run by manual polling past the 120s RPC cap, and reported 10/10 green. After the operator
merged, it archived both `bump-pi-compat-to-0-78` and the superseded
`bump-pi-compat-to-0-76`, deleted the branch, and removed the worktree.

## 4. Prompts that worked

- **The goal prompt** — `/skill:openspec-apply-change bump-pi-compat-to-0-78`. Effective
  because the change already carried a proposal + tasks; the skill gave the AI a
  structured task list to execute and verify against. A future operator should still open
  this way, but front-load the verification expectation (see below).
- **"What versions will be delivered in electron build?"** — high leverage. It turned an
  assumption into a concrete, sourced table and *incidentally exposed the dead test
  scripts*. Rewrite as: *"Before finishing, produce a table of what the Electron/bundle
  build actually ships and where each version is pinned."*
- **"Is there a way to verify some tasks with existing docker / ci tests?"** — converted
  "trust the diff" into "run the real automation." A durable kickoff line: *"Prefer
  existing CI/Docker smoke scripts over manual claims for any task marked verifiable."*
- **"Docker is running. If there is QA / Smoke tests ... do it"** — unblocked the Docker
  path by confirming the prerequisite. Effective because it removed the AI's excuse to
  defer.
- **"go on"** — a single short unlock that let the AI continue the collateral cleanup it
  had already scoped and paused on. Cheap, high-yield when the AI has clearly staged the
  next move.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Treat "apply the change" as edits-only and defer verification to the human | Asking "verify with existing docker/ci tests?" and "Docker is running, do it" | Stating up front: "run the real standalone + Docker smoke scripts, don't just claim resolution works" |
| Assume what the Electron build ships without tracing it | Asking "what versions will be delivered in electron build?" | Requiring a source-of-pin table as a definition-of-done item |
| Reach for a naive `sed` rename on the stale package scope | Pointing at the specific `@mariozechner` file and letting the AI discover it was dead, not stale | Noting that `eliminate-electron-runtime-install` deleted the offline/managed-dir flow, so those scripts need rewrite or deletion |
| Risk scope creep into the `.deb` build failure | (AI self-corrected) — it triaged the empty-makers bug as pre-existing and out of scope | Keeping a "touched-zero-files-here → not mine" rule for infra failures unrelated to the diff |
| Expect CI to fire on a branch push | (AI caught it) — workflows gate on PR/develop | Remembering: open the PR to trigger `ci.yml`; branch push alone does nothing |

The strongest recurring theme: **the operator's steers were all "prove it," and the AI's
best moves were the scope-boundary calls** (rewrite-not-rename, defer-the-.deb-bug,
PR-triggers-CI).

## 6. Skills, tools & memory created — and why they're effective

No new skills or memories were created this session — the work ran entirely through
existing infrastructure (`openspec-apply-change`, the standalone + Docker smoke scripts,
the OpenSpec archive command). The one subagent spawned was `Explore` ("Update docs for
rewritten Electron test scripts"), used to keep doc-tree edits out of the main context.

**What *should* be captured:** the recurring pattern here is a *version-floor bump* —
bump `piCompatibility` + the pi dependency, regenerate the lockfile, add lookup-table
rows, then prove resolution through standalone + Docker smoke. This repo already has a
`bump-pi-version` skill in `projects-memory`; this session is a strong validation of it,
and the one thing worth adding is the **"dead-test-detection" guardrail**: after any pi
bump, grep the Electron test scripts for the deleted `@mariozechner` scope /
offline-cache assertions, because a floor bump is the moment those stale tests get
re-run and fail.

## 7. Pitfalls & dead ends

- **Stale lockfile → `npm ci` ETARGET.** Bumping `dependencies` to `^0.78.0` without
  regenerating `package-lock.json` leaves the old `0.75.5` pin; consumers/CI fail. Run
  `npm install --package-lock-only`. *Required, not optional.*
- **Don't `sed`-rename dead scripts.** The `test-{electron,deb,desktop}-install*.sh`
  scripts tested a deleted bootstrap flow; the stage-1 offline-cache/`manifest.json`
  assertion fails regardless of package scope. Rewrite (or delete) — renaming won't help.
- **`start` subcommand daemonizes.** The bundled server's `start` forks and the parent
  exits; the smoke test's foreground spawn must invoke the bare command, not `start`.
- **`ps aux` returns nothing without `procps`.** The Ubuntu test container lacked it;
  add `apt-get install procps` (or demote the process-liveness assertion to informational).
- **`.deb` empty-makers build failure** (`Making for the following targets: , `) is a
  pre-existing forge 7.11 local-build bug — unrelated to a floor bump. Don't chase it;
  the CI `_electron-build.yml` path is the proven installer route.
- **CI won't fire on a branch push.** `ci.yml` / `ci-electron.yml` gate on PR-to-develop
  (or `workflow_dispatch`). Open the PR to trigger the run.
- **Heredoc + backticks break the shell** when creating a PR body inline. Write the body
  to a file (`/tmp/pr-body-*.md`) and pass `--body-file`.
- **MCP RPC caps at ~120s** — polling CI via a single long call times out. Poll manually
  in a loop.

## 8. Reproduce it faster — checklist

**Inputs to have ready:**
- The OpenSpec change (`openspec/changes/bump-pi-compat-to-0-78/` with proposal + tasks)
  checked out in its `.worktrees/<name>` worktree.
- Docker running (for the bundle smoke), `gh` authed (for the PR + CI monitoring).

**Steps:**
1. `/skill:openspec-apply-change bump-pi-compat-to-0-78` in the worktree.
2. Bump `packages/server/package.json` → `piCompatibility.{minimum,recommended}=0.78.0`
   + `dependencies."@earendil-works/pi-coding-agent"=^0.78.0`.
3. Add `0.76/0.77/0.78 → Node floor` rows to `bundled-node-meets-pi-floor.test.ts`.
4. `npm install --package-lock-only` to realign the lockfile.
5. `npm test 2>&1 | tee /tmp/pi-test.log | tail` → confirm green.
6. Grep the Electron test scripts for `@mariozechner` / offline-cache — rewrite any that
   test the deleted managed-dir flow against the bundle-only flow.
7. `bash scripts/test-standalone-npm-install.sh --port 18000` (no Docker) and
   `bash packages/electron/scripts/test-electron-install.sh` (Docker) → both green.
8. Commit in logical chunks, `git push -u`, open PR (body via `--body-file`), poll CI to
   10/10 green, merge.
9. `openspec archive bump-pi-compat-to-0-78` + archive the superseded sibling; delete the
   branch and `git worktree remove` the worktree.

**Final artifacts produced:** the floor bump (`packages/server/package.json`,
`bundled-node-meets-pi-floor.test.ts`, regenerated `package-lock.json`), four rewritten
Electron test scripts, doc updates (`docs/electron-session.md`,
`docs/file-index-electron.md`, `docs/electron-build-methods.md`), PR #58 merged as
`47a36927` on develop, and the archived change under
`openspec/changes/archive/2026-05-30-bump-pi-compat-to-0-78/`.

---

_Generated from session `019e79e9` · `pi-agent-dashboard` · 2026-05-30. Source extract: `/tmp/facts-TnRAZI`._
