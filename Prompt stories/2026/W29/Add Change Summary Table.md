---
session: 019f5caf
week: 2026/W29
type: development
model: "@fast"
premium: true
premium_reason: "created 2 memories; heavy steering (5 user prompts); large facts sheet (~14898 tok)"
upgrade_status: pending
openspec_changes: [add-change-summary-table]
proposal_excerpt: "File edits get lost in the chat stream. A session makes many Edit/Write tool calls across many turns; each renders as a collapsed card that expands to a diff. There is no glanceable answer to 'what did this session do…'"
---

# How we did it: Add Change Summary Table — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The user wanted a **per-turn change summary table** in the pi-dashboard chat stream — a glanceable, file-level diff overview at every turn boundary, showing which files were Added/Modified/Deleted and the line counts (+X −Y). The original OpenSpec proposal had it always-on; the user also wanted an **on/off toggle** in the settings, wired through the same "overridable as others" pattern the existing display preferences use (global Settings toggle + per-session ⚙ View popover override).

Real objective: add a new `DisplayPrefs` boolean axis (`changeSummaryTable`) that gates the per-turn `ChangeSummaryBlock`, enrich every file-diff surface with live numstat counts from git, add a side-pane diff viewer with a `diff:` virtual-path scheme, and ship it all — 33 implemented tasks across shared types → server → client → e2e → docs, culminating in a squash-merge PR to `develop`.

## 2. TL;DR playbook

1. **Open the OpenSpec change** — `/skill:openspec-apply-change add-change-summary-table`. Read the proposal, design, spec delta, and all tasks.
2. **Implement shared types first** — add `additions`/`deletions` (per-file) + `totalAdditions`/`totalDeletions` (aggregate) to the diff payload (`diff-types.ts`). Run shared tests.
3. **Add server-side git numstat** — a `GIT_NUMSTAT` recipe (`git diff --numstat --relative HEAD`) and parser in `session-diff.ts`. Surface counts in the route. Test with a mocked git platform.
4. **Add the `changeSummaryTable` DisplayPrefs axis** — a new boolean in `display-prefs.ts`, its Preset defaults (`simple: false`, `standard: true`, `everything: true`), backfill in `preferences-store.ts`, and UI rows in both `ChatViewMenu` (View popover) and `SettingsPanel`.
5. **Build the per-turn line-delta utility** — `lineDelta.ts` with `editDelta`/`toolCallDelta`/`turnFileDeltas`/`buildTurnSummaries` using `jsdiff`'s `structuredPatch`. Unit-test every shape.
6. **Build `ChangeSummaryBlock`** — a React component showing the summary table at turn boundaries, wired into `ChatView` with the `changeSummaryTable` preference gate. Add the tail block for the in-progress turn.
7. **Enrich `DiffFileTree`** — add per-file line counts, aggregate header totals, and a `CountBadges` component (extracted DRY).
8. **Build the `diff:` viewer** — `SessionDiffProvider` (shared fetch per session), `DiffViewer` (reuses `DiffPanel`), `"diff"` ViewerKind in `VALID_VIEWERS`, tab tag in `EditorTabs`.
9. **Wire the changes rail** — `ChangesRailSection` component in `EditorPane`, `openChanges()`/`openDiffTab()` on `SplitWorkspaceContext`, `ChangedFilesChip` in `SessionHeader`.
10. **Ship** — `quality:changed` gate, e2e Playwright spec, archive + sync specs (fix pre-existing malformed main spec headers), commit, push, open PR, watch CI + CodeRabbit, squash-merge to `develop`, remove worktree.

## 3. How the collaboration unfolded

### Phase 1: Clarify scope (prompts 1–3)

The session began with a terse question: *"Is this can be switched on / off on settings and view?"* The AI opened the OpenSpec change, read the proposal, and correctly identified that there was **no** on/off toggle specified — only a per-instance collapse affordance. It laid out two options: a Settings toggle (global) vs a View toggle (per-session). **Why this worked:** the AI surfaced the gap immediately rather than assuming, and gave the user a choice.

The user then clarified: *"In prompt the View also contains - overridable as others"* — a compact instruction referencing the existing `DisplayPrefs` multi-axis pattern. The AI recognized the pattern instantly and mapped it to a `changeSummaryTable` boolean axis. **Decision point:** the user chose the `DisplayPrefs` approach (not a bespoke toggle), which gave them the entire existing plumbing for free.

The third prompt — *"be on by default in standard. Simple off"* — confirmed the preset defaults. The AI matched them to the existing spec exactly, requiring zero spec changes.

### Phase 2: Implement spec changes (prompt 4)

