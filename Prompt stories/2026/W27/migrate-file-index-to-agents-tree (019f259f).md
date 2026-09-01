---
session: 019f25a2
week: 2026/W27
type: development
model: "@fast"
premium: true
premium_reason: "large facts sheet (~12921 tok)"
upgrade_status: pending
openspec_changes: [migrate-file-index-to-agents-tree]
proposal_excerpt: "The repo adapted agent0ai/dox (a recursive per-directory `AGENTS.md` tree) but **kept only its philosophy, not its data structure**. `2026-06-23-add-markdown-knowledge-base` §6d shipped the DOX *tooling* (`kb dox init…"
---

# How we did it: migrate the flat file-index into a per-directory AGENTS.md tree — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The user attached the OpenSpec change `migrate-file-index-to-agents-tree` and opened with a single low-key prompt: **"Is it anything to clarify?"** The real objective, sharpened by the two steering turns, was to **replace the flat `docs/file-index-*.md` splits with a recursive per-directory `AGENTS.md` tree** (the agent0ai/dox model the repo had adopted in philosophy but never in data structure): make `kb dox init` *source-aware*, big-bang-generate the whole `packages/` tree with `@fast`-authored per-file purpose rows, keep it BM25-searchable and pull-retrievable via `kb agents <path>`, and commit the result — all without regressing the existing splits or the hand-authored root `AGENTS.md`.

## 2. TL;DR playbook

1. **Read the attached spec first, then answer your own "anything to clarify?"** — surface the *decision-forcing* ambiguities (deliverable boundary, big-bang vs pilot, quality gate, tree granularity), don't just start coding.
2. **Bake the human's answers back into `design.md` + `tasks.md`** (new review gate, big-bang+commit scope) and re-run `openspec validate --strict` before touching code.
3. **TDD the source-aware `kb dox init` deltas ①–⑤** in `dox.ts` (red→green): parameterized source/md walker, exclude `.worktrees|openspec|doc-example`, group by `dirname(rel)`, drop `part-N` pseudo-dirs, rows relative to each file's own dir.
4. **Build the migration core + runner as pure, testable modules** (`migrate-file-index.ts`, `migrate-runner.ts`): parse splits → join with source → Tier-0 (verbatim copy) vs Tier-1 (author) → grounding check → batch → validate → resumable checkpoint.
5. **Preview on 2 real dirs before the big-bang** — one all-hits (Tier-0), one with misses (Tier-1 via a live `@fast` subagent) — and verify the authored rows against source.
6. **Drive Tier-1 authoring in waves of ~6 parallel `@fast` subagents**, each writing its rows to a scratch reply file; process replies through the tolerant parser.
7. **Run a deterministic grounding audit over every authored row** (every backticked identifier must exist in the source), triage the handful of flags, confirm 0 fabrications.
8. **Flip searchability flags** (`indexAgentsFiles` on, `directoryLevelAgents` → enabled/pull), prove `kb agents <deep-path>` returns the full chain, run the full suite, commit.

## 3. How the collaboration unfolded

