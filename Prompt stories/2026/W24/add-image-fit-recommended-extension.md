---
session: 019ebdd7
week: 2026/W24
type: development
model: "@fast"
premium: true
premium_reason: "heavy steering (8 user prompts)"
upgrade_status: pending
openspec_changes: [add-image-fit-recommended-extension]
proposal_excerpt: "`@blackbelt-technology/pi-image-fit` is a first-party, pure-JS pi extension that ships from this monorepo (`packages/image-fit-extension/`) and transparently downsizes oversize images before they reach the model — sav…"
---

# How we did it: add pi-image-fit to Recommended Extensions — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The kickoff was a single skill invocation:

```
/skill:openspec-apply-change add-image-fit-recommended-extension
```

The literal ask was "implement the OpenSpec change." But the *real* objective — which
only emerged through the steering turns — was to ship a feature **end-to-end**: add the
seventh `RECOMMENDED_EXTENSIONS` manifest entry for `@blackbelt-technology/pi-image-fit`,
**publish that package to npm for the first time** (so the manifest's `npm:` source
actually resolves), then commit → PR → green CI → squash-merge → tear down the worktree.
The code change was tiny (one manifest object + test updates); the real work was the
release + ship pipeline around it.

## 2. TL;DR playbook

1. `/skill:openspec-apply-change <change>` — let the apply skill drive tasks.md; it adds
   the manifest entry and updates the co-located tests.
2. When exact-set assertions break (`toHaveLength(6)`, id-set snapshots), **grep the
   whole repo for the old count** before assuming the tasks list named every affected test.
3. Run package tests with an **ephemeral HOME** (`HOME=$(mktemp -d) npx vitest run …`) so
   they don't touch your real config.
4. Worktrees have **no `node_modules`** — run dependency-touching tests from the *main
   checkout* after confirming the source is byte-identical (`diff -rq`).
5. `/skill:openspec-verify-change <change>` — confirm 7/7 tasks + scenarios covered before
   moving to release.
6. For an **initial npm publish**: `npm pack --dry-run` first, check auth with
   `npm whoami`. If 401, have the human create an **automation token** (bypasses 2FA) and
   set it via `npm config set //registry.npmjs.org/:_authToken npm_…` — never interactive
   `npm login`/OTP in an agent loop.
7. `npm publish` (relies on `publishConfig.access=public`), then verify with
   `npm view <pkg> version`.
8. Commit only the **feature files** (stage explicitly; exclude machine-local
   `.pi/settings.json`), push to the existing branch, `gh run watch` CI to green.
9. `gh pr merge <n> --squash --delete-branch`, then finish worktree teardown from the
   **main checkout** (`git worktree remove --force …`; delete local + remote branch).

## 3. How the collaboration unfolded

**Phase 1 — Apply the change (Discovery + Implement).** The AI located the change dir,
read context files, and worked tasks.md: added the manifest entry in
`packages/shared/src/recommended-extensions.ts`, then retargeted **three** exact-set
assertions in `recommended-extensions.test.ts` (six→seven id set, npm-prefix set,
optional-status set). It hit one dead end — an invalid `no_overlap` test key — and retried
cleanly. Type-check surfaced a **pre-existing, unrelated** `error-patterns.test.ts` error,
correctly identified as not-introduced. Task 3.2 (manual card render) was marked
"verified-by-mechanism" because the live :8000 server runs the *main checkout*, not the
worktree, and the change is data-only.

**Phase 2 — Verify.** `/skill:openspec-verify-change` produced a completeness/correctness/
coherence report: 7/7 tasks, 4/4 scenarios (3 by test, 1 by mechanism). Green gate to move on.

**Phase 3 — Initial npm publish (the hard part).** The human redirected: "create package
in npmjs… release 0.5.4 manually." The AI discovered the package was a 404 (initial
publish), npm auth was 401 (expired token), and the worktree had no `node_modules`. It
`npm pack --dry-run`'d, noticed the tarball shipped `src/__tests__/*.test.ts`, trimmed
`files` to `["src/", "!src/__tests__", "README.md"]` (flagging that this **diverges** from
sibling packages), and confirmed the source was healthy by running tests in the main
checkout — where the only 2 "failures" were 5s-timeout flakes on cold jimp JPEG encode
(72/72 with a 30s timeout). Auth stalled on OTP; the AI steered the human to an
**automation token** instead of interactive OTP. Then `npm publish` → live, verified.

**Phase 4 — Ship (commit → PR → CI).** The AI staged only feature files (excluding a
machine-local `.pi/settings.json` absolute-path edit), found PR **#102 already existed**,
committed onto the branch, pushed, and `gh run watch`'d. CI caught a **hidden 7th-entry
assertion** in `packages/server/src/__tests__/recommended-routes.test.ts:211` that wasn't
in tasks.md. The AI grepped the repo to confirm no *other* count assertions were affected,
fixed 6→7, re-pushed, and watched to green.

**Phase 5 — Merge + teardown.** `gh pr merge 102 --squash --delete-branch` merged
(`58ead77`) but local branch delete failed (develop checked out in main worktree). The AI
finished from the main checkout: force-removed the worktree (only the deliberately-excluded
`.pi/settings.json` remained), deleted local + remote branch, pruned refs.

## 4. Prompts that worked

