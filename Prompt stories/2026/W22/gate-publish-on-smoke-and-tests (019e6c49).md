---
session: 019e6c49
week: 2026/W22
type: development
model: "@fast"
premium: true
premium_reason: "heavy steering (5 user prompts)"
upgrade_status: pending
openspec_changes: [gate-publish-on-smoke-and-tests]
proposal_excerpt: "The `standalone-install-smoke` matrix runs 7 container jobs (Linux × 6 Node-image combos + Windows × 1) on every push to every PR targeting `develop`. For typical PRs that touch only client TS or server logic, thi…"
---

# How we did it: Gate publish on smoke + tests — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The kickoff was a single skill invocation: `/skill:openspec-apply-change gate-publish-on-smoke-and-tests`. The change already had a proposal and a 38-task `tasks.md`; the ask was simply "implement it."

The **real objective**, once the CI-workflow surgery was in motion, was: move the expensive 7-leg `standalone-install-smoke` matrix off *every PR push* and instead make it (plus lint+test+build) a **release gate** — so a version tag can never publish unless smoke + tests are green first. Concretely: extract a reusable `_smoke.yml`, add an on-demand `ci-smoke.yml`, split `publish.yml`'s `prepare` job into `resolve` + `tag-and-push`, fan out `ci-checks` + `smoke` in parallel before publish, strip the smoke jobs from the per-PR `ci.yml`, and pin the whole contract with a repo-lint test.

## 2. TL;DR playbook

