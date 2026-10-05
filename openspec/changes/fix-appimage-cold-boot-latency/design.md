## Context

See proposal.md (Why) for the spike timing table. Facts below come from reading the code and
from the spike runs.

**Today: jiti everywhere.**
- `launchDashboardServer` resolves its loader with `ToolResolver.resolveJiti({ anchor })`
  (`packages/shared/src/server-launcher.ts:230`). It throws `JitiNotFoundError` when that resolves
  to null (`server-launcher.ts:41-48`).
- The pre-loader CLI wrapper resolves jiti itself from `process.argv[1]`
  (`packages/server/bin/pi-dashboard.mjs:64-100`, `JITI_PACKAGES = ["jiti", "@mariozechner/jiti"]`).
  It exits 1 with the "cannot find jiti" hint when the lookup fails.
- The Electron launch helpers `packages/electron/scripts/server-launch-helpers/start-server.{sh,cmd,ps1}`
  hard-code the jiti register path (`start-server.sh:44-49`).
- The bundled-server plugin-load build gate hard-codes jiti
  (`packages/electron/scripts/assert-bundled-server-plugin-load.mjs:55,154,206`).
- The Electron Doctor launch test builds `--import <jitiUrl>` and reports "No jiti loader" when
  that lookup fails (`packages/electron/src/lib/doctor.ts:397-451`).

**jiti default cache on a read-only bundle.** jiti 2.7.0's default `fsCache` dir is
`<dirname(file)>/../node_modules/.cache/jiti`. For the bundle that is
`resources/server/node_modules/.cache/jiti`, which on a FUSE-mounted AppImage is read-only
squashfs. jiti drops the cache when the dir is not writable. Every real-user AppImage launch is
therefore a cold transpile.

**Spike evidence** (`spike/native-ts-loader` at `bd14b0696` and `f58e56b4d`; CI runs
37285545559 and 37286703495; Ubuntu 22.04, extracted AppImage):
- Native loader: health in 3 s and 5 s, 18 plugins loaded.
- jiti, same container: no health within 240 s. `server running` arrived about 4 min after launch.
- Conclusion: the latency is in jiti's transpile/load path. H3 (a container-only blocking step)
  is ruled out. Why jiti regressed from 18 s (2026-08-26) to over 240 s is still unattributed
  (plugin-graph growth, or loss of a cache warmed at build time). This is recorded as
  documentation only (D7).

**How workers get their loader.**
- Three worker pools inherit the loader through `execArgv: [...process.execArgv]`:
  - `openspec-poll-worker-pool.ts:102`
  - `session-load-worker-pool.ts:140`
  - `custom-event-group-matcher.ts:184`
- `fit-worker-pool.ts:81-91` instead adds jiti itself when the inherited argv has no jiti loader
  (`isJitiLoader`).
- `restart-helper.ts:104-111` re-spawns with the loader it is given (`params.loader`) through
  `buildNodeImportArgvParts`.

**CJS globals in server-loaded code.** jiti transpiles first-party TS to CJS and injects
`require`, `__dirname`, and `__filename`. Native ESM provides none of these.
- `packages/server/src/routes/file-routes.ts:212` calls a bare `require("asciidoctor")` and throws
  a `ReferenceError` under the native loader. The spike never reached it because AsciiDoc preview
  is lazy.
- `packages/server/src/lib/purify.ts:17` already uses `createRequire(import.meta.url)`, a pattern
  that works under both loaders.
- `restart-helper.ts:119-123` uses `require`, but only inside a `node -e` string, which runs as a
  separate CJS script. It is not affected.

**Entry URL-wrapping.** `node-spawn.ts:158-165` (`shouldUrlWrapEntry`) refuses to URL-wrap the
entry for jiti and tsx loaders, and wraps it on Windows for every other loader. The pre-loader
wrapper always passes a raw entry (`bin/pi-dashboard.mjs:107-113`) and cannot import that TS rule.
Node's default resolver accepts `file://` entries, and the wrap is what protects `A:`/`B:` drives
from `ERR_UNSUPPORTED_ESM_URL_SCHEME` (`node-spawn.ts:4-25`, `:115-165`). The jiti exemption is
jiti-specific: it mishandles `file:///` entries. The native hooks delegate resolution to Node first.

