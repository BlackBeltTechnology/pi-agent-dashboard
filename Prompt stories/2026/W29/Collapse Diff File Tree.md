---
session: 019f6770
week: 2026/W29
type: development
model: "@fast"
premium: true
premium_reason: "heavy steering (6 user prompts); large facts sheet (~12341 tok)"
upgrade_status: pending
openspec_changes: [collapse-diff-file-tree]
proposal_excerpt: "The editor-pane rail carries **two** file trees stacked on top of each other:"
---

# How we did it: Collapse diff file tree — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The user wanted to **eliminate the dual-file-tree layout** in the editor-pane rail of
pi-dashboard's diff view. Instead of two separate trees — one listing only changed files
(`DiffFileTree` inside `ChangesRailSection`) and another showing the full workspace tree
(`EditorFileTree`) — merge changed-file indicators into the single workspace tree. On top
of that, add a **Preview mode** to the diff tab that shows the current file's changed
regions (removed lines omitted, contiguous hunk context displayed).

> First prompt: *"Modify proposal. Currently the tree is split to 2 parts, one that collects the changed files. I would like to combine it with current tree."*

The real objective after steering: **one unified workspace tree with inline change markers,
a slim summary bar replacing the old changes section, and a new Preview toggle in the
diff panel — all landed through a full OpenSpec workflow including mockups, doubt review,
scenario planning, implementation, and PR merge.**

## 2. TL;DR playbook

1. **Clarify scope via mockups** — before rewriting any spec, serve a clickable HTML
   mockup of the merged-tree layout + Preview toggle. Show the human three variants
   (merge into existing tree, summary bar, preview mode placement). Get sign-off.

2. **Update proposal + design docs** — rewrite `proposal.md` to reflect the merged-tree
   approach (not collapse). Add `design.md` with numbered decisions (D1–D5: path matching,
   lazy-tree reveal, session-only scope, Preview derivation, residual bottom group).

3. **Run doubt-driven review** — spawn a fresh-context adversarial reviewer against the
   proposal + design. Then a cross-model reviewer (different architecture, not the author's
   family) for second opinion. Reconcile findings with precedence classification
   (contract-misread → actionable → trade-off → noise).

4. **Run scenario design** — apply ISTQB-derived test scenarios from the reconciled spec.
   Write `test-plan.md` with 14 automated L1 scenarios (component render + interaction)
   plus manual QA scenarios. Fold automated scenarios into `tasks.md` checkboxes.

5. **Commit planning artifacts**, then invoke `openspec-apply-change` to implement:
   - `ChangesRailSection` → slim summary bar (counts + summed badges + session-only toggle)
   - `EditorFileTree` → inline change markers, folder dots, event expansions, diff chip
   - `DiffPanel` → new Preview mode toggle (changed regions, not whole file)
   - `EditorPane` → wire rail-local `sessionOnly` + `openDiffTab`

6. **Verify with tests** — run `vitest` on the four affected test files (29 scenarios),
   then the full client suite for regressions (3534 tests). Fix failures, run Biome.

7. **Run CodeRabbit review** on the uncommitted diff. Triage findings (auto-apply safe
   localized fixes; skip noise with documented reason). Push fixes, re-watch CI.

8. **Ship**: `openspec archive` → commit → push → open PR against `develop`. Squash-merge
   when CI green + zero actionable CodeRabbit threads. Delete worktree + remote branch.

## 3. How the collaboration unfolded

**Phase 1 — Discovery & mockup (22:24 → 22:38).** The AI read the existing proposal + both
file-tree components. It realized the user's ask (merge two trees) was a *different design
direction* than the original proposal (collapse the changes section). Before rewriting
anything, it built a clickable HTML mockup showing the merged-tree layout with:
- A slim `Changes (N) · +X −Y` summary bar at the top
- Inline change markers in the workspace tree
- A new `Diff / Preview` segmented toggle in the diff tab header

The user reviewed live (`serve_mockup` on port 54455) and approved: *"it seems ok, move to proposal"*.

**Phase 2 — Proposal rewrite + planning (22:38 → 00:16).** The AI rewrote `proposal.md`,
created `design.md` with explicit architectural decisions, and produced specs/change-summary-table.
Then the critical discipline gates fired:

- **Doubt-driven review** (2 cycles): First a fresh-context adversarial reviewer found a
  bombshell — `DiffPanel` already has a `Diff / File` toggle that shows the *whole current
  file*, making the proposed synthetic-Preview largely redundant. A cross-model second
  opinion (GLM-5.2, different architecture from the Claude author) confirmed. The user
  chose to keep the synthetic Preview anyway as a distinct coexisting mode. Other
  findings: `mergeRoots` is private, auto-expand clashes with localStorage persistence,
  `sessionOnly` lift would break `FileDiffView`.

  *Result*: dropped auto-expand → added cheap folder-level change dots. Kept `sessionOnly`
  rail-local. Aligned Preview to show only changed regions (near-duplicate of "File" mode).

- **Scenario design**: 14 automated L1 scenarios + manual QA written into `test-plan.md`,
  folded into `tasks.md` with harness-exemplar pointers and input-trigger-observable triples.

**Phase 3 — Implementation (00:37 → 01:00).** The AI wrote four components:
  - `ChangesRailSection.tsx` — reduced to a 1-line summary bar
  - `EditorFileTree.tsx` — inline markers, folder dots, event expansion, diff chip
  - `DiffPanel.tsx` — Preview mode toggle + auto-reset logic
  - `EditorPane.tsx` — wired rail-local state + `openDiffTab`

  During coding, the AI discovered that the server skips pure deletions — the "deleted files
  bottom group" planned in the design would always be empty. It tightened the artifacts to
  match upstream reality before committing.

  Tests written alongside code (TDD style): 29 L1 scenarios across the four test files.
  Full client suite: 3534 tests passing, zero regressions.

