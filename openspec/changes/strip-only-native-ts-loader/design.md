## Context

**Today.** The native loader is the default for every server launch, and jiti is the opt-in
fallback (archived `2026-10-05-fix-appimage-cold-boot-latency`).

- `selectTsLoader` returns `"jiti"` when `PI_DASHBOARD_TS_LOADER=jiti` **or** when Node lacks
  transform mode (`packages/shared/src/platform/ts-loader-select.mjs:53-55`). The second branch is
  not in the `server-launch` spec. The cold-boot design rejected exactly this:
  *"Rejected: auto-falling back to jiti whenever native fails"*.
- The hooks strip types in transform mode (`packages/shared/src/platform/native-ts-hooks.mjs:80`)
  and suppress the `stripTypeScriptTypes` `ExperimentalWarning` in the hooks thread (`:21-26`).
- The register module calls `module.register` (`packages/shared/src/platform/native-ts-register.mjs:18`).
  Node 26 deprecates it with `DEP0205: Use module.registerHooks() instead` (verified on v26.11.1).
- jiti is still wired into `ToolResolver.resolveJiti` (`packages/shared/src/platform/binary-lookup.ts:372`),
  `launchDashboardServer` (`packages/shared/src/server-launcher.ts:141,233,249-250`; `JitiNotFoundError` caught in `packages/server/src/cli.ts:44,434` and relied on by `packages/extension/src/server-auto-start.ts:466`), the bin wrapper
  (`packages/server/bin/pi-dashboard.mjs:66-130`), `fit-worker-pool.workerExecArgv`
  (`packages/server/src/attachments/fit-worker-pool.ts:100`), the bridge launcher
  (`packages/extension/src/server-launcher.ts:42,179`), Doctor, the Electron launch helpers and
  test scripts, `.github/workflows/_electron-build.yml` (the `PI_DASHBOARD_TS_LOADER=jiti`
  failure-path step), `qa/tests/{02,08,09,26,36}-*.sh`, and `scripts/verify-plugin-install-load.mjs`
  (the CI plugin install-load gate, which uses `createJiti`). `jiti` is a dependency of the server
  package (`packages/server/package.json:94`), and `scripts/verify-release-deps.mjs:33-41` (run in
  CI, `ci.yml:111`) requires it there.
- `/api/restart` copies the running process's `--import` loader verbatim from `process.execArgv`
  (`packages/server/src/routes/system-routes.ts:1430-1432`).

**Node facts (2026-10-11):**

| | 22.19+ | 23.0–23.1 (EOL) | 23.2–23.4 (EOL) | 23.5+ / 24 / 25 | 26.11 |
|---|---|---|---|---|---|
| `stripTypeScriptTypes` `mode: "strip"` | ✅ | ❌ | ✅ | ✅ | ✅ |
| `mode: "transform"` | ✅ | ❌ | ✅ | ✅ | ❌ `ERR_INVALID_ARG_VALUE` |
| `module.registerHooks` | ✅ (≥22.15) | ❌ | ❌ | ✅ | ✅ |
| `module.register` | ✅ | ✅ | ✅ | ✅ | ⚠️ DEP0205 |
| strip error for non-erasable syntax | `ERR_UNSUPPORTED_…` | (amaro `UnsupportedSyntax`) | `ERR_INVALID_TYPESCRIPT_SYNTAX` | `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` | same |

Verified on real binaries: 22.19.0, 22.22.3, 23.1.0, 23.4.0, 24.15.0, Electron 43.4.1 (Node
24.18.1), 26.11.1. The 25.x column comes from Node's API history and is **unverified** locally.
The timings and amaro costs below come from the console output of the spike run (not retained as
files); they are directional, and task 4.1 re-measures them in-repo.

**Three-tier spike (2026-10-11, `/tmp/amaro-spike`).** The tiers were: `registerHooks` + native
strip; `module.register` + native strip; `module.register` + `amaro@1.2.1` `strip-only`. The real
server booted with a temp HOME on isolated ports, with a logged `transpileModule` stand-in for the
pending source rewrite:

