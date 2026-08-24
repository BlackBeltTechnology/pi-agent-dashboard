---
session: 019f80fe
week: 2026/W30
type: planning
model: "@fast"
premium: false
premium_reason: ""
upgrade_status: n/a
openspec_changes: [fix-vite-build-warnings, shrink-client-index-chunk]
proposal_excerpt: "`npm run build` emits warnings that obscure real regressions. This change removes the **mechanical, zero-behavior** ones — two Lightning CSS parse errors, one circular manual-chunk cycle, and two dynamic-import-defeat…"
---

# How we did it: Turning noisy `npm run build` warnings into two verified OpenSpec plans — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The session opened in **explore mode** (`openspec-explore`): *"Enter explore mode.
Think deeply… you must NEVER write code or implement features… You MAY create
OpenSpec artifacts."* The concrete objective — surfaced immediately as the AI ran the
build — was to make sense of the **warnings `npm run build` emits** and decide what
to do about them.

The *real* objective, once the second prompt (`plan-proposal`) clarified it: don't
just list the warnings — **triage them by root cause and risk, split the mechanical
zero-behavior fixes from the structural one, and produce two fully-planned,
doubt-reviewed, scenario-folded OpenSpec changes** ready to hand to `ship-it`. The
output was never code; it was two valid+complete change proposals committed to
`develop`.

## 2. TL;DR playbook

1. **Capture the raw build once, then grep it — never re-run to inspect.**
   `npm run build 2>&1 | tee /tmp/pi-build.log | grep -iE "warn|circular|larger than|chunk"`.
2. **Build a root-cause map** of every warning: *warning → root cause → fix risk
   (TRIVIAL/LOW/MEDIUM)*. This table is the spine of everything downstream.
3. **Split by risk.** Mechanical zero-behavior warnings → one change
   (`fix-vite-build-warnings`); the one structural fix (the oversized chunk) → a
   sibling deferral change (`shrink-client-index-chunk`).
4. **Scaffold with OpenSpec, not by hand:** `openspec new change <name>`, then
   `openspec status --json` to learn which artifacts are actually *required* before
   drafting (only `tasks` was mandatory here).
5. **Run `plan-proposal`** to drive the discipline: doubt-review → scenario-design →
   fold. Let it invoke the cross-model reviewer automatically via the
   `@propose-review-N` role.
6. **Verify every reviewer claim against the repo before accepting it** — the
   reviewer's headline finding (wrong chunk inventory) was *confirmed and bigger*;
   another (a new size-warning line) was *refuted empirically*.
7. **Let the doubt-review reshape scope.** Cycle 1 descoped `@mdi/js`; cycle 2
   flipped `PdfPreview` from static→lazy. Stop when all findings are reconciled.
8. **Fold the scenario manifest into `tasks.md`** (one task per automated row +
   tagged manual tasks), run `openspec validate … --type change`, commit at the
   worktree boundary.

## 3. How the collaboration unfolded

**Phase 1 — Discovery (build + root-cause map).**
The AI ran the build once into `/tmp/pi-build.log`, then re-grepped the *file* for
each warning class instead of re-running. It chased the CSS `Delim('.')` warning to
its true source — Tailwind v4's scanner extracting literal `bg-[var(...)]` /
`text-[var(...)]` tokens *out of JS comments and a `.AGENTS.md` sidecar* — and drew a
five-row root-cause map (CSS token leak, circular chunk, 3× dynamic+static import,
oversized chunk). *Why it worked:* one authoritative log + a risk-ranked table turned
a wall of warnings into a decidable scope.

**Phase 2 — Scaffold (OpenSpec, minimal artifacts).**
Chose an OpenSpec change over an ad-hoc fix. Ran `openspec new change`, then
`openspec status --json` to discover that only `tasks` was required — and drafted
just `proposal + design + tasks`, adding a `client-build-config` spec delta only when
the strict validator demanded one. *Decision point:* the human's `plan-proposal`
prompt then took over and **replaced** the hand-authored `tasks.md` with the
scenario-derived manifest.

**Phase 3 — Doubt-review (2 cross-model cycles).**
`plan-proposal` invoked `doubt-driven-review`, which auto-selected
`@propose-review-1 = zai/glm-5.2` (a different model family from the author, opus).
Cycle 1 found the oversized-chunk inventory was *wrong* — the culprit is the 4.8 MB
`index` chunk (54% of it raw `@mdi/js` SVG paths), not the 1.1 MB `diff` chunk first
named. Cycle 2 caught that making `PdfPreview` static would orphan `lazy`/`Suspense`
(Biome failure) and refuted a claimed "new warning line" (Vite emits a *single
aggregate* size warning, verified empirically). *Why it worked:* every load-bearing
reviewer claim was checked against the actual repo before being accepted or rejected.

**Phase 4 — Scenario-design + fold.**
`scenario-design` ran at design-stage (HARD gate), found the repo's idiom
(build-artifact guard tests like `monaco-chunk-size.test.ts` +
`eml-bundle-exclusion.test.ts`), hit two spec gaps, resolved them (gzip size-cap +
CI build-log grep gate), wrote a manifest (6 automated + 2 manual), and folded it
into `tasks.md`.

**Phase 5 — Commit + sibling.**
Committed `fix-vite-build-warnings` at the worktree boundary, then ran a second full
`plan-proposal` pass on `shrink-client-index-chunk` — whose doubt-review caught a
*core* flaw (a `manualChunks` entry does **not** silence a dynamic+static warning when
the chunk is eager; the reliable fix is static-converting the import sites). Both
committed to `develop`, working tree clean.