**Bundled Node.** Electron bundles Node v24.15.0 (`packages/electron/scripts/_node-version.sh`).

**Package exports.** `@blackbelt-technology/pi-dashboard-shared` exports `"./*.mjs": "./src/*.mjs"`
(`packages/shared/package.json`). That lets a launch site resolve
`@blackbelt-technology/pi-dashboard-shared/platform/native-ts-register.mjs` by package specifier
from any anchor that can see the shared package.

## Goals / Non-Goals

**Goals:**
- Every dashboard-server launch boots with the Node-native TypeScript loader by default.
- The 22.04 AppImage smoke goes green within 90 s and reports per-phase timings.
- `PI_DASHBOARD_TS_LOADER=jiti` gives the previous behaviour exactly, as a runtime rollback.
- Server-loaded first-party code runs under both loaders.

**Non-Goals:**
- pi's own extension and bridge loading, which stays on pi's jiti.
- Pre-compiling the server to JS.
- Plugin third-party dependency bundling (`bundle-plugin-third-party-deps`).
- A writable jiti cache dir. Native has no cache, and the jiti fallback keeps today's cache behaviour.
- Keeping the smoke step's spike comparison of native and jiti. The step times only the shipped loader.

## Decisions

**D1: Loader selection in one pure helper.**
- `selectTsLoader(env)` returns `"native"` unless `PI_DASHBOARD_TS_LOADER === "jiti"`. It reads the
  launching process's own `process.env`. A caller's `opts.env` overlay does not change the
  selection, which keeps the parent-side argv, Doctor, and restart in agreement.
- Any other value logs a warning and falls back to `"native"`.
- The helper lives in `packages/shared/src/platform/` as an `.mjs` module, because the pre-loader
  wrapper `bin/pi-dashboard.mjs` runs before any TS loader exists and must use it too.
- `launchDashboardServer` resolves the loader with this helper. It throws `JitiNotFoundError`
  only when `jiti` was selected.
- *Rejected:* auto-falling back to jiti whenever native fails. That hides real native-loader
  bugs, and the opt-in env var already gives operators an escape.

**D2: Locate the register module by package specifier, not path arithmetic.**
- Node launch sites resolve `@blackbelt-technology/pi-dashboard-shared/platform/native-ts-register.mjs`
  with `createRequire(anchor).resolve(...)`. The anchor is `cliPath`, `argv[1]`, or the wrapper's
  own file. Return it as a `file://` URL.
- Shell launch helpers cannot resolve packages. They use the bundle's fixed layout path
  `<server>/node_modules/@blackbelt-technology/pi-dashboard-shared/src/platform/native-ts-register.mjs`.
  Nothing pins that path today: `assert-runnable-bundle.mjs:45-47` only checks that the helpers
  exist. A new L1 test pins the path in all three helpers and that it exists in the bundle layout.
- *Rejected:* the spike's `dirname(cliPath)/../..` arithmetic. It assumes the monorepo and bundle
  layouts and breaks under pnpm and hoisted installs.

**D3: Hook contract (taken from the spike, hardened).**
- `resolve`: first delegate to `nextResolve`. Only on `ERR_MODULE_NOT_FOUND` or
  `ERR_UNSUPPORTED_DIR_IMPORT` for a relative or `file:` specifier, retry `.js→.ts`,
  `.mjs→.mts`, and `.cjs→.cts`. For an extensionless specifier, retry
  `.ts, .js, .mjs, /index.ts, /index.js`. Bare specifiers are never rewritten.
- `load`:
  - `.ts`, `.mts`, `.cts` sources go through
    `stripTypeScriptTypes(src, { mode: "transform", sourceUrl })`. Transform mode supports
    enums, parameter properties, and namespaces. These files are loaded with `shortCircuit`, so
    they also load under `node_modules`, where Node refuses native stripping.
  - `.cts` loads as `commonjs`; everything else loads as `module`.
  - A JSON import without an attribute gets `type: "json"`. This is done in `resolve`, by
    returning `importAttributes`. In `load` it is too late, and Node throws
    `ERR_IMPORT_ATTRIBUTE_MISSING`.
  - `.tsx` is unsupported. The D5 gate rejects `.tsx` in server scope.