| Node | Tier | `/api/health` (warm) | stripped clean | needed rewrite stand-in |
|---|---|---|---|---|
| 23.1.0 | register + amaro | 2.17 s | 724 | 52 |
| 23.4.0 | register + native | 2.18 s | 724 | 52 |
| 24.15.0 | registerHooks + native | 1.66 s | 724 | 52 |
| 26.11.1 | registerHooks + native | 1.66 s | 724 | 52 |

No worker thread is spawned during that boot (each log has one tier line). A separate probe
(a `.ts` main spawning a `.ts` worker with inherited `execArgv`) showed the worker re-running the
register module and stripping on the same tier on 22.19.0, 23.1.0, 23.4.0, 24.15.0 and 26.11.1.

The 52 files are the same set on every tier (the parameter-property and enum files). `amaro`
costs 19 ms to `require` and 4 ms for the first transform on 23.1. `amaro@1.2.1` is MIT, published
from `nodejs/amaro`, has no dependencies, needs `engines >=22`, and is 7.6 MB unpacked (swc WASM).

**Non-erasable syntax.** `tsc --erasableSyntaxOnly` over the root program (`packages/*/src`,
including tests and `.tsx`) reports **172 TS1294 sites in 112 files: 96 non-test and 16 test
files**, all parameter properties apart from one enum (`ChangeState`,
`packages/shared/src/types.ts:1227`). Counted on `develop` at `8ea552489`; the count was 161 / 91
non-test before `c457bdbae` (deck3d pptx import) landed. `packages/team-app`, which the root
program excludes, adds 4 sites in `src/api/client.ts`. Tasks derive the set from `tsc` output, not
from a fixed list.

**Boot spike** (a throwaway loader in `/tmp`, not retained; only its logs remain. It used strip mode
plus `registerHooks`, fell back to `ts.transpileModule` and logged when strip failed; temp HOME;
isolated ports. The spike is evidence of direction only. Task 4.1 re-establishes it in-repo.):

| | Node 26.11.1 | Node 24.15.0 |
|---|---|---|
| `/api/health` | UP in 2 s | UP in 2 s |
| `.ts` loaded (server, shared, the plugins enabled in a fresh HOME, 6 worker modules; e.g. `browser-plugin` was *not* loaded) | 772 | 772 |
| stripped as-is | 720 | 720 |
| fallback needed | 52, all parameter property or enum, all in the static set | same |
| other load errors | none | none |
| `.ts` loaded from `node_modules` | 0 | 0 |

`automation-plugin engine init failed: Fastify instance is already listening` shows up under the
spike loader **and** the stock loader, so it is unrelated. Lazily loaded paths (for example the EML
sanitizer's `createRequire`) were not exercised by the boot.

## Goals / Non-Goals

**Goals:**
- One server TypeScript loader on every maintained Node line in the engines range: strip mode via
  `registerHooks`.
- First-party source is erasable-only, and the type-check enforces it.
- The dashboard server never evaluates TypeScript through jiti. Remove the server-side jiti
  resolution, selection, and dependency, and move the CI plugin install-load gate onto the native
  loader.

**Non-Goals:**
- pi's own loading of `pi.extensions` and plugin `bridge` entries. That stays on pi's jiti.
- Raising the Node floor (`raise-node-floor-to-26`, draft). End-of-life Node 23.0–23.4 keeps
  booting through the fallback tiers (D4)
  with a clear message instead.
- These repo scripts, which use `createJiti` and keep the root `jiti` dependency:
  `scripts/{generate-plugin-registry,i18n-parity,sync-served-client,measure-auto-naming,measure-replay-compaction}.mjs`,
  plus `scripts/lib-jiti-scope.mjs`, whose `jiti-cjs-transpile-safety` walk is jiti-based by design
  (D6). The root `jiti` dependency is therefore permanent while that gate exists. Every other jiti
  user listed in Context is in scope, including the E2E identity matrix
  (`tests/e2e/identity-matrix/matrix-lifecycle.ts:126`, which boots the server under
  `--import jiti/register`) and `scripts/test-standalone-npm-install-docker.sh:170` (asserts the
  old `cannot find jiti` text).
- The entry-wrap rule (`shouldUrlWrapEntry`) and the `isJitiLoader` / `isTsxLoader` argv
  classifiers. They stay, because restart normalization (D5) uses them to recognize a foreign
  loader.
- The TypeScript 7 migration (change `migrate-typecheck-to-ts7`). That change is independent.

## Decisions

### D1 — Rewrite parameter properties as explicit fields (output-identical)

`constructor(private readonly x: T)` becomes:
1. a field declaration `private readonly x: T;` placed **at the top of the class body, before
   every other field, in parameter order**, and
2. `this.x = x;` as the first constructor statement, or the first after `super(...)`.

*Why it is safe:* under native class-field semantics, which Node uses at runtime whatever the
tsconfig says, parameter-property fields are defined **first** and assigned **after** field
initializers. tsc 5.9 (ES2022), Node transform mode and jiti all emit `max; y; cache = …;` with
keys ordered `["max","y","cache"]`, and a probe class gives `cache = this.max * 2` → `NaN` under all
three. tsc already rejects reading a parameter property in a field initializer (TS2729), and no
source uses decorators: a repo-wide grep finds only `@fast` inside two test template strings. With
the placement above, field order, `Object.keys`, `JSON.stringify` and spread output (including on
the 34-plus `Error` subclasses) stay identical **under Node**. Duplicate names (a `declare` field
or accessor with the same name) are compile errors, so they cannot occur silently.

**jiti differs.** jiti does *not* hoist parameter-property fields: for
`class A { cache = 5; constructor(private max: number) {} }` it orders keys `["cache","max"]`,
while Node orders them `["max","cache"]` (probe, jiti 2.7.0). Placement therefore follows the
runtime that loads the file:
- files loaded only by pi's jiti (`pi.extensions` and plugin `bridge` seeds in
  `scripts/lib-jiti-scope.mjs`, for example `packages/extension/src/**` and `*/src/bridge/**`): declare
  the fields **after** the existing fields, which preserves jiti's current order;
