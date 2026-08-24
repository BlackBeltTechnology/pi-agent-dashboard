---
session: 019f294e
week: 2026/W27
type: development
model: "@fast"
premium: true
premium_reason: "heavy steering (7 user prompts); large facts sheet (~11060 tok)"
upgrade_status: pending
openspec_changes: [fix-dox-lint-false-positives]
proposal_excerpt: "`kb dox lint` over-reports drift, and its `--fix` path would **delete valid documentation rows**. Running it on this repo today:"
---

# How we did it: Fix `kb dox lint` false positives — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The user opened not with a task but with a gate: **"is there anything to clarify?"** —
inviting the AI to pressure-test an already-drafted OpenSpec change
(`fix-dox-lint-false-positives`) *before* implementation. The real objective: land a
correct fix for `kb dox lint`, which over-reports documentation drift and — worse —
whose `--fix` path would **delete valid AGENTS.md documentation rows** (data loss).
The change had a proposal/design/tasks already, but the AI was asked to find gaps the
design missed, get the ambiguous decisions ruled on by the human, then implement,
test, and ship the whole thing end-to-end.

## 2. TL;DR playbook

1. **Ask for clarification first.** Before touching code, read the actual source against
   the spec's cited line numbers. Surface *decision points*, don't pick silently.
2. **Verify assumptions with grep, not memory.** Confirm the "orphaned" caller is really
   gone; confirm real DOX tables sit under `# DOX — <dir>` H1s; find every consumer of
   `parseRowPaths` (it turned out `kb-extension/src/reindex.ts` shared the bug family).
3. **Let the human rule on scope + design forks** via `ask_user`: guard location, mixed-file
   heading scope, whether to widen into `reindex.ts`, and the orphan-resolution strategy.
4. **Implement the smallest correct fix:** a shared `resolveRowPath` (dir-relative →
   repo-root fallback = "Option B") + normalize `rowPaths` to cwd-relative so `missing`
   detection stops mis-firing.
5. **Add regression tests per defect** (Defect A path resolution, Defect B `rowPaths`
   mismatch, Option B repo-root fallback, reindex mirror). Run per-package in the monorepo.
6. **Measure real impact from the MAIN checkout, not the worktree** — `DEFAULT_EXCLUDE`
   matches `.worktrees/` and scans nothing. Point `doxLint` at the parent repo path.
7. **Keep the published tool convention-agnostic:** strip pi-dashboard-specific file names
   out of `kb`/`kb-extension` doc comments; the repo rationale lives in `design.md` only.
8. **Ship with the `ship-change` skill:** archive + sync specs, exclude unrelated working-tree
   edits, open PR against `develop`, watch CI, auto-apply the CodeRabbit fix, squash-merge.

## 3. How the collaboration unfolded

**Phase 1 — Clarify before coding.** The AI read `dox.ts` against the proposal's line
references and found the design was *correct but incomplete*: the Defect A existence-check
fix would introduce a **new** `missing` false positive because `rowPaths` still stored raw
basenames while `allMd` held cwd-relative paths — they'd stop matching. It also found
`parseRowPaths` was **not** orphaned (called twice in `reindex.ts`), raising a cross-package
scope question the proposal never addressed. *Why it worked:* grounding every claim in the
real code (grep + read) turned "looks fine" into three concrete, rulable decisions.

**Phase 2 — Human rules on scope.** Through short steering replies the human decided: guard
goes in shared `parseRowPaths` (migration caller confirmed gone); mixed-file guard tracks
`# DOX —` headings *within* a file; and **include** `reindex.ts` in scope. Decision points
were surfaced as options, never chosen silently.

**Phase 3 — Implement + measure.** The AI applied four fixes, added regressions, and ran the
real lint — first getting a bogus "1226 → 13" because the worktree cwd is self-excluded by
`DEFAULT_EXCLUDE`. It caught the artifact, re-measured against the **main checkout**
(orphan 1069 → 1, `over-threshold` correctly preserved at 8), then discovered a *fourth*
issue: `docs/AGENTS.md` legitimately documents repo-root config (`biome.json`,
`playwright.config.ts`, `.pi-test-harness.json`) living outside its own dir — strict
dir-relative resolution falsely orphaned them. The human chose **Option B** (generic
dir-relative → repo-root fallback), avoiding a hard-coded `docs/` special-case (Option C).

**Phase 4 — De-leak the published tool.** The human flagged that the generic `kb` package
must stay repo-agnostic. The AI confirmed `kb dox init`'s scaffold was already generic and
pulled pi-dashboard file names out of two `resolveRowPath` doc comments + the AGENTS.md row,
relocating the rationale to `design.md`. Verified zero repo-specific tokens remained in
tool source.