**Phase 1 — Clarify (don't start).** The AI read the OpenSpec change and answered "anything to clarify?" with *genuine* open questions rather than a rubber stamp: (1) deliverable boundary — ship the tooling only, or generate-and-commit the tree? (2) big-bang vs a de-risking pilot; (3) `@fast`-authored purposes had **no correctness gate**; (4) a tree-granularity fork the spec left unpinned (every dir gets an `AGENTS.md` vs a size threshold). *Why it worked:* it converted a vague spec into a small set of binary choices the human could answer in one line.

**Phase 2 — Decision capture.** The human's steering turn ("1. produce commit tree, 2. big bang, 3. yes, 4. ok…") resolved every fork. The AI wrote the decisions into `design.md` §0 + a §4c review gate and `tasks.md` (3.5 review gate, 3.7 big-bang commit), then `openspec validate --strict`. *Decision point:* commit-the-tree + big-bang + add a semantic review gate.

**Phase 3 — Source-aware `dox init` (TDD).** Deltas ①–⑤ in `dox.ts`, red→green (44 kb tests). A dry-run from repo root exposed a **real latent bug**: `DEFAULT_EXCLUDE` matched the *absolute* path, so running inside `.worktrees/…` self-excluded the whole walk — fixed to match relative-to-root. It also surfaced that the root `"."` group was just config files that must **not** be appended to the hand-authored root `AGENTS.md` (Rule 0) → orchestrator anchors the walk at `src/`+`packages/*`.

**Phase 4 — Migration core + runner (TDD).** Pure parse/plan/tier0/validate/render modules, then a resumable `migrate-runner.ts` adding a deterministic grounding check and batching. A real preview measured a **material finding**: the file-index covered only **46.8%** of source files, not the "large majority" the design assumed — Tier-1 authoring was the bulk of the work (~486 rows / 56 dirs).

**Phase 5 — Big-bang generation.** 36 Tier-0 dirs written deterministically (purposes copied verbatim, every `See change:` annotation preserved); 34 Tier-1 batches (486 misses) authored in **waves of 6 parallel `@fast` subagents**. *Decision point:* switch to a leaner protocol where each subagent writes its own reply file (no re-transcription).

**Phase 6 — Review, searchability, rollup.** A deterministic grounding audit of all 486 rows → **9 flags, all false positives, 0 fabrications** (spot-verified real claims like the `pi_dash_token` cookie). Flipped `directoryLevelAgents` to pull; verified `kb agents <deep-path>` returns the full root→nearest chain. A **6.1 context-cost spike** quantified the design's risk (deep cwd under `components/` auto-loads a 60 KB `AGENTS.md` ≈ 23k tokens → pull-mode is correct, push stays deferred). Finally a **strictly add-only rollup** synced the 486 new rows back into the 9 splits (`lost=0, altered=0, added=486`). 4 commits, 25/25 tasks.

## 4. Prompts that worked

- **The goal prompt — "Is it anything to clarify?"** Effective *because the spec was attached*: it delegated the hard thinking (find the ambiguities) to the AI instead of pre-deciding. A stronger explicit version: *"Read the attached OpenSpec change and list only the decision-forcing ambiguities — deliverable boundary, rollout strategy, quality gates — as binary choices for me to answer."*
- **High-leverage follow-up — the numbered answer block** ("1. produce commit tree / 2. big bang / 3. yes / 4. ok…"). A terse, positional reply to the AI's enumerated questions unlocked the entire implementation. This is the pattern to reuse: make the AI *enumerate* choices so you can answer with a numbered list.
- **"start"** (next day) — a one-word resume that worked only because the plan was already committed to `tasks.md`; the AI picked up at the next unchecked task.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Leave scope ambiguous (tooling-only vs commit the tree) | "produce commit tree" + "big bang" | State the deliverable boundary + rollout strategy in the proposal's success criteria |
| Trust the design's "Tier-0 covers the majority" | (AI self-corrected by measuring 46.8%) | Measure coverage on real data before sizing the authoring work |
| Ship `@fast`-authored rows with no correctness gate | "yes" to adding a review gate (#3) | Require a grounding/hallucination gate whenever a budget model authors committed prose |
| Want to append root config files to the hand-authored root `AGENTS.md` | Anchor the walk at `src/`+`packages/*` | Protect Rule 0 explicitly — never index the repo-root `AGENTS.md` |

## 6. Skills, tools & memory created — and why they're effective

- **A project skill capturing the big-bang dox-authoring orchestration** (2 `skill_manage` calls). It records the reusable pattern: parse existing index → Tier-0 verbatim copy vs Tier-1 author, drive authoring in **waves of parallel `@fast` subagents** with per-subagent scratch reply files, then a **deterministic grounding audit** (backticked identifiers must exist in source) as the primary hallucination gate with a review-subagent fallback. *Why effective:* it bounds cost across hundreds of rows while keeping a correctness guarantee, and makes a one-way-ish migration resumable/checkpointed. *Invoke it* whenever you must generate hundreds of per-file doc rows with a budget model.
- **The migration modules themselves** (`migrate-file-index.ts`, `migrate-runner.ts`) are the durable tooling — pure, unit-tested parse/plan/tier/ground/batch/rollup functions reusable for any future index→tree migration.

## 7. Pitfalls & dead ends

- **`DEFAULT_EXCLUDE` matched the absolute path** → running inside `.worktrees/…` self-excluded the entire walk (planned 0 files). *Fix:* test paths relative to the walk root.
- **Root `"."` group = config files** (`playwright.config.ts`, `vitest.config.ts`) → appending them to the hand-authored root `AGENTS.md` breaks Rule 0. *Fix:* anchor the walk at source roots, never repo root.
- **A subagent (batch-23) omitted the trailing `|`** on each row → the strict parser silently skipped all 20. *Fix:* make the parser tolerant of a missing/extra trailing pipe.
- **Colliding basenames** (`index.ts` in many dirs) — a batch spanning dirs is ambiguous. *Fix:* have subagents emit the **full rel path** in each row; map back to dir+basename.
- **Grounding false positives** from cross-references (a row mentioning a *consumer* file's symbol). *Fix:* suppress ids that match another source file's stem, keeping only genuine unknowns.
- **`loader.ts` duplicated across two splits with divergent purposes** — dedupe made it look "changed" on rollup. *Fix:* make the rollup **strictly add-only** — never overwrite a curated row.
- **Editor `endText`/stray edit field** caused 3 `edit` failures — resend the edit without the stray field.
- **A `/tmp` processor script's relative import** resolved against `/tmp`, not the repo. *Fix:* run the driver from the repo root.

## 8. Reproduce it faster — checklist

- [ ] Read the attached OpenSpec change; answer "anything to clarify?" with binary, decision-forcing questions.
- [ ] Record the answers into `design.md`/`tasks.md`; `openspec validate --strict`.
- [ ] TDD source-aware `dox init` (deltas ①–⑤); dry-run from repo root and confirm 0 noise dirs.
- [ ] Build pure migration core + resumable runner; unit-test parse/plan/tier0/ground/batch/rollup.
- [ ] Measure real Tier-0 coverage before sizing Tier-1.
- [ ] Preview 1 all-hits + 1 has-misses dir; verify authored rows against source.
- [ ] Author Tier-1 in waves of ~6 parallel `@fast` subagents → scratch reply files → tolerant parser.
- [ ] Grounding-audit all authored rows; triage flags; confirm 0 fabrications.
- [ ] Flip `indexAgentsFiles`/`directoryLevelAgents`; prove `kb agents <deep-path>`; full suite; commit per section.

**Key inputs:** the OpenSpec change dir, the `docs/file-index-*.md` splits (migration source), a working `@fast` role, `NODE_OPTIONS=--experimental-sqlite` for the kb suite.
**Artifacts produced:** 92 per-directory `AGENTS.md` (486 authored purposes), `packages/kb/src/{migrate-file-index,migrate-runner}.ts` + tests, `dox.ts`/`config.ts` deltas, rewritten root `AGENTS.md` protocol, rolled-up splits — across 4 commits (`296ea9a3`, `c42c45e5`, `1341054e`, `87a7089b`).

---

_Generated from session `019f25a2` · `/Users/robson/Project/pi-agent-dashboard` · 2026-07-03. Source extract: deterministic facts sheet._
