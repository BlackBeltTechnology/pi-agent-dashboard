---
session: 019f0900
week: 2026/W26
type: development
model: "@fast"
premium: false
premium_reason: ""
upgrade_status: n/a
openspec_changes: [improve-dashboard-attention-routing, simplify-session-card-ordering]
proposal_excerpt: "The dashboard's single most important daily question — *\"which of my running sessions needs me right now?\"* — is the hardest to answer at a glance. Grounded in the live UI (14 active sessions across folders) and the a…"
---

# How we did it: Improve dashboard attention routing — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The kickoff was a single skill invocation:

```
/skill:openspec-apply-change improve-dashboard-attention-routing
```

The real objective, once the change artifacts were read: make the dashboard answer
*"which of my running sessions needs me right now?"* at a glance. That meant a
**client render-layer only** change — semantic status tokens across all themes, a
color-precedence rule that surfaces `ask_user` prompts, disambiguated status labels,
a non-color shape channel for accessibility, a per-folder "needs you" rollup pill,
and an opt-in urgency sort — with **no server or protocol change**. The two steering
turns then pushed it through review and all the way to a merged PR.

## 2. TL;DR playbook

1. `/skill:openspec-apply-change <change>` — load the change, read every context file
   *before* editing.
2. **Reconcile spec vs. reality first.** The tasks referenced 4 themes that don't
   exist (`studio/earth/athlete/gradient`); the real system is 9 themes in
   `themes.ts`. Pause, surface the mismatch via `ask_user`, get a decision, *then* code.
3. Build the **token layer** (`themes.ts` `CSS_VAR_KEYS` + all themes derived from
   accents; `index.css` base fallbacks) before any component wiring.
4. Add **pure, unit-testable helpers** (`deriveDotColorWithFlags`, `deriveRailBgColor`,
   `deriveStatusShape`, rollup counters) and TDD them, then thread into components.
5. Run tests with the **project runner + isolated HOME**:
   `HOME=$(mktemp -d) NODE_OPTIONS="--localstorage-file=$(mktemp)" npm test` — bare
   `npx vitest` resolves wrong and the worktree `node_modules` may be empty (`npm install`).
6. At real spec/codebase gaps, **checkpoint with `ask_user`** offering lettered options
   (A1/A2/A3) rather than guessing; pick the lightest client-only path.
7. Mockup loop: `serve_mockup` + `agent-browser` screenshots at 375/768/1440 when
   Playwright's CDN is unreachable; record a `score.md` rubric from computed-style evidence.
8. `"Make review"` → run CodeRabbit, self-review the diff, fix real regressions with
   regression tests.
9. `"use ship-change skill"` → verify gate (`npm test` + `npm run build`), archive +
   sync specs, PR against `develop`, watch CI, fold CodeRabbit findings, squash-merge,
   delete branch, remove worktree.

## 3. How the collaboration unfolded

**Phase 1 — Discovery & reality check.** The AI read all change artifacts and the key
source files, then hit a **factual blocker**: task 1.1 and the spec said add tokens to
"all 4 themes (studio, earth, athlete, gradient)" — names that don't exist. The real
system is `themes.ts` with 9 themes keyed by `CSS_VAR_KEYS`. *Why it worked:* it
stopped and used `ask_user` instead of inventing themes. The human chose to reconcile
the artifacts to reality and derive the new `--status-*` tokens per-theme from existing
accents.

**Phase 2 — Token + helper layer (TDD).** Added `--status-needs-you/working/idle/error`
to `themes.ts` and `index.css`, then tokenized `session-status-visuals.ts` with a new
`ask_user` branch and precedence **error > ask_user(chat-routed) > resuming/retry >
streaming > idle > ended**. Pure helpers were written and tested first, then wired into
`SessionCard`. Existing tests asserting old literal classes were updated to token-class
substring matches.

**Phase 3 — Labels, shape channel, folder rollup.** `ActivityIndicator` labels split
(`ask_user`→"Needs you", idle→"Idle", retiring "Waiting for input"); a `StatusShapeBadge`
added a non-hue channel (filled/half/ring/cross). A pure counting helper plus a
`FolderNeedsYouPill` probe component rolled the count up to the folder header.

**Phase 4 — Checkpoint on genuine gaps.** At 8/16 tasks the AI checkpointed again:
Task 5 said "persist via existing display-prefs" but no per-folder store exists (Explore
confirmed). It offered A1 (localStorage per-folder), A2 (server-backed), A3 (defer). Human
chose A1 + a mockup-loop option (B2). *Decision point:* keep it pure-client, matching the
existing `endedExpanded`/collapse-state pattern.

**Phase 5 — Mockup verification.** Playwright's Chromium CDN was unreachable, so the AI
fell back to `agent-browser` screenshots at three widths and verified tokens/`color-mix`
via `eval` of computed styles, recording a `score.md` rubric.

