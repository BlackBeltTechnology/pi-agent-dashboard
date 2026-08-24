---
session: 019f258f
week: 2026/W27
type: development
model: "@fast"
premium: true
premium_reason: "created 0 skill(s) / 1 memory(ies); heavy steering (6 user prompts); large facts sheet (~11313 tok)"
upgrade_status: pending
openspec_changes: [fix-thinking-level-supported-projection]
proposal_excerpt: "The dashboard's thinking-level dropdown under-reports the levels a reasoning model supports. For every frontier Opus model (`claude-opus-4-5/4-6/4-7/4-8`), whose catalog metadata is `reasoning: true` + `thinkingLevelM…"
---

# How we did it: Fix the thinking-level dropdown under-reporting supported levels — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The user opened with `"Is there anything to clarify?"` against a pre-written OpenSpec
change (`fix-thinking-level-supported-projection`). The *real* objective, surfaced by
verification and steering, was: **ship the fix where the dashboard's thinking-level
dropdown under-reports the levels a reasoning model supports.** `toModelInfo` in the
bridge treated a model's `thinkingLevelMap` as an **allowlist**, so an Opus model whose
catalog metadata carries a *sparse* map (`{xhigh: …}`) rendered only `xhigh` — leaving
the live `high` level un-selectable. The correct behaviour is pi's **sparse-override**
rule: a reasoning model with a partial (or absent) map still exposes the full base
ladder `off/minimal/low/medium/high`, with map entries overriding individual rungs.
The task was to make the projection match pi's own `getSupportedThinkingLevels`, prove
it with tests, and land it through apply → archive → ship.

## 2. TL;DR playbook

1. **Do not trust the spec's import instructions — verify them against installed code.**
   Run `node -e "const m=require('@earendil-works/pi-ai/...'); console.log(...)"` and
   inspect `package.json` `exports` to confirm the symbol actually resolves.
2. **Map the version split explicitly.** The dashboard *pins* `@earendil-works/pi-ai`
   at `^0.75.5` (devDep, what `tsc` sees) but the extension *runs inside pi's process*
   which bundles `0.80.x`. Type-check target ≠ runtime target.
3. **Prove which import paths type-check** with a throwaway `.ts` file and
   `npx tsc --noEmit` (+ `--traceResolution` when a barrel is suspect). Here: **no**
   pi-ai import path resolved, because the shipped `.d.ts` re-exports via explicit
   `.ts` extensions the repo tsconfig can't follow.
4. **Pivot to inlining the rule.** Copy pi's ~5-line `getSupportedThinkingLevels`
   verbatim as a local `deriveSupportedThinkingLevels` helper above `toModelInfo` — no
   pi-ai import, version-agnostic, sidesteps the whole resolution trap.
5. **Write the test matrix from pi's *real* output**, not the spec's claims (pi excludes
   `xhigh` for a no-map reasoning model — the spec wrongly said "all six").
6. **Separate your gate from pre-existing breakage.** Confirm the repo's jimp/electron
   `tsc`/test failures reproduce on clean `HEAD` before treating your change as clean.
7. **Commit surgically** — `git add -A` swept in an unrelated `manage-flows/SKILL.md`
   flag flip; reset it out and re-commit only your files.
8. **Apply → archive → ship** via the skills, but when `develop`'s own CI is red from an
   unrelated docker test, **stop before merge**; later **rebase onto green develop** to
   inherit the fix, then squash-merge + clean up the worktree.

## 3. How the collaboration unfolded

