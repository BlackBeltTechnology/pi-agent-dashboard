---
session: 019f0965
week: 2026/W26
type: development
model: "@fast"
premium: false
premium_reason: ""
upgrade_status: n/a
openspec_changes: [extend-client-utils-state-feedback-primitives, add-extension-ui-a11y-baseline]
proposal_excerpt: "A grounded UX exploration across six dashboard surfaces (session card, folder header, composer `ArtifactChip`, search/composer inputs, chat empty/loading, OpenSpec board) found one root cause, confirmed by a falsifica…"
---

# How we did it: Extend client-utils with state-feedback primitives — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The user opened with a single skill invocation:

```
/skill:openspec-apply-change extend-client-utils-state-feedback-primitives
```

The real objective: take an already-planned OpenSpec change (all artifacts drafted,
17 tasks pending) and **implement it end-to-end** — build four reusable `client-utils`
state-feedback primitives (`EmptyState`, `Skeleton`, `focusRing`, `statusPresentation`),
refactor six dashboard surfaces onto them to prove they work, satisfy a WCAG 1.4.1
"don't-encode-meaning-in-hue-alone" accessibility bar, verify via tests + a mockup
loop, then **ship it** — archive, PR against `develop`, survive CI + CodeRabbit, and
squash-merge with full worktree cleanup. One later steering turn (`Use ship-change`)
promoted "implement" into "implement **and land**".

## 2. TL;DR playbook

1. `cd` into the change's worktree and run `/skill:openspec-apply-change <name>`; read the spec deltas, `tasks.md`, and the mockup before touching code.
2. Build each primitive **TDD-first**: write the `__tests__/*.test.tsx`, then the component; add its `package.json` export entry.
3. Worktree has no `node_modules` → `npm install` once, then run scoped vitest with `HOME=$(mktemp -d) ./node_modules/.bin/vitest run <names>` (isolates the run, dodges the global config).
4. Refactor the real surfaces onto the primitives (chat/board empties → `EmptyState`, load spinner → `Skeleton`, status color-maps → `statusPresentation` glyph+token). Update the existing tests that asserted the *old* behavior.
5. Add an **adoption ratchet test** that fails if a surface regresses off the primitive — locks the win in.
6. Verify the mockup: `serve_mockup` + `score_mockup`; if Playwright download fails, fall back to the `browser` skill and prove WCAG 1.4.1 by screenshotting in **grayscale** (glyphs stay distinguishable, color-only column collapses).
7. Delegate every `docs/` write to a general-purpose subagent with the caveman-style rule passed verbatim.
8. Run the quality gate on the **actual changed files** (`biome check --write` + `tsc` + tests) — don't trust `quality:changed` in a worktree (its `--changed` git base is wrong).
9. `Use ship-change`: verify gate → `openspec archive --yes` (syncs specs) → **restore `package-lock.json`** before commit → push → PR → watch CI → triage CodeRabbit → apply safe fixes → re-push → squash-merge → delete branches → `git worktree remove`.

## 3. How the collaboration unfolded

**Discovery (16:04–16:08).** The AI confirmed it was inside the change's worktree,
read the apply skill, saw all artifacts drafted with 17 tasks pending, and read the
four spec deltas + mockup + the existing surfaces to refactor. *Why it worked:* it
front-loaded context (specs, mockup, target components) before writing a line, so the
primitive APIs matched the real call sites.

**Generate primitives (16:08–16:11).** Four primitives built TDD-first: `EmptyState`
(NN/g pattern, single `action` prop enforcing one-primary-CTA by construction),
`Skeleton` (content-shaped, honors `prefers-reduced-motion`), `.focus-ring` CSS
utility + `--focus-ring` token in both themes, and `statusPresentation` (semantic
`--status-*` token **plus** a mandatory non-hue glyph ✓/▸/○/✕ + `statusAriaLabel`).
Decision point: the worktree had no `node_modules` → `npm install`, then 11 primitive
tests green before any surface was touched.

**Refactor surfaces (16:11–16:15).** Chat empty → `EmptyState`; chat spinner →
`Skeleton variant="bubble"`; board "No proposals" → `EmptyState`; board color-map →
`statusPresentation`; composer `ArtifactChip` → glyph + `aria-label`; search/composer
inputs + spawn buttons → `.focus-ring` + aria-labels + ≥44px targets. Then a **Task 6.1
adoption ratchet test** to prevent regression.

**Verify (16:15–16:34).** Two existing tests asserted the old color-only behavior; the
spec change *required* updating them. A defensive `matchMedia` guard was added to
`useMediaQuery` (jsdom lacks it). Full suite surfaced one **unrelated flaky server
timing test** — confirmed flaky by re-running in isolation (passed). Mockup scored via
the browser skill after the Playwright download failed on network; grayscale screenshot
proved WCAG 1.4.1. Docs delegated to a subagent. Quality gate run manually on changed
files.

**Ship (16:42–17:13).** `Use ship-change`: verify gate green → `openspec archive --yes`
synced 4 delta specs + archived → **caught a 34k-line `package-lock.json` churn** from
the worktree install and restored it → PR #175 → CI green + CodeRabbit (10 findings,
0 blocking). Applied 9 safe fixes (Skeleton count clamp, `role="status"`, localized
aria-label, stronger ratchet, glyph assertion, 4 spec Purpose stubs), deferred #5 with
a posted rationale, re-pushed → round-2 clean → squash-merge → branch + worktree cleanup.

