---
session: 019f2713
week: 2026/W27
type: development
model: "@fast"
premium: false
premium_reason: ""
upgrade_status: n/a
openspec_changes: [project-init-skill-and-profiles, migrate-file-index-to-agents-tree]
proposal_excerpt: "The `generalize-worktree-init-hook` change makes the Initialize button run a project's declared init hook. But a brand-new, unconfigured directory has **no** hook, no `AGENTS.md`, no toolset settings — nothing to run.…"
---

# How we did it: Split the 60 KB components/AGENTS.md into a per-file sidecar tree — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The user opened with a compressed, typo-laden but dense brief:

> *"splitting the 60 KB components/AGENTS.md, and de-duping the 3 cross-split paths. Have to add to AGENTS.md and the AGENTS.md template (for new projects) that large AGENTS.md not supported, when it is presented have to split up file based - means files that have rarge index can have own index."*

Restated after discovery, the **real objective** was four things at once:

1. **Shrink** the flat `packages/client/src/components/AGENTS.md` (60 KB / ~23k tokens, auto-injected by pi's directory up-walk on every turn under that dir).
2. **De-dupe** the 3 known cross-split path overlaps in the generated `docs/file-index-*.md` rollups.
3. **Teach the kb tooling** a new pattern so a split stays searchable but *not* auto-injected.
4. **Codify the rule** — "large AGENTS.md unsupported → split file-based" — in both the root `AGENTS.md` and the new-project doctrine template so the fix becomes a standing convention, not a one-off cleanup.

## 2. TL;DR playbook

1. **Ground before touching code.** Measure the real file (`wc -l`, per-row char sizes) and resolve *actual* duplicate paths — don't trust the prompt's counts. Here "3 cross-split paths" was really **0 duplicates in the tree** but **26 duplicated paths in the generated rollups**, clustering into 3 area-overlap cases.
2. **Read the design doc first.** `design.md §5` already named the outlier ("split the components mega-file, or cap rows/dir") — the plan was half-written already.
3. **Find the mechanism that makes a split safe.** Grep the kb indexer: `docTypeOf` only tags literal `AGENTS.md` as `agents`. So name sidecars `<File>.AGENTS.md` — searchable via `docTypeOf` change, but *not* literally `AGENTS.md`, so pi's up-walk never injects them.
4. **Present a concrete plan with real numbers and get sign-off** before a big mechanical migration (this one touched 126 files).
5. **Build the migration as a committed script** (`scripts/split-large-agents.mjs`), dry-run first (`--write` gated), so it's reproducible and reviewable.
6. **Split by information-loss, not by size:** rows ≤200 chars stay verbatim inline (lossless incl. their short `See change:`); rows >200 chars promote to a per-file `<File>.AGENTS.md` sidecar carrying full detail + history, leaving a terse pointer inline.
7. **Fix the rollup dedup at the source** (`migrate-runner.ts` `exportRollup`): route each path to its canonical owner split and drop it from every non-owner split (was add-only). Make `treeRows` reconstruct full detail from sidecars so re-runs stay complete.
8. **Verify end-to-end with a forced reindex** — a stale mtime cache will lie about `doc_type`; `indexSource` clean-reindex proves the 111 sidecars classify as `agents` and rank #1 on their unique content.
9. **Codify the rule** in root `AGENTS.md` Rule 3 and the project-init DOX doctrine spec, add tasks to the attached change, then commit — excluding any pre-existing unrelated worktree change.

## 3. How the collaboration unfolded

**Phase 1 — Discovery & ground-truthing (10:25–10:27).** The AI resisted the prompt's framing. It measured the file (154 flat source files → 60 KB, one row each), then tried to resolve the "3 cross-split paths" literally and found **zero** true duplicate resolved paths in the `AGENTS.md` tree. Instead of asking prematurely, it kept digging: the duplication lived in the *generated* `docs/file-index-*.md` rollups (26 paths in ≥2 splits), clustering into exactly 3 area-overlap cases. *Why it worked:* refusing to take the prompt's numbers at face value surfaced the true bug (an add-only rollup merge), not a phantom one.

**Phase 2 — Mechanism hunt (10:29–10:31).** Before proposing, the AI found *how* a split can stay retrievable yet not injected: `indexer.ts docTypeOf` tags only literal `AGENTS.md` as `agents`, and pi's up-walk keys on the literal filename. That single fact unlocked the whole design — sidecars named `<File>.AGENTS.md`.

**Phase 3 — Plan + sign-off (10:31).** The AI put a concrete 4-part plan (A tooling, B split, C dedup, D docs) in front of the user with real numbers, explicitly asking for sign-off before touching code. **Decision point:** the user answered the design fork with "both".

**Phase 4 — Build & tune (10:33–11:24).** Tooling first (indexer classification + a byte-size `over-threshold` lint), then the rollup dedup with a regression test, then the split script. The AI iterated on the split *heuristic* several times — capping rows silently dropped `See change:` history, so it switched to promote-if-lossy. **Decision point:** per-file sidecars = 111 new files vs. a cleaner alternative; the user chose **per-file sidecars** despite the file count, to preserve every history.

**Phase 5 — Verify & land (11:24–11:27).** A forced clean reindex caught a stale-cache lie (sidecars showed as `source-md` until reindexed). Final gates: `tsc` clean, 60 kb tests (3 new), both `openspec validate --strict`. The AI spotted a pre-existing unrelated `manage-flows/SKILL.md` change and **deliberately excluded it** from the commit (`6d40f4c1b`, 126 files).

## 4. Prompts that worked

- **The goal prompt** (§1) was terse and typo-heavy but *dense with intent* — it named the file, the size, the dedup, the template requirement, and the "file-based split" principle. Lesson: a good kickoff packs the constraint ("large AGENTS.md not supported") and the mechanism ("files with large index can have own index"), even if grammar suffers. The AI's job is to ground the fuzzy numbers, not to demand a polished spec.
- **High-leverage follow-up: "both" / "yes".** Two one-word steering turns resolved the only genuine forks (the design fork, then final commit approval). They worked because the AI had already framed each as a crisp binary with real numbers attached — so a single word carried the decision.

Rewrite of the goal prompt for next time (same intent, less ambiguity):

> *"Split `packages/client/src/components/AGENTS.md` (60 KB, flat, 154 rows) so per-turn injection drops. Promote large rows to per-file sidecars, keep short rows inline. De-dupe paths that appear in multiple `docs/file-index-*.md` rollups. Add a rule to root AGENTS.md + the new-project doctrine template: large AGENTS.md is unsupported, split file-based. Get my sign-off on the plan before the mechanical migration."*

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Take the prompt's "3 cross-split paths" as literal tree duplicates | (self-corrected) — but a wrong prompt count can send you hunting a phantom | State counts as *approximate* and let the AI measure ground truth first |
| Reach for row-capping, which silently drops `See change:` history | The protocol treasures history — promote-if-lossy instead of cap | Encode "never drop `See change:` history" as a hard rule in the split heuristic |
| Over-deliberate the split heuristic (multiple threshold passes) | "Decision made — stop deliberating and build it, then show the result" | Timebox exploration; present 2 options with real numbers, then execute |
| Risk committing an unrelated pre-existing worktree change | Explicitly stage only own files, leave `manage-flows/SKILL.md` untouched | Always `git status` before commit; exclude anything you didn't author |
| Trust the first index/search result | A stale mtime cache mis-reported `doc_type` | Force a clean `indexSource` reindex before asserting classification |

Quality bars the user imposed implicitly: **zero content/history loss**, **sign-off before a large mechanical change**, and **surgical commits** (own work only).

## 6. Skills, tools & memory created — and why they're effective

- **`scripts/split-large-agents.mjs`** (new, committed) — the reusable engine. It splits any oversized directory `AGENTS.md`: rows ≤200 chars stay inline (lossless), rows >200 chars promote to `<File>.AGENTS.md` sidecars with full detail + history, leaving a terse pointer. Dry-run by default, `--write` to apply. *Why effective:* turns a 60 KB→26 KB migration into one reproducible command; documented in the docs tree; the standing fix for any future oversized flat index.
- **kb tooling changes** (`indexer.ts` + `dox.ts`) — the enabling mechanism: `*.AGENTS.md` → `agents` doc_type (searchable via `kb search --doc-type agents`) but never auto-injected (name ≠ literal `AGENTS.md`), plus an `AGENTS_BYTE_CAP` byte-size `over-threshold` lint that *names the fix*. *Why effective:* makes the sidecar pattern a first-class, lintable convention.
- **`migrate-runner.ts` `exportRollup` dedup** — routes each path to its canonical owner and drops it from non-owner splits; `treeRows` reconstructs full detail from sidecars. *Why effective:* fixes the add-only merge at the source, so `kb dox export` re-runs stay complete instead of degrading to pointer rows.
- **Doctrine codification** — root `AGENTS.md` Rule 3 + project-init DOX doctrine spec now both carry "large AGENTS.md → split file-based". *Why effective:* the rule ships to every new project, not just this repo.

No pi *skill* was created, but this workflow is clearly repeatable — a `split-oversized-agents-index` project skill wrapping the script + kb sidecar mechanism + doctrine rule would be worth extracting.

## 7. Pitfalls & dead ends

- **"3 cross-split paths" was misleading** — there were 0 tree duplicates; the real 26 duplicates lived in the generated rollups. *If a prompt gives a suspicious count, measure before you hunt.*
- **Row-capping loses history** — capping mid-size rows silently drops `See change:` tails. *Promote to a sidecar instead of capping.*
- **The 154-flat-rows floor is ~21 KB** regardless of cap — you cannot get below it without a source refactor (subdividing the 154 files). Byte cost is solved (60→26 KB); `dox lint` still flags on **row count** (154 > 40), which is a separate future change.
- **Stale index cache lies about `doc_type`** — the sidecars showed as `source-md` until a forced `indexSource` reindex reclassified all 111 as `agents`. *Force a clean reindex before trusting classification.*
- **`exportRollup` has no CLI** — run it directly via `npx tsx -e "import { exportRollup } ..."`; dry-run first to see removal counts.
- **Unrelated worktree noise** — `.pi/skills/manage-flows/SKILL.md` was already modified in the worktree; it was deliberately left out of the commit.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** the oversized `AGENTS.md` path; access to `packages/kb/src/` (indexer, dox, migrate-runner); the design doc section flagging the outlier; ability to run `npx vitest` + `openspec validate`.

- [ ] Measure the file: `wc -l` + per-row char sizes; resolve *actual* duplicate paths (don't trust prompt counts).
- [ ] Read `design.md` for the pre-named mitigation.
- [ ] Confirm the safe-split mechanism: `docTypeOf` tags only literal `AGENTS.md`; sidecars use `<File>.AGENTS.md`.
- [ ] Patch `indexer.ts` (`*.AGENTS.md` → `agents`) + `dox.ts` (byte-cap `over-threshold` lint, exclude sidecars from md walk).
- [ ] Fix `migrate-runner.ts exportRollup`: canonical-owner routing + drop from non-owners; `treeRows` reconstructs from sidecars. Add a dedup regression test.
- [ ] Run `scripts/split-large-agents.mjs <path>` (dry) → review → `--write`. Split by information-loss (≤200 inline, >200 promoted).
- [ ] Force a clean reindex (`indexSource`) and prove sidecars classify `agents` + rank on unique content.
- [ ] Codify the rule in root `AGENTS.md` + project-init doctrine spec; add tasks to the attached change.
- [ ] Gates: `tsc` · kb vitest · `openspec validate --strict`. Stage **only your files**; commit.

**Final artifacts produced:** `scripts/split-large-agents.mjs` (new); edits to `packages/kb/src/{indexer,dox,migrate-runner}.ts` + its test; split `packages/client/src/components/AGENTS.md` (60→26 KB) + 111 `<File>.AGENTS.md` sidecars; 27 rollup dedup removals; root `AGENTS.md` Rule 3 + `project-profiles/spec.md` doctrine amendment; tasks appended to `migrate-file-index-to-agents-tree/tasks.md`. Commit `6d40f4c1b` (126 files).

---

_Generated from session `019f2713-364f-78ca-aa03-5e0c24b335f4` · `pi-agent-dashboard` · 2026-07-03. Source extract: deterministic facts sheet from `session-to-guideline/scripts/extract_session.ts`._
