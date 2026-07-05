## 1. Reproduce & pin topology

- [x] 1.1 Add a failing unit test in `packages/shared/src/tool-registry/__tests__/` asserting that resolving `openspec` on unix yields a node-wrapped argv (`[<node>, .../bin/openspec.js]`), NOT the bare `.bin/openspec` shebang symlink. Test must fail against current code. (`openspec-unix-node-wrap.test.ts`)
- [ ] 1.2 (DEFERRED — needs affected macOS bundle) On the affected macOS bundle, capture `pickNodeForServer` result (bundled `<resources>/node/bin/node` vs `execpath-fallback`) to confirm whether the `ELECTRON_RUN_AS_NODE` fallback branch is exercised in practice (resolves Open Question 1 in design.md). Fallback implemented defensively regardless (runner sets `ELECTRON_RUN_AS_NODE=1` when node-wrap lands on the Electron `process.execPath`).

## 2. Node-wrap unix Node-script executor spawns (Decision 1)

- [x] 2.1 In `packages/shared/src/tool-registry/definitions.ts`, generalize `nodeScriptToArgv` to node-wrap `.js` resolved paths on unix as well as win32: when `/\.js$/` matches, return `[nodePath, resolvedPath]`; `nodePath` from `registry.resolve("node")`, falling back to `process.execPath` only when it is a real node.
- [x] 2.2 Ensure the resolved openspec/pi path is the `.js` entry, not the `.bin` shebang symlink: dereference the `.bin` symlink to its `.js` target (`resolveJsScript` via `realpathSync`, unix-only) before `toArgv`. (`bare-import` already ordered ahead of `managedBin` on unix.)
- [x] 2.3 Handle the `ELECTRON_RUN_AS_NODE` edge: when the node-wrap falls back to `process.execPath` and that is the Electron binary, set `ELECTRON_RUN_AS_NODE=1` on that child spawn's env so it runs as node. (Done in `runner.ts::buildSpawnEnvForArgv`.)
- [x] 2.4 Preserve the existing Windows `[node.exe, script.js]` branch byte-for-byte (no regression). (`resolveJsScript` skips the deref on win32; `node-script-toargv-fallback.test.ts` still green.)

## 3. Seed real node dir into buildSpawnEnv (Decision 2, defense-in-depth)

- [x] 3.1 Defense-in-depth (real node bin dir on child PATH): **already provided by existing code**, no new `buildSpawnEnv` change needed. `process-manager.buildSpawnEnv` wraps `resolver.buildSpawnEnv` with `prependManagedNodeToPath` (seeds `~/.pi-dashboard/node/bin` at PATH head); `server-launcher` + `electron/launch-source` construct the resolver with `processExecPath: pick.nodeBin` (the picked real node), so `dirname(nodeBin)` is already prepended. A duplicate prepend inside the shared `ToolResolver.buildSpawnEnv` was implemented then **reverted** — it was redundant and its extra `existsSync`/`os.homedir()` widened a pre-existing cross-file `HOME`-mutation race that flaked `process-manager-managed-path.test.ts` in CI. The real fix is Decision 1 (node-wrap via the runner, which does not use `buildSpawnEnv`).
- [x] 3.2 Duplicate-PATH guard: existing `prependManagedNodeToPath` already dedups via `currentPath.split(delimiter).includes(dir)`; no change needed.

## 4. Surface CLI-read failure instead of empty degradation (Decision 3)

- [x] 4.1 In `packages/server/src/routes/openspec-routes.ts`, change `GET /api/openspec/config` to use `configListAsync` (Result), inspect `.ok`, and on failure return a distinct signal instead of `200 { workflows: [] }`. **Open Question 2 settled: HTTP `502 { success:false, error }`** (client already throws on `!res.ok`). Failed reads are NOT cached (retry re-attempts).
- [x] 4.2 Keep the successful-read path intact, including the `custom` + expanded-set → `expanded` alias mapping.
- [x] 4.3 Propagate the failure signal from `fetchGlobalOpenSpecConfig` distinctly from an empty/custom profile. Satisfied by existing client code: `fetchGlobalOpenSpecConfig` `throw`s on the 502 (`!res.ok`), which is distinct from a resolved empty/custom config.
- [x] 4.4 Render a recoverable "couldn't read OpenSpec config" error state (with retry). Satisfied by the existing `OpenSpecProfileSection` `loadStatus === "error"` path + `profile-load-retry` button (added by `fix-openspec-profile-load-race`) — now reached because the server returns 502 on read failure instead of a fake-empty profile.