- The register module throws a clear error naming `PI_DASHBOARD_TS_LOADER=jiti` when
  `node:module` lacks `stripTypeScriptTypes`. That is a guard for old or embedded Node; the
  engines floor of 22.19 always has it.
- The `ExperimentalWarning` this emits is suppressed only for the type-stripping warning, not
  globally.

**D4: Every launch site picks up the selection.**
- `server-launcher.ts` uses D1/D2 and puts the selected loader into the spawn log header
  (`… loader <url>`), as the spike did.
- `bin/pi-dashboard.mjs` uses the same `.mjs` helper. A missing jiti is fatal only when jiti is
  selected. The entry is raw for jiti, and URL-wrapped on Windows for native (D8).
- `start-server.{sh,cmd,ps1}` honour `PI_DASHBOARD_TS_LOADER` and default to the bundled native
  register module.
- `fit-worker-pool.ts` treats any known TS loader in `execArgv` as present (a native-or-jiti
  predicate in `node-spawn.ts`). When neither is present it adds the selected loader.
- `restart-helper.ts` keeps re-using the running loader. The current server's loader is the
  right one to restart with. A loader switch (including the jiti rollback) therefore needs a
  fresh launch (`pi-dashboard stop && start`, or an Electron relaunch), not `/api/restart`.
- Bridge auto-start (`packages/extension/src/server-launcher.ts`, `server-auto-start.ts`) goes
  through `launchDashboardServer` and inherits the default. Its `JitiNotFoundError` →
  `logOwned: false` mapping becomes jiti-only.
- `doctor-core.ts` reports the native loader as satisfying the TS-loader check when it is
  selected. It flags a missing jiti only when jiti is selected.
- The Electron Doctor launch test (`doctor.ts`) runs its probe with the selected loader.
- `assert-bundled-server-plugin-load.mjs` boots with the selected loader, which is native by
  default. The build gate therefore proves the shipped default.

**D5: Loader-neutral source gate.**
- Add an L1 gate that scans server-loaded first-party TS for bare CJS globals: `require(`,
  `__dirname`, `__filename`, `module.exports`, `exports.`.
- Allowed are a `createRequire`-bound identifier and string-literal or template contents such as
  the `restart-helper` `node -e` script.
- The gate is AST-level. A global counts as unbound unless the file declares it, so
  `const __dirname = dirname(fileURLToPath(import.meta.url))` passes.
- Plugin entries are read from both manifest forms the runtime accepts (adjacent
  `dashboard-plugin.json` first, then `package.json#pi-dashboard-plugin`;
  `dashboard-plugin-runtime/src/server/loader.ts:160-198`).
- Scope is server-only and derived. Tag the seeds in `scripts/lib-jiti-scope.mjs` by kind
  (`piExtension` | `serverMain` | `pluginServer` | `pluginBridge`) and walk only from
  `serverMain` and `pluginServer`. The `pi.extensions` and bridge seeds are loaded by pi's jiti,
  where CJS globals exist; a non-goal.
- An empty file set fails the gate, and a fixture proves it fires.
- Fix `file-routes.ts:212` to use the `createRequire(import.meta.url)` pattern from `purify.ts`.
- The `jiti-cjs-transpile-safety` gate keeps its file set. Its seed-2 rationale is rewritten
  (MODIFIED delta): server source stays in scope because the jiti fallback can evaluate it.
  `bootstrapsJiti()` (`lib-jiti-scope.mjs:41-52`) keys on the literal `"jiti"` in the wrapper,
  which stays present. Pin that with a test so seed 2 cannot silently drop out.

**D6: 22.04 smoke timing table.**
- Print the table on success before the step's `exit 0` (`_electron-build.yml:615`), and on
  failure.
- Define one de-noise filter (drop dbus/GPU noise, as the failure branch does today at
  `_electron-build.yml:646-649`) and reuse it on both paths.
- The logs carry no per-line timestamps: `[plugin-loader]` and `Dashboard server running` are
  plain `console` output (`dashboard-plugin-runtime/src/server/loader.ts:485`,
  `packages/server/src/server.ts:3847`). The existing 1 s health-poll loop therefore records the
  elapsed second at which each marker first appears. Resolution is 1 s, which is enough against
  a 90 s budget.
