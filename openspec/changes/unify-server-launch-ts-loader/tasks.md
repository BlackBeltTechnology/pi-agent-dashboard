## 1. Resolver consolidation (additive, no migration yet)

- [ ] 1.1 Add `resolveJiti(opts?: { anchor?: string }): string | null` to `ToolResolver` in `packages/shared/src/platform/binary-lookup.ts`. Resolution order: managed pi → system pi via `which("pi")` → `opts.anchor` (resolve up to nearest `node_modules`) → `process.argv[1]`. Returns absolute path to `node_modules/@mariozechner/jiti/lib/jiti-register.mjs` or null.
- [ ] 1.2 Add `resolveTsLoader(opts?: { anchor?: string; preferTsx?: boolean }): { loader: "jiti" | "tsx"; importPath: string } | null`. Default order: jiti → tsx. `preferTsx: true` flips order (legacy Electron path until §3.4 lands).
- [ ] 1.3 Unit tests covering: managed-pi hit, system-pi hit, anchor walk-up, argv fallback, all-miss → null, Windows path separators. Mirror existing `resolve-jiti.test.ts` cases.

## 2. Shared server launcher

- [ ] 2.1 Create `packages/shared/src/server-launcher.ts` exporting `launchDashboardServer(opts: LaunchOpts): Promise<{ pid: number; healthOk: boolean }>` where `LaunchOpts` covers: `node` (path), `cliPath`, `extraArgs`, `loader` (`"auto" | "jiti-only" | { kind: "tsx" } | { kind: "jiti"; path: string }`), `env` (or auto via `ToolResolver.buildSpawnEnv()`), `stdio` (`"ignore" | { logFile: string }`), `healthTimeoutMs`, `port`.
- [ ] 2.2 Internally: resolve loader (when `auto`), build argv via existing `buildNodeImportArgv` from `packages/shared/src/platform/node-spawn.ts`, spawn detached via `spawnDetached`, then poll `/api/health` until `healthTimeoutMs` (or skip when `stdio: ignore`).
- [ ] 2.3 Update `packages/shared/src/__tests__/no-raw-node-import.test.ts` allow-list: add `packages/shared/src/server-launcher.ts`. Verify only `node-spawn.ts` and `server-launcher.ts` may construct `--import` argv.
- [ ] 2.4 Unit tests for `launchDashboardServer`: jiti-only loader, auto with jiti hit, auto with jiti miss + tsx hit, auto with both miss → typed error, log-file stdio, env merge, health-poll timeout. Mock `spawnDetached` and `fetch`.

## 3. Migrate call sites

- [ ] 3.1 `packages/extension/src/server-launcher.ts`: replace inline spawn with `launchDashboardServer({ loader: "jiti-only", stdio: "ignore", healthTimeoutMs: 2000, ... })`. Keep file as thin wrapper for the `pi` `bridge` integration.
- [ ] 3.2 `packages/server/src/cli.ts` `cmdStart`: replace inline spawn with `launchDashboardServer({ loader: "auto", stdio: { logFile }, healthTimeoutMs: 5000 })`.
- [ ] 3.3 `packages/electron/src/lib/launch-source.ts` `spawnFromSource`: replace `resolveJitiFromAnchor` + manual spawn with `launchDashboardServer({ loader: "auto", anchor: source.cliPath, stdio: { logFile }, healthTimeoutMs: 15000, env: buildSpawnEnv() })`.
- [ ] 3.4 `packages/electron/src/lib/server-lifecycle.ts` `launchServer` (legacy V1 path): if reachable when `LAUNCH_SOURCE_V2=false`, migrate to `launchDashboardServer`; if dead code, delete with the V2-flag removal change.
- [ ] 3.5 Existing per-call-site tests updated to mock `launchDashboardServer` instead of `node:child_process`.

## 4. Deletions

- [ ] 4.1 Delete `packages/shared/src/resolve-jiti.ts` and its test. Update any non-launch callers (search confirms only test file and re-exports).
- [ ] 4.2 Delete `packages/electron/src/lib/ts-loader-resolver.ts`.
- [ ] 4.3 Remove `resolveJitiFromPi` from `packages/electron/src/lib/server-lifecycle.ts` if `launchServer` is gone after §3.4; otherwise convert to thin call into `ToolResolver.resolveJiti()`.
- [ ] 4.4 Remove `resolveJitiFromAnchor` from `packages/electron/src/lib/launch-source.ts` (replaced by `launchDashboardServer` internal resolution).
- [ ] 4.5 Update `AGENTS.md` Key Files: drop `src/shared/resolve-jiti.ts` row; add `packages/shared/src/server-launcher.ts` row.

## 5. Coordination & cleanup

- [ ] 5.1 If `replace-tsx-with-jiti` has landed: drop tsx branch from `resolveTsLoader` and from `LaunchOpts.loader` union. Single jiti path remains.
- [ ] 5.2 If this change lands first: `replace-tsx-with-jiti` only needs to delete the tsx branch + dependency; no spawn-site edits required.
- [ ] 5.3 Add CHANGELOG entry under `## [Unreleased]` noting the consolidation and any minor behavioural shifts (error message text, log-file paths if changed).

## 6. Validation

- [ ] 6.1 `openspec validate unify-server-launch-ts-loader --strict` passes.
- [ ] 6.2 All unit + integration test suites green: extension, server, electron.
- [ ] 6.3 Manual smoke: each starter (Bridge auto-spawn, `pi-dashboard start`, Electron cold-launch via every `LaunchSource`) reaches `bootstrap.status=ready` and `/api/health` returns the matching `starter`.
- [ ] 6.4 Repo-lint: `no-raw-node-import` + `no-direct-process-kill` still pass with updated allow-list.
