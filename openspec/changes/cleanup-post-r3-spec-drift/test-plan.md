# Test Plan — cleanup-post-r3-spec-drift

Stage: design   Generated: 2026-10-03

Hard gate passed: every Triple below fills from the delta specs plus the code facts cited in design.md, with no open clarifications. Most of the change is spec text. The behavioural surface is:
- the doctor "TypeScript loader" row;
- the launch-source contract (re-specified, code unchanged);
- the "stays gone" guards for deleted symbols and types;
- the empty bundled manifest.

Rows marked "(existing)" are already covered by a test. Their folded task re-runs or extends that test, with no new infra.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | dashboard-server "Doctor does not probe for tsx" → "jiti mode ignores an installed tsx" | decision-table (loader=jiti × jiti absent × tsx present) | L1 | automated | `PI_DASHBOARD_TS_LOADER=jiti`; empty managed dir; injected `resolvePackageJson` → `null` for `jiti`, a path for `tsx` | `runSharedChecks(deps)` | "TypeScript loader" row: `status === "error"`, `code === "doctor.ts_loader_not_found"`; `message`, `detail`, `suggestion` each fail `/tsx/i` |
| E2 | same → "jiti mode ignores an installed tsx" (managed tsx variant) | decision-table (jiti × managed tsx only × bundled jiti resolvable) | L1 | automated | jiti mode; managed dir has only `node_modules/tsx/package.json`; default resolver | `runSharedChecks(deps)` | row `message` fails `/tsx/i` and names jiti (the bundled copy), not tsx |
| E3 | same → "Doctor output omits tsx" | decision-table (loader=native) | L1 | automated | env unset (native); empty managed dir | `runSharedChecks(deps)` | row `status === "ok"`, `message` contains `native-ts-register.mjs`; `message`/`detail`/`suggestion` fail `/tsx/i` |
| E4 | same → "jiti mode reports the resolved jiti" | decision-table (jiti × managed jiti present) | L1 | automated | jiti mode; managed dir has `node_modules/jiti/package.json` with `version: "9.9.9"` | `runSharedChecks(deps)` | row `status === "ok"`, `message` contains `9.9.9` and the managed jiti dir |
| E5 | same (requirement body: no tsx probe on any Doctor surface) | static source assertion | L1 | automated | text of `packages/shared/src/doctor-core.ts` with comments stripped | read the file in a vitest | no `which tsx` / `where tsx`, no `tryResolvePkg("tsx")` / `resolvePackageJson("tsx")`, no `"node_modules", "tsx"` |
| E6 | doctor-diagnostic "Section taxonomy on every check" → "Server-related checks are tagged server" | equivalence partition (live check name) | L1 | automated | default deps | `runSharedChecks(deps)` | the check named exactly `TypeScript loader` has `section === "server"`; no check is named `TypeScript loader (tsx)` |
| E7 | electron-launch-source "Discriminated launch-source resolution" → "Default precedence" (existing) | state-transition (probe chain) | L1 | automated | `isPackaged: true`, no runtime candidates, bundled `cli.ts` absent | `selectLaunchSource(opts)` | rejects with `BundledServerMissingError` whose `cliPath` is `<res>/server/node_modules/@blackbelt-technology/pi-dashboard-server/src/cli.ts` |
| E8 | electron-launch-source "Discriminated launch-source resolution" → "Invalid override value" + "Launch-source probe contracts" → "Invalid override is logged to the dashboard log" | equivalence partition (retired kind names) | L1 | automated | `DASHBOARD_PREFER_SOURCE` ∈ {`piExtension`, `npmGlobal`, `extracted`} | `parsePreferOverride(env)` | returns `null`; a warning containing `[launch-source]` and the raw value is emitted through the dashboard-log writer (`logLaunchSource`) |
| E9 | electron-launch-source "Launch-source probe contracts" → "bundled probe" | BVA (resourcesPath set/unset × cli present/absent) | L1 | automated | `resourcesPath: "/fake/resources"`, `existsSync` true only for the bundled `cli.ts`; spy on fs writes | `selectLaunchSource(opts)` | returns `{ kind: "bundled", cwd: "/fake/resources/server" }`; zero write/mkdir/rm calls |
| E10 | electron-launch-source "Uniform spawn primitive across launch sources" → "All non-attach sources spawn identically" | state assertion (spawn options) | L1 | automated | mocked `launchDashboardServer`; `bundled` source | `spawnFromSource(source, {port, piPort})` | the captured options have `detach === false`, `env.DASHBOARD_STARTER === "Electron"`, and `cwd === source.cwd` |
| E11 | same → "execPath fallback when bundled Node is missing" | fault-injection (bundled Node absent) | L1 | automated | `pickNodeForServer` → `{kind:"execpath-fallback"}` (no bundled node) | `spawnFromSource(...)` | captured `env.ELECTRON_RUN_AS_NODE === "1"`; a `[pick-node]` warning is logged |
| E12 | server-launch "Removed predecessors" → "Symbol-presence check" | static guard ("stays gone") | L1 | automated | `git grep -nwE '(resolveJitiImport\|…\|buildJitiRegisterUrl)[[:space:]]*\('` and `'ts-loader-resolver'` over `packages/**/*.ts` (dist/out/resources excluded) | run in a vitest via `execFileSync("git", …)` | both greps exit 1 with empty stdout |
| E13 | (code edit) dead `bootstrap_*` protocol types removed | static guard ("stays gone") | L1 | automated | text of `packages/shared/src/browser-protocol.ts` | read in a vitest | no `bootstrap_status_update`, `bootstrap_ticket_complete` or `BootstrapStateSnapshot` |
| E14 | bundled-recommended-extensions "Bundled extension manifest" → "Initial bundled set" (existing manifest half) | equivalence partition | L1 | automated | `BUNDLED_EXTENSION_IDS` | import | deep-equals `[]` (`recommended-extensions.test.ts` "contains exactly the v0.x initial bundled set") |
| E15 | same → "an installed recommended extension SHALL NOT be reported as bundled" | decision-table (default manifest × dir present) | L1 | automated | a recommended row (e.g. `pi-flows`); `resourcesPath` set; `existsFn` → true for `<res>/bundled-extensions/pi-flows`; DEFAULT `bundledIds` | `enrichInstalledRow(row, opts)` | `isBundled === false` |
| E16 | bundled-recommended-extensions REMOVED "Build-time bundling script" / electron-build-pipeline REMOVED "Size budget" (existing guard) | static guard | L1 | automated | `.github/workflows/_electron-build.yml`, `publish.yml` | `bundle-runtime-contract.test.ts` X5 | neither references `bundle-recommended-extensions` |
| E17 | ci-cd-pipeline "Workflow build tools are declared dependencies" → "New build-tool added in a future change" | process rule | — | manual-only | a future change adding `node --import <pkg>` / `npx <pkg>` to a workflow | code review of that change | [judgment: reviewer confirms `<pkg>` is in a workspace `package.json` and the lockfile is regenerated. The spec makes automation optional ("Repo-lint enforcement (optional, future)")] |