## 5. Tests & verification

- [x] 5.1 Make task 1.1's test pass; add a unix + win32 argv matrix test for `nodeScriptToArgv` covering `.js` node-wrap and non-`.js` passthrough. (`node-script-argv-matrix.test.ts`)
- [x] 5.2 Add a test that a stripped-PATH spawn of the resolved openspec argv executes successfully (no `env: node` / exit 127). (`node-script-argv-matrix.test.ts` — real spawn with `env: { PATH: "" }`.)
- [x] 5.3 Add a route test: `GET /api/openspec/config` returns the error state (not empty profile) when the CLI read fails, and returns `expanded` for a `custom`+expanded-set config on success. (`openspec-profile-routes.test.ts` — new 502 + no-cache tests; expanded-alias test pre-existing.)
- [x] 5.4 Run `npm test` — no failures in touched areas. Only pre-existing failures are `@blackbelt-technology/pi-image-fit-extension` (`Jimp is not a constructor`, untouched package).
- [x] 5.4a End-to-end runner integration test in CI: drives the REAL `OPENSPEC_CONFIG_LIST` recipe through `run` + `runAsync` with `env: { PATH: "" }` and a managed-bin `.bin/openspec` shebang-symlink topology (the confirmed macOS bug env), asserting success where a CONTROL raw-shebang spawn exits 127. Closes most of task 1.2's intent (the failing spawn env) in CI without a real bundle. (`openspec-runner-stripped-path.integration.test.ts`)
- [ ] 5.5 (DEFERRED — manual macOS bundle DOM check; superseded as a CI gate by 5.6 below, kept only as an optional human backstop)
- [x] 5.6 Bundled-Electron launch-smoke openspec assertion (CI regression gate on the real failing topology). Extended `qa/tests/09-electron-mac-launch.sh` (macos-14 arm64 + macos-15-intel x64) and `qa/tests/08-electron-real-launch.sh` (linux). BEFORE launch, seed: (a) a fake `~/.pi-dashboard/node_modules/.bin/openspec` as a `#!/usr/bin/env node` shebang script that answers `config list --json` with a known profile, and (b) `~/.config/openspec/config.json`. AFTER `/api/health`, assert `GET /api/openspec/config` returns HTTP 200 + the seeded profile (NOT 502, NOT empty). "Both" strength: strong assert when the seed is in place; gracefully SKIP (exit 0) only if the seed cannot be created. Rides the existing `_electron-build.yml` “Launch-smoke the .app” step — direct-execs the inner Mach-O so `process.execPath` is the Electron binary (the `execpath-fallback` topology). Pre-fix the seeded openspec dies exit-127 → smoke fails; post-fix node-wrap resolves it → passes. Closes 1.2 / 5.5 in CI. Manual bundle check: rebuild the Electron bundle, open Settings on macOS, confirm the OpenSpec profile loads (`expanded`, 10 workflows) instead of "not found."

## 6. Land

- [x] 6.1 Run the code-review gate (`npx tsx .pi/skills/implement/scripts/review-changes.ts`). CodeRabbit CLI not installed on this host → advisory gate warned-and-continued (exit 0), deferred to a later cycle per the documented rate-limit/missing-CLI behavior. No Critical/Warning items to address from the gate.
- [ ] 6.2 (DEFERRED — worktree-isolated) Full rebuild + restart per the build matrix. Per AGENTS.md, `full-rebuild.ts` deploys the checked-out dev version to the local running instance and is NOT run for worktree / Docker-isolated work. Changes touch `shared` + `server` (→ restart) and no client source (client fix reuses the existing error state) — deploy happens at merge/release, not from this worktree.
