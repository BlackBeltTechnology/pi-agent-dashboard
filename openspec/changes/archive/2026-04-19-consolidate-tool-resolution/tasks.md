## 1. Foundation — ToolRegistry module (shared)

- [x] 1.1 Create `packages/shared/src/tool-registry/types.ts` with `ToolDefinition`, `Strategy`, `StrategyResult`, `Resolution`, `Source`, `UnknownToolError`, `ModuleResolutionError`
- [x] 1.2 Create `packages/shared/src/tool-registry/overrides.ts` reading/writing `~/.pi/dashboard/tool-overrides.json` via `json-store`; handle missing/malformed files gracefully
- [x] 1.3 Create `packages/shared/src/tool-registry/registry.ts` implementing `ToolRegistry` class with `resolve`, `resolveModule`, `rescan`, `list`, `setOverride`, `clearOverride` and the per-instance cache
- [x] 1.4 Create `packages/shared/src/tool-registry/definitions.ts` registering `pi`, `pi-coding-agent`, `openspec`, `npm`, `node`, `tsx`, `git`, `zrok`, `pi-dashboard` with ordered strategies (override / bare-import / managed / npm-global / where) and classifiers
- [x] 1.5 Add `packages/shared/src/tool-registry/index.ts` barrel + export from the package
- [x] 1.6 Write unit tests for `registry.ts`: first-strategy-wins, failing-strategies-recorded, cache returns referentially-equal Resolution, `rescan` invalidates (one vs all), unknown tool throws `UnknownToolError`, module resolution caches + throws `ModuleResolutionError` with trail
- [x] 1.7 Write unit tests for `overrides.ts`: absent file → empty map, malformed file → warn + empty, set/clear round-trip, atomic write via `json-store`
- [x] 1.8 Write tests for `definitions.ts` strategy chains (use fakes / `existsSync` fixtures) for `pi`, `pi-coding-agent`, and `openspec`
- [x] 1.9 Run `npm test` in `packages/shared`; confirm all new tests pass

## 2. REST API — /api/tools on server

- [x] 2.1 Create `packages/server/src/routes/tool-routes.ts` exposing `GET /api/tools`, `GET /api/tools/:name`, `POST /api/tools/rescan`, `PUT /api/tools/:name`, `DELETE /api/tools/:name`, `POST /api/tools/diagnostics`
- [x] 2.2 Wire the routes in `packages/server/src/server.ts`; gate them behind the same auth guard as `/api/config`
- [x] 2.3 Add `ApiResponse` types for tool endpoints in `packages/shared/src/rest-api.ts`
- [x] 2.4 Write route tests (fastify inject): list, get single, rescan all, rescan one, set/clear override, 404 for unknown tool, 401 for unauthenticated remote
- [x] 2.5 Write a test asserting the diagnostics export text format matches the "one line per attempt" layout required by `tool-settings-ui`

## 3. Settings UI — Tools section

- [x] 3.1 Create `packages/client/src/lib/tools-api.ts` with `fetchTools`, `fetchTool`, `rescanAll`, `rescanOne`, `setOverride`, `clearOverride`, `exportDiagnostics`
- [x] 3.2 Create `packages/client/src/components/ToolsSection.tsx` rendering one row per tool with status badge, source, truncated path, expandable `tried[]` trail, per-row override input + rescan button
- [x] 3.3 Add the top-level `[Rescan all] [Reset overrides] [Export diagnostics]` control row
- [x] 3.4 Add Tools section to `SettingsPanel` General tab (below existing sections)
- [x] 3.5 Trigger browser download of diagnostics text as `pi-dashboard-tools.txt` on export click
- [x] 3.6 Write component tests: initial load from `/api/tools`, rescan refreshes rows, invalid override shows warning, reset overrides confirmation flow

## 4. Migration — Package manager wrapper (server + electron)

- [x] 4.1 Replace `loadPiPackageManager()` in `packages/server/src/package-manager-wrapper.ts` with `registry.resolveModule("pi-coding-agent")`
- [x] 4.2 Update server error responses in `packages/server/src/routes/package-routes.ts` so a failed resolution returns 500 with the `tried[]` trail (no bare "pi-coding-agent is not installed" message) — delivered via `OperationResult.diagnostics` on the `package_operation_complete` broadcast
- [x] 4.3 Replace `loadPiPackageManager()` in `packages/electron/src/lib/dependency-installer.ts` with `registry.resolveModule("pi-coding-agent")`
- [x] 4.4 Delete both local `loadPiPackageManager()` implementations and their `piModuleCache` variables
- [~] 4.5 Update existing `package-manager-wrapper` tests to mock the registry instead of the old chain — _skipped per user request_
- [ ] 4.6 Manually verify on Windows (against the reproducer machine) that clicking a recommended-extension install succeeds where it previously failed with "pi-coding-agent is not installed" — _pending user verification_