The user invoked `/skill:openspec-apply-change add-change-summary-table`, switching from planning to implementation mode. The AI read all 35 tasks and began executing in dependency order:

- **Phase 1** (shared types): added line-count fields to diff payloads. TDD: 2 tests.
- **Phase 2** (server numstat): added a git numstat recipe, parser, and route enrichment. 20 tests.
- **Phase 3** (client line-delta util): the pure-data layer for per-turn summaries. 16 tests.
- **Phase 4/4A** (UI block + toggle): `ChangeSummaryBlock` + `DisplayPrefs` axis. Tests for both.
- **Phase 5** (enriched tree): `DiffFileTree` with counts + badges. 3 tests.
- **Phase 6** (diff viewer): `SessionDiffProvider` + `DiffViewer` + viewer-kind plumbing.
- **Phase 7** (split-pane integration): `ChangesRailSection`, `openChanges()`, `ChangedFilesChip`.

**Key discovery:** the worktree's `node_modules` was **empty** — cross-package `@blackbelt-technology/*` resolution leaked to the parent repo. The AI diagnosed this (bash commands checking symlinks + workspace resolution) and created local scope symlinks as the sanctioned fix. It also saved a project memory documenting the worktree gotcha. **Why this worked:** the AI didn't guess at the worktree-linkage — it ran diagnostic commands, traced the resolution chain, and applied a minimal fix.

### Phase 3: Integration and test (206 tests)

After the code-complete checkpoint (prompt 4), the AI ran the full test suite — **206 tests green** across all changed modules. A `quality:changed` gate exposed cognitive-complexity warnings in `lineDelta.ts`; the AI refactored by extracting a shared `walkTurns` helper and smaller functions, clearing the gate. An unused-import warning in `ChangedFilesChip` was also fixed.

### Phase 4: Ship (prompt 5 — "ship-it")

The AI drove the full ship-change pipeline:
1. Manual/e2e tasks deferred (keyword match: "QA/manual" — Chromium CDN was down locally, e2e runs authoritatively in CI).
2. Docker harness built and ran healthy with local changes (port 18386).
3. Pre-existing malformed main spec (`## ADDED Requirements` instead of `## Purpose`/`## Requirements`) **fixed during archive** — otherwise the delta-sync would fail.
4. Commit → push → PR #311 opened → CI green (10m39s) → CodeRabbit rate-limited but re-triggered → 0 actionable threads → squash-merged to `develop`.
5. Remote branch deleted, worktree removed.

**Why this worked:** the AI followed the ship-change skill precisely — it deferred tasks it couldn't close locally, fixed a pre-existing blocker (malformed spec) at the archive step, and handled the CodeRabbit rate-limit by triggering a full review.

## 4. Prompts that worked

### The goal prompt — and what made it effective

> *"Is this can be switched on / off on settings and view?"*

Compact but sufficient. The AI immediately opened the spec to answer. **Why effective:** it named the two surfaces (Settings / View) and asked about *switching*, which forced the AI to check whether the feature had a control mechanism vs being always-on. A future user should be **more explicit** about the existing plumbing they want to reuse:

> **Stronger version:** *"I want a toggle for the change summary table, wired through the existing DisplayPrefs system with Settings + View popover override, same as toolResults. On by default in standard/everything, off in simple."*

### High-leverage follow-ups

| Prompt | Why it worked |
|--------|---------------|
| *"In prompt the View also contains - overridable as others"* | One sentence established the exact architectural pattern to follow. The AI knew to model it as a `DisplayPrefs` axis instead of a bespoke setting. |
| *"be on by default in standard. Simple off"* | Three words confirmed the preset defaults. The AI matched them to the existing spec, changed nothing. |
| `/skill:openspec-apply-change add-change-summary-table` | Switched from planning to execution cleanly. The skill auto-loads and follows the task list. |
| `ship-it` | One word triggers the entire ship pipeline: verify, archive, commit, PR, CI watch, merge, cleanup. |

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Answer the "is there a toggle" question with just a spec citation | Naming the `DisplayPrefs` pattern explicitly ("overridable as others") | State the target pattern up front: "use the same multi-axis DisplayPrefs system" |
| Propose bespoke toggle designs (separate button, localStorage flag) | Clarifying "the View also contains" — everything goes in the existing View popover | Tell the AI "no new buttons — add a row in the existing View menu" |
| Worktree `node_modules` being empty caused tsc to miss cross-package edits | The AI self-diagnosed and fixed (no user steering needed) | Run the worktreeInit fix at the start of any worktree-based change: create scope symlinks under `node_modules/@blackbelt-technology/` |
| Spec archive failed due to pre-existing malformed main spec | The AI diagnosed and fixed the malformed header itself | Check `openspec/specs/` for structural issues before the archive step — catch `## ADDED` headers early |
| CodeRabbit rate-limited on first review | Waited and re-triggered a full review | Pre-warm CodeRabbit before the final CI pass, or build in a 2-minute wait for the rate-limited ACK to resolve |

