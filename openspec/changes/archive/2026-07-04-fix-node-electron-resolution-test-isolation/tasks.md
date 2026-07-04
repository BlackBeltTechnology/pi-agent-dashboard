# Tasks

## 1. Reproduce & pin the leak
- [x] 1.1 Confirm failure on this machine: `HOME=$(mktemp -d) npx vitest run packages/shared/src/tool-registry/__tests__/node-electron-resolution.test.ts` → `argv[0]` leaks `~/.pi-dashboard/node/bin/node`. → verify: 1 failed, received path is real managed node.
- [x] 1.2 Record the two leak sources: `resolveJsScript` → `realpathSync` (leak A, `/Applications/PI-Dashboard.app`); `nodeScriptToArgv` → `process.execPath` fallback (leak B). → verify: both cited in test comment.

## 2. Add injection seams (source)
- [x] 2.1 `types.ts`: add optional `execPath?: string` to the `toArgv` context and/or `StrategyDeps`. → verify: `tsc --noEmit` clean.
- [x] 2.2 `definitions.ts` `nodeScriptToArgv`: use `ctx.execPath ?? process.execPath`. → verify: default path unchanged; existing tests pass.
- [x] 2.3 `definitions.ts` `resolveJsScript`: route `realpathSync` through an injected `realpath`/`exists` seam, default real fs. → verify: production default = `realpathSync`.

## 3. Isolate the test
- [x] 3.1 In `node-electron-resolution.test.ts`, inject `execPath` and a fake `realpath`/`exists` (or a succeeding `node` resolution) so executor cases assert against mocked state only. → verify: no real-path string in resolved argv.
- [x] 3.2 Add an assertion that the resolved argv contains **no** `/Applications/PI-Dashboard.app` or `.pi-dashboard` substring. → verify: guard fails pre-fix, passes post-fix.

## 4. Regression + Electron-safety gates
- [x] 4.1 `HOME=$(mktemp -d) npx vitest run .../node-electron-resolution.test.ts` → 9 passed. → verify: green.
- [x] 4.2 Full `npm test` → green (no other tool-registry regressions). → verify: exit 0.
- [x] 4.3 `no-electron-execpath-spawn` lint test still passes; no files under `packages/electron/` changed. → verify: `git diff --name-only` shows only `packages/shared/**`.
- [x] 4.4 Confirm no runtime change on healthy Electron path: `bundledNodeStrategy("node")` still short-circuits before the touched fallback (reasoned/asserted in a unit case). → verify: bundled-node case unchanged.

## 5. Close out
- [x] 5.1 `openspec validate fix-node-electron-resolution-test-isolation --strict`. → verify: passes.
- [x] 5.2 Note the deferred adjacent bug (execPath fallback under corrupted Electron lacks `ELECTRON_RUN_AS_NODE=1`) for a future change. → verify: recorded in design Non-Goals.