**Phase 5 — Ship.** Driven by `ship-change`: excluded two unrelated working-tree edits
(`manage-flows/SKILL.md`, a regenerated `plugin-registry.tsx`), ran the gate (`npm install`
took failures 19 → 1; the last was a machine-local path leak in an untouched package,
proven env-only because `develop`'s CI was green), archived + synced specs, opened PR #224,
watched CI green, auto-applied one CodeRabbit doc fix (mislabeled orphan as "stale"),
squash-merged (`15fc52ef`), and cleaned up the branch + worktree.

## 4. Prompts that worked

- **The goal prompt — "is there anything to clarify?"** Deceptively powerful: it invites an
  adversarial pre-implementation review instead of a rubber-stamp. A future operator should
  make it explicit: *"Before implementing, read the source against the spec's line refs and
  list any gaps or decisions I need to rule on — don't pick silently."*
- **"1. File index does not exists anymore / 2. Mixed"** — a terse two-part ruling that
  unblocked both the guard location and the mixed-file heading-scope design in one line.
- **"include"** — one word settled the `reindex.ts` scope-widening fork.
- **"docs was special place for file-index"** — supplied the missing convention that
  explained *why* the `docs/AGENTS.md` orphan existed, validating Option B over a hard-code.
- **"In the init there be not any pi-dashboard specific rule, instruction"** — a quality bar
  that caught a genuine abstraction leak in the published tool.
- **"Use ship-change skill"** — delegated the entire land-it pipeline to a known skill.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Treat the spec's stated scope (`dox.ts` only) as complete | "include" — widen to `reindex.ts` | Grep for ALL consumers of a shared fn before scoping a fix |
| Nearly leave the design gap (`rowPaths`/`allMd` mismatch) implicit | Confirming the guard location + mixed-file scope | Always trace the *downstream* uses of a value you're changing the shape of |
| Consider hard-coding a `docs/` special-case | "docs was special place for file-index" | Prefer a generic fallback (Option B) over naming a convention in code |
| Leak pi-dashboard file names into the published `kb` tool's doc comments | "no pi-dashboard specific rule in init" | State up front: published packages stay repo-agnostic; rationale goes in `design.md` |
| Measure lint impact from the worktree cwd (self-excluded) | (self-caught) — re-measure from main checkout | Remember `DEFAULT_EXCLUDE` matches `.worktrees/`; always lint from the parent repo |
| Stage unrelated working-tree edits during ship | Confirm exclude of `manage-flows`/`plugin-registry.tsx` | Ship surgically: `git add` only the change's files, never `-A` blindly |

## 6. Skills, tools & memory created — and why they're effective

No new skill or memory was created — the session *consumed* an existing one:

- **`ship-change` skill** — invoked verbatim by the user to run archive → sync specs →
  exclude unrelated edits → PR → CI watch → CodeRabbit fix loop → squash-merge → worktree
  cleanup. Effective because it made a 10-step landing sequence a single delegated command,
  and its built-in pitfalls (CodeRabbit rate-limit ACK vs real review; worktree-collision on
  `gh` checkout) were exactly the ones hit.

**Recommended skill to create:** a short **"lint-from-main-checkout"** note (or a memory)
capturing that `kb dox lint` / `doxLint` must be measured from the parent repo, because a
worktree cwd under `.worktrees/` is nuked by `DEFAULT_EXCLUDE` and silently scans nothing —
this cost a full bogus "1226 → 13" measurement mid-session.

## 7. Pitfalls & dead ends

- **Bogus lint measurement from the worktree.** "1226 → 13" was invalid — the worktree cwd
  is under `.worktrees/`, which `DEFAULT_EXCLUDE` matches, scanning almost nothing. *If your
  drift numbers look impossibly clean, re-run `doxLint` pointed at the main checkout.*
- **Cross-package import of an unreleased export.** Adding `resolveRowPath` to the `kb` barrel
  and importing it from `kb-extension` failed in the worktree: with no local `node_modules`,
  Node resolved `@blackbelt-technology/pi-dashboard-kb` to the **main repo's** symlink, which
  lacked the new export. *Fix:* keep the canonical helper in `kb`, give `reindex.ts` a small
  local mirror — deliberate duplication across a versioned package boundary.
- **`oldText_2`/`newText_2` in edit calls.** The AI repeatedly tried numbered-suffix edit
  fields; the tool needs separate edit objects. *Emit one edit object per replacement.*
- **Green-local-gate deviation.** The full suite showed 19 failures in the worktree, all in
  untouched packages (jimp/`image-fit`, `browse-endpoint` expecting `node_modules/`,
  `node-electron-resolution` picking up a machine-local path). Proven env-only because
  `develop`'s CI was green across 6 runs; `npm install` took it 19 → 1. *Don't push a red
  gate — first prove the reds are pre-existing/environmental via CI, then install to confirm.*
- **CodeRabbit "pass" can be a rate-limited ACK.** Verify a real review happened (it did —
  1 actionable comment: an absent file is an **orphan**, not "stale" which means
  exists-but-drifted).
- **Worktree removal discards uncommitted edits.** Removing the worktree force-discarded the
  intentionally-kept `manage-flows` edit — worktrees have independent working copies. Flag
  this tension before `git worktree remove`.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** the OpenSpec change dir (`proposal.md`/`design.md`/`tasks.md`),
a clean worktree, `gh` auth, and the main repo path for lint measurement.

1. Read source against the spec's cited line numbers; list gaps + decision points via `ask_user`.
2. Grep every consumer of the function you're changing (`parseRowPaths` → also `reindex.ts`).
3. Get scope + design forks ruled on by the human (guard location, `reindex.ts` inclusion, Option B).
4. Implement the minimal fix: shared `resolveRowPath` (dir-relative → repo-root fallback) +
   normalize `rowPaths` to cwd-relative.
5. Add one regression per defect; run tests per-package (`kb`, `kb-extension`).
6. Measure real lint impact from the **main checkout** (not the worktree).
7. Strip repo-specific tokens from published `kb`/`kb-extension` source; keep rationale in `design.md`.
8. `Use ship-change skill` — exclude unrelated edits, PR vs `develop`, watch CI, apply CodeRabbit fix, squash-merge, clean up.

**Final artifacts:** `packages/kb/src/dox.ts` + `index.ts`, `packages/kb-extension/src/reindex.ts`,
regression tests in both packages, updated `AGENTS.md` rows, archived change
`openspec/changes/archive/2026-07-03-fix-dox-lint-false-positives/`, synced
`openspec/specs/markdown-knowledge-base/spec.md`, PR #224 (merged `15fc52ef`).

---

_Generated from session `019f294e-be87-7ab6-b5fb-2e713cd6a199` · `pi-agent-dashboard` · 2026-07-03. Source extract: session facts sheet (deterministic extract)._