**Phase 6 — Review & ship.** `"Make review"` ran CodeRabbit (rate-limited on re-fetch),
so the AI self-reviewed and fixed a **real regression** (ended sessions could show "needs
you") + a latent regex over-match, with regression tests. `"use ship-change skill"` then
drove verify → archive (fixing a `MODIFIED`-rename that needed `REMOVED`+`ADDED`) → PR #174
→ CI → 6 CodeRabbit findings folded → squash-merge → branch + worktree cleanup.

## 4. Prompts that worked

- **The goal prompt** — `/skill:openspec-apply-change improve-dashboard-attention-routing`.
  Effective because the change was already fully specified in OpenSpec artifacts, so the
  skill gave the AI a task list, context files, and a definition of done. *Stronger next
  time:* ensure the proposal's assumptions (theme names, pref stores) are validated
  against the codebase *before* apply, so the first checkpoint isn't a reality mismatch.
- **`"Make review"`** — a 2-word high-leverage follow-up that triggered the CodeRabbit +
  self-review discipline and surfaced the ended-session regression before merge.
- **`"use ship-change skill"`** — one line that handed the entire land-it pipeline
  (verify, archive, PR, CI watch, review fold, merge, cleanup) to a known skill.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Trust spec wording (4 fictional themes) | Choose "reconcile artifacts to the real 9-theme system" at the `ask_user` block | State "validate spec assumptions against code before coding" in the change's design |
| Assume "reuse existing" pref store was literally possible | Pick **A1** (localStorage per-folder) over a server-backed store | Note in proposals when "reuse existing X" is aspirational, not verified |
| Want to run the full mockup-loop gate | Pick **B2** and accept `agent-browser` fallback when Playwright CDN is down | Pre-install Chromium / document the screenshot fallback |
| Consider ship done at "implementation complete" | `"Make review"` then `"use ship-change skill"` | Chain apply → review → ship explicitly as the standard flow |

## 6. Skills, tools & memory created — and why they're effective

No new skill or memory was created this session — it *consumed* existing project skills
well: `openspec-apply-change` (task-driven implementation), `ship-change` (the land-it
pipeline), plus `serve_mockup`/`score_mockup` and `agent-browser`.

Recommended skill to create: **"spec-reality reconciliation"** — a short checklist to run
at the top of `openspec-apply` that greps the codebase for every concrete noun the tasks
name (theme names, hook names, pref stores) and flags mismatches via `ask_user` *before*
the first edit. This session spent its first real decision on exactly that; a skill would
make the check automatic.

## 7. Pitfalls & dead ends

- **`npx vitest` resolves the wrong binary** and the worktree `node_modules` can be empty.
  Fix: `npm install` in the worktree, then run via `npm test` with an isolated
  `HOME=$(mktemp -d)` and `NODE_OPTIONS="--localstorage-file=$(mktemp)"`.
- **`npm install` dirtied `package-lock.json`** — revert it (`git checkout package-lock.json`)
  since it's not part of the change.
- **Playwright Chromium CDN unreachable** → `score_mockup`'s axe gate can't run. Fall back
  to `agent-browser` screenshots + `eval` computed-style checks and hand-score a rubric.
- **`biome quality:changed` returned 0 files** (a worktree-vs-`develop` git-detection quirk).
  Verify by running `biome lint`/`check` directly on the changed files; distinguish
  Tier-A errors (hard gate) from grandfathered Tier-B/C warnings.
- **OpenSpec archive failed on a `MODIFIED` requirement rename** — `MODIFIED` matches by the
  *existing* header, so a title change needs `REMOVED` (old) + `ADDED` (new), merged into one
  `## ADDED Requirements` section.
- **`gh pr merge` tried to switch the local checkout to `develop`** (held by the parent
  worktree) and failed after the server-side merge succeeded — verify the merge landed, then
  delete the remote branch explicitly.
- **Removing the worktree killed the shell's cwd** — the Bash tool couldn't `chdir` afterward.
  Re-anchor to the parent repo *before* `git worktree remove`; the last prune/branch-delete
  steps are cosmetic.

## 8. Reproduce it faster — checklist

- [ ] Have the OpenSpec change artifacts ready; run `/skill:openspec-apply-change <change>`.
- [ ] Grep the codebase for every concrete name the tasks reference; `ask_user` on any mismatch.
- [ ] Build tokens (`themes.ts` + `index.css`) → pure helpers (TDD) → component wiring, in that order.
- [ ] `npm install` in the worktree; test via `HOME=$(mktemp -d) NODE_OPTIONS=... npm test`.
- [ ] Checkpoint with lettered `ask_user` options at real spec/codebase gaps; prefer client-only.
- [ ] Mockup: `serve_mockup` + `agent-browser` at 375/768/1440; record `score.md`.
- [ ] `"Make review"` → CodeRabbit + self-review; fix regressions with regression tests.
- [ ] `"use ship-change skill"` → verify gate, archive+sync, PR vs `develop`, CI, fold findings, squash-merge, cleanup.

Key inputs: the OpenSpec change name, a clean worktree, `gh` auth, CodeRabbit access.
Final artifacts: token/helper/component edits across `packages/client/src`, new
`FolderNeedsYouPill.tsx` + `useFolderUrgencySort.ts` + tests, `mockups/` (ui-plan, HTML,
score), and **merged PR #174** (`improve-dashboard-attention-routing`).

---

_Generated from session `019f0900-d61e-73ff-947c-d7de239f0e59` · `/Users/robson/Project/pi-agent-dashboard` · 2026-06-27. Source extract: session facts sheet (deterministic extract)._
