---
session: 019ef6d4
week: 2026/W26
type: planning
model: "@fast"
premium: true
premium_reason: "yes — large facts sheet (~10040 tok)"
upgrade_status: pending
openspec_changes: [add-code-quality-skill]
proposal_excerpt: "The repo has **no code-quality analyzer**. `npm run lint` is just `tsc --noEmit` (type checking), and `npm test` is vitest. There is no ESLint, Biome, Prettier, or dead-code tool, and no `.editorconfig`. 1712 tracked…"
---

# How we did it: Add a Biome code-quality gate — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The kickoff was a single skill invocation: `/skill:openspec-apply-change add-code-quality-skill`.
The real objective, once the change artifacts were read, was to **introduce the repo's
first static-analysis code-quality tool** — the repo had no ESLint/Biome/Prettier, only
`tsc --noEmit` for `lint` and vitest for `test`. The change installs **Biome 2.5.1**, wires
a tiered rule ladder (Tier A hard `error`, Tier B/C soft `warn`), adds a `quality:changed`
"oracle" script that gates only files changed vs the default branch, adds a soft CI step,
authors a `code-quality` skill, and graduates Tier A rules to hard-fail. The two steering
turns then pushed it through **isolation-testing feasibility** and finally **shipping via
`ship-change`** (deferring the one live acceptance task).

## 2. TL;DR playbook

1. In the change worktree, run `openspec status` + `openspec instructions apply` to load the tasks and context.
2. `npm install --save-dev --save-exact @biomejs/biome`; then read `node_modules/@biomejs/biome/configuration_schema.json` to get **authoritative** rule→group mapping (Biome 2.x ≠ 1.x schema).
3. Author `biome.json`: formatter off, `preset: "none"` (not deprecated `recommended: false`), explicit tier rules, client-a11y + test-file overrides, and **ignore CSS/fixtures/dist** (Biome parse-errors on Tailwind at-rules otherwise).
4. Set `vcs.defaultBranch` to the repo's **actual** integration branch (`develop`, **not** `main`) — otherwise `biome check --changed` silently reports 0 files and the oracle passes everything.
5. Add npm scripts: `lint:biome`, `fix:changed`, `quality:changed` (biome→tsc→vitest short-circuit), `quality:report`. Verify the oracle **both ways**: clean diff → exit 0, warn-tier issue in a **committed** change → exit non-zero.
6. Count Tier A violations repo-wide first (they were only 4); fix **surgically**, then flip Tier A rules to `error` and prove reintroducing `==` hard-fails.
7. Delegate all `docs/` writes to a subagent in caveman style; add a one-line AGENTS.md pointer.
8. Run the full repo gate (tsc + full vitest + `biome lint .`), then invoke `ship-change` to archive, commit, PR against `develop`, watch CI, triage CodeRabbit, and squash-merge.

## 3. How the collaboration unfolded

**Phase 1 — Load the change.** The AI read the OpenSpec `status`/`instructions apply` JSON and all context files before touching code. Effective because it turned 17 abstract tasks into a concrete phase plan (config → scripts → CI → skill → Tier-A graduation → docs → verify).

**Phase 2 — Config foundation (the schema trap).** Biome 2.5.1 has a different config schema than 1.x. Instead of guessing, the AI parsed `configuration_schema.json` to verify all 20 rules exist and map to the right groups. This caught a **spec error**: `useValidTypeof` lives in `correctness`, not `suspicious`. It also learned 2.x uses `files.includes` with `!` negations and `overrides[].includes`. Decision point: keep everything soft first (`warn`), then graduate — a low-risk ratchet.

**Phase 3 — The `--changed` oracle blocker.** The spec hardcoded `defaultBranch: "main"`, but the repo has **no `main`** — CI and HEAD are `develop`. With `main`, `biome check --changed` returned 0 files and the oracle silently passed. The AI methodically isolated the cause: it first suspected a linked-worktree libgit2 bug, then proved via a committed change that `--changed` compares **committed** branch state vs the default branch (untracked/uncommitted files are invisible). Root cause: wrong `defaultBranch`. **The human was asked to approve deviating from the approved spec** (`main`→`develop`); approved, and the spec artifacts were updated to match.

**Phase 4 — Scripts + Tier A graduation.** Verified the oracle both ways. Learned `useTemplate`'s fix is **unsafe** while `useConst` (`let`→`const`) is **safe** — corrected the skill's safe/unsafe examples empirically. Tier A had only 4 violations (`noEmptyPattern`×3, `noUnreachable`×1), fixed surgically (no repo-wide `--write` blast), then flipped to `error` and proved a reintroduced `==` hard-fails.

**Phase 5 — Docs + verify.** Per the Documentation Update Protocol, delegated `docs/code-quality.md` + file-index rows to a `general-purpose` subagent in caveman style; added a one-line AGENTS.md pointer directly. Ran the full gate: tsc clean, 8082 tests pass, Biome exits 0.

**Phase 6 — Steering: isolation test, then ship.** Steering #1 asked whether 7.1 (a live GoalControl acceptance test) could run in the isolated Docker harness. The AI grounded the answer in the actual `docker/` files: the harness gives **isolation but not determinism** — it ships a real pi agent + goal-plugin UI, but the autonomous loop driver (`pi-goal-hermes`) isn't bundled. Steering #2 ("I will test later, use skill ship-change") deferred 7.1 and triggered the ship pipeline: archive/sync, commit (via `-F` to avoid backtick substitution), PR #163 vs `develop`, CI green, CodeRabbit triage, a mid-flight `develop` merge-conflict resolution, and squash-merge.