- every other file: declare them **first** (Node order).

Files reachable from both runtimes (the bridge value-imports `packages/shared/src`) are today an
**empty set** for this rewrite: `packages/shared/src` contains no parameter properties. A future
dual-runtime class follows the Node rule. With that, runtime output is identical under both Node
and jiti for every rewritten file.

*Rejected:* keeping transform-mode support through a vendored transpiler fallback. That keeps two
code paths, adds a transpile cost on the boot path, and re-creates the cold-boot problem.

### D2 — `ChangeState` becomes `as const` plus a same-named type

```ts
export const ChangeState = { PLANNING: "PLANNING", READY: "READY", IMPLEMENTING: "IMPLEMENTING", COMPLETE: "COMPLETE" } as const;
export type ChangeState = (typeof ChangeState)[keyof typeof ChangeState];
```
Runtime values are identical and `ChangeState.X` call sites compile unchanged. **Accepted
trade-off:** the type is now a structural union, so a raw `"READY"` becomes assignable where the
nominal enum used to reject it. Exhaustive `switch` narrowing still works.

### D3 — `erasableSyntaxOnly: true` in `tsconfig.base.json` is the gate

It needs TypeScript ≥5.8. The installed version is 5.9.3, but the root range is `^5.7.0`
(`package.json:143`), so the range is raised to `^5.8.0` (root and
`packages/app-kit/package.json:59`, whose `tsc -p tsconfig.build.json` extends the base config). Every package inherits the flag. CI
enforces it through `pnpm run lint` (`ci.yml:173`, the root program, tests included). **CI does not
type-check `packages/team-app`** (the root program excludes it, and only the local
`quality:changed` runs it). That carries **no runtime risk**: team-app is a Vite-bundled browser app
(esbuild handles parameter properties), and the server loader never evaluates it. The
erasable-syntax requirement is therefore scoped to the root program. team-app still inherits the
flag locally (it extends the base config), so its 4 sites are fixed to keep `quality:changed`
clean. Known bypasses: `// @ts-nocheck` / `// @ts-ignore` suppress TS1294. No
first-party file uses `@ts-nocheck` today, and a bypassed file fails loudly at load (D4), not
silently.

**Type-only imports are a second strip-mode rule.** Strip mode (like transform mode) keeps
`import { Foo } from "./x.js"` even when `Foo` is only a type, and the module then fails to link;
jiti drops such imports. First-party code is clean today (`tsc --verbatimModuleSyntax` reports no
TS1484), but nothing enforces it. Biome `style/useImportType` goes from `warn` to `error`
(`biome.json:72`). `verbatimModuleSyntax` is *not* used, because it would also forbid ESM syntax in
the CommonJS-emitting packages. On Node 22/24 the native loader already requires this today, so the
break for plugin authors is new only for Node 26 hosts, which ran plugins under the jiti fallback.

