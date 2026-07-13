## Why

Two pre-existing reliability defects that both surface only outside a clean,
isolated run — so they slip past `pass-in-isolation` checks and bite in the full
suite / in freshly-created worktrees.

1. **Flaky full-suite tests.** ~20 tests fail intermittently under the full
   parallel run but pass in isolation. Root cause is **CPU oversubscription**:
   Vitest `pool:"forks"` + `maxWorkers:"50%"` gives each fork its own unshared
   vite transform cache, and server tests re-`import("../server.js")` after
   `vi.resetModules()` in a `boot()` helper, so the transform tree is
   cold-recompiled repeatedly (~90s aggregate) and starves async work. This
   produces two symptom classes: server boot/git/subprocess tests exceed the 5s
   default timeout, and client jsdom tests lose async-completion races
   (`waitFor` polls exceeding 1000ms, a fixed-tick FileReader flush, a bare
   `expect(mock).toHaveBeenCalled()`, and a shared fixture restored only at a
   test's end so a throw cascades into an unrelated test).

2. **Worktree init silently skips the OpenSpec (opsx) skills.** The
   `.pi/settings.json` `worktreeInit` hook regenerates the gitignored
   `.pi/skills/openspec-*` skills via `npx openspec init`. But the `openspec`
   binary is provided by the **scoped** package `@fission-ai/openspec`, while a
   squatted **`openspec@0.0.0`** stub exists on npm. When the local
   `.bin/openspec` is not resolvable from the worktree root (hoisting/install
   timing/npx cache), bare `npx openspec` fetches the `0.0.0` stub, whose `init`
   creates nothing — yet the `&&` chain still exits 0. Every existing worktree
   is missing `openspec-explore`. The hook's `npm ci` also had no fallback for
   the known npm/cli#4828 optional-deps failure that CI already guards.

## What Changes

**Test reliability (behavior-preserving)**

- `packages/server/vitest.config.ts` — raise package `testTimeout` to `30_000`
  so boot/git/subprocess tests stop tripping under contention. Fast tests are
  unaffected; a genuine hang still fails, just at 30s.
- `packages/client/vitest.config.ts` — raise package `testTimeout` to `15_000`.
- `packages/client/src/test-support/virtualizer-jsdom.ts` — global
  `configure({ asyncUtilTimeout: 5000 })` so all `waitFor`/`findBy*` polls get
  headroom under load (43 client test files use `waitFor`; only 1 used a
  fixed-tick flush).
- `packages/client/src/__tests__/chat-input-images-integration.test.tsx` —
  replace the fixed two-tick `flushFileReader()` with `waitFor` polling on the
  actual DOM result (the FileReader→state→re-render is async).
- `packages/client/src/components/editor-pane/__tests__/EditorFileTree.test.tsx`
  — wrap the racy bare `expect(scrollSpy).toHaveBeenCalled()` in `waitFor`, and
  reset the shared module-level `dirs` fixture in `beforeEach` instead of at a
  test's end (the end-restore was skipped on throw, cascading a single race
  failure into an unrelated `.git` test).

**Worktree init hardening (`.pi/settings.json` → `worktreeInit.run.command`)**

- `npm ci` → `(npm ci || npm install)` — self-heal the hard-failure path
  (npm/cli#4828 optional-deps) so init never aborts the `&&` chain. Worktree-safe
  (no lockfile deletion, unlike CI's variant, which would dirty tracked state).
- `npx openspec` → `npx @fission-ai/openspec` — name the scoped package so npx
  resolves the real CLI (or fetches the correct package) and can never invoke
  the squatted `openspec@0.0.0` stub.

Non-goals: no change to `maxWorkers`/`pool` (the timeout/async-headroom knobs fix
the flakes without slowing the suite), no rewrite of the `boot()` helper, no
change to the `worktreeInit` gate (it correctly re-triggers on missing skills),
no backfill of existing broken worktrees (documented as a manual one-liner).

## Impact

- Test infra only for the flakiness fixes — no product code, no spec behavior
  change. Verified: server package 10/10 clean under repeated full-package
  stress; root full suite clean across repeated runs; edited client tests pass.
- `.pi/settings.json` worktreeInit command — future worktrees reliably install
  dependencies and regenerate the opsx skills. Proven end-to-end: fresh worktree
  + scoped init created all 8 opsx skills (`openspec-explore`, `-apply-change`,
  … + the `/opsx:` commands).
- Existing broken worktrees can be backfilled manually:
  `cd <worktree> && npx @fission-ai/openspec init --tools pi --force` (safe — the
  `.pi/skills/openspec-*` dirs are gitignored).

## Discipline Skills

- `systematic-debugging` — reproduce-before-fix on both defects (loop the suite
  to catch the flake; run a real worktree `npm ci` + scoped init to prove the
  opsx-skill footgun and its fix).
