---
session: 019e7ada
week: 2026/W22
type: development
model: "@fast"
premium: true
premium_reason: "heavy steering (7 user prompts)"
upgrade_status: pending
openspec_changes: [server-launch-smoke-suite]
proposal_excerpt: "Change `unify-server-launch-ts-loader` collapsed five duplicate dashboard-server spawn sites into one shared `launchDashboardServer` primitive. Unit coverage is comprehensive (launcher tests, `ToolResolver.resolveJiti…"
---

# How we did it: Fix a CodeRabbit-flagged CI publish gate on PR #43 — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The session opened with a deceptively small question — _"What is the openspec which is
related?"_ — but the real objective emerged over the next few steering turns: **take a
CodeRabbit review of PR #43, verify each finding against the actual worktree source,
fix the still-valid issues as clean separate commits, monitor CI to green, wait out
CodeRabbit's re-review cadence until it reports no actionable comments, and squash-merge
the PR.** The change itself gates the release `publish` job on smoke + tests and splits
the monolithic `prepare` job into `resolve` + `tag-and-push`.

## 2. TL;DR playbook

1. **Anchor the change**: ask _"what is the openspec related?"_, then correct against
   the actual commits — `git log develop..HEAD` revealed the branch touches
   `gate-publish-on-smoke-and-tests` (archived), **not** the first-guessed
   `server-launch-smoke-suite`.
2. **Pull the full review**: fetch the CodeRabbit summary **and** inline comments for
   PR #43 (11 actionable + 3 nitpicks, each with an embedded "🤖 Prompt for AI Agents"
   block).
3. **Verify before fixing**: open the real `publish.yml` / `_smoke.yml` source and
   confirm each finding is still valid — do **not** trust the review blindly.
4. **Plan commits by severity**: critical → major → minor → docs-hygiene, one concern
   per commit; explicitly defer large mechanical changes (SHA-pinning) to a separate PR.
5. **Land each fix + update its contract test**: e.g. drop `tag-and-push` from
   `publish.needs`, add the `if: !cancelled()` guard, and align
   `publish-workflow-contract.test.ts` clause 5. Run the contract test after every commit.
6. **Push once, then poll CI**: watch the triggered run to `success` before declaring done.
7. **Loop on CodeRabbit re-reviews**: each push triggers a fresh pass; fix the one
   follow-up (a missed `prepare` reference), push, re-poll — until "No actionable
   comments were generated."
8. **Squash-merge + delete branch** once CI green and CodeRabbit clean.

## 3. How the collaboration unfolded

**Phase A — Discovery & correction (prompts 1–2).** The AI first guessed the related
OpenSpec was `server-launch-smoke-suite` from directory listing. The human steered:
_"check the changes in this PR that the commits related to that spec."_ Running
`git log develop..HEAD` corrected the answer to `gate-publish-on-smoke-and-tests`.
**Lesson worth repeating:** ground "which spec" claims in the actual commits, not a
`ls openspec/changes/` fuzzy match.

**Phase B — Review analysis with verification (prompt 3).** Given the PR URL, the AI
pulled CodeRabbit's summary plus 11 inline comments, then — critically — opened
`publish.yml` and confirmed the 🔴 finding was real: `tag-and-push` is
`workflow_dispatch`-only, so on a `v*` tag push it's **skipped**, and `publish` had
`needs: [resolve, ci-checks, smoke, tag-and-push]` with no `if:` guard → GitHub treats
the skipped need as blocking → **no publish, no Electron, no release on tag push.** The
contract test actively enforced the broken shape.

**Phase C — Severity-ordered commits (prompt 4: "make separate commits").** Four commits
landed in priority order: (1) unbreak publish on tag-push + fix contract clause 5,
(2) shrink Windows smoke matrix to a single Node 22 leg, (3) sync the `ci-cd-pipeline`
spec, (4) docs hygiene (caveman FAQ, attribution fix, alphabetized index rows). The
contract test (17→18 assertions) passed after every commit.

**Phase D — CI monitor + CodeRabbit loop (prompts 5–6: "monitor CI", "recheck").**
Pushed once, polled run `26696189821` to green. CodeRabbit's pass 2 flagged one missed
`prepare` reference → commit 5, push, poll run `26698756636` green, pass 3 clean.