### D4 — Strip mode via `module.registerHooks`, with two fallback tiers for EOL 23.x

`native-ts-register.mjs` picks one tier at startup:

| Tier | When | Registration | Stripper |
|---|---|---|---|
| 1 | `registerHooks` **and** `stripTypeScriptTypes` exist (22.15+, 23.5+) | `module.registerHooks` (sync, in-thread) | `stripTypeScriptTypes(src, { mode: "strip" })` |
| 2 | no `registerHooks`, has `stripTypeScriptTypes` (23.2–23.4) | `module.register` (async, off-thread) | same |
| 3 | no `stripTypeScriptTypes` (23.0–23.1) | `module.register` | bundled `amaro`: `transformSync(src, { mode: "strip-only", filename }).code` (the call returns an object), loaded with `createRequire(import.meta.url)("amaro")` inside the tier-3 branch |

- One shared resolve/load core (`native-ts-hooks.mjs`) serves both registration styles. Tier 1
  calls it synchronously with `readFileSync`; tiers 2 and 3 wrap the same functions as async
  hooks. Resolution logic is unchanged.
- Any strip error is rethrown with the file path, whatever its code or name (it varies by tier;
  see Context). There is no transpiling fallback.
- `amaro` is an exact-pinned dependency of `@blackbelt-technology/pi-dashboard-shared` (the package
  that ships the register module). It is loaded only in tier 3, so 22.x/24+/26 never load it. On
  tier 3 each worker thread loads its own copy (~19 ms each, EOL lines only).
- **Distribution:** `amaro` arrives transitively wherever shared is installed: npm global install
  (root → server → shared), the Electron bundle (`bundle-server.mjs` `BUNDLED_WORKSPACE_PKGS`),
  the runtime-lock overlay and the docker image (`pnpm install --frozen-lockfile`, so the lockfile
  must be regenerated). Only a system-Node 23.0–23.1 npm install ever *uses* it; Electron
  (bundled Node 24) and docker (Node 24) carry it unused. A `scripts/verify-release-deps.mjs` rule
  pins it on `packages/shared/package.json`, so a later "unused 7.6 MB dependency" cleanup cannot
  silently break tier 3.
- **Pre-existing on 23.x (not caused by this change):** `jsdom`/`isomorphic-dompurify` and the
  `@inquirer/*` packages declare `engines` that exclude 23.0–23.4, and the repo's `.npmrc` sets
  `engine-strict=true`. EOL 23.x support was already best-effort; the 23.x boot job installs with
  `--config.engine-strict=false`, as the pre-26 `_smoke.yml` legs already do.
- **Warning suppression lives in every stripping thread**: the main thread on tier 1, the hooks
  thread on tiers 2 and 3. `stripTypeScriptTypes` emits an `ExperimentalWarning` on every line,
  including 26. The filtered `process.emitWarning` wrapper matches only that one message prefix;
  every other warning still reaches stderr.
- **The guard** fails only when neither `registerHooks` nor `register` exists, which never happens
  inside the engines range. Every version that boots today still boots, so there is no change to
  the accept-set, `node-version.ts` or Doctor.

*Rejected:* refusing 23.0–23.4 (would have needed `server-startup-node-version-guard` and
`doctor-diagnostic` deltas, and would regress versions that boot today). *Rejected:* jiti as the
23.0–23.1 last resort; it would keep a jiti path in the server.
- **`require()` is hooked too.** Unlike the async `register` hooks, `registerHooks` hooks also see
  CommonJS `require()`. The resolve hook calls Node first and retries only on
  `ERR_MODULE_NOT_FOUND` / `ERR_UNSUPPORTED_DIR_IMPORT` (CommonJS reports `MODULE_NOT_FOUND`,
  so `require()` never takes the retry path) and never rewrites bare specifiers. `require()`
  resolution of non-TypeScript modules is therefore unchanged. Verified on 22.19.0 and 24.15.0: a
  `registerHooks` resolve hook that adds the JSON attribute leaves `require()` of JSON and jsdom
  working. A test covers `loadPurify()`'s `createRequire` path (the
  jsdom require cycle).