- Markers:
  - electron exec, from `/tmp/electron.log`, with the remaining rows from the de-noised server log
  - the spawn header, including the loader
  - the first and last `[plugin-loader]` line
  - `Dashboard server running`
  - the first health 200
- Print the result as a table.
- Keep the 90 s budget, which leaves CI container and xvfb slack. Once native lands, record the
  measured boot time in the workflow comment, and cross-reference the separate 30 s
  launch-to-health contract in `ci-electron-on-demand-build`, which this step does not replace.

**D8: Native loader keeps the existing entry-wrap rule.**
- The `shouldUrlWrapEntry` rule is unchanged. Native is neither jiti nor tsx, so its entry is
  URL-wrapped on Windows and passed raw on POSIX. That keeps the `A:`/`B:` drive protection.
- The pre-loader wrapper (`bin/pi-dashboard.mjs:107-113`) mirrors the rule in plain JS: raw for
  jiti, `pathToFileURL` for native on win32. It already carries a "mirrors shouldUrlWrapEntry"
  comment, and an L1 parity test pins the mirror.
- `node-spawn.ts` adds `isNativeTsLoader(loader)` (segment match `platform/native-ts-register.mjs`,
  either separator). `fit-worker-pool.ts` uses it to see that a TS loader is already present.
- *Rejected:* a raw entry for native. That would lose `B:`-drive safety on an unverified inference
  (cycle-3 review).

**D7: jiti regression attribution, documentation only.**
- List `node_modules/.cache/jiti` in the 08-26 AppImage and in the current one (H1). Compare
  plugin-graph size (H2).
- Write the result in this file under Context. It does not block D1–D6.

## Risks / Trade-offs

- [Native ESM semantics differ from jiti's CJS interop] → Default-import interop of CJS packages
  and missing CJS globals can break lazy code paths that the spike never exercised.
  Mitigations:
  - the D5 gate
  - switching the default exercises the docker E2E harness (it boots through `pi-dashboard start`,
    `docker/test-entrypoint.sh:889`) and the qa server-start tests on native. The identity-matrix
    harness (`tests/e2e/identity-matrix/matrix-lifecycle.ts:126`) and the purify jiti test pin
    jiti explicitly. They stay as-is, as jiti-fallback coverage.
  - the plugin-load gate (`assert-bundled-server-plugin-load.mjs`) is switched to the selected
    loader (D4), so it runs on native
- [Windows launch] → Native with a URL-wrapped entry has not been run on real Windows. Verify a
  Windows launch (electron windows job or the qa Windows VM) before shipping. A failure returns
  the change to planning; the predicate is not patched in-flight.
- [JSON import attributes] → The spike put the attribute fix-up in `load` and never imported
  JSON, so neither placement is verified (*unverified*). The JSON scenario's L1 test decides.
- [`stripTypeScriptTypes` stability] → It is still marked experimental or release-candidate
  depending on the Node line. The jiti fallback is one env var away, and the D3 guard names it.
- [Unsupported TS syntax] → Decorators with emit, and `import x = require()`, are not handled by
  transform mode. Today none appear in server-loaded code (`enum`/`namespace` exist and are
  supported). The plugin-load gate and the E2E suite catch regressions.
- [The bridge and pi still use jiti] → Those are separate processes, so there is no interaction.
  `jiti-cjs-transpile-safety` keeps covering them.
- [Stale docs and recipes] → The `jiti-loader` spec Purpose ("jiti is the sole TypeScript loader")
  cannot be changed by a delta, so it is updated at archive. The same goes for the `packaging`
  requirement title "(jiti-only)". The `node-inspect-debugger` skill's
  jiti recipe stays valid under the opt-in; it gains a native-loader recipe.

## Migration Plan

- There is no data migration.
- The change ships as the new default behind `PI_DASHBOARD_TS_LOADER`.
- Rollback at runtime: `PI_DASHBOARD_TS_LOADER=jiti`.
- Full rollback: revert the change. jiti resolution code is unchanged.

## Open Questions

- Why jiti regressed (D7). This is documentation only and does not affect the specs.
