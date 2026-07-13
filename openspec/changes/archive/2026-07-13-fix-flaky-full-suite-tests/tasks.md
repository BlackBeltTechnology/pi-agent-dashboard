# Tasks

## 1. Server test-timeout hardening

- [x] 1.1 Raise `testTimeout` to `30_000` in `packages/server/vitest.config.ts`
  with a rationale comment (fork-pool cold-transform starvation under the full
  suite).
- [x] 1.2 Verify: repeated full-package runs (`cd packages/server && vitest run`
  ×10) are clean; previously-flaky `recovery-offer`, `doctor-route`,
  `git-pr-operations`, `headless-shutdown-fallback` no longer time out.

## 2. Client async-race hardening

- [x] 2.1 `packages/client/src/test-support/virtualizer-jsdom.ts` —
  `configure({ asyncUtilTimeout: 5000 })` for global `waitFor` headroom.
- [x] 2.2 `packages/client/vitest.config.ts` — `testTimeout: 15_000` so longer
  polls fit the test budget.
- [x] 2.3 `chat-input-images-integration.test.tsx` — replace fixed-tick
  `flushFileReader()` with `waitFor` polling on the rendered thumbnail/state.
- [x] 2.4 `EditorFileTree.test.tsx` — wrap the bare `scrollSpy` assertion in
  `waitFor`; reset the shared `dirs` fixture in `beforeEach` (kill the
  end-of-test restore that cascaded on throw).
- [x] 2.5 Verify: edited client test files pass; repeated client-package runs
  clear the reproduced flakes (residual `CtxToolRenderer`/`DiagnosticsSection`
  are local-8-fork thrash only — pass 15/15 in isolation, out of scope).

## 3. Worktree init hardening (`.pi/settings.json`)

- [x] 3.1 `npm ci` → `(npm ci || npm install)` in `worktreeInit.run.command`
  (self-heal npm/cli#4828 without deleting the lockfile).
- [x] 3.2 `npx openspec` → `npx @fission-ai/openspec` (avoid the squatted
  `openspec@0.0.0` registry stub).
- [x] 3.3 Verify: `.pi/settings.json` is valid JSON; fresh worktree +
  `npx @fission-ai/openspec init --tools pi --force` regenerates all 8 opsx
  skills incl. `openspec-explore` (before: 1, after: 9).

## 4. Gates

- [x] 4.1 `npm run lint` (tsc) clean; no new Biome warnings (the `React`
  unused-import warnings are pre-existing).
- [x] 4.2 Root full suite (`npm test`) validated locally across repeated runs;
  CI confirmation (CI's ~2-fork runner is less contended than local) deferred to
  a later manual test pass.
