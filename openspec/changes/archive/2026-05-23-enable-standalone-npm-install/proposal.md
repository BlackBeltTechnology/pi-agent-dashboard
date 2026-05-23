## Why

`pi-dashboard` is intended to be installable as a plain npm package (`npm i -g @blackbelt-technology/pi-agent-dashboard`) and runnable without the Electron desktop app. Today that path is broken in a subtle way:

`packages/server/bin/pi-dashboard.mjs` resolves a TypeScript loader (`jiti`) from `process.argv[1]` and walks up `node_modules/` looking for `jiti/package.json`. `jiti` is **not** a direct dependency of any dashboard workspace package — it is only present transitively via `@earendil-works/pi-coding-agent` (pi), which is listed as an **optional peer dependency** of the root package. Result: a clean `npm i -g @blackbelt-technology/pi-agent-dashboard` followed by `pi-dashboard` exits with:

```
pi-dashboard: cannot find jiti. Install pi: 'npm install -g @earendil-works/pi-coding-agent'
```

This forces users into the Electron app (which pre-installs pi via its bundled-Node + bundled offline cache) even when all they want is the headless server + web UI. The Electron stub is also reported as buggy in some environments.

The fix is to make the dashboard server self-sufficient for boot. Pi is still required for spawning pi agent sessions, but the dashboard should be able to boot, serve the web UI, and then install pi into `~/.pi-dashboard/` on demand via the existing `bootstrapInstall` machinery — exactly what Electron does today, just done by the CLI itself.

## What Changes

- **Add `jiti` as a direct runtime dependency of `@blackbelt-technology/pi-dashboard-server`.** This is the smallest change that unblocks the bin wrapper: `createRequire(argv[1]).resolve("jiti/package.json")` will find it via Node's normal `node_modules` walk, regardless of install layout (flat, scoped, hoisted, pnpm).

- **~~Wire first-run bootstrap from an empty installable-list.~~** **REVERTED** — originally proposed but proved harmful by Docker smoke. Reason: `cli.ts::runDegradedModeBootstrap` (existing, runs AFTER `server.start()`) already detects an unresolvable pi via `ToolRegistry` and installs `@earendil-works/pi-coding-agent` + `@fission-ai/openspec` in the BACKGROUND with the exact same package set the proposal wanted to seed. Wiring `maybeSeedDefaultInstallableList()` into the startup path caused `bootstrapInstallFromList` to BLOCK on `npm install pi` before the HTTP listener was open, preventing the degraded-mode UI from coming up.

  The seed helper is kept as an exported utility in `cli.ts` (with a docstring explaining why it is NOT on the default path) for explicit callers that want to write the installable list out-of-band. The default `pi-dashboard` invocation relies on `runDegradedModeBootstrap` for first-run pi-install — unchanged from pre-existing behavior, which already handled this case correctly.

- **Improve the "cannot find jiti" error in `bin/pi-dashboard.mjs`** to mention that this should now be impossible from a clean npm install (with a "please file a bug" hint) and only fall back to the legacy "install pi" advice for corrupted trees.

- **Tighten the optional peerDependency story in the root `package.json`.** Pi remains optional (because the Bridge extension is loaded by pi, so a development install where pi-dashboard is consumed *by* pi still works), but the misleading "install hint" goes away from the happy path.

- **Documentation:** update `docs/service-bootstrap.md` and `docs/faq.md` to describe a true "standalone npm install" mode that does not require Electron. Today's "Standalone mode" section is implicitly Electron-only.

- **Tests:** extend the existing jiti-resolution test suite with a scenario where pi is absent and `jiti` lives in pi-dashboard-server's own `node_modules`. Add a bootstrap-from-empty-list test for the CLI startup path.

## Capabilities

### New Capabilities

_(none — composes existing bootstrap + static-serve capabilities)_

### Modified Capabilities

- `bootstrap-install`: extend to be triggerable from CLI first-run when `installable.json` is absent. Previously implicitly assumed Electron wizard had seeded the list.
- `dashboard-cli`: a stock `npm i -g @blackbelt-technology/pi-agent-dashboard && pi-dashboard` must boot to a usable web UI with **zero** prior installs and **no** other prompts. Pi gets installed in the background.

## Impact

- **Code (small, surgical):**
  - `packages/server/package.json` — add `"jiti": "^2.x"` to `dependencies`.
  - `packages/server/bin/pi-dashboard.mjs` — improve error message; resolution logic unchanged (already walks up via `argv[1]` anchor).
  - `packages/server/src/cli.ts` — when `bootstrapInstallFromList` finds no list and managed pi is absent, seed the default list before calling.
  - `packages/server/src/bootstrap-install-from-list.ts` — accept optional default packages parameter, or surface a "seed list" helper.

- **Tests:**
  - `packages/shared/src/__tests__/resolve-jiti.test.ts` — add "own-tree jiti, no pi" scenario.
  - New CLI bootstrap test covering empty-installable-list seeding (mock filesystem via memfs harness already in use for `__tests__/bootstrap/`).

