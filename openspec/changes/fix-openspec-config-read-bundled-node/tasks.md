## 1. Reproduce & pin topology

- [ ] 1.1 Add a failing unit test in `packages/shared/src/tool-registry/__tests__/` asserting that resolving `openspec` on unix yields a node-wrapped argv (`[<node>, .../bin/openspec.js]`), NOT the bare `.bin/openspec` shebang symlink. Test must fail against current code.
- [ ] 1.2 On the affected macOS bundle, capture `pickNodeForServer` result (bundled `<resources>/node/bin/node` vs `execpath-fallback`) to confirm whether the `ELECTRON_RUN_AS_NODE` fallback branch is exercised in practice (resolves Open Question 1 in design.md).

## 2. Node-wrap unix Node-script executor spawns (Decision 1)

- [ ] 2.1 In `packages/shared/src/tool-registry/definitions.ts`, generalize `nodeScriptToArgv` to node-wrap `.js` resolved paths on unix as well as win32: when `/\.js$/` matches, return `[nodePath, resolvedPath]`; `nodePath` from `registry.resolve("node")`, falling back to `process.execPath` only when it is a real node.
- [ ] 2.2 Ensure the resolved openspec/pi path is the `.js` entry, not the `.bin` shebang symlink: order `bare-import` / `managedModule` strategies ahead of `managedBin` on unix, OR dereference the `.bin` symlink to its `.js` target before `toArgv`.
- [ ] 2.3 Handle the `ELECTRON_RUN_AS_NODE` edge: when the node-wrap falls back to `process.execPath` and that is the Electron binary, set `ELECTRON_RUN_AS_NODE=1` on that child spawn's env so it runs as node.
- [ ] 2.4 Preserve the existing Windows `[node.exe, script.js]` branch byte-for-byte (no regression).

## 3. Seed real node dir into buildSpawnEnv (Decision 2, defense-in-depth)

- [ ] 3.1 In `packages/shared/src/platform/binary-lookup.ts`, extend `buildSpawnEnv` to prepend the resolved node bin dir and, when present, the managed `~/.pi-dashboard/node/bin` to the child PATH.
- [ ] 3.2 Guard against duplicate PATH entries (reuse the existing `currentPath.includes(dir)` pattern).

## 4. Surface CLI-read failure instead of empty degradation (Decision 3)

- [ ] 4.1 In `packages/server/src/routes/openspec-routes.ts`, change `GET /api/openspec/config` to use `configListAsync` (Result), inspect `.ok`, and on failure return a distinct signal instead of `200 { workflows: [] }` (settle HTTP-error vs `{ readError: true }` per design Open Question 2).
- [ ] 4.2 Keep the successful-read path intact, including the `custom` + expanded-set → `expanded` alias mapping.
- [ ] 4.3 In `packages/client/src/lib/openspec-config-api.ts`, propagate the failure signal from `fetchGlobalOpenSpecConfig` distinctly from an empty/custom profile.
- [ ] 4.4 In the Settings panel, render a recoverable "couldn't read OpenSpec config" error state (with retry) distinct from a genuine empty/custom profile.

## 5. Tests & verification

- [ ] 5.1 Make task 1.1's test pass; add a unix + win32 argv matrix test for `nodeScriptToArgv` covering `.js` node-wrap and non-`.js` passthrough.
- [ ] 5.2 Add a test that a stripped-PATH spawn of the resolved openspec argv executes successfully (no `env: node` / exit 127) — mock or integration per existing test conventions.
- [ ] 5.3 Add a route test: `GET /api/openspec/config` returns the error state (not empty profile) when the CLI read fails, and returns `expanded` for a `custom`+expanded-set config on success.
- [ ] 5.4 Run `npm test 2>&1 | tee /tmp/pi-test.log` and confirm no failures (`grep -nE 'FAIL|Error|✗' /tmp/pi-test.log`).
- [ ] 5.5 Manual bundle check: rebuild the Electron bundle, open Settings on macOS, confirm the OpenSpec profile loads (`expanded`, 10 workflows) instead of "not found."

## 6. Land

- [ ] 6.1 Run the code-review gate (`npx tsx .pi/skills/implement/scripts/review-changes.ts`) and address Critical/Warning items.
- [ ] 6.2 Full rebuild + restart per the build matrix (shared/server change → restart; client change → `npm run build` + restart), then reload pi sessions.
