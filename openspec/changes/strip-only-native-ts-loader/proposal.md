## Why

The dashboard server already boots on the Node-native TypeScript loader (`fix-appimage-cold-boot-latency`),
but that loader needs `stripTypeScriptTypes` in **transform** mode. Node 26 removed transform mode, and
26 becomes the Active LTS on **2026-10-28**. `selectTsLoader` therefore silently falls back to jiti on
every Node 26 host (`packages/shared/src/platform/ts-loader-select.mjs:55`). That fallback is the
auto-fallback the cold-boot design rejected, it is absent from the `server-launch` spec, and it
brings back jiti's cold transpile on read-only bundles. Node 26 also deprecates `module.register`
(DEP0205), which the native loader uses.

The only reason transform mode is still needed is non-erasable syntax in our own source:
**172 sites in 112 files** (96 non-test, 16 test; all parameter properties apart from one enum),
plus 4 in `packages/team-app`. Removing that syntax lets one strip-only loader run on every
maintained Node line from 22.19 to 26, and lets the dashboard server stop depending on jiti.

Spike evidence (outside the repo, 2026-10-11): a strip-only `registerHooks` loader booted
`packages/server/src/cli.ts` to `/api/health` in 2 s on Node 26.11.1 and on 24.15.0. 720 of 772
`.ts` files stripped as-is, and the rest were exactly the parameter-property and enum files.

## What Changes

- **First-party source becomes erasable-only.** Parameter properties become explicit fields
  (declared first, in parameter order, so runtime output is identical), and `ChangeState` becomes
  an `as const` object plus a same-named type. `"erasableSyntaxOnly": true` goes into
  `tsconfig.base.json`, `typescript` is raised to `^5.8.0` (root and `app-kit`), and Biome
  `useImportType` goes from warn to error (strip mode needs `import type` for type-only imports).
- **The native loader switches to strip mode on `module.registerHooks`**, which is synchronous and
  in-thread. The `stripTypeScriptTypes` `ExperimentalWarning` is still suppressed (now in every
  stripping thread), and `require()` resolution is left unchanged. End-of-life Node 23.0–23.4 stays
  bootable: 23.2–23.4 register the same hooks with `module.register`, and 23.0–23.1 (no stripping
  API) strip with the bundled **`amaro`** (Node's own stripper, MIT, no dependencies, 7.6 MB,
  lazy-loaded only there). Spike: the server booted on 23.1, 23.4, 24 and 26.
- **BREAKING (operator-facing): the jiti server loader is removed.** `PI_DASHBOARD_TS_LOADER` no
  longer selects jiti. A set value (other than `native`) makes the server log one
  warning at boot. `/api/restart` normalizes an inherited jiti `--import` to the native loader, and a
  server booting under a foreign loader warns. `selectTsLoader`, the transform probe,
  `ToolResolver.resolveJiti`, the bin wrapper's jiti path, the bridge's jiti anchoring, the
  fit-worker jiti injection, the Doctor jiti row, and the jiti paths in the Electron helpers, test
  scripts, workflows and qa tests are all removed. `jiti` stays in
  `@blackbelt-technology/pi-dashboard-server` dependencies **only as a transitional upgrade aid**:
  nothing imports it, but it keeps a pre-upgrade server's jiti `execArgv` restartable. Removing it
  is a later change. Rollback is by installing the previous version.
- **BREAKING (plugin authors):** dashboard plugin server TypeScript must be erasable (no `enum`,
  runtime `namespace` or parameter properties) and must import type-only symbols with
  `import type`. Node 22/24 hosts already need this today; the break is new for Node 26 hosts,
  which ran plugins under the jiti fallback. A non-erasable third-party plugin fails to load in
  isolation, and the error names the file. The CI plugin install-load gate moves from `createJiti`
  to the native loader, so first-party plugins are checked the same way.
- **Upgrade (Node 26 CLI/npm hosts):** the first `/api/restart` after upgrading runs the old code
  and may bring the new server up under jiti, which keeps working. The new server warns, and the
  next restart (or `pi-dashboard stop && pi-dashboard start`) switches it to the native loader.
- **Unchanged:** pi still loads `bridge.ts` and plugin `bridge` entries with **pi's** jiti. The
  `jiti-cjs-transpile-safety` gate keeps its current scope, with its rule restated as an explicit
  conservative superset.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `native-ts-loader`: strip mode via `registerHooks`, with a `module.register` fallback (23.2–23.4) and a bundled-`amaro` stripper (23.0–23.1); no jiti workaround; `ExperimentalWarning` suppression and `require()` neutrality specified; adds the erasable-only source requirement.
