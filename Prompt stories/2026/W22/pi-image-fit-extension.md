---
session: 019e7b7e
week: 2026/W22
type: development
model: "@fast"
premium: true
premium_reason: "heavy steering (11 user prompts)"
upgrade_status: pending
openspec_changes: [pi-image-fit-extension]
proposal_excerpt: "Models have per-image and per-request byte and pixel ceilings (Anthropic ~5 MB / >1568px long edge is server-downscaled; OpenAI ~20 MB with tile math; Gemini ~7 MB inline). When a pi agent calls `Read` on a large scre…"
---

# How we did it: shipping the pi-image-fit-extension — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The operator opened on a terse logistics prompt — _"proposals on parent folder. Add
and commit [ci skip] to develop and after rebase to develop"_ — but the real objective,
which the following ten steering turns made explicit, was **to take the
`pi-image-fit-extension` OpenSpec change from a committed proposal all the way to a
merged PR on `develop`**: apply the change (implement the hook + tests), prove it works
live in a real pi session, wire it into publish/QA plumbing, confirm it does not bloat
the Electron bundle, and clean up the worktree. The extension itself auto-downscales
oversize images that a pi agent `Read`s (5116×2878 PNG → 1568×882) so they fit model
byte/pixel ceilings.

## 2. TL;DR playbook

1. Commit the proposal to `develop` with `[ci skip]`, then **rebase the worktree branch
   onto the updated develop** so it picks up any parallel-session work first.
2. Run `/skill:openspec-apply-change pi-image-fit-extension` — but **audit existing
   scaffolding before writing** (a parallel session had already done sections 1–3).
3. When tests fail on a fresh worktree, try `npm install` first — a missing `jimp`
   install (workspace not hydrated) masqueraded as a code bug.
4. Do the mechanical doc/skill edits inline (caveman style); the `Explore` subagent
   delegate was blocked (missing `@fast` role), so don't hard-depend on it.
5. **Prove the hook live, not just in unit tests**: wire the extension into the
   worktree's `.pi/settings.json` via the top-level `extensions` array (absolute path),
   spawn a session through the dashboard, `Read` a real oversize screenshot, and watch
   telemetry + `$TMPDIR/pi-image-fit/<sessionId>/<sha256>.png` + the dashboard preview.
6. Verify all four manual scenarios in one live session: oversize-rewrite, cache-hit,
   small-image pass-through, `PI_IMAGE_FIT_DISABLE=1`.
7. Add the new package to `.github/workflows/publish.yml` (allowlist) and a `qa/tests/`
   case (+ Windows `.ps1` peer); wire into `run-all.{sh,ps1}`.
8. Open the PR, **rebase onto develop, then push WITHOUT `[ci skip]`** so CI actually
   runs; fix any TS errors your own code introduced; poll `gh` until green.
9. Confirm Electron impact = zero (package is not in `BUNDLED_WORKSPACE_PKGS`).
10. Merge, then run the cleanup sequence (shutdown QA sessions, remove tmp dir, delete
    worktree + branch, prune refs).

## 3. How the collaboration unfolded

**Phase 1 — Proposal landing & rebase (prompts 1–2).** The AI committed the proposal to
`develop` with `[ci skip]`, rebased the worktree branch onto it, and pushed both. The
effective move: rebasing the worktree _before_ implementing so it inherited a
parallel session's sections 1–3 rather than colliding with them.

**Phase 2 — Apply the change (prompt 3).** `/skill:openspec-apply-change` drove 43
tasks. The AI **audited first** and found prior scaffolding (`package.json`, `cache.ts`,
`policy.ts`), rebased again to pick up commit `deceebc2`, then filled the gaps. Two real
bugs surfaced: a `jimp` import failure fixed by `npm install`, and a cache-sanitize bug
(2 failing tests). It reached 72/72 unit tests green, then handled the publish allowlist
contract test that blocks the suite.

**Phase 3 — Docs & skills (still prompt 3).** README + file-index + release-cut SKILL +
faq.md updated. The `Explore` subagent delegate was **blocked** (required `@fast` role
not configured), so the AI fell back to inline edits in caveman style — a good instinct:
don't stall the whole apply loop on an unavailable subagent.

**Phase 4 — Live verification (prompts 4–5).** The decisive human steer: _"Is it possible
to test in a local session?"_ then _"Can you make qa c/ smoke test with this pi-dashboard
session and browser tool?"_. This forced the integration boundary that unit tests can't
cover. The AI wired the extension into `.pi/settings.json`, spawned a dashboard session,
`Read` the 5116×2878 screenshot, and captured live telemetry
(`5116×2878 795.3KB → 1568×882 146.0KB`), the session-scoped temp file, and the inline
dashboard preview — then ran cache-hit / pass-through / disable in the same session.

**Phase 5 — Ship (prompts 6–10).** PR #66, rebase onto develop, **CI**. The AI caught
that its own image-fit code had broken develop's CI with two TS errors, fixed them,
re-pushed _without_ `[ci skip]`, and polled `gh` to green (lint + 6,901 tests + build +
CodeRabbit). It answered _"How is it affecting the electron bundles?"_ with a
design-grounded "zero" (package excluded from `BUNDLED_WORKSPACE_PKGS`), merged, and ran
the five-step cleanup.

## 4. Prompts that worked

