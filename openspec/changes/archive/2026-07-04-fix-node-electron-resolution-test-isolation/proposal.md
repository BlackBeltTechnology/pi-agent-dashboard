## Why

The tool-registry test `packages/shared/src/tool-registry/__tests__/node-electron-resolution.test.ts` — *"packaged Electron — bundled-node wins > npm (executor) resolves to bundled with argv = [bundled-npm]"* — is a **boomerang failure**: it fails on developer machines but passes in CI, so nearly every coding session inherits a red suite it did not cause.

Confirmed root cause (reproduced on this machine, not a version mismatch):

```
FAIL  node-electron-resolution.test.ts > npm (executor) resolves to bundled with argv = [bundled-npm]
AssertionError: expected [ …(2) ] to deeply equal [ Array(1) ]
  expected  [ "/Applications/PI-Dashboard.app/.../node/bin/npm" ]        (1 elem, from mock)
  received  [ "/Users/<user>/.pi-dashboard/node/bin/node", <script> ]    (2 elems, from real disk)
```

The test injects `exists`/`which` mocks, so step 1 (resolve the npm *path* → `BUNDLED_NPM`, `source: "bundled"`) passes. The failure is in step 2, `toArgv: nodeScriptToArgv`, which escapes the dependency-injection boundary:

1. `resolveJsScript(BUNDLED_NPM)` calls **real `realpathSync`**. On a dev box with the packaged app installed, `/Applications/PI-Dashboard.app/.../node/bin/npm` dereferences to a real `npm-cli.js` → the node-wrap branch fires. On clean CI it returns `null` → `argv = [BUNDLED_NPM]` → green.
2. Inside the wrap, `registry.resolve("node")` fails (correctly, under the mock), so `nodeScriptToArgv` falls back to **`process.execPath`** — which, on a dev box where `which node` is the managed runtime, is `~/.pi-dashboard/node/bin/node`. That real path leaks into `argv[0]`.
(Aside: the home-isolation guard `HOME=$(mktemp -d)` is not load-bearing here — neither `realpathSync` nor `process.execPath` consults `$HOME`, so the leak would bypass it regardless. The two leaks above are the whole mechanism.)

Two real, per-machine on-disk facts drive the leak — `/Applications/PI-Dashboard.app` (installed) and the managed `node` on `PATH` (= `process.execPath`). Neither depends on the repo checkout, so **a git worktree or a copied fork on the same machine reproduces it identically**. The only "workarounds" are destructive machine-state changes (uninstall the app, repoint `PATH`), not a real fix.

This is a **test-isolation defect**, not a resolution-behavior bug: `nodeScriptToArgv` has an injectable seam for `exists`/`which` but not for its `process.execPath` fallback nor for the `realpathSync` in `resolveJsScript`, so `resolveExecutor("npm")` reaches past the mocks into live machine state.

## What Changes

- **Close the isolation leak** so the test asserts against injected state only, with no real-disk reads. Candidate approaches (settled in `design.md`):
  - Give `nodeScriptToArgv` an injectable node-interpreter fallback (thread `deps.execPath` / a resolver seam through the registry `toArgv` context) whose **default stays `process.execPath`** — additive, runtime-identical.
  - And/or make `resolveJsScript`'s `realpathSync` go through the injected `exists`/fs seam so a fake `BUNDLED_*` path cannot dereference to a real script.
  - And/or have the test inject a `node` resolution (mock `which`/`exists`) so `registry.resolve("node")` succeeds deterministically and the `process.execPath` fallback never runs.
- **No change to runtime resolution behavior** on any platform, and **no change to the Electron spawn path**. The `process.execPath` default is preserved; the fallback only fires on a corrupted install, exactly as today.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `tool-registry`: the Node-script `toArgv` transform (`nodeScriptToArgv`) and JS-entry resolution (`resolveJsScript`) SHALL be fully drivable from injected dependencies under test — no `process.execPath` fallback and no `realpathSync` against the real filesystem when a test supplies `exists`/`execPath` seams — so executor resolution is deterministic regardless of the host machine's installed apps or `PATH`.

## Impact

- `packages/shared/src/tool-registry/definitions.ts` — `nodeScriptToArgv` (injectable execPath fallback, default `process.execPath`) and/or `resolveJsScript` (route `realpathSync` through the injected fs seam).
- `packages/shared/src/tool-registry/types.ts` — extend the `toArgv` context / `StrategyDeps` with an optional `execPath` (and, if needed, `realpath`) seam.
- `packages/shared/src/tool-registry/__tests__/node-electron-resolution.test.ts` — inject the node resolution / execPath so the executor cases assert against mocked state only.
- **Electron build: no impact.** Change is additive with `process.execPath` defaults preserved; the `no-electron-execpath-spawn` lint scans only `packages/electron/src/lib/**` (not `shared/tool-registry`), so it is not tripped, and healthy packaged-Electron resolution (`bundledNodeStrategy` finds `<resourcesPath>/node/bin/node`) never reaches the touched fallback.

## Verification

- Pre-fix (dev box with app installed + managed node on PATH): `HOME=$(mktemp -d) npx vitest run packages/shared/src/tool-registry/__tests__/node-electron-resolution.test.ts` → 1 failed (`argv` leaks `~/.pi-dashboard/node/bin/node`).
- Post-fix: same command → 9 passed, with **no** real-path string (`/Applications/PI-Dashboard.app`, `~/.pi-dashboard`) appearing in the resolved argv.
- Regression guard: full `npm test` green; Electron package/build unchanged (no edits under `packages/electron/`); `no-electron-execpath-spawn` lint still passes.
