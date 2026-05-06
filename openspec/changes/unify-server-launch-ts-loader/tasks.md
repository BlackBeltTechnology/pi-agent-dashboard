## 1. Resolver consolidation (additive)

- [ ] 1.1 Add `resolveJiti(opts?: { anchor?: string }): string | null` to `ToolResolver` in `packages/shared/src/platform/binary-lookup.ts`. Resolution order: managed pi (`~/.pi-dashboard/node_modules/@mariozechner/pi-coding-agent/package.json` → walk to nearest `node_modules`) → system pi via `which("pi")` → `opts.anchor` (resolved up to nearest `node_modules`) → `process.argv[1]`. Returns the jiti register hook as a `file://` URL string (preserving the existing `buildJitiRegisterUrl` contract — Windows drive letters URL-wrapped) or null.
- [ ] 1.2 Port unit tests from `packages/shared/src/__tests__/resolve-jiti.test.ts` onto `ToolResolver.resolveJiti`: managed-pi hit, system-pi hit, anchor walk-up, argv fallback, all-miss → null, Windows drive-letter URL wrapping, symlink realpath behavior.

## 2. Shared server launcher

- [ ] 2.1 Create `packages/shared/src/server-launcher.ts` exporting `launchDashboardServer(opts: LaunchOpts): Promise<{ pid: number; healthOk: boolean }>` where `LaunchOpts` covers: `nodeBin?` (defaults to `process.execPath`), `cliPath`, `extraArgs`, `anchor?` (forwarded to `resolveJiti`), `env?` (defaults to `ToolResolver.buildSpawnEnv()`), `stdio: "ignore" | { logFile: string }`, `healthTimeoutMs`, `port`.
- [ ] 2.2 Internal flow: call `ToolResolver.resolveJiti({ anchor })` → throw typed `JitiNotFoundError` if null → delegate argv construction to existing `spawnNodeScript({ nodeBin, loader, entry: cliPath, args: extraArgs })` from `packages/shared/src/platform/node-spawn.ts` → wrap in `spawnDetached` with the chosen stdio → poll `/api/health` until `healthTimeoutMs` (skip when `stdio: "ignore"`).
- [ ] 2.3 Tighten `packages/shared/src/__tests__/no-raw-node-import.test.ts`: allow-list becomes exactly `["packages/shared/src/platform/node-spawn.ts", "packages/shared/src/server-launcher.ts"]`. Remove `resolve-jiti.ts` from the list (file is deleted in §4.1). Remove `resolveJitiImport(` / `resolveJitiFromAnchor(` from the URL-looking regex.
- [ ] 2.4 Unit tests: jiti hit → spawn argv shape correct, jiti miss → throws `JitiNotFoundError`, log-file stdio routes streams correctly, env merge with `buildSpawnEnv()`, health-poll timeout. Mock `spawnDetached` and `fetch`.

## 3. Migrate call sites

- [ ] 3.1 `packages/extension/src/server-launcher.ts`: replace `resolveJitiImport()` + raw `["--import", loader, entry, ...]` spawn with `launchDashboardServer({ cliPath: entry, stdio: "ignore", healthTimeoutMs: 2000, ... })`. Remove the `ban:raw-node-import-ok` opt-out comment.
- [ ] 3.2 `packages/server/src/cli.ts cmdStart`: replace `resolveJitiImport()` + raw spawn with `launchDashboardServer({ cliPath, stdio: { logFile }, healthTimeoutMs: 5000 })`. Remove the opt-out comment. Note: the `#!/usr/bin/env node --import tsx` shebang in `cli.ts` is independent — owned by `replace-tsx-with-jiti`.
- [ ] 3.3 `packages/electron/src/lib/launch-source.ts spawnFromSource`: replace the `resolveJitiFromAnchor(source.cliPath) ?? resolveJitiImport()` chain + raw spawn with `launchDashboardServer({ cliPath: source.cliPath, anchor: source.cliPath, stdio: { logFile }, healthTimeoutMs: 15000, env: ToolResolver.buildSpawnEnv() })`. Remove the opt-out comment. Update the `deps?.resolveJitiFromAnchor` test seam to inject `resolveJiti` instead.
- [ ] 3.4 `packages/electron/src/lib/server-lifecycle.ts launchServer`: this is the legacy V1 path (reachable only when `LAUNCH_SOURCE_V2=false`, default-on per simplify-electron-bootstrap-derived-state task 6.5). Decide one of: (a) migrate to `launchDashboardServer` and drop the tsx branch, or (b) delete the function entirely if no caller remains after V2 default. Audit imports; pick the lighter option.
- [ ] 3.5 Update each call site's existing tests to mock `launchDashboardServer` rather than `node:child_process` / `resolveJitiImport`.

## 4. Deletions

- [ ] 4.1 Delete `packages/shared/src/resolve-jiti.ts` and `packages/shared/src/__tests__/resolve-jiti.test.ts` (cases ported in §1.2). `git grep` to confirm zero remaining importers.
- [ ] 4.2 Delete `packages/electron/src/lib/ts-loader-resolver.ts`. `git grep` for importers — should be none after §3.4.
- [ ] 4.3 Remove `resolveJitiFromPi` export from `packages/electron/src/lib/server-lifecycle.ts`. If `launchServer` is gone (per §3.4 option b), trim the file accordingly.
- [ ] 4.4 Delete the `deps.resolveJitiFromAnchor` injection seam in `packages/electron/src/lib/launch-source.ts` (replaced by the launcher's internal call to `resolveJiti`).
- [ ] 4.5 Update `AGENTS.md` Key Files (delegate to general-purpose subagent per Documentation Update Protocol): drop `src/shared/resolve-jiti.ts` row if present; add `packages/shared/src/server-launcher.ts` row.

## 5. Coordination

- [ ] 5.1 Confirm tsx is fully gone from the runtime path post-migration. The only remaining tsx reference becomes the `#!/usr/bin/env node --import tsx` shebang in `packages/server/src/cli.ts`, owned by `replace-tsx-with-jiti`. No tsx code in the new launcher.
- [ ] 5.2 If `replace-tsx-with-jiti` has landed when this change starts: no extra work — tsx was already gone.
- [ ] 5.3 If this change lands first: `replace-tsx-with-jiti` is reduced to (a) bin-bootstrap shebang fix, (b) removing the `tsx` devDependency.
- [ ] 5.4 Add CHANGELOG entry under `## [Unreleased]` noting the consolidation. Mention removed exports for downstream packagers.

## 6. Validation

- [ ] 6.1 `openspec validate unify-server-launch-ts-loader --strict` passes.
- [ ] 6.2 Affected unit suites green: shared (resolveJiti, server-launcher, no-raw-node-import), extension (server-launcher), server (cli), electron (launch-source).
- [ ] 6.3 Manual smoke per starter:
  - Bridge auto-spawn → `/api/health.starter === "Bridge"`.
  - `pi-dashboard start` → `/api/health.starter === "Standalone"`.
  - Electron cold-launch on every `LaunchSource` (devMonorepo, piExtension, npmGlobal, extracted) → `/api/health.starter === "Electron"`.
- [ ] 6.4 Repo-lint: `no-raw-node-import` passes with the tightened 2-entry allow-list. No `ban:raw-node-import-ok` markers remain in `packages/{extension,server,electron}/src/`.