1. **Kick off** with `/skill:openspec-apply-change <change-name>` — let the apply skill read the proposal and drive tasks in order.
2. **Author the workflows** (`_smoke.yml` reusable, `ci-smoke.yml` dispatch shim, refactored `publish.yml`, slimmed `ci.yml`) and **parse each with `js-yaml`** immediately (`node -e "require('js-yaml').load(fs.readFileSync(...))"`) to catch YAML errors before pushing.
3. **Pin the contract in code**: add gate-shape assertions to `publish-workflow-contract.test.ts` (resolve.outputs.ref, ci-checks shape, smoke `uses:`, `publish.needs` includes smoke). Extend `no-bash-on-windows.test.ts` to also scan the new `_smoke.yml`.
4. **Verify the failure mode**: temporarily `sed` out `smoke` from `publish.needs`, confirm the contract test fails with the cited change name, then revert. Proves the gate actually gates.
5. **Run tests in a clean HOME** to dodge flaky parallel-suite races: `cd packages/shared && HOME=$(mktemp -d) npx vitest run <files>`.
6. **Delegate docs** (file-index, FAQ, spec sync) to `Explore` subagents per the repo's Documentation Update Protocol — don't hand-edit `docs/` from the main agent.
7. **Commit selectively** — stage the workflow + test + doc files explicitly; leave unrelated `.pi/settings.json` drift uncommitted.
8. **Open the PR with `--body-file`** (a `/tmp/pr-body.md`), not an inline heredoc — the first inline `gh pr create` failed.
9. **When CI goes red on something you didn't touch, diff `develop` first** to prove it's pre-existing; here a lockfile drift blocked both PRs — fix it in a *separate* PR (#44).
10. **Defer manual-only tasks** (GitHub-UI dispatch, real prerelease cut) explicitly to the operator, mark them done with a note, then archive + push.

## 3. How the collaboration unfolded

**Phase A — Apply (tasks 1–8, autonomous).** The AI read the current workflows, then authored `_smoke.yml`, `ci-smoke.yml`, the refactored `publish.yml` (prepare → resolve + tag-and-push), and the slimmed `ci.yml`. It validated each YAML with `js-yaml` and added a 5-clause gate contract to `publish-workflow-contract.test.ts`. **Why it worked:** parsing workflows programmatically and encoding the gate shape as a test meant the "did I wire needs[] correctly" question got a machine answer, not a human eyeball.

**Phase B — Verify the gate is real.** The AI didn't just assert the contract test passed — it *broke* the workflow on purpose (`sed` out `smoke` from `publish.needs`), watched the contract test fail with the exact expected message, then reverted. **Decision point worth repeating:** a gate you never watched fail is a gate you don't know works.

**Phase C — Test hygiene.** The full `npm test` surfaced two failures. The AI correctly triaged them: the `no-bash-on-windows` failure was *its own* (the Windows leg moved to `_smoke.yml` but the lint only scanned `publish.yml`/`ci.yml`) → fixed by widening the lint's file set. The `browse-endpoint` failure was a pre-existing flaky parallel race → confirmed green in isolation with a clean `HOME`.

**Phase D — Steering: "smoke test run and electron package in CI."** The operator wanted real CI proof. The AI pushed the branch and dispatched `ci-electron.yml` + `ci-smoke.yml` — and hit GitHub's rule that `workflow_dispatch` requires the file on the **default branch**, so the brand-new `ci-smoke.yml` returned 404. It pivoted rather than fighting the limitation.

**Phase E — The pre-existing lockfile drift.** CI Electron failed on `lock file's @earendil-works/pi-coding-agent@0.74.1 does not satisfy @0.75.5`. The AI diffed `develop`, proved the drift was introduced by an earlier `bump-pi-compat-to-0-75` change (package.json bumped, lockfile never regenerated), and fixed it in a **separate PR #44** cloned fresh into `/tmp`. Serendipitously, #44 branched from `develop` *before* this change removed smoke from `ci.yml`, so its CI ran the full 9-leg smoke matrix green — that *was* the smoke run the operator asked for.

**Phase F — Defer, archive, push.** Operator said "defer tests and mark done," then archived and "commit and push." The AI marked the 9 manual-verification tasks done-with-note, synced the delta spec into `ci-cd-pipeline/spec.md` (2 modified, 4 added) via an `Explore` subagent, archived, and pushed both commits to PR #43.

## 4. Prompts that worked

- **The goal prompt** — `/skill:openspec-apply-change gate-publish-on-smoke-and-tests`. Effective because a well-formed proposal + tasks.md already existed; the skill invocation lets the AI self-drive without re-litigating scope. *Stronger version for a fresh change:* ensure the proposal names the exact files to create and the contract to pin **before** invoking apply.
- **High-leverage follow-up** — `"perform smoke test run and electron package in CI"`. Short, but it forced the real-world validation phase that surfaced the lockfile drift. A better-specified version: *"push the branch and get a green smoke matrix + electron build on real CI; if CI is red, prove whether it's from this change or pre-existing."*
- **`defer tests and mark done`** — a clean scope-closer that told the AI to stop chasing manual-only tasks and finalize. Effective because it drew the line between "code done" and "operator-must-click."

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Stop at "tasks implemented + tests pass" | "perform smoke test run and electron package in CI" | Make "green on real CI" an explicit acceptance criterion in the proposal, not an afterthought |
| Keep grinding on manual-verification tasks that need GitHub-UI dispatch | "defer tests and mark done" | Tag GitHub-UI/operator-only tasks in tasks.md up front so the AI defers them automatically |
| Treat any red CI as its own bug | (implicit) — AI self-corrected by diffing `develop` | State the rule "if CI is red, diff the base branch before assuming it's your change" |

## 6. Skills, tools & memory created — and why they're effective

No new skill or memory was created this session — the work rode existing skills (`openspec-apply-change`, `openspec-archive-change`) and the `Explore` subagent for docs/spec sync.

**Skill that *should* exist:** a "verify-a-CI-gate" micro-procedure — *push branch → dispatch workflows → if 404 on dispatch, remember GitHub requires the file on the default branch → if CI red, `git diff origin/<base>` to classify pre-existing vs. introduced → fix pre-existing drift in its own PR.* This session re-derived all four of those rules from scratch; capturing them would remove ~30 minutes of re-discovery. (The repo already has a `ci-troubleshoot` skill — this session's lockfile-drift + dispatch-404 findings belong folded into it.)

## 7. Pitfalls & dead ends

- **`gh pr create` with an inline heredoc `--body` failed.** Fix: write the body to `/tmp/pr-body.md` and use `--body-file`.
- **`workflow_dispatch` 404 for a brand-new workflow file.** GitHub only finds dispatchable workflows that exist on the **default branch**. A new `ci-smoke.yml` in a feature PR can't be dispatched until the PR merges. Don't burn time retrying — either merge first or piggyback on another branch's CI.
- **Pre-existing lockfile drift blocked *both* PRs.** `packages/server/package.json` declared `^0.75.0` but `package-lock.json` still had `0.74.1` (an earlier `bump-pi-compat-to-0-75` change bumped package.json but never ran `npm install --package-lock-only`). Symptom: `npm error Invalid: lock file's ...@0.74.1 does not satisfy ...@0.75.5`. Fix: regenerate the lockfile in a clean clone and land it as its own PR.
- **Flaky `browse-endpoint` test in the parallel suite.** Passes in isolation with a clean `HOME=$(mktemp -d)`. Don't chase it as a real regression.
- **Unrelated `.pi/settings.json` drift** kept showing in `git status`. Leave it uncommitted; stage the change's files explicitly.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** an OpenSpec change with proposal + tasks.md; `gh` authenticated; write access to the repo; the base branch (`develop`) checked out cleanly.

- [ ] `/skill:openspec-apply-change <change-name>`
- [ ] Author workflows; `js-yaml`-parse each before commit
- [ ] Encode the gate as assertions in `publish-workflow-contract.test.ts`; widen `no-bash-on-windows.test.ts` to any new workflow file
- [ ] Break the gate on purpose, watch the contract test fail, revert
- [ ] `HOME=$(mktemp -d) npx vitest run <files>` to dodge parallel-suite flakes
- [ ] Delegate docs + delta-spec sync to `Explore` subagents
- [ ] Stage change files explicitly; leave `.pi/settings.json` alone
- [ ] `gh pr create --body-file /tmp/pr-body.md`
- [ ] If CI red → `git diff origin/develop` to classify; fix pre-existing drift in a separate PR
- [ ] Defer operator-only tasks with a note; archive + sync specs + push

**Artifacts produced:** `.github/workflows/_smoke.yml`, `ci-smoke.yml`, refactored `publish.yml`, slimmed `ci.yml`; tests in `packages/shared/src/__tests__/{publish-workflow-contract,no-bash-on-windows}.test.ts`; `openspec/changes/archive/2026-05-28-gate-publish-on-smoke-and-tests/`; spec sync into `openspec/specs/ci-cd-pipeline/spec.md` (2 modified, 4 added); PR #43 (this change) + PR #44 (lockfile regen).

---

_Generated from session `019e6c49-155f-7565-b430-89eeb6ced017` · `pi-agent-dashboard` · 2026-05-28. Source extract: `/tmp/facts-20958-1784848634.md`._