## 5. Migration — Dependency detector and doctor

- [x] 5.1 Rewrite `packages/electron/src/lib/dependency-detector.ts` so `detectPi`, `detectOpenSpec`, `detectSystemNode`, `detectDashboardPackage`, `detectBridgeExtension`, `detectPiDashboardCli` delegate to `registry.resolve(name)` and translate to `DetectionResult`
- [x] 5.2 Update `packages/electron/src/lib/doctor.ts` to read from the registry instead of re-implementing detection; keep display format unchanged — automatic (doctor calls the detectors; detectors now delegate)
- [x] 5.3 Remove the private `ToolResolver` instance in `dependency-detector.ts` (now owned by the registry)
- [~] 5.4 Update tests in `packages/electron/src/__tests__/` covering detectors to mock the registry — _skipped per user request_

## 6. Migration — Runner and npm cache removal

- [x] 6.1 Modify `packages/shared/src/platform/runner.ts` `resolveBinary()` to call `ToolRegistry.resolve(name).path` for registered names; fall back to `ToolResolver.which()` for unregistered
- [x] 6.2 Remove the `resolverCache` Map and `resetResolverCache()` function from `runner.ts`; replace `resetResolverCache()` test hook with `registry.rescan()` — kept `resetResolverCache()` as a shim that calls `registry.rescan()` for backward compat with existing test imports
- [x] 6.3 Remove `cachedGlobalRoot` and `_resetNpmRootCache()` from `packages/shared/src/platform/npm.ts`; `rootGlobal()` becomes a thin wrapper that reads the registry — `_resetNpmRootCache()` preserved as a no-op shim
- [~] 6.4 Update `platform/runner.test.ts` and `platform/npm.test.ts` to exercise registry-based caching and rescan — _skipped per user request_
- [~] 6.5 Run the full `npm test` at repo root; fix any regressions — _skipped per user request_

## 7. Supersede fix-portable-windows-package-manager

- [x] 7.1 Verify the managed-install strategy registered for `pi-coding-agent` covers the exact case that change was fixing — confirmed: `moduleDefWithAliases("pi-coding-agent", ["@mariozechner/pi-coding-agent", "@oh-my-pi/pi-coding-agent"], "dist/index.js")` produces strategies that probe `MANAGED_DIR/node_modules/@mariozechner/pi-coding-agent/dist/index.js` and the `@oh-my-pi` variant, matching the original proposal's scope
- [ ] 7.2 Archive `openspec/changes/fix-portable-windows-package-manager/` once this change lands (use `openspec archive` at archive time) — _deferred: runs after this change archives_
- [x] 7.3 Add a note to that change's proposal pointing to this one as the superseding work

## 8. Docs

- [x] 8.1 Update `docs/architecture.md` with a "Tool resolution" section describing `ToolRegistry`, the override file, and the REST API
- [x] 8.2 Update `AGENTS.md` with new key files: `tool-registry/registry.ts`, `tool-registry/definitions.ts`, `tool-registry/overrides.ts`, `routes/tool-routes.ts`, `ToolsSection.tsx`, `tools-api.ts`
- [x] 8.3 Update `README.md` Configuration section to mention `~/.pi/dashboard/tool-overrides.json`
- [x] 8.4 Add a short troubleshooting entry ("Dashboard can't find pi / openspec / npm — use the Tools settings section to inspect and override")

## 9. Release gate

- [ ] 9.1 Full-stack manual test on Windows: server start → `/api/tools` returns all tools resolved → settings Tools section renders → set an override for `openspec` → rescan → session's OpenSpec data populates via the overridden path — _pending user verification_
- [ ] 9.2 Full-stack manual test on macOS or Linux: `/api/tools` + settings UI work; no regressions in session spawn, openspec polling, or package install — _pending user verification_
- [ ] 9.3 Run `npm run build` + `npm run reload:check` and confirm clean type-check + reload — _pending user verification_
- [x] 9.4 Confirm `docs/architecture.md`, `AGENTS.md`, `README.md` reflect landed behavior before archiving
