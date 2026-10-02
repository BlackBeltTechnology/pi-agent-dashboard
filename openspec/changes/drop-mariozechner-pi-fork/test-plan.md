# Test Plan — drop-mariozechner-pi-fork

Stage: design   Generated: 2026-05-17

No clarifications needed. All Triple slots resolve from the spec deltas and the current code: error strings from `pi-core-routes.ts` / `server-launcher.ts`, fixed versions, and the synthetic `@other/pi-coding-agent` scope for scope-agnostic reads.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | pi-core-version-check "lockstep … without the legacy fork"; packaging "No legacy fork peers" | decision-table (manifest × field) | L1 | automated | fixture manifests: root / `packages/extension` with `@mariozechner/pi-{coding-agent,ai,tui}` in `peerDependencies`, `peerDependenciesMeta`, `devDependencies` (one at a time) | run `dependency-declarations` assertions + `verify-release-deps.mjs` against each fixture | each fixture fails with a message naming the offending dep and file; the clean tree passes |
| E2 | design "Manifests and types" (`tsconfig.base.json` paths) | EP | L1 | automated | `tsconfig.base.json` | parse `compilerOptions.paths` | no key matches `^@mariozechner/pi-`; `@earendil-works/pi-*` keys present |
| E3 | pi-core-version-check "Core package discovery without the legacy fork" | decision-table {earendil ∈ {absent, global, managed}} × {fork ∈ {absent, global, managed}} | L1 | automated | mocked `npm ls -g` JSON + managed `node_modules` per combo (9 combos) | `PiCoreChecker.getStatus({refresh:true})` | `packages[].name` never contains `@mariozechner/pi-coding-agent`; contains `@earendil-works/pi-coding-agent` iff installed, with the matching `installSource` |
| E4 | pi-core-version-check "Core package display names" | EP | L1 | automated | earendil installed globally | `getStatus()` | earendil `displayName === "pi (core agent)"`; no status entry or display string contains "legacy fork" |
| E5 | pi-core-version-check REMOVED "pi.dev version check" | EP (env × package) | L1 | automated | earendil `1.0.0` installed; `fetchLatest` stub → `"1.0.2"`; global `fetch` spy; `PI_OFFLINE` / `PI_SKIP_VERSION_CHECK` unset | `getStatus({refresh:true})` | `latestVersion === "1.0.2"`, `updateAvailable === true`; `fetch` spy never called with a `pi.dev` URL |
| E6 | pi-core-version-check "Core package update execution for discovered packages only" | EP | L1 | automated | status lists earendil only; updater spy | `POST /api/pi-core/update {packages:["@mariozechner/pi-coding-agent"]}` | HTTP 400, `error === "Unknown package(s): @mariozechner/pi-coding-agent"`; updater spy not called |
| E7 | same | decision-table (mixed list) | L1 | automated | status lists earendil | `POST /api/pi-core/update {packages:["@earendil-works/pi-coding-agent","@mariozechner/pi-coding-agent"]}` | HTTP 400 naming only the fork; updater not called for either package (all-or-nothing) |
| E8 | server-launch "Unified jiti resolution … anchored at earendil pi" ("Managed legacy fork is not an anchor") | state (anchor chain) | L1 | automated | managed dir has only `node_modules/@mariozechner/pi-coding-agent` + its jiti; `which("pi")` → null; `opts.anchor` tree contains upstream `jiti` | `ToolResolver.resolveJiti({anchor})` | returns the anchor tree's `jiti-register.mjs` URL; the URL does not contain `@mariozechner/pi-coding-agent` |
| E9 | design decision 3 (`isPiCodingAgentName`) | EP | L1 | automated | names `pi-coding-agent`, `@earendil-works/pi-coding-agent`, `@other/pi-coding-agent`, `pi-coding-agent-x`, `@x/pi-ai`, `""`, `undefined` | `isPiCodingAgentName(name)` | `true` for the first 3, `false` for the rest |
| E10 | design decision 3 (`readPiEnginesFloor`) | EP | L1 | automated | spawned pi entry under `@other/pi-coding-agent` whose manifest declares `engines.node: ">=24.1.0"` | `readPiEnginesFloor(piEntry)` | `{floor: "24.1.0", source: "engines"}`, not the `MIN_SUPPORTED_NODE` fallback |
| E11 | tool-registry "Registered tool set" (pi / pi-coding-agent / pi-ai) | EP (platform × tool) | L1 | automated | stubbed resolvers returning null; `platform ∈ {win32, linux}` | enumerate strategies of `pi`, `pi-coding-agent`, `pi-ai` | no strategy path or spec string contains `@mariozechner`; the earendil bare-import / managed / npm-global strategies appear in the documented order |
| E12 | package-management "Pi module resolution from the earendil package only" ("Legacy-fork-only install is not resolved") | fault (absent primary) | L1 | automated | only `@mariozechner/pi-coding-agent` present, in managed and npm-global roots | `loadPiPackageManager()` | rejects with a message containing "pi-coding-agent is not installed" |
| E13 | same ("Legacy fork alongside earendil is ignored") | decision-table | L1 | automated | both packages in managed `node_modules`; fs/import spies | `loadPiPackageManager()` | resolves from the earendil path; no spy call references `@mariozechner` |
| E14 | bridge-extension "… at the active earendil pi cli" ("Error message names only the earendil pi package") | EP | L1 | automated | none | `new JitiNotFoundError().message` | contains `@earendil-works/pi-coding-agent`; contains neither `@mariozechner/pi-coding-agent` nor `@oh-my-pi` |
| E15 | design decision 3 (by-name probe earendil-only) | EP | L1 | automated | `createRequire` stub resolves `@mariozechner/pi-coding-agent/package.json` (version `0.69.0`) but not earendil; registry `resolve("pi")` → not ok | `readCurrentPiVersion(registry)` | returns `undefined`; the stub's `resolve` was never called with an `@mariozechner` specifier |
| E16 | design decision 3 (registry fallback is scope-agnostic) | EP | L1 | automated | registry `resolve("pi")` → bin that realpaths into `@other/pi-coding-agent/dist/cli.js`, manifest version `0.69.0` | `readCurrentPiVersion(registry)` | returns `"0.69.0"` |
| E17 | pi-core-version-check "A session running below the floor is flagged" (scope-agnostic read) | BVA (walk) | L1 | automated | (a) `argv1` under `@other/pi-coding-agent@0.73.1`; (b) the nearest manifest is a non-pi package nested inside the pi package; (c) no pi manifest within the walk | `readRunningPiVersion(argv1, fs)` | (a) `"0.73.1"`; (b) skips the non-pi manifest and returns the outer pi version; (c) `undefined` |
| E18 | design decision 3 (shared walk-up must not broaden other readers) | regression pin | L1 | automated | an `@other/pi-coding-agent` manifest resolvable by name only | `defaultReadPiVersion()` | behaviour is identical before and after the change (pinned expected value) |
| E19 | dependency-auto-update "Periodic outdated check" ("Legacy fork is never checked") | EP (starter ∈ {standalone, electron}) | L1 | automated | `npm.outdatedOr` / `npm.outdatedGlobalOr` spies | `checkOutdated(starter)` | spies are called for `@earendil-works/pi-coding-agent` and `@fission-ai/openspec` only; never for `@mariozechner/pi-coding-agent` |
| E20 | package-install "Package queue dispatches by operation kind" | EP | L1 | automated | `enqueue({source:"pi-core:@earendil-works/pi-coding-agent", kind:"pi-core", action:"update", scope:"global"})` | queue dispatch | POST `/api/pi-core/update` with body exactly `{packages:["@earendil-works/pi-coding-agent"]}`; no POST to `/api/packages/update` |
| E21 | repo-wide fork-removal gate (proposal "Verification") | static scan | L1 | automated | source tree under `packages/ scripts/ qa/`, `tsconfig.base.json`, `package.json` (excluding node_modules / out / dist / *.md / scripts/ab-context) | vitest repo-scan for `mariozechner(?![\\/]jiti)` | zero hits outside the allowlist (node-spawn history comment, `not.toContain("@mariozechner")` negatives, the forbidden-name assertions); a seeded fixture string fails the scan |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | pi-core-version-ui "Breaking-change icon on Core rows" ("Icon hidden for non-pi packages") | state | L1 | automated | `usePiCoreVersions` mock returns a stale row `{name:"@mariozechner/pi-coding-agent", updateAvailable:true}` plus an earendil row with an update | render `UnifiedPackagesSection` | no what's-new icon on the fork row; `fetch` called for `/api/pi-core/changelog?pkg=@earendil-works%2Fpi-coding-agent…` only, never with the fork name |
| F2 | pi-core-version-ui "Core sub-group rows read from `usePackageOperations`" ("Update All produces serialized per-row state") | state-convergence | L1 | automated | 2 updatable Core rows (earendil, dashboard) | click Update All | exactly 2 pi-core ops queued FIFO; first row `running`, second `queued`; after the first POST resolves, the second transitions to `running`; 2 POSTs, each `{packages:[oneName]}` |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | pi-core-version-check REMOVED "pi.dev version check" (npm is the sole source) | fault-injection (abort) | L1 | automated | `fetchLatest` throws (network error) for earendil | `getStatus({refresh:true})` | earendil row has `latestVersion === null` and `updateAvailable === false`; no pi.dev request is attempted as a fallback |
| X2 | pi-core-version-check "A session running below the floor is flagged" ("Unknown version" path) | fault-injection | L1 | automated | `fs.readFile` throws on the first manifest during the walk | `readRunningPiVersion(argv1, fs)` | returns `undefined` and does not throw |
| X3 | pi-core-version-check "Running legacy fork is flagged" | regression (fault: unsupported pi) | L1 | automated | session registers with `piVersion: "0.73.1"`; `piCompatibility.minimum === "1.0.0"` | server processes the session's version report | session record carries the below-floor flag; a session reporting `"1.0.0"` does not |
| M1 | pi-core-version-check discovery + pi-core-version-ui, on a real install | live verification | — | manual-only | real machine with both `@earendil-works/pi-coding-agent` and `@mariozechner/pi-coding-agent` installed globally | open Settings → Pi Ecosystem after reload/restart | [judgment on a real host] a single "pi (core agent)" row; `curl /api/pi-core/versions` lists no fork |
| M2 | proposal "fork pi on PATH may still spawn" + below-floor warning, on a real install | live verification | — | manual-only | real machine where the only `pi` on PATH is the fork | spawn a session from the dashboard | [judgment on a real host] the session runs; its card and chat show a below-floor warning naming the fork's version and `1.0.0` |

---

## Coverage summary

- Requirements covered: 17/17 delta requirements (ADDED / MODIFIED / REMOVED with behavioural impact) plus design decision 3 and the proposal gate.
- Scenarios by class: edge 21 · perf 0 · frontend 2 · error 3 + 2 manual
- Scenarios by level: L1 26 · L2 0 · L3 0
- Scenarios by disposition: automated 26 · manual-only 2

## New infra needed

- none. E21 extends the repo-scan pattern of `packages/shared/src/__tests__/no-direct-child-process.test.ts`. M2 would need a docker harness image with the fork preinstalled to automate, which is not worth it for a removal change.