**Phase E — Merge (prompt 7: "merge PR").** Squash-merged to `develop` (`38ea8d5`),
branch deleted.

## 4. Prompts that worked

- **Goal prompt** — _"What is the openspec which is related?"_ was a weak kickoff on its
  own (too narrow), but the follow-up _"check the changes in this PR that the commits
  related to that spec"_ made it strong by forcing verification against commits. A better
  single kickoff: _"Analyze CodeRabbit's review on PR #43, verify each finding against
  the source, and plan the fixes as separate commits."_
- **High-leverage follow-ups**:
  - _"make separate commits"_ — turned a fix pile into a clean, reviewable, severity-ordered history.
  - _"monitor CI"_ / _"recheck"_ — short, but drove the poll-to-green + re-review loop.
  - _"merge PR"_ — the terminal one-word command once all gates were green.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Guess the related OpenSpec from a directory `ls` | "check the changes in this PR that the commits related" | Always run `git log develop..HEAD` before naming the spec a PR touches |
| Read the review summary and be ready to act | Pointing at the PR URL and "analyze the problems" | Fetch summary **and** inline comments, then verify each against source before fixing |
| Bundle fixes together | "make separate commits" | One concern per commit, severity-ordered; state the plan first |
| Consider the work done after pushing | "monitor CI" then "recheck" | Always poll the triggered run to `success` and re-fetch CodeRabbit after each push |

Quality bars the human imposed implicitly: verify-before-fix, separate commits,
contract-test-green per commit, CI-green + CodeRabbit-clean before merge.

## 6. Skills, tools & memory created — and why they're effective

No new skill or memory was persisted this session, but the workflow is highly
repeatable and **should** become a skill: **"triage-coderabbit-pr"** — fetch review
(summary + inline), verify each finding against source, plan severity-ordered commits,
land each with its contract test, poll CI, loop on re-reviews to clean, squash-merge.
A subagent (`Explore`) was attempted for caveman-style `docs/` rewrites per AGENTS.md
rule 6 but the role was unresolvable, so the AI applied caveman style manually. **When
to invoke:** any PR that comes back with a CodeRabbit review needing verified fixes.

## 7. Pitfalls & dead ends

- **Trusting the review blindly** — avoided here; every finding was verified against
  `publish.yml`/`_smoke.yml` source first. Some `prepare` references (line 24, "legacy
  monolithic prepare") were **intentional historical context** and correctly left alone.
- **Subagent unavailable** — the `Explore` role was unresolvable, so the delegated
  `docs/` caveman rewrite fell back to manual editing. If a subagent role won't resolve,
  proceed inline rather than blocking.
- **Deferred, not skipped** — SHA-pinning `actions/*@v4` and `persist-credentials: false`
  were explicitly deferred to a dedicated security PR (touches 9+ `uses:` lines); calling
  the deferral out kept scope tight.
- **CodeRabbit re-review latency** — each push triggers a fresh pass minutes later; don't
  declare done on the first green — poll until "No actionable comments were generated."

## 8. Reproduce it faster — checklist

- [ ] `git log develop..HEAD` — name the real change/spec from commits, not `ls`.
- [ ] Fetch CodeRabbit summary **+** inline comments for the PR.
- [ ] Open the flagged source files; verify each finding is still valid.
- [ ] Plan commits severity-ordered (critical→major→minor→docs); defer large mechanical changes.
- [ ] Land each fix + update its contract test; run the contract test after every commit.
- [ ] Push once; poll the triggered CI run to `success`.
- [ ] Re-fetch CodeRabbit; fix follow-ups; repeat until clean.
- [ ] Squash-merge + delete branch.

**Inputs needed:** PR number + URL, `gh` auth, worktree checked out on the PR branch.
**Artifacts produced:** 5 fix commits on PR #43, green CI runs `26696189821` /
`26698756636`, squash-merge `38ea8d5` on `develop`.

---

_Generated from session `019e7ada-11b8-73c9-8c7b-43b6bf037637` · `/Users/robson/Project/pi-agent-dashboard/.worktrees/gate-publish-on-smoke-and-tests` · 2026-05-31. Source extract: session facts sheet._