- **Synchronous reads on a cold FUSE mount** (the AppImage case the cold-boot change fought):
  **unmeasured.** The off-thread async hooks could overlap sibling-module reads (up to the libuv
  pool size); `readFileSync` on the main thread serializes them. The impact on the 90 s Ubuntu
  22.04 AppImage budget is a hypothesis to measure (task 4.2, `performance-optimization`): per-phase
  boot timings before and after. If it regresses materially, add a bounded prefetch of the
  server's static import graph.
- Workers re-run the `--import` from inherited `execArgv`. The spike logged 6 worker modules loaded
  through the hooks.
- Strip mode replaces types with whitespace, so line and column numbers are exact and no source
  maps are needed.

*Rejected:* keeping `module.register` (async, off-thread). It is deprecated on 26 and adds a
message-port hop per module.

### D5 — Remove jiti selection; warn once; normalize on restart

- `selectTsLoader` and `nativeTransformSupported` are deleted. `resolveNativeTsLoader` stays.
- `PI_DASHBOARD_TS_LOADER` set to anything other than empty or `native` (both stay silent no-ops,
  as today): **only the server process** logs one warning at boot, in `server.log`. Wrappers and
  launchers neither warn nor rewrite the environment. The Electron overlay env and
  `buildRestartEnv` pass the full environment through, so mutating it was not reliably possible.
  The warning text is (`PI_DASHBOARD_TS_LOADER is no longer supported (the jiti server loader was removed); using the native loader.`)
  (one line per server boot; restarts repeat it, which is acceptable for a deprecation nudge).
- **Restart normalization:** `/api/restart` (`system-routes.ts:1430-1432`) stops copying the
  `--import` loader verbatim and **always** hands the restart orchestrator
  (`restart-helper.ts`) the native register module, whatever was there, including an unknown
  loader or none. The orchestrator's own argv branches (loader / bare-entry, `server-restart` spec)
  are unchanged, and its stale "running server's loader" / "cold jiti boot" comments are updated. A server booting under a foreign loader logs a warning
  recommending `pi-dashboard stop && pi-dashboard start`. `isJitiLoader` / `isTsxLoader` only name
  the foreign loader in that warning.
- **Upgrade continuity (code mitigation, not just a note):** the *first* `/api/restart` after an
  upgrade, including the in-app updater's restart, runs the *old* process's code, which copies its
  loader verbatim. On a Node 26 host the old server ran under jiti through the silent fallback, often
  from the server package's own `jiti`. This change therefore **keeps `jiti` as a transitional
  dependency of `@blackbelt-technology/pi-dashboard-server`**. Nothing imports or resolves it; it
  only keeps the old `execArgv` path valid across the upgrade. The new code then boots under jiti
  (jiti runs erasable code fine), logs the foreign-loader warning, and the **next** restart
  normalizes to native. Removing the dependency is a separate, later change (candidate: fold into
  `raise-node-floor-to-26`). `verify-release-deps.mjs` keeps its `jiti` rule until then, with its
  rationale updated. Electron is unaffected (bundled Node 24, already native). **Residual risk:** a
  reinstall into a different directory (for example a global reinstall under a new prefix) deletes
  the old absolute jiti path, and that first restart then fails. The boot warning plus
  `pi-dashboard stop && pi-dashboard start` recover. A pre-change server cannot be patched
  retroactively. Workers in the transitional window inherit the server's jiti loader; that counts
  as present, so no second `--import` is added.
- Also deleted: `ToolResolver.resolveJiti` and its `JitiResolver` deps, the `_resolveJiti` /
  `resolveJiti` injection seams (`server-launcher.ts:141`, `fit-worker-pool.ts:89`), the
  `JitiNotFoundError` class and its catch sites (`cli.ts:44,434`, the bridge `logOwned:false` path),
  the jiti remediation text in `resolveNativeTsLoader`'s error (`ts-loader-select.mjs:76-80`),
  the bin wrapper's jiti branch, the jiti branch of `fit-worker-pool.workerExecArgv`, the Doctor
  jiti row branch, and the jiti fallbacks in the `start-server.*` helpers,
  `assert-bundled-server-plugin-load.mjs` and the Electron test scripts.

