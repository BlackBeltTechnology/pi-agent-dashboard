---
session: 019f2ca7
week: 2026/W27
type: development
model: "@fast"
premium: false
premium_reason: ""
upgrade_status: n/a
openspec_changes: [add-panel-elevation-system]
proposal_excerpt: "Session and folder titles currently render flat: the session name is `text-sm` weight-400 (`SessionCard.tsx`), and cards lift only via a single `shadow-md shadow-[var(--shadow-card)]` drop shadow. The result reads as…"
---

# How we did it: Panel elevation system — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The session opened with a single slash command:

```
/skill:openspec-apply-change add-panel-elevation-system
```

The real objective: take an already-scoped OpenSpec change (a "Tier-1 neutral
elevation" visual system — session cards and folder/workspace headers should read as
raised *panels* via a subtle inset-highlight bevel instead of a flat drop shadow, and
session names should gain weight) and **implement it end-to-end from the change
artifacts, then land it**. There was no design debate — the proposal, tasks.md, and a
validated `tier1.html` mockup already fixed the exact recipe. The job was faithful
translation into the React/Tailwind client, verification, and a clean ship.

## 2. TL;DR playbook

1. `/skill:openspec-apply-change add-panel-elevation-system` — let the apply skill
   walk tasks.md task-by-task.
2. **Read before touching**: confirm the token-flow contract — `applyThemeVars` only
   writes `CSS_VAR_KEYS`, so an *un-listed* `--elevation-rim` in `index.css` survives
   all 9 named themes. That single fact decides the token's home.
3. Add `--elevation-rim` to `index.css`: `:root` (dark) `rgba(255,255,255,0.10)`,
   `[data-theme="light"]` `rgba(255,255,255,0.9)`.
4. Replace `shadow-md` with the bevel utility
   `shadow-[inset_0_1px_0_var(--elevation-rim),0_4px_8px_var(--shadow-card)]` on both
   card layouts; add `font-semibold` to the session-name spans; apply the lighter
   `0 2px 4px` variant to `WorkspaceHeader` + the folder panel in `renderGroup`.
5. Test the token deterministically: import `index.css` via `import.meta.dirname`
   (**not** jsdom `getComputedStyle`, **not** `?raw`) and assert both mode values plus
   "token is outside `CSS_VAR_KEYS`".
6. **Build, then grep the built CSS** to prove the arbitrary multi-shadow class wasn't
   purged and the commas parsed as multiple shadows.
7. Run the quality gate on the *touched* files directly (Biome `--write` for safe
   import-sort, `tsc`, vitest); pre-classify unrelated failures as pre-existing by
   reproducing them on the clean base.
8. `Use ship-change skill` → archive + spec-sync, commit, **merge `develop`** to pull
   in-flight fixes, push, let CI be the authoritative gate.
9. Address CodeRabbit's one finding (hover overrode the box-shadow → give hover its own
   rim-preserving shadow), update the living spec's hover scenario, re-push.
10. Re-run flaky CI jobs, confirm no unresolved review threads, squash-merge.

## 3. How the collaboration unfolded

**Phase 1 — Discovery / contract-reading (12:24).** The AI read the spec and every
source file it would edit *before* writing anything. The pivotal discovery: tracing
`applyThemeVars` → `CSS_VAR_KEYS` proved that a token *not* in that list is never
cleared when a named theme is applied. That made `index.css` the correct home for
`--elevation-rim` — a decision grounded in code, not guesswork.

**Phase 2 — Generate (12:24–12:26).** Straight task-by-task translation: token →
card bevels (desktop + mobile) → `font-semibold` spans → header + folder bevels. The
AI explicitly checked that the `isSelected` ternary only swapped border/tint/ring, so
the shared-container bevel couldn't regress the selected state.

**Phase 3 — Test the token (12:26–12:29).** This was the session's real friction. Three
approaches failed before one worked (see §7). The winning move: assert against the
real `index.css` **source** loaded via `import.meta.dirname`, checking presence of both
mode values *and* that the token sits outside `CSS_VAR_KEYS`. 13 tests pass.

**Phase 4 — Verify the build (12:31–12:33).** Because Tailwind arbitrary values with
commas are a known purge/parse gotcha, the AI ran `npm run build` and grepped the
emitted CSS to confirm both bevel utilities generated with commas parsed as
multi-shadow and tokens resolving per-mode (`#ffffff1a` dark, `#ffffffe6` light) —
byte-identical to the validated mockup.

**Phase 5 — Quality gate (12:32–12:39).** `quality:changed` found 0 files (worktree
git-base quirk), so the AI ran Biome/tsc/vitest directly on the touched files. It
carefully separated its own diagnostics (a mechanical import-sort) from the ~41
pre-existing warnings and 20 pre-existing test failures, reproducing the latter on the
clean base to prove non-regression. CodeRabbit: no findings at this stage.

**Phase 6 — Ship (14:13 onward).** The human steered with `Use ship-change skill`. The
AI archived + synced specs, committed, **merged `origin/develop`** (which happened to
carry the exact `tool-registry` electron fix for one local failure), pushed, and
deferred to CI. CodeRabbit then flagged a real bug: `hover:shadow-lg` *replaced* the
box-shadow, dropping the inset rim on hover. The AI gave hover its own bevel-preserving
shadow, updated the spec's hover scenario, re-pushed, re-ran a flaky CI job, confirmed
no open threads, and squash-merged PR #231.

## 4. Prompts that worked

- **The goal prompt** — `/skill:openspec-apply-change add-panel-elevation-system`.
  Effective because *all the design work was already captured in the change*. When a
  proposal + tasks.md + validated mockup exist, a single apply-skill invocation is the
  right kickoff; the AI just needs to execute faithfully and verify.