**Phase 4 — Quality gates & ship (01:00 → 01:35).** Biome fix applied, CodeRabbit review
  flagged 10 comments (9 actionable fixed, 1 noise). CI green on both commits. Squash-merge
  into `develop` (commit `eafbbd7fc`), worktree + remote branch cleaned up.

## 4. Prompts that worked

- *The goal prompt* — *"Modify proposal. Currently the tree is split to 2 parts… I would like to combine it with current tree."* Effective because it named the *what* (combine two trees) without prescribing *how*, leaving room for the AI to explore design options.

- *"create mockups for that. Another in the diff view be a Switch to preview mode where the current version of file can be seen — except removed."* A high-leverage 2-in-1: both the merged-tree visualization AND the new Preview mode specified in one concise sentence. The "except removed" detail was critical — it defined Preview scope (removed lines omitted).

- *"it seems ok, move to proposal"* — A classic approval steer that unlocked full-speed execution. Short, decisive, unambiguous.

- *Skill invocations* — Calling `plan-proposal` and `ship-it` as prompts turned the entire OpenSpec pipeline over to the AI. Each skill carries its own preconditions, gates, and sub-skills. The model correctly adapted `plan-proposal` to the already-in-worktree reality (the usual develop→worktree boundary was behind us).

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|---|---|---|
| Design a synthetic "Preview" mode that derives from `gitDiff` (hunk context) — which is a gapped fragment, not the whole file | Accepting it anyway as a distinct mode, but the human's choice overrode the AI's technical caution | State up front: "Preview = changed regions only, omitted removed lines — I know it duplicates the File mode, keep it" |
| Propose auto-expanding ancestor dirs in the lazy tree | Accepting it, until the doubt review revealed `mergeRoots` is private + persistence clashes | Pre-check: "is the lazy-tree reveal API public? does it persist?" before writing into proposal |
| Plan a "deleted files" bottom group in the rail | Reality-check during implementation showed the server skips deletions entirely — scope was tightened automatically | Cross-reference server response shape (`session-diff.ts`) before finalizing design decisions |
| Propose lifting `sessionOnly` out of the rail into global `SplitWorkspaceContext` | Doubt review revealed it would break the `FileDiffView` takeover — AI corrected to rail-local | Before touching shared context state, trace all callers that depend on the current shape |

## 6. Skills, tools & memory created — and why they're effective

No new skills or memory were created in this session — the work operated entirely within
the existing OpenSpec pipeline (plan-proposal → ship-it → ship-change), the doubt-review
skill, and the scenario-design skill.

**Recommended skill to create:** *"merged-file-tree-pattern"* — captures the design
decision taxonomy (when to inline change markers vs. keep a separate changes list,
folder-change-dot placement, preview vs. file toggle coexistence). Invoke when adding
or modifying any code-review / diff navigation surface.

## 7. Pitfalls & dead ends

- **Synthetic Preview near-duplicate.** The biggest blind alley: the AI proposed deriving
  Preview from `gitDiff` (hunk context only). This yields a gapped fragment — inferior to
  the pre-existing `Diff / File` mode that shows the whole current file. Solution: accept
  the overlap, document Preview as a *changed-regions-only* mode, test both coexist.

- **Plan-proposal precondition mismatch.** The skill expects to run on `develop` and spawn
  a worktree. This session was already inside the worktree. No action needed — the model
  detected the deviation and adapted by running the doubt-review + scenario-design gates
  directly on the worktree branch.

- **Server reality vs. design assumption.** The design doc planned a "deleted files"
  bottom group. The server (`session-diff.ts`) skips pure deletions entirely → the group
  would always be empty. The model discovered this during implementation and corrected
  the artifacts. Pre-check on server response shape would have saved iteration.

## 8. Reproduce it faster — checklist

- [ ] Read the current proposal + both components (`ChangesRailSection`, `EditorFileTree`)
- [ ] Build a clickable HTML mockup of the merged-tree + Preview toggle (`serve_mockup`)
- [ ] Get user sign-off on the visual direction
- [ ] Rewrite `proposal.md` + create `design.md` with numbered decisions
- [ ] Run doubt-driven review (fresh-context + cross-model, 2 cycles)
- [ ] Reconcile findings with precedence classification
- [ ] Run scenario-design → `test-plan.md` → fold into `tasks.md`
- [ ] Commit planning artifacts
- [ ] `openspec-apply-change`: implement summary-bar, inline markers, Preview mode
- [ ] Write tests alongside code (TDD — vitest + RTL for L1 component tests)
- [ ] Run full client suite for regressions (3534 tests)
- [ ] Biome fix + CodeRabbit review on diff; auto-apply safe fixes
- [ ] `openspec archive` → commit → push → PR against `develop`
- [ ] Squash-merge when CI green + zero actionable threads
- [ ] Delete worktree + remote branch

**Key inputs needed:** existing `ChangesRailSection`, `EditorFileTree`, `DiffPanel` source
files; `session-diff.ts` server response shape. **Final artifacts:** 4 components + 15 test
files; PR #338 merged into `develop` (commit `eafbbd7fc`).

---

_Generated from session `019f6770` · `pi-agent-dashboard` · 2026-07-16.
Source extract: `/var/folders/qb/m1_q3v6d5bnfzbpmc0dkkqx40000gn/T/tmp.0Sgszy63Nk`._