## 6. Skills, tools & memory created — and why they're effective

### Memories saved (2)

- **`failure · tool-quirk`** (pi-dashboard worktrees): documents the worktree `node_modules` being empty, causing cross-package edits under `packages/shared` to be invisible to local `tsc`/`vitest`. The `@blackbelt-technology/*` resolution falls up to the parent repo. **Why effective:** next time a worktree's tsc fails on a shared-package edit, the fix (create scope symlinks) is one grep away.
- **`project` memory** (Worktree gotcha): same fact for the project scope — `node_modules` exists but is empty, `worktreeInit` gate (`test ! -d node_modules`) was fooled by the empty dir. **Why effective:** the project level makes it visible to any `kb_search` from inside this repo, not just a failure-oriented lookup.

### Subagent spawned

- **`general-purpose`**: documented the change's OpenSpec spec delta, tree rows, and `docs/` prose in caveman style (Rule 6). **Why effective:** offloads documentation to an isolated context, keeps the main session focused on implementation.

## 7. Pitfalls & dead ends

| Pitfall | How to avoid |
|---------|--------------|
| Worktree `node_modules` exists but is **empty** — `tsc` can't see cross-package edits | Create `node_modules/@blackbelt-technology/*` symlinks pointing to the worktree's `packages/*` before starting. Or run `npm install` in the worktree (heavy). |
| Chromium CDN timeout prevents local e2e run | Use `PW_CHANNEL=chrome` with system Chrome installed, or defer to CI. Don't block on the bundled download. |
| Spec archive fails because main spec has `## ADDED Requirements` instead of `## Requirements` | Pre-check `openspec/specs/*/spec.md` for structural issues before the archive step. Fix the header and add a missing `## Purpose` if needed. |
| `quality:changed` gate fails on cognitive-complexity warnings | Run `npx biome check --changed --since=develop` before the final commit to surface and fix all warnings. Extract helpers from over-complex functions. |
| `npm run quality:changed` needs a fresh `git merge-base` to work | If the worktree history is short, use `HEAD~1` instead of `develop` as the diff base. |

## 8. Reproduce it faster — checklist

### Key inputs to have ready

- OpenSpec change name (here: `add-change-summary-table`)
- Understanding of the existing `DisplayPrefs` system (docs: `openspec/specs/chat-display-preferences/spec.md`)
- The `diff` npm package (edit shapes: `oldText`/`newText`, hashline, tool writes with `content`)
- Docker + Chromium for e2e (or defer to CI)

### Fastest path

1. **Prompt:** "Add a `changeSummaryTable` DisplayPrefs axis. Settings toggle + View popover override (same pattern as `toolResults`). Default: simple off, standard on, everything on. Then build the per-turn summary block, enrich the diff tree, add a diff viewer, wire the changes rail."
2. Read the spec → implement in order: shared types → server numstat → line-delta util → DisplayPrefs axis → ChangeSummaryBlock → enriched tree → diff viewer → changes rail.
3. TDD throughout: `vitest run` after each sub-phase.
4. Quality gate: `npm run quality:changed` → fix warnings.
5. E2E spec: add a Playwright spec under `tests/e2e/`.
6. Ship: `ship-it` — archive, commit, PR, CI, CodeRabbit, merge.
7. **Worktree fix** (if applicable): `mkdir -p node_modules/@blackbelt-technology && for d in packages/*/; do ... create scope symlinks`.

### Final artifacts

- `packages/client/src/lib/lineDelta.ts` — per-turn summary utility
- `packages/client/src/components/ChangeSummaryBlock.tsx` — the per-turn UI block
- `packages/client/src/components/SessionDiffContext.tsx` — diff data context
- `packages/client/src/components/editor-pane/DiffViewer.tsx` — diff viewer
- `packages/client/src/components/editor-pane/ChangesRailSection.tsx` — changes rail
- `packages/client/src/components/CountBadges.tsx` — shared badge component
- `packages/shared/src/diff-types.ts` — `additions`/`deletions` fields on diff payload
- `packages/server/src/session-diff.ts` — git numstat parser and enrichment
- `tests/e2e/change-summary-table.spec.ts` — Playwright e2e spec
- PR #311 squash-merged to `develop`

---

_Generated from session `019f5caf` · `pi-agent-dashboard` · 2026-07-13. Source extract: `/tmp/session_facts.XXXXXX.md`._