*Rollback:* reinstall the previous release. *Rejected:* keeping `PI_DASHBOARD_TS_LOADER=jiti` as a
dormant escape hatch. It would keep the resolution code, the dependency, tests and Doctor rows for
a path that cannot fix anything strip mode cannot run.

### D6 — `jiti-cjs-transpile-safety`: scope unchanged, rule restated as a conservative superset

After this change jiti no longer evaluates the server entry (seed 2) or plugin `server` entries
(seed 3). Dropping them would make the gate's erasure scenarios (which rely on
`packages/server/src/changelog/changelog-fs.ts`) pass **vacuously**. The requirement therefore
restates its rule as *"jiti-evaluated source, plus a deliberately conservative superset (the
server entry graph and plugin `server` entries)"*. The scope stays as it is, and the rule now says
honestly why.

*Rejected:* narrowing here. It would silently weaken a gate.

### D7 — The CI plugin install-load gate moves to the native loader

`scripts/verify-plugin-install-load.mjs` imports each packed plugin's server entry. Today it uses
`createJiti`, which accepts any TypeScript and so would keep passing non-erasable plugins that the
real server now rejects. It switches to the native register module, so CI fails on a non-erasable
plugin before users hit it. Third-party plugins in the field still fail **in isolation**, per the
existing "Plugin failure does not crash the shell" requirement (`/api/health.plugins[]` error).

## Risks / Trade-offs

- **[Lost runtime rollback]** → strip-only is transform minus syntax we no longer use. The spike
  booted the full server plus plugins on 24 and 26. `_smoke.yml` boots on 22/24/25/26.
- **[Third-party plugins using enums or parameter properties]** → they fail to load in isolation
  with the file path. **BREAKING for plugin authors**, stated in the proposal and release notes.
  The scaffold templates need checking.
- **[First restart after upgrade on Node 26 CLI hosts]** → transitional `jiti` dependency keeps
  it alive (D5); a boot warning and the next restart normalize.
- **[PR-time plugin gate is `--changed` only]** (`ci.yml:162-163`) → an unchanged plugin
  affected by a shared edit is re-checked by the nightly full run, not per PR.
- **[Pre-existing: `tsx` still in six workspace manifests]**, against the `packaging` rule that
  forbids it. Unrelated to this change and left for a follow-up.
- **[EOL Node 23.0–23.4]** → kept bootable by tiers 2 and 3 (D4), best-effort as today (some
  dependencies' `engines` already exclude 23.x). Cost: `amaro` (+7.6 MB in installs and the Electron
  bundle, which never loads it) and a code path only EOL lines exercise. Covered by
  a dedicated 23.1 / 23.4 boot test (task 4.1), since `_smoke.yml` deliberately leaves out EOL 23.
- **[`registerHooks` is synchronous]** → boot reads about 770 files; the spike measured 2 s warm.
  AppImage cold-boot timing is measured before and after (D4).
- **[`registerHooks` also hooks `require()`]** for native addons and large CommonJS graphs
  (`node-pty`, `jsdom`, `mailparser`). The hooks pass non-`.ts` loads through `nextLoad` and retry
  only relative not-found specifiers. Lazy paths are exercised by the qa server-start, the docker
  E2E harness and a `loadPurify` test (tasks 2.4, 4.2).
- **[`ExperimentalWarning` suppression in the main thread]** → exact message-prefix filter only.

## Migration Plan

1. Raise `typescript` to `^5.8.0`. Rewrite the files reported by `tsc --erasableSyntaxOnly` (D1,
   D2), team-app included. Enable `erasableSyntaxOnly`. `npm run lint`, `lint:e2e` and `npm test`
   green.
2. Switch the hooks to strip plus `registerHooks` (D4); boot test on 22.19, 24, 25 and 26.
3. Remove jiti selection and resolution, normalize restart, move the install-load gate (D5, D7);
   update specs and docs.
4. Electron: the AppImage cold-boot smoke (90 s budget) stays green.

Rollback: revert the merge commit, or for users reinstall the previous version.

## Open Questions

- None blocking. Follow-ups: drop the transitional server `jiti` dependency; move the five non-goal
  dev scripts to the native loader (the root `jiti` dependency stays for `lib-jiti-scope.mjs`); remove the stray `tsx`
  dependencies.