## 4. Prompts that worked

- **The goal prompt** — `/skill:openspec-apply-change <name>`. Effective because all the
  spec/design/tasks context already lived in the change; the skill gave the AI a
  deterministic task list to execute rather than an open-ended "build me a thing".
- **High-leverage follow-up** — `Use ship-change`. Two words that promoted the session
  from "implemented" to "merged + cleaned up", handing the AI the entire land pipeline.

**Stronger kickoff for next time:** `/skill:openspec-apply-change <name> then ship-change`
— state both phases up front so the AI plans the verify gate and lockfile-restore into
the run instead of discovering them at ship time.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| stop at "implementation complete" | "Use ship-change" | Say "apply **and ship**" in the first prompt |
| trust `npm run quality:changed` (its `--changed` git base is wrong in a worktree) | (self-corrected) run biome/tsc/tests on the actual changed files | Note the worktree quirk in the apply/ship skill |
| let the worktree `npm install` rewrite `package-lock.json` (34k lines) into the commit | (self-corrected) `git checkout` the lockfile to base before commit | Add a lockfile-restore step to ship-change |
| treat a full-suite flaky failure as a real break | re-run the single test in isolation to confirm flake | Keep a "known flaky: probeServer/DiagnosticsSection" note |
| want to edit `docs/` directly | delegate to a subagent with the caveman rule verbatim | Enforce the docs-subagent protocol from AGENTS.md |

## 6. Skills, tools & memory created — and why they're effective

No new skill or memory was created — the session was a clean execution of existing
skills (`openspec-apply-change`, `ship-change`) plus the `browser`, `serve_mockup`,
and `score_mockup` tools. The reusable pattern worth capturing:

- **Adoption ratchet test** — a test that asserts each surface still consumes the shared
  primitive. It converts "we refactored six surfaces" into a *permanent* guarantee that
  a future edit can't silently regress off the primitive. Invoke this pattern whenever a
  change's value is "everyone now uses X".
- **Grayscale-screenshot WCAG 1.4.1 proof** — when the automated `score_mockup` path is
  blocked (Playwright download fails offline), screenshot the mockup in grayscale via the
  `browser` skill: glyph-bearing states stay distinguishable while a color-only column
  collapses. A cheap, visual, falsifiable accessibility proof.

## 7. Pitfalls & dead ends

- **No `node_modules` in a fresh worktree.** `vitest` isn't on PATH until you `npm install`. Run it, then use `./node_modules/.bin/vitest`.
- **`quality:changed` errors in a worktree.** `biome --changed` finds 0 files (wrong git base) and aborts the chain. Run the three gates explicitly on `git status --porcelain` files instead.
- **`npm install` rewrites `package-lock.json` wholesale.** 34k-line churn with zero dep changes → `git checkout <base> -- package-lock.json` before committing.
- **Biome auto-edits import style** (`import type React`, drops unused `React` under the automatic JSX runtime) → re-check touched files after `biome check --write`, and watch for a stray `}` you introduced during manual edits (happened twice).
- **Flaky non-related tests** (`probeServer` timing, `DiagnosticsSection` clipboard) fail under full-suite parallel load → confirm by isolated re-run before treating as a real failure.
- **Squash-merge from a worktree collides** — `gh pr merge --delete-branch` tries to check out `develop` locally and fails; verify the merge landed on GitHub, then clean up remote branch + worktree manually, and `git branch -D` the local (squash leaves it "unmerged" by ancestry).

## 8. Reproduce it faster — checklist

**Inputs to have ready:** the OpenSpec change name with drafted artifacts, worktree
checked out, `gh` auth for PR + CodeRabbit.

1. `/skill:openspec-apply-change <name> then ship-change` — state both phases up front.
2. Read specs + `tasks.md` + mockup before coding.
3. TDD each primitive → `npm install` (once) → scoped `HOME=$(mktemp -d) ./node_modules/.bin/vitest run …`.
4. Refactor surfaces; update old-behavior tests; add an adoption ratchet test.
5. Mockup verify (grayscale fallback for WCAG 1.4.1); delegate docs to a subagent.
6. Quality gate on changed files (not `quality:changed`); confirm flakes in isolation.
7. Ship: archive+sync → **restore `package-lock.json`** → PR → CI → triage CodeRabbit → re-push → squash-merge → delete branches + `git worktree remove`.

**Artifacts produced:** 4 primitives (`EmptyState.tsx`, `Skeleton.tsx`, `focusRing.ts`,
`statusPresentation.ts`) + tests in `packages/client-utils/src/`, 6 refactored surfaces
in `packages/client/src/components/`, adoption test `state-feedback-adoption.test.tsx`,
4 synced specs under `openspec/specs/client-utils-*`. Merged as **PR #175** (squash) →
`develop` @ `7c0e8fd5`.

---

_Generated from session `019f0965` · `/Users/robson/Project/pi-agent-dashboard` · 2026-07-24. Source extract: session-to-guideline facts sheet._