### Performance

None. The change has no latency, throughput or memory requirement.

### Frontend-quirk

None. No rendered UI changes; the removed protocol messages had no client handler.

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | dashboard-server "Doctor does not probe for tsx" (row never throws) | fault-injection (abort) | L1 | automated | injected `resolvePackageJson` throws for `jiti` | `runSharedChecks(deps)` in jiti mode | resolves (no rejection); "TypeScript loader" row present with `status === "error"` (the `safeCheck` envelope keeps the row) |

---

## Coverage summary

- Requirements covered: 9/10 delta requirements with behaviour. The ADDED/MODIFIED requirements in dashboard-server, doctor-diagnostic, electron-launch-source ×4, server-launch, bundled-recommended-extensions and ci-cd-pipeline are covered by automated rows. The ci-cd rule is manual-only. REMOVED requirements (electron-bundle-extract ×3, electron-qa-coverage, electron-build-pipeline, bundled-recommended-extensions ×4, the electron-launch-source REMOVED blocks) need no behavioural test; the E12/E13/E16 guards and task 4.2's sweep cover their "stays gone" side. platform-primitives' scenario is covered by E12 (no `resolveJitiFromPi(`).
- Scenarios by class: edge 17 · perf 0 · frontend 0 · error 1
- Scenarios by level: L1 17 · L2 0 · L3 0 · manual 1
- Scenarios by disposition: automated 17 · manual-only 1

## New infra needed

- None. E1/X1 need the optional `resolvePackageJson` seam on `SharedChecksDeps`, which is already planned in task 1.2. E12/E13 follow the existing "stays gone" pattern of `bundle-runtime-contract.test.ts`.