**Phase 1 — Verify the spec against reality (Discovery).**
Instead of implementing the change as written, the AI ran node/grep probes to check the
spec's central instruction: `import { getSupportedThinkingLevels } from
"@earendil-works/pi-ai/compat"`. Two discrepancies surfaced immediately — the `/compat`
subpath **does not exist** in the pinned 0.75.5, and the design's claim that "the bridge
already depends on `/compat`" was false. *Why it worked:* treating the spec as a
hypothesis to falsify caught a bug before a single line was written.

**Phase 2 — The version-split investigation (steering #1, #2).**
The user's terse `"is it suck?"` and then the sharp hypothesis `"We are using much later
version. Maybe there was refactor in pi which moves the packages?"` were the pivot.
The AI confirmed: pi refactored in **0.80** (added `/compat`); dashboard pins **0.75.5**
for type-check but runs against **0.80.3**. Deeper `tsc --traceResolution` work then
found the *real* trap — pi-ai's `.d.ts` re-export via explicit `.ts` extensions
(`export * from "./models.ts"`), which needs `allowImportingTsExtensions` (unset, and
unsafe to set globally because the base config emits declarations). **Every** pi-ai
import path — main entry *and* `/compat`, on both versions — fails `tsc` here.

**Phase 3 — Pivot to inline + implement (Generate).**
Decision point: since no import type-checks, the AI inlined pi's rule as a local
`deriveSupportedThinkingLevels` helper (verbatim, spec-pinned) and rewrote `toModelInfo`
to use it. It wrote `provider-register-thinking-levels.test.ts` with 5 cases (Opus
sparse map, dense-disabled, non-reasoning, no-map, no-metadata) — aligning the matrix to
pi's *actual* output (no `xhigh` without a declared entry), and corrected the
proposal/design/spec/tasks that had claimed otherwise.

**Phase 4 — Gates & surgical commit (Verify).**
The AI isolated its change from the repo's pre-existing red: 7 jimp `tsc` errors and 18
test failures all reproduced on clean `HEAD` → its change added **+2 passing tests, 0
regressions, 0 new biome diagnostics**. CodeRabbit: 0 Critical/Warning. It caught
`git add -A` sweeping in an unrelated skill-file flag flip and backed it out before
committing.