- **High-leverage follow-up** — `Use ship-change skill`. Three words that handed off
  the entire land-it pipeline (archive → commit → merge develop → CI → CodeRabbit →
  merge). Naming the skill routes the AI into a known, guarded workflow instead of
  ad-hoc git.

Neither prompt needed rewriting — this is what a well-prepared change looks like. The
lesson for a future operator: **invest the design/scoping into the OpenSpec artifacts
up front, and the implementation session becomes two short prompts.**

## 5. Steering & corrections (what to watch for)

Only one human steering turn occurred, but several *self-corrections* are worth baking
in as guardrails:

| The AI tended to… | The steer / correction was… | Bake this in next time by… |
|-------------------|------------------------------|----------------------------|
| Reach for jsdom `getComputedStyle` to test a CSS token | It can't resolve custom props from `@import "tailwindcss"` | Assert against the `index.css` **source** + the `CSS_VAR_KEYS` contract, not computed style |
| Load CSS via `?raw` / `import.meta.url` in vitest | `?raw` returned empty; jsdom `import.meta.url` isn't a file URL | Use `import.meta.dirname` + `readFileSync` for deterministic source reads |
| Treat any red test as its own regression | 20 full-suite failures were pre-existing (Jimp, electron argv, flaky `EditorFileTree`) | Reproduce failures on the clean base first; only own diagnostics in files you touched |
| Trust `quality:changed` to find the diff | It found 0 files (worktree git-base quirk) | Run Biome/tsc/vitest directly against the explicit touched-file list in a worktree |
| Assume `hover:shadow-lg` layers on top | Tailwind hover **replaces** box-shadow, killing the inset rim | Give hover its own full shadow that re-includes the rim; update the living spec |
| Wait on CodeRabbit "pass" as done | "pass" can be a rate-limited ACK, not a real review | Verify there are no actionable threads/comments before declaring the gate green |

## 6. Skills, tools & memory created — and why they're effective

No new skills or memories were created this session. The workflow leaned entirely on
existing project skills — `openspec-apply-change` (task-by-task execution) and
`ship-change` (archive→CI→CodeRabbit→merge) — which is exactly the point: a mature
change pipeline means implementation needs no new tooling.

**Worth capturing as a durable note** (candidate memory/skill): *"Testing a CSS custom
property in this repo — assert against the `index.css` source via `import.meta.dirname`
and verify the token is outside `CSS_VAR_KEYS`; never rely on jsdom `getComputedStyle`
or `?raw`."* This burned three attempts and will recur for every future theme token.

## 7. Pitfalls & dead ends

- **jsdom `getComputedStyle` for CSS vars → dead end.** Won't resolve props behind
  `@import "tailwindcss"`. Assert on the source file instead.
- **`?raw` import → returned empty; `import.meta.url` → not a file URL under jsdom.**
  Use `import.meta.dirname` + `readFileSync`.
- **Tailwind arbitrary multi-shadow (commas) → purge/parse risk.** Always build and
  grep the emitted CSS to confirm the class generated and commas became multiple
  shadows.
- **`hover:shadow-lg` replaces, not layers.** Any hover shadow must re-declare the
  inset rim or the bevel vanishes on hover.
- **`quality:changed` finds 0 files in a worktree.** Fall back to explicit file lists.
- **`EditorFileTree.test.tsx` is parallel-flaky** (jsdom scroll timing / `.git`
  reveal). It failed one CI run unrelated to the diff → re-run the failed jobs; it's a
  known flaky, not a regression.
- **`git worktree remove` from inside the worktree deletes your own cwd.** The final
  cleanup killed the shell (every subsequent `bash` failed on a missing cwd). Run
  worktree removal from the parent repo, not from within the worktree. The ship was
  complete; only a cosmetic local branch ref remained.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** a fully-scoped OpenSpec change (`proposal.md`, `tasks.md`,
and a validated mockup like `tier1.html`); a clean worktree; CI + CodeRabbit wired to
the PR target branch.

- [ ] `/skill:openspec-apply-change <change-name>`.
- [ ] Read the token-flow contract; confirm an un-listed token in `index.css` survives
      `applyThemeVars` (touches only `CSS_VAR_KEYS`).
- [ ] Add the token with per-mode values in `index.css`.
- [ ] Apply the bevel utility + `font-semibold` across both card layouts and the
      header/folder panels; verify the selected-state ternary can't regress.
- [ ] Test the token via `import.meta.dirname` source read + `CSS_VAR_KEYS`
      membership check.
- [ ] `npm run build` → grep the emitted CSS for the bevel utilities.
- [ ] Biome `--write` (safe import-sort) + `tsc` + vitest on **touched files**;
      reproduce any red on the clean base to prove non-regression.
- [ ] `Use ship-change skill` → archive+sync, commit, **merge develop**, push.
- [ ] Resolve CodeRabbit's hover finding; update the living spec; re-push.
- [ ] Re-run flaky CI jobs; confirm zero open review threads; squash-merge.
- [ ] Remove the worktree **from the parent repo**, never from inside it.

**Final artifacts produced:** `packages/client/src/index.css` (token),
`SessionCard.tsx` / `WorkspaceHeader.tsx` / `SessionList.tsx` (bevels + weight),
`themes.test.ts` (token tests), `packages/client/src/AGENTS.md` +component sidecars
(docs), `openspec/specs/panel-elevation/spec.md` (synced, 5 requirements). Merged via
PR #231 (squash `886386ef`) → `develop`.

---

_Generated from session `019f2ca7-2eef-7f40-87bf-60858c4accf4` · `/Users/robson/Project/pi-agent-dashboard` · 2026-07-04. Source extract: deterministic facts sheet._