## 4. Prompts that worked

- **Goal prompt** `/skill:openspec-apply-change add-code-quality-skill` — effective because the change's proposal/design/tasks/spec already existed, so a single skill call loaded the full plan. Lesson: front-load the OpenSpec artifacts, then apply is one line.
- **High-leverage follow-up** `is it possible to test with isolated docker test?` — a short feasibility probe that (correctly) got a grounded "partially — isolation, not determinism" answer instead of an unqualified yes. Good because it forced the AI to read the real harness files before answering.
- **High-leverage follow-up** `I will test later, use skill ship-change` — decisively unblocked the last task by explicitly deferring the live acceptance test and naming the next skill. A future operator should give this the moment a live/interactive task is the only blocker.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Follow the spec's `defaultBranch: "main"` literally | (AI surfaced it and asked) — approve `main`→`develop` | State the repo's real integration branch is `develop` up front; never assume `main` exists |
| Stall on the live acceptance task (7.1) waiting for a decision | "I will test later, use skill ship-change" | Pre-declare that live/interactive acceptance tasks are deferred to post-merge |
| Consider Docker as a push-button test for the autonomous loop | "is it possible to test with isolated docker test?" (probe) | Know the harness ships isolation + agent + goal UI but **not** `pi-goal-hermes` |
| Trust the spec's rule grouping | (AI cross-checked schema) | Verify rule→group against `configuration_schema.json`, not the design doc |

## 6. Skills, tools & memory created — and why they're effective

- **`.pi/skills/code-quality/SKILL.md`** — captures the Biome workflow (analyze→fix→test), the revert-on-red guardrail, the "no out-of-diff edits" rule, and the empirically-verified safe/unsafe fix policy (`useConst` safe, `useTemplate` unsafe). Effective because it removes the schema-and-safety guesswork the AI had to do live; invoke it on "improve code quality", "lint and fix", or when setting a code-quality goal.
- **`docs/code-quality.md` + file-index rows** — written by a subagent in caveman style per the Documentation Update Protocol, keeping the main agent out of `docs/` prose.
- **`general-purpose` subagent** (docs writer) — the reusable pattern: delegate every `docs/` write to an isolated subagent with the caveman rule passed verbatim.

## 7. Pitfalls & dead ends

- **`biome check --changed` returns 0 files** → the `defaultBranch` doesn't exist (or you're comparing against uncommitted/untracked changes). Fix: point `defaultBranch` at the real branch (`develop`) and test with a **committed** change.
- **Biome exits 1 with "errors" while all rules are `warn`** → those are **parse errors** on CSS (Tailwind at-rules) and `.cjs` fixtures, not lint violations. Fix: exclude CSS/fixtures/dist from `files.includes`.
- **`rules.recommended: false` is deprecated in Biome 2.5** → use `preset: "none"` instead (CodeRabbit flagged this; same rule set, warning gone).
- **CodeRabbit "pass" with 0 comments** can be a rate-limit ACK, not a real review. Wait out the reset window (~12 min here) and re-trigger.
- **Rejecting a bad review suggestion:** CodeRabbit wanted `continue-on-error: true` on the CI Biome step — that would break the Tier A hard gate. Correct move: reject, rename the stale "(soft warn)" label instead, and reply explaining why.
- **`--delete-branch` fails when `develop` is checked out in the parent worktree** → delete the remote branch directly, then remove the worktree from the parent checkout.
- **Removing the worktree your shell sits in** kills subsequent Bash calls (cwd deleted). Do worktree removal last, from the parent repo.
- **A stray `packages/server/src/index.ts`** appeared from an earlier `echo >>` to a non-existent path during `--changed` testing; `git checkout` can't restore an untracked file. Clean it before committing.

## 8. Reproduce it faster — checklist

- [ ] Worktree ready; `openspec status`/`instructions apply` loaded.
- [ ] `npm i -D --save-exact @biomejs/biome`; read `configuration_schema.json` for rule→group truth.
- [ ] `biome.json`: formatter off, `preset: "none"`, explicit tiers, client-a11y + test overrides, ignore CSS/fixtures/dist.
- [ ] `vcs.defaultBranch: "develop"` (the real branch — verify with `git remote show origin`).
- [ ] npm scripts `lint:biome` / `fix:changed` / `quality:changed` / `quality:report`; test oracle both ways with a **committed** change.
- [ ] Count Tier A violations; fix surgically; flip to `error`; prove `==` hard-fails.
- [ ] CI soft step `biome lint . --reporter=github`.
- [ ] `docs/` writes via subagent (caveman style); one-line AGENTS.md pointer.
- [ ] Full gate: tsc + full vitest + `biome lint .` all green.
- [ ] `ship-change`: archive/sync, commit via `-F`, PR vs `develop`, watch CI, triage CodeRabbit, resolve any `develop` conflict, squash-merge, delete remote branch, remove worktree last.

**Key inputs:** `ANTHROPIC_API_KEY` (agent + judge turns), the OpenSpec change artifacts under `openspec/changes/add-code-quality-skill/`.
**Final artifacts:** `biome.json`, `.pi/skills/code-quality/SKILL.md`, `docs/code-quality.md`, CI step in `.github/workflows/ci.yml`, PR #163 squash-merged (`e44a5c18`) into `develop`.

---

_Generated from session `019ef6d4-801c-7225-8b02-6a0c41f25da9` · `pi-agent-dashboard` · 2026-06-24. Source extract: session facts sheet._