## 4. Prompts that worked

- **The goal prompt (`openspec-explore`)** — effective because it set a hard *"think,
  don't implement"* stance while explicitly permitting OpenSpec artifacts. It let the
  AI go deep on root-cause analysis without prematurely writing code.
- **High-leverage follow-up (`plan-proposal`)** — a single skill invocation that
  chained doubt-review → scenario-design → fold → commit. One prompt bought the entire
  planning discipline, including automatic cross-model review.
- **Rewrite of a weak kickoff:** instead of "fix the build warnings," say
  *"Explore the `npm run build` warnings, build a warning→root-cause→risk table, and
  split mechanical zero-behavior fixes from structural ones into separate OpenSpec
  changes."* That framing produces the split-by-risk outcome directly.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Stay in pure explore/analysis mode | Handing it `plan-proposal` to force the planning discipline | Naming the target deliverable ("two committed OpenSpec changes") in the goal prompt |
| Mis-scope the oversized chunk (named 1.1 MB `diff`, real culprit 4.8 MB `index`) | Trusting the cross-model reviewer's inventory finding *then verifying it in-repo* | Always measure `dist/assets` sizes before writing the design's numbers |
| Accept the reviewer's "merge adds a new warning line" | Empirically checking: Vite emits **one aggregate** size warning | Verify every reviewer claim against repo/tool reality, not generic knowledge |
| Plan a static `PdfPreview` conversion | Noticing it would orphan `lazy`/`Suspense` (Biome fail) → flip to Option B (lazy the one static outlier) | Match the repo's existing lazy pattern (`viewer-registry` already lazies MonacoBuffer) |
| Try to "just fix" the @mdi bloat inside the mechanical change | Descoping @mdi + size-limit into a *separate* sibling change | Split structural vs mechanical at the very first root-cause map |

## 6. Skills, tools & memory created — and why they're effective

No new skill or memory was created — the session was a clean composition of existing
skills (`openspec-explore` → `plan-proposal` → `doubt-driven-review` →
`scenario-design`). That composition *is* the reusable pattern:

- **`plan-proposal` as the orchestrator** removes the manual work of remembering to
  doubt-review, run scenario-design, fold the manifest, and stop at the worktree
  boundary. Invoke it whenever a drafted OpenSpec change on `develop` needs to become
  build-ready.
- **The `@propose-review-N` role convention** makes cross-model adversarial review
  automatic and family-aware (picks a reviewer from a *different* model family than
  the author). Effective because it removes single-model blind spots — here it caught
  a wrong chunk inventory and a false premise.
- **Recommended memory to save:** *"Vite in this repo emits a single aggregate
  chunk-size warning (not per-chunk); only a limit above the tallest chunk (monaco
  ≈3.9 MB) silences it."* This fact was re-derived empirically and would save a future
  operator the experiment.

## 7. Pitfalls & dead ends

- **Stale `.git/index.lock`** blocked the first commit. *If you hit this:* check for a
  live git process (`ps aux | grep '[g]it commit'`), and only if none exists remove the
  0-byte lock, then commit — files were already staged.
- **Trusting reviewer inventory numbers verbatim** — the reviewer was *right about the
  direction, wrong about the magnitude* (and once outright wrong about the "new warning
  line"). Never fold a reviewer claim into a design without a repo/tool check.
- **`@mdi/js` cannot be tree-shaken** here — icon keys are arbitrary runtime strings
  from extension primitives (`{primitive:"ui:status-pill", props:{icon}}`), so the full
  namespace is required. Don't plan a "only-used-icons" shake; relocate the chunk instead.
- **Re-running `npm run build` to re-read warnings** wastes minutes — `tee` once, grep
  the log repeatedly.

## 8. Reproduce it faster — checklist

- [ ] `npm run build 2>&1 | tee /tmp/pi-build.log | grep -iE "warn|circular|larger than|chunk"`
- [ ] Write a *warning → root-cause → fix-risk* table; split mechanical vs structural.
- [ ] `openspec new change <mechanical>` + `openspec new change <structural-sibling>`.
- [ ] `openspec status --json` → draft only the required artifacts first.
- [ ] Run `plan-proposal`; let it auto-invoke `@propose-review-N` cross-model review.
- [ ] **Verify every reviewer claim in-repo** (measure `dist/assets`, read the source, check tool behavior) before accepting it.
- [ ] Fold the scenario-design manifest into `tasks.md`; `openspec validate … --type change`.
- [ ] Commit both changes to `develop` at the worktree boundary → hand to `ship-it`.

**Key inputs to have ready:** a runnable `npm run build`; a configured
`@propose-review-N` reviewer role (different model family than the author); write
access to `develop`.

**Artifacts produced:** `openspec/changes/fix-vite-build-warnings/` (proposal, design,
specs/client-build-config, tasks, test-plan) and
`openspec/changes/shrink-client-index-chunk/` (proposal, design,
specs/client-build-config, tasks, test-plan) — both valid+complete, committed
(`c8eb5bb33`, `752c36c32`).

---

_Generated from session `019f80fe-caec-7348-a7d8-5b33387f01bc` · `pi-agent-dashboard` · 2026-07-24. Source extract: `/tmp/facts.session-019f80fe.md`._