- **Goal prompt (weak as written):** _"proposals on parent folder. Add and commit
  [ci skip] to develop and after rebase to develop"_ — terse and ambiguous. A stronger
  kickoff: _"Commit the `pi-image-fit-extension` proposal to develop with [ci skip],
  rebase the worktree branch onto it, then apply the change end-to-end and open a PR."_
- **High-leverage follow-up:** _"Is it possible to test in a local session?"_ — one
  question that redirected the AI from "unit tests already cover this" to actually
  proving the pi-runtime integration boundary live.
- **High-leverage follow-up:** _"Can you make qa c/ smoke test with this pi-dashboard
  session and browser tool?"_ — unlocked the full dashboard + browser verification loop.
- **Terse workflow drivers** (_"push"_, _"rebase develop"_, _"monitor CI"_, _"merge PR"_,
  _"cleanup"_) worked because the AI already held the full task context; each was a
  single-word unlock of the next ship phase.
- **Scope-probing follow-up:** _"How it effecting the electron bundles?"_ — forced a
  concrete bundle-impact answer instead of an assumption.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Treat unit tests as sufficient proof of the hook | "Is it possible to test in a local session?" | State up front: verify the integration boundary live (real pi session + real oversize asset), not just unit tests |
| Not reach for the dashboard/browser for live QA | "Can you make qa c/ smoke test with this pi-dashboard session and browser tool?" | Name the dashboard+browser QA loop as the acceptance step for any tool-hook change |
| Push with `[ci skip]` on every commit | "monitor CI" (which exposed that no CI had run) | Drop `[ci skip]` on the final PR push so CI actually runs before merge |
| Assume no Electron impact | "How it effecting the electron bundles?" | Explicitly check `BUNDLED_WORKSPACE_PKGS` for any new workspace package |

## 6. Skills, tools & memory created — and why they're effective

No new pi skill or memory was persisted this session, but two **reusable QA assets** were
produced and merged:

- **`qa/tests/09-image-fit-extension.sh` + `.ps1` peer** — a cross-platform smoke test
  wired into `run-all.{sh,ps1}`. It captures the install + dep-tree sanity that VMs
  uniquely catch (the package ships `.ts` sources, so plain `node` can't import without a
  TS loader — the test focuses on what actually differs per-OS). Invoke it in the QA
  matrix for any new workspace extension.
- **The live-dashboard verification pattern** is the real reusable artifact and _should_
  be captured as a skill: _wire extension into `.pi/settings.json` (top-level `extensions`
  array, absolute path) → spawn a dashboard session → Read an oversize asset → assert
  telemetry + `$TMPDIR/pi-image-fit/<sessionId>/<sha256>.png` + inline preview_. It removes
  the guesswork of proving a `tool_call` hook works end-to-end.

## 7. Pitfalls & dead ends

- **`jimp` import fails on a fresh worktree** → run `npm install` before assuming a code
  bug; the workspace wasn't hydrated.
- **`packages[].extensions` silently ignores your path** → that array filters from the
  source package's declared `pi.extensions`, and the monorepo root only declares the
  bridge. Load a local extension via the **top-level `extensions` array** with an absolute
  path instead.
- **`Explore` subagent dispatch blocked** (required `@fast` role not configured) → fall
  back to inline edits; don't stall the apply loop waiting on a subagent.
- **Every commit carried `[ci skip]`, so CI never ran** → the branch's own TS errors had
  broken develop's CI unnoticed. Push the final PR commit without `[ci skip]`.
- **Worktree cwd deleted during cleanup** → after removing the worktree, this session's
  cwd no longer exists on disk; spawn a fresh session in the project root for follow-ups.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** the OpenSpec change name (`pi-image-fit-extension`), a real
oversize asset (`docs/screenshots/Screenshot 2026-04-04 at 18.44.55.png`, 5116×2878),
a running dashboard + the `pi-dashboard` and `browser` skills.

- [ ] Commit proposal to develop `[ci skip]`; rebase worktree onto develop first.
- [ ] `/skill:openspec-apply-change pi-image-fit-extension`; audit existing scaffolding before writing.
- [ ] `npm install` on the worktree before trusting any import failure.
- [ ] Fix bugs to 72/72 unit green; satisfy the publish-allowlist contract test.
- [ ] Add package to `publish.yml`; add `qa/tests/09-*.sh` + `.ps1`; wire `run-all.*`.
- [ ] Wire extension into `.pi/settings.json` top-level `extensions` (absolute path).
- [ ] Spawn dashboard session; `Read` the oversize PNG; verify telemetry + temp file + preview.
- [ ] Verify cache-hit, small-image pass-through, `PI_IMAGE_FIT_DISABLE=1` in the same session.
- [ ] Open PR; rebase onto develop; push WITHOUT `[ci skip]`; fix your own TS errors; poll CI green.
- [ ] Confirm package is NOT in `BUNDLED_WORKSPACE_PKGS` (Electron impact zero).
- [ ] Merge; shutdown QA sessions, remove `$TMPDIR/pi-image-fit/`, delete worktree + branch, prune refs.

**Artifacts produced:** `packages/image-fit-extension/` (README, src, tests),
`qa/tests/09-image-fit-extension.{sh,ps1}`, updated `publish.yml` / `release-cut` SKILL /
`docs/faq.md` / `docs/file-index-extension.md`, merged PR #66 (`b8c1899d` on develop).

---

_Generated from session `019e7b7e` · `pi-agent-dashboard/.worktrees/os-pi-image-fit-extension` · 2026-05-31. Source extract: facts sheet (mktemp)._