- **Goal prompt** — `/skill:openspec-apply-change add-image-fit-recommended-extension`.
  Effective because the change was already scoped in OpenSpec; the skill drove tasks
  deterministically. *Stronger kickoff:* state the full intent up front —
  "apply the change, then publish the package to npm and ship the PR to green" — so the AI
  plans the whole pipeline instead of stopping at 7/7 tasks.
- **`create package in npmjs. To achive that I need to release the 0.5.4 manually`** —
  high-leverage: expanded scope from "code change" to "release," which was the actual work.
- **`I logged in` / `proceed`** — short unlock signals after the human completed the
  out-of-band auth step. Effective because the AI had staged everything and only waited on
  the human-only action (auth).
- **`commit, push, create PR and monitor CI`** — one prompt that authorized the whole ship
  sub-pipeline including the CI watch loop.
- **`merge, delete branch, worktree`** — terse but complete teardown authorization.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Stop at "7/7 tasks complete" (apply skill's scope) | `create package in npmjs… release 0.5.4 manually` | State the full end-to-end goal (apply → publish → ship) in the first prompt |
| Get blocked, saying "stuck" mid-apply | `stuck` (nudge) then re-issue verify | Give the AT the whole pipeline so it doesn't stall at a skill boundary |
| Reach for interactive `npm login` / ask for a 2FA OTP | (human) chose the token route | Prefer an **automation token** for agent-driven publishes; OTP can't be automated |
| Trust tasks.md as the complete list of affected tests | CI failure on `recommended-routes.test.ts:211` | Grep the repo for the changed invariant (old count / id set) before pushing |
| Consider committing every dirty file | (AI self-caught) excluded `.pi/settings.json` | Stage feature files explicitly; treat `.pi/settings.json` as machine-local |

## 6. Skills, tools & memory created — and why they're effective

No new skill or memory was created. The session was driven by **existing** skills —
`openspec-apply-change` and `openspec-verify-change` — plus one subagent spawn
(`general-purpose`) to update the `docs/file-index-shared.md` row per the caveman-style
docs-delegation rule.

**Recommended skill to create:** a `publish-monorepo-package` procedure capturing the
initial-publish path this session reinvented: `npm pack --dry-run` review → auth check
(`npm whoami`, prefer automation token over OTP) → source-health check from the main
checkout when the worktree lacks `node_modules` → `npm publish` → `npm view` verify. That
would remove the ~30 min of trial-and-error around auth and the tarball `files` trim.

## 7. Pitfalls & dead ends

- **Worktree has no `node_modules`.** Dependency-touching tests fail with cryptic errors
  (`JimpMime is undefined`). Fix: confirm `diff -rq` source parity with main, then run the
  suite from the main checkout.
- **Invalid test key** (`no_overlap`) — an initial edit added a non-schema key; retried
  without it. Read the test's shape before adding assertions.
- **npm OTP in an agent loop is a dead end.** You cannot see the authenticator. Use an
  automation token set via `npm config set …:_authToken` instead.
- **tasks.md under-lists affected tests.** A hidden `toHaveLength(6)` in
  `recommended-routes.test.ts` broke CI. Grep the whole repo for the old invariant before
  pushing.
- **Tarball ships tests** because `files: ["src/"]` is a directory glob — trimming to
  `["src/", "!src/__tests__", "README.md"]` cut 13.9 kB→8.4 kB, but **diverges** from
  sibling packages (all ship tests). Flag the inconsistency; don't silently diverge.
- **Cold jimp JPEG encode is timing-flaky** at the default 5s vitest timeout. Re-run the 2
  suspects with `--testTimeout=30000` before concluding a real defect (they passed 72/72).
- **`--delete-branch` fails on the local step** when `develop` is checked out in the main
  worktree. Finish teardown from the main checkout with `git worktree remove --force`.

## 8. Reproduce it faster — checklist

**Inputs to have ready**
- An OpenSpec change already scoped under `openspec/changes/<name>/`.
- npm publish rights on the scope + an **automation token** (not just an interactive login).
- The main checkout available (for dependency-backed test runs the worktree can't do).

**Steps**
1. `/skill:openspec-apply-change <name>` → implement manifest + co-located tests.
2. Grep repo for the changed invariant (old count / id set); fix every hit, not just tasks.md.
3. `HOME=$(mktemp -d) npx vitest run …` for clean package tests; run dep-backed tests from main.
4. `/skill:openspec-verify-change <name>` → 7/7 + scenarios.
5. `npm pack --dry-run`; trim `files` if tests leak (flag divergence); `npm whoami`.
6. If 401: automation token → `npm config set //registry.npmjs.org/:_authToken npm_…`.
7. `npm publish` → `npm view <pkg> version` verify.
8. Stage feature files only (exclude `.pi/settings.json`); commit; push to existing branch.
9. `gh run watch <run-id>` to green (fix hidden assertions CI surfaces).
10. `gh pr merge <n> --squash --delete-branch`; finish worktree teardown from main checkout.

**Final artifacts**
- `@blackbelt-technology/pi-image-fit@0.5.4` published to npm (initial, `latest`, public).
- `packages/shared/src/recommended-extensions.ts` — 7th manifest entry.
- `packages/shared/src/__tests__/recommended-extensions.test.ts` + `packages/server/src/__tests__/recommended-routes.test.ts` — count/set assertions updated 6→7.
- PR #102 squash-merged to `develop` (`58ead77`); worktree + branches removed.

---

_Generated from session `019ebdd7` · `pi-agent-dashboard` · 2026-06-13. Source extract: `/var/folders/qb/.../facts.XXXXXX.Q6YaStKaZj.md`._