- **Docs:**
  - `docs/service-bootstrap.md` — new "Standalone npm install" section above the existing Electron-coupled "Standalone mode".
  - `docs/faq.md` — update or add a "how do I install pi-dashboard via npm" entry pointing at the now-clean flow.
  - `docs/file-index-server.md` — note if any new file is added (likely none, only edits).

- **Backward compatibility:** Electron path unchanged — it still ships bundled pi via its wizard. The only new behavior is that the CLI now also knows how to bootstrap on its own. No config schema changes. No protocol changes.

- **Performance:** install size grows by jiti (~200 KB on disk, single small package, ESM-only). First-run experience on the npm path improves from "fatal error" to "UI in 1s, sessions in 10–30s once pi installs".

- **Risk:** the bootstrap-from-empty-list path runs `npm install` against the public registry. If the user is offline on first run, they get a clearly-surfaced bootstrap-failed state (existing UI). No regression vs Electron, which has the same dependency just with an offline-bundle escape hatch.

## Addendum — published-tarball packaging bugs (added 2026-05-19; revised against Docker baseline)

A `node:22-bookworm-slim` reproducer against published **v0.5.3** confirms two blocking bugs at install time and one further bug at runtime, all distinct from the proposal's task 1.1 jiti-direct-dep fix. Evidence: `docs/repro/v0.5.3-clean-node22-linux-x64-2026-05-19.log` + `docs/repro/v0.5.3-reproducer.sh`.

An earlier draft of this addendum listed two additional bugs (bin field pointing at `.ts`, missing `fix-pty-permissions.cjs`) that the Docker baseline refuted. v0.5.3's `package.json#bin` correctly targets `packages/server/bin/pi-dashboard.mjs` and the tarball ships the postinstall script. Those symptoms on the maintainer's machine were stale local state (old `npm link` from a renamed legacy package + corrupted npm cache). They are not in the table below.

| # | Symptom on clean Linux x64 | Root cause | Status |
|---|---|---|---|
| B' | `npm install -g @blackbelt-technology/pi-agent-dashboard@0.5.3` exits code 1 because `node-pty` postinstall runs `node-gyp rebuild` (no `linux-x64` prebuild in the bundled tree) and slim base images lack Python + C++ toolchain. | Missing `node-pty/prebuilds/linux-x64/` in v0.5.3's dep tree (upstream or our build-time install dropped it). | Hard install blocker. Fix in task 7.1. |
| C | After `--ignore-scripts` workaround: `pi-dashboard --version` exits with `cannot find jiti. Install pi: 'npm install -g @earendil-works/pi-coding-agent'`. `npm view ...@0.5.3 dependencies.jiti` returns nothing. | Task 1.1 (declare jiti as direct dep) landed in the workspace AFTER v0.5.3 was published. No release containing the fix has been cut. | Resolved by cutting a new release. Fix in task 7.2. |
| D | v0.5.3-only: `bin/pi-dashboard.mjs::JITI_PACKAGES` accepts `["jiti", "@mariozechner/jiti"]`; the v0.5.3 published `shared/src/resolve-jiti.ts` accepted `["@mariozechner/jiti", "@oh-my-pi/jiti"]`. After 7.2 declares plain `jiti`, the wrapper would find it but the daemon re-spawn would throw. | Two divergent jiti-package-name allowlists at v0.5.3 publish time. | **Already resolved in current workspace.** The archived `2026-05-08-migrate-pi-fork-to-earendil` change deleted `@oh-my-pi/jiti` from the codebase and renamed `resolve-jiti.ts` → `binary-lookup.ts`. Both lists now read `["jiti", "@mariozechner/jiti"]`. Task 7.3 reduces to a drift-prevention lint. |

Reproducer evidence:

- `STEP 1` of the log (lines 31–79): node-gyp Python-search failure, exit 1.
- `STEP 3` (lines 88–91): "cannot find jiti" wrapper error.
- `STEP 4` (lines 99–112): confirms `node_modules/jiti` is absent, while `fastify` and `@blackbelt-technology/pi-dashboard-web/dist/` ARE present — the rest of the tree is intact.
- `STEP 5` (lines 117–122): direct `node packages/server/src/cli.ts --version` fails with `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING` (Node 22 refuses to strip TS types inside `node_modules/`). Independent confirmation that running the `.ts` source directly is not a valid fallback on any OS.
- `STEP 6` (lines 137–157): tarball inspection. `bin: {"pi-dashboard":"packages/server/bin/pi-dashboard.mjs"}` (correct), wrapper file present, postinstall script present, `dependencies.jiti: (none)` (confirmed bug).

With hand-applied workarounds for B'/C/D, `pi-dashboard start` succeeded on the maintainer's macOS host. The Docker baseline did not test post-install runtime because the install itself blocks first. The bootstrap-install-from-list seed path (task 3.x) was therefore not exercised on a clean machine and remains untested end-to-end.

**Bumped risk:** without Phase 7 the proposal's promise ("a stock `npm i -g` boots to a usable web UI with **zero** prior installs and **no** other prompts") is not met in any published release. Phase 7 is a hard precondition for closing this change.