- `server-launch`: native loader only (warn once and drop the env var, restart normalization, foreign-loader boot warning); loader selection and jiti resolution removed; "Removed predecessors" also forbids `resolveJiti`, `JitiResolver`, `selectTsLoader`.
- `jiti-loader`: its only requirement (jiti register-path resolution for the server) is removed.
- `dashboard-server`: the bin-wrapper and Doctor-row requirements are replaced (native only; the no-tsx rule is kept).
- `packaging`: the bin wrapper drops the jiti branch; no server source imports jiti; `jiti` is a transitional dependency only.
- `electron-launch-source`: the metadata short-circuit is reframed around native-loader resolution; the uniform spawn primitive always uses the native loader.
- `electron-shell`: the main-process lifecycle launches with the native loader only.
- `bridge-extension`: the bridge's jiti anchoring for server auto-start is removed.
- `platform-primitives`: shared platform code resolves the server's TypeScript loader natively; no jiti resolution.
- `dashboard-plugin-loader`: the install-load gate imports under the native loader; plugin server TypeScript must be erasable.
- `file-and-url-preview`: the EML sanitizer requirement's loader premise changes from jiti to native.
- `jiti-cjs-transpile-safety`: the rule is restated as a conservative superset; scope is unchanged.
- `openspec-change-state`: `ChangeState` becomes an erasable `as const` object plus a type (same string values).
- `debugging-skills`: launch recipes cover both loaders (native for the server, jiti for pi-hosted code).

## Impact

- **Code:** the files reported by `tsc --erasableSyntaxOnly`; `packages/shared/src/platform/{native-ts-hooks,native-ts-register,ts-loader-select}.mjs` and `ts-loader-select.d.mts`; `packages/shared/src/{server-launcher,doctor-core}.ts`; `packages/shared/src/platform/binary-lookup.ts`; `packages/shared/src/tool-registry/definitions.ts`; `packages/server/bin/pi-dashboard.mjs`; `packages/server/src/attachments/fit-worker-pool.ts`; `packages/server/src/routes/system-routes.ts` (restart loader); `packages/server/src/cli.ts` and `packages/extension/src/server-auto-start.ts` (`JitiNotFoundError`); `scripts/verify-release-deps.mjs` (rationale); `packages/extension/src/server-launcher.ts`; `packages/electron/src/lib/{doctor,launch-source}.ts`; `packages/electron/scripts/{assert-bundled-server-plugin-load.mjs,server-launch-helpers/*,test-server-launch.sh,test-electron-install-inner.sh,test-desktop-launch-inner.sh,spike-source-only-bundle.sh}`; `scripts/{verify-plugin-install-load,check-loader-neutral-source,lib-jiti-scope}.mjs`; `.github/workflows/{_electron-build,_smoke,ci,ci-gateway-platform,nightly}.yml` (jiti and `PI_DASHBOARD_TS_LOADER` steps); `qa/tests/{02,08,09,26,36}-*.sh`; `tests/e2e/identity-matrix/matrix-lifecycle.ts`; `scripts/test-standalone-npm-install-docker.sh`; `biome.json`; `packages/server/src/spawn-process/restart-helper.ts` (comments); the unit tests that pin jiti selection or resolution (task 3.15).
- **Dependencies:** `jiti` stays in `packages/server/package.json` as a transitional upgrade aid (no imports; `scripts/verify-release-deps.mjs` rule kept with updated rationale). The root `jiti` dependency stays permanently for six repo scripts, including the `jiti-cjs-transpile-safety` walk (design non-goals). `typescript` range goes to `^5.8.0`. **New:** `amaro` (exact pin) becomes a dependency of `@blackbelt-technology/pi-dashboard-shared` (+7.6 MB in installs and the Electron bundle; loaded only on Node 23.0–23.1). pi's own `jiti` is unaffected.
- **Compatibility:** no Node floor, `engines` or accept-set change (still `>=22.19.0 <27`); every version that boots today still boots.
- **Rollback:** reinstall the previous npm or Electron version. There is no runtime switch.
- **Independent of** change `migrate-typecheck-to-ts7`: `erasableSyntaxOnly` works on TypeScript 5.8+. **Prerequisite of** `raise-node-floor-to-26` (draft).

## Discipline Skills

- `doubt-driven-review`: removing the jiti rollback switch and the public `PI_DASHBOARD_TS_LOADER` contract is hard to undo after release.
- `performance-optimization`: server cold boot has a budget (the 90 s AppImage smoke on Ubuntu 22.04). The boot must be measured on 22.19, 24, 25 and 26.
- `node-inspect-debugger`: loader hooks running in-thread under `registerHooks` are opaque runtime state; use it if a hook misbehaves.
- `review-code`: before commit.
