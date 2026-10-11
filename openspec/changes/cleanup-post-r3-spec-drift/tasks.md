## 1. Doctor: drop tsx probes (TDD)

Red-first. Every test below is written before 1.2 and must fail first, except E4/E6, which may already pass and pin behaviour. Harness exemplar for all doctor rows: the `TypeScript loader row follows PI_DASHBOARD_TS_LOADER (E30)` describe block in `packages/shared/src/__tests__/doctor-core.test.ts` (`baseDeps(env)` + `row(checks)`).

- [ ] 1.1a Add test (test-plan #E1) in `packages/shared/src/__tests__/doctor-core.test.ts`, E30 block (see its `baseDeps`):
  - input: jiti mode, empty managed dir, injected `resolvePackageJson` → `null` for `jiti`, a path for `tsx`;
  - trigger: `runSharedChecks`;
  - observable: the "TypeScript loader" row has `status: "error"`, `code: "doctor.ts_loader_not_found"`, and `message`/`detail`/`suggestion` each fail `/tsx/i`.

  Verify it fails before 1.2.
- [ ] 1.1b Add test (test-plan #E2), same file/block:
  - input: jiti mode, managed dir with only `node_modules/tsx/package.json`, default resolver;
  - trigger: `runSharedChecks`;
  - observable: row `message` fails `/tsx/i` and names jiti.

  Verify it fails before 1.2.
- [ ] 1.1c Add test (test-plan #E3), same file/block:
  - input: env unset (native), empty managed dir;
  - trigger: `runSharedChecks`;
  - observable: row `status: "ok"`, `message` contains `native-ts-register.mjs`, and `message`/`detail`/`suggestion` fail `/tsx/i`.

  Verify it passes. It pins the native path.
- [ ] 1.1d Add test (test-plan #E4), same file/block:
  - input: jiti mode, managed dir with `node_modules/jiti/package.json` (`version: "9.9.9"`);
  - trigger: `runSharedChecks`;
  - observable: row `status: "ok"`, `message` contains `9.9.9` and the managed jiti dir.

  Verify it passes.
- [ ] 1.1e Add test (test-plan #E5), same file. Exemplar: the source-reading "stays gone" tests in `packages/shared/src/__tests__/bundle-runtime-contract.test.ts`:
  - input: `doctor-core.ts` source with comments stripped;
  - trigger: read the file;
  - observable: no `which tsx` / `where tsx`, no `tryResolvePkg("tsx")` / `resolvePackageJson("tsx")`, no `"node_modules", "tsx"`.

  Verify it fails before 1.2.
- [ ] 1.1f Add test (test-plan #X1), same file/block:
  - input: jiti mode, injected `resolvePackageJson` that throws for `jiti`;
  - trigger: `runSharedChecks`;
  - observable: resolves without rejection, and the "TypeScript loader" row is present with `status: "error"`.

  Verify it fails before 1.2 (the seam does not exist yet).
- [ ] 1.1g Add test (test-plan #E6) in `packages/shared/src/__tests__/doctor-core-row-set.test.ts` (exemplar: its "has a TypeScript loader row and no offline-packages row" test):
  - input: default deps;
  - trigger: `runSharedChecks`;
  - observable: the check named `TypeScript loader` has `section: "server"`, and no check is named `TypeScript loader (tsx)`.

  Verify it passes.
- [ ] 1.1h Rename the existing E30 test at ~583 from "still probes for jiti/tsx" to "probes for jiti". Verify `grep -n "jiti/tsx" packages/shared/src/__tests__/doctor-core.test.ts` returns nothing.
- [ ] 1.2 In `packages/shared/src/doctor-core.ts`:
  - add the optional `resolvePackageJson?: (name: string) => string | null` to `SharedChecksDeps`, and route the bundled-jiti lookup (~1288, `tryResolvePkg("jiti")`) through `(deps.resolvePackageJson ?? tryResolvePkg)("jiti")`;
  - remove the managed-tsx, bundled-tsx and system-`tsx` lookups and their `ok` branches from the "TypeScript loader" check;
  - change the remediation text (~542) to "No TypeScript loader (jiti) found…";
  - rewrite the error `detail` (~1346) without `managedTsxPkg` / bundled tsx / PATH;
  - reword the comments at ~32-33 and ~1253-1256 that call tsx a fallback.

  Verify `npx vitest run packages/shared/src/__tests__/doctor-core.test.ts packages/shared/src/__tests__/doctor-core-row-set.test.ts` passes: tests 1.1a–1.1g are green and the old E30 tests stay green.
- [ ] 1.3 Check the other doctor tests for tsx-loader expectations: `grep -n "tsx" packages/shared/src/__tests__/doctor-*.test.ts packages/electron/src/__tests__/doctor.test.ts packages/server/src/__tests__/doctor-route.test.ts`. Fix any hit. Verify `npx vitest run packages/shared/src/__tests__ packages/electron/src/__tests__/doctor.test.ts packages/server/src/__tests__/doctor-route.test.ts` passes.

## 2. Dead protocol types and stale comments

- [ ] 2.0a Add test (test-plan #E13) in a new `packages/shared/src/__tests__/removed-symbols-stay-gone.test.ts`. Exemplar: `packages/shared/src/__tests__/bundle-runtime-contract.test.ts` ("removed bundled-extensions step stays gone (X5)"):
  - input: text of `packages/shared/src/browser-protocol.ts`;
  - trigger: read in vitest;
  - observable: no `bootstrap_status_update`, `bootstrap_ticket_complete` or `BootstrapStateSnapshot`.

  Verify it fails before 2.1.
- [ ] 2.0b Add test (test-plan #E12), same new file and exemplar:
  - input: `git grep -nwE '(resolveJitiImport|resolveJitiFromAnchor|resolveJitiFromPi|pickJitiRegisterUrl|pickJitiFromAnchor|buildJitiRegisterUrl)[[:space:]]*\(' -- packages/ ':!packages/**/dist/**' ':!packages/**/out/**' ':!packages/electron/resources/**'` plus the `ts-loader-resolver` grep over `packages/**/*.ts` (same excludes), run via `execFileSync("git", …)` from the repo root;
  - trigger: vitest run;
  - observable: both return empty stdout (exit 1 handled as "no match").

  Verify it fails before 2.4 (it hits `no-raw-node-import.test.ts:46`).
- [ ] 2.1 Delete `BootstrapStateSnapshot`, `BootstrapStatusUpdateMessage` and `BootstrapTicketCompleteMessage` (and their doc-comments) from `packages/shared/src/browser-protocol.ts`. Remove both members from the `ServerToBrowserMessage` union. Reword the `WorktreeInitProgressMessage` comment that cites them. Verify:
  - `git grep -nE "Bootstrap(StateSnapshot|StatusUpdateMessage|TicketCompleteMessage)" -- packages/ ':!packages/**/dist/**' ':!packages/**/out/**' ':!packages/electron/resources/**' ':!*.md'` returns nothing;
  - `npx tsc --noEmit -p packages/shared && npx tsc --noEmit -p packages/client && npx tsc --noEmit -p packages/server` all exit 0.
- [ ] 2.2 Fix the stale comments in `packages/electron/scripts/bundle-server.mjs` (~77-82, ~209-222, ~513, ~563). They cite the "Phase 1/5" timeline, the `offline-packages.json` pin source, Electron's `extractBundle` and the "extracted layout". State the current read-only bundled-tree facts instead. Verify `grep -nE "offline-packages|extractBundle|extracted layout|Phase [15] of change" packages/electron/scripts/bundle-server.mjs` returns nothing.
- [ ] 2.3 In `packages/shared/src/tool-registry/definitions.ts` (~531-534), rewrite the `tsx` note: tsx is not a server loader (native default, jiti opt-in). Verify `grep -n "co-installed" packages/shared/src/tool-registry/definitions.ts` returns nothing.
- [ ] 2.4 In `packages/shared/src/__tests__/no-raw-node-import.test.ts` (~46), drop the `resolveJitiImport()` / `resolveJitiFromAnchor()` allowlist bullet. In `packages/shared/src/platform/node-spawn.ts` (~83), drop the "Mirrors … `resolve-jiti.ts::buildJitiRegisterUrl`" pointer. Verify:
  - `npx vitest run packages/shared/src/__tests__/no-raw-node-import.test.ts` passes;
  - `grep -n "resolve-jiti.ts" packages/shared/src/platform/node-spawn.ts` returns nothing;
  - the server-launch guard `git grep -nwE '(resolveJitiImport|resolveJitiFromAnchor|resolveJitiFromPi|pickJitiRegisterUrl|pickJitiFromAnchor|buildJitiRegisterUrl)[[:space:]]*\(' -- packages/ ':!packages/**/dist/**' ':!packages/**/out/**' ':!packages/electron/resources/**'` returns nothing.
- [ ] 2.5 In `packages/shared/src/recommended-extensions.ts` (~624, ~646), fix the `BUNDLED_EXTENSION_IDS` doc-comment: it is an empty manifest, with no installer pre-bundle path. Drop the references to `installBundledExtensions()`/`dependency-installer.ts` and `bundle-recommended-extensions.mjs`. Verify:
  - `grep -nE "dependency-installer|bundle-recommended-extensions" packages/shared/src/recommended-extensions.ts` returns nothing;
  - `npx vitest run packages/shared/src/__tests__/recommended-extensions.test.ts` passes.

- [ ] 2.6 In `packages/server/src/__tests__/cli-version.test.ts` (~7-9), put the `probeNpmGlobal` rationale in the past tense: the probe is deleted. Verify `npx vitest run packages/server/src/__tests__/cli-version.test.ts` passes.

## 2b. Launch-source and bundled-manifest scenario tests (re-specified contract, code unchanged)

- [ ] 2.7 Run the existing test (test-plan #E7) in `packages/electron/src/lib/__tests__/launch-source.test.ts`, "throws BundledServerMissingError when no source resolves":
  - input: `isPackaged: true`, no runtime candidates, bundled `cli.ts` absent;
  - trigger: `selectLaunchSource`;
  - observable: rejects with `BundledServerMissingError`, and its `cliPath` is the bundled server entry.

  Extend it to assert `cliPath` if it does not already. Verify `npx vitest run packages/electron/src/lib/__tests__/launch-source.test.ts` passes.
- [ ] 2.8 Extend the existing test (test-plan #E8) in `launch-source.test.ts`, "rejects pre-R3 source kinds (piExtension, npmGlobal, extracted) individually". Exemplar for the log assertion: `packages/electron/src/lib/__tests__/launch-source-logging.test.ts` ("writes to BOTH stderr (warn) and log file"):
  - input: `DASHBOARD_PREFER_SOURCE` ∈ {`piExtension`, `npmGlobal`, `extracted`};
  - trigger: `parsePreferOverride`;
  - observable: returns `null`, and the warning containing `[launch-source]` plus the raw value goes through `logLaunchSource`.

  Verify the file passes.
- [ ] 2.9 Extend the existing test (test-plan #E9) in `launch-source.test.ts`, "returns bundled when resourcesPath/server/.../cli.ts exists":
  - input: `resourcesPath: "/fake/resources"`, `existsSync` true only for the bundled `cli.ts`;
  - trigger: `selectLaunchSource`;
  - observable: `{ kind: "bundled", cwd: "/fake/resources/server" }`, and the injected probes expose no write/mkdir/rm path (only `healthProbe`/`existsSync` are called).

  Verify it passes.
- [ ] 2.10 Add test (test-plan #E10) in `packages/electron/src/lib/__tests__/launch-source-shared-primitive.test.ts`. Exemplar: its "calls launchDashboardServer with source.cliPath and no tsx binary" test, which mocks `launchDashboardServer`:
  - input: a `bundled` source;
  - trigger: `spawnFromSource(source, {port, piPort})`;
  - observable: the captured options have `detach === false`, `env.DASHBOARD_STARTER === "Electron"` and `cwd === source.cwd`.

  Verify it passes.
- [ ] 2.11 Add test (test-plan #E11), same file/exemplar:
  - input: `pickNodeForServer` → `execpath-fallback` (no bundled node);
  - trigger: `spawnFromSource`;
  - observable: captured `env.ELECTRON_RUN_AS_NODE === "1"`, and a `[pick-node]` warning is logged.

  Verify it passes.
- [ ] 2.12 Run the existing test (test-plan #E14) in `packages/shared/src/__tests__/recommended-extensions.test.ts`, "contains exactly the v0.x initial bundled set":
  - input: `BUNDLED_EXTENSION_IDS`;
  - trigger: import;
  - observable: deep-equals `[]`.

  Verify the file passes.
- [ ] 2.13 Add test (test-plan #E15) in `packages/server/src/__tests__/installed-package-enricher.test.ts`. Exemplar: its `existsFn: (p) => p === "/res/bundled-extensions/pi-flows"` case at ~147:
  - input: recommended row `pi-flows`, `resourcesPath` set, `existsFn` true for `<res>/bundled-extensions/pi-flows`, DEFAULT `bundledIds` (no override);
  - trigger: `enrichInstalledRow`;
  - observable: `isBundled === false`.

  Verify it passes.
- [ ] 2.14 Run the existing test (test-plan #E16) in `packages/shared/src/__tests__/bundle-runtime-contract.test.ts`, "removed bundled-extensions step stays gone (X5)":
  - input: `_electron-build.yml`, `publish.yml`;
  - trigger: vitest;
  - observable: neither references `bundle-recommended-extensions`.

  Verify the file passes.
- [ ] 2.15 Manual (test-plan: manual-only, #E17): when a future change adds a workflow build tool, the reviewer confirms that `<pkg>` is declared in a workspace `package.json` and the lockfile is regenerated. No test; deferred post-merge.

## 3. Main-spec Purpose edits (not carried by deltas)

- [ ] 3.1 Rewrite the `## Purpose` of `openspec/specs/electron-launch-source/spec.md` to list the live kinds (running, dev monorepo, local link, staged overlay, bundled). Verify `sed -n '/^## Purpose/,/^## Requirements/p' openspec/specs/electron-launch-source/spec.md | grep -ciE "pi extension|npm global|extracted"` prints 0.
- [ ] 3.2 Rewrite the `## Purpose` of `openspec/specs/bundled-recommended-extensions/spec.md`: drop the build-time script, ExtraResource, first-run activation and size budget, and keep the manifest + requires/probe scope. Verify `sed -n '/^## Purpose/,/^## Requirements/p' openspec/specs/bundled-recommended-extensions/spec.md | grep -ciE "bundling script|ExtraResource|first-run|size budget"` prints 0.
- [ ] 3.3 Rewrite the `## Purpose` of `openspec/specs/electron-qa-coverage/spec.md`: drop the "degraded managed `node_modules`" failure-mode framing. Verify `sed -n '/^## Purpose/,/^## Requirements/p' openspec/specs/electron-qa-coverage/spec.md | grep -ciE "degraded managed"` prints 0 (the v0.4.6 incident may stay as history).

## 4. Validate and close out

- [ ] 4.1 Run `openspec validate cleanup-post-r3-spec-drift --strict`. Verify it prints "is valid".
- [ ] 4.2 Run a residual-drift sweep over the live specs. Use `git grep -nE "resolve-jiti\.ts|ts-loader-resolver|needsExtraction|extractBundle|buildExtractedSource|extractedSourceIsHealthy|probeNpmGlobal|piExtension`|bundle-recommended-extensions|dependency-installer|installBundledExtensions|Bootstrap(StateSnapshot|StatusUpdateMessage|TicketCompleteMessage)|TypeScript loader \(tsx\)|Stage 9" -- openspec/specs/`. Verify every hit is either:
  - a negative guard;
  - a requirement this change REMOVES or MODIFIES (so it disappears at archive); or
  - a design.md Non-Goal.

  Record any other hit as a follow-up. (The pattern matches only the backticked launch kind `` `piExtension` ``. `piExtensions` and the `piExtension` seed kind are live plugin-loader vocabulary, so they are excluded.)
- [ ] 4.3 Run the full suite: `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log; grep -nE 'FAIL|Tests +[0-9]+ failed' /tmp/pi-test.log`. Verify exit 0 and no grep hits.
- [ ] 4.4 Update the DOX record of every touched source file with `See change: cleanup-post-r3-spec-drift`:
  - sidecars: `packages/shared/src/doctor-core.ts.AGENTS.md`, `packages/shared/src/browser-protocol.ts.AGENTS.md` (drop `BootstrapStateSnapshot`) and `packages/shared/src/recommended-extensions.ts.AGENTS.md`;
  - rows: the primary `definitions.ts` row in `packages/shared/src/tool-registry/AGENTS.md` (the row describing tool registration), `node-spawn.ts` and `no-raw-node-import.test.ts` in `packages/shared/src/platform/AGENTS.md`, and `bundle-server.mjs` in `packages/electron/AGENTS.md`.

  Verify:
  - `for f in packages/shared/src/doctor-core.ts.AGENTS.md packages/shared/src/browser-protocol.ts.AGENTS.md packages/shared/src/recommended-extensions.ts.AGENTS.md packages/shared/src/tool-registry/AGENTS.md packages/shared/src/platform/AGENTS.md packages/electron/AGENTS.md; do grep -q cleanup-post-r3-spec-drift $f || echo MISSING $f; done` prints nothing;
  - `git grep -n "BootstrapStateSnapshot" -- '*AGENTS.md' ':!packages/electron/resources/**'` returns nothing.
- [ ] 4.5 Run the `review-code` skill on the diff, then `npm run quality:changed`. Verify there are no unresolved blocker/major review findings and `quality:changed` exits 0.