**Phase 5 — Apply → archive → ship (steering #3, #4, #5).**
Driven by `/skill:openspec-apply-change`, then `use ship-change skill`. ship-change hit
a hard guardrail: `develop`'s own CI was red (unrelated docker test), so it **stopped
before merge** and opened PR #218. The final steering, `"rebase to develop, maybe the
fix for develop is there"`, was decisive — rebasing pulled in PR #219's fix, develop
went green, PR #218 went green, and the AI squash-merged + cleaned up the worktree
(which also killed its own cwd — an expected consequence).

## 4. Prompts that worked

- **Goal prompt — `"Is there anything to clarify?"`** Effective *because* it invited
  verification-before-implementation rather than blind execution. A stronger version:
  *"Before implementing this change, verify every import path and version assumption in
  the proposal against the installed packages; list discrepancies."*
- **`"We are using much later version. Maybe there was refactor in pi which moves the
  packages?"`** — the highest-leverage prompt of the session. A short, correct domain
  hypothesis that redirected the AI from "fix the import" to "understand the version
  split," which is where the real bug lived.
- **`"rebase to develop, maybe the fix for develop is there"`** — unblocked a stalled
  ship. Short, testable, and correct: it inherited an upstream fix instead of waiting.
- **`use ship-change skill` / `/skill:openspec-apply-change …`** — invoking the named
  skills kept the land-the-change process disciplined and auditable.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Trust the spec's `/compat` import and version assumptions | `"is it suck?"` — push to re-examine | Add "verify imports/versions against installed packages" to the apply checklist |
| Treat the bug as an import-path fix | `"We are using much later version… refactor in pi?"` | Record the pi-ai version-split as a project convention (done — memory saved) |
| Stall the ship on pre-existing red `develop` CI | `"rebase to develop, maybe the fix… is there"` | ship-change should auto-check whether develop's red is upstream+fixable via rebase |
| Sweep unrelated files via `git add -A` | (self-caught) | Prefer staging explicit paths; diff-review the staged set before commit |

## 6. Skills, tools & memory created — and why they're effective

- **Project memory (convention): pi-ai import paths & the version split.**
  Captures that the dashboard pins `@earendil-works/pi-ai ^0.75.5` (devDep) while the
  extension runs inside pi's `0.80.x` process, that `getSupportedThinkingLevels` lives on
  the **main entry** in every version the dashboard touches, and that the shipped `.d.ts`
  `.ts`-extension barrels make **all** pi-ai imports fail this repo's `tsc` — so **inline
  pi's pure rules** instead of importing. *Why effective:* removes hours of
  re-investigation the next time anyone needs a pi-ai symbol in the bridge; converts a
  hard-won `--traceResolution` finding into a one-line rule. *Invoke:* whenever tempted
  to `import` from `@earendil-works/pi-ai` in `packages/extension/`.
- **Skills used (not created):** `openspec-apply-change`, `ship-change`, plus the
  implement gates. **Recommended new skill:** a "verify-spec-imports-before-apply" micro
  step — probe every third-party import/version claim in a proposal against installed
  packages before writing code.

## 7. Pitfalls & dead ends

- **`find / -path "*@earendil-works/pi-ai/package.json"` aborted** — too broad. Scope to
  the known `node_modules` roots instead.
- **`import … from "@earendil-works/pi-ai/compat"`** → `TS2307` (absent in pinned
  0.75.5). **`import … from "@earendil-works/pi-ai"` (main entry)** → `TS2305` (barrel
  re-exports via `.ts` extensions the tsconfig can't follow). *Both dead ends* — the only
  robust fix was **inlining** the rule.
- **`biome check --changed` found 0 files** in the worktree (vcs-root quirk) — run biome
  on the explicitly touched files instead.
- **`npm test` / `reload:check` red from pre-existing jimp+electron breakage** — always
  reproduce on clean `HEAD` before blaming your change; these are baseline noise here.
- **`git add -A` staged an unrelated `manage-flows/SKILL.md` flag flip** — `git reset
  --soft HEAD~1` + `git restore --staged` it, re-commit only your files.
- **`ship-change` stalled on red `develop` CI** — don't force a merge; rebase onto a
  green develop to inherit the upstream fix.
- **Removing the worktree killed the session's cwd** — expected when the running session
  lives inside the worktree it deletes; do final verification from the parent repo path.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** the OpenSpec change name; write access to `packages/extension/`;
`gh` auth for PR/CI; a clean `HEAD` to baseline pre-existing test failures against.

- [ ] Probe the spec's imports/versions against installed packages (`node -e require(...)`,
      inspect `package.json` `exports`); list discrepancies before coding.
- [ ] Confirm the pi-ai version split (pinned `^0.75.5` devDep vs `0.80.x` runtime).
- [ ] Prove import resolution with a throwaway `.ts` + `tsc --noEmit`; if barrels fail,
      **inline** the pure rule instead of importing.
- [ ] Add `deriveSupportedThinkingLevels` helper above `toModelInfo`; rewrite the
      allowlist logic to pi's sparse-override rule.
- [ ] Write the test matrix from pi's *real* output (no `xhigh` for a no-map reasoning
      model); correct any spec/design claims that disagree.
- [ ] Baseline pre-existing failures on clean `HEAD`; verify your diff adds 0 regressions.
- [ ] Stage explicit paths (not `git add -A`); commit surgically.
- [ ] apply → archive → ship; if `develop` CI is red upstream, stop before merge, then
      rebase onto green develop, squash-merge, and clean the worktree from the parent repo.

**Artifacts produced:**
- `packages/extension/src/provider-register.ts` (helper + `toModelInfo` rewrite)
- `packages/extension/src/__tests__/provider-register-thinking-levels.test.ts` (+2 tests)
- `openspec/changes/.../{proposal,design,tasks}.md` + `specs/model-selector/spec.md`
  (corrected to the inline approach; archived to `2026-07-03-fix-thinking-level-supported-projection`)
- PR **#218** — MERGED (squash `0ccf56b0`, base `develop`)

---

_Generated from session `019f258f-ee81-7f29-99b8-245e5e4485f6` · `pi-agent-dashboard` · 2026-07-03. Source extract: deterministic facts sheet from `session-to-guideline/scripts/extract_session.ts`._
