# Tasks

## 1. Pure helper

- [ ] 1.1 In `packages/shared/src/dashboard-starter.ts`, add `export function computeBundleImmutable(launchSource: LaunchSource): boolean`. Body: `return launchSource === "electron";`. JSDoc explains the contract is "true iff install root is read-only at runtime" and that the body is the current implementation, not the contract.
  - **Note**: TWO `LaunchSource` types coexist. This helper uses the **flat-string** `LaunchSource` (`"electron" | "standalone" | "bridge"`) from `dashboard-starter.ts`, **not** the discriminated union in `launch-source-types.ts`. The server imports `parseLaunchSource` from `@blackbelt-technology/pi-dashboard-shared/dashboard-starter.js` — the helper lives in the same file.
- [ ] 1.2 Unit test the helper in `packages/shared/src/__tests__/dashboard-starter.test.ts` (extend existing file). Three cases: `"electron"` → `true`, `"bridge"` → `false`, `"standalone"` → `false`.

## 2. Server `/api/health` extension

- [ ] 2.1 In `packages/server/src/routes/system-routes.ts`, in the `/api/health` handler, add `bundleImmutable: computeBundleImmutable(parseLaunchSource(process.env))` to the response body. Import `computeBundleImmutable` from `@blackbelt-technology/pi-dashboard-shared/dashboard-starter.js`.
- [ ] 2.2 Extend the response type in `packages/shared/src/rest-api.ts` (or wherever `HealthResponse` lives — locate via `grep -rn "launchSource" packages/shared/src`). Add `bundleImmutable: boolean` as a required field.
- [ ] 2.3 Contract test in `packages/server/src/__tests__/health-route.test.ts` (extend existing). With `DASHBOARD_STARTER=Electron`, GET returns `bundleImmutable: true`. With `=Bridge` and `=Standalone`, returns `false`. All three cases also assert `launchSource` is the matching value (regression net).

## 3. Client hook

- [ ] 3.1 Create `packages/client/src/hooks/useBundleImmutable.ts` mirroring the shape of `useLaunchSource.ts`. Same module-level cache pattern. Return type `boolean | undefined` while fetching; `boolean` after first successful response. Reads `/api/health.bundleImmutable`.
- [ ] 3.2 Unit test in `packages/client/src/hooks/__tests__/useBundleImmutable.test.ts`. Three cases: happy path returns `true`/`false`; missing field on response (legacy server) returns `undefined` and does not throw; second hook call uses cache (no second fetch).

## 4. Migrate the two proxy gates

- [ ] 4.1 `packages/client/src/App.tsx:1344` — replace `{launchSource !== "electron" && <PiUpdateBadge />}` with `{bundleImmutable === false && <PiUpdateBadge />}`. Use `=== false` (not `!bundleImmutable`) so the badge stays hidden during the brief `undefined` initial-fetch window, matching today's behaviour (hidden on Electron, where the fetch resolves to `true`). Add `const bundleImmutable = useBundleImmutable();` near the existing `useLaunchSource()` call.
- [ ] 4.2 `packages/client/src/components/UnifiedPackagesSection.tsx:90-91` — replace `const hideCoreGroup = launchSource === "electron"` with `const hideCoreGroup = bundleImmutable === true`. Add `const bundleImmutable = useBundleImmutable();` near the existing `useLaunchSource()` call. Keep `useLaunchSource()` for any other branches in the component (none today, but preserve the import for future use — verify and remove if truly unused).
- [ ] 4.3 Verify no remaining `launchSource === "electron"` / `launchSource !== "electron"` checks in `packages/client/src/` whose intent is install-immutability. Grep result should show two callers only: any new ones must justify staying on `launchSource` (e.g. Electron-specific orchestration, not install topology).

## 5. Documentation

- [ ] 5.1 Update `docs/service-bootstrap.md#Concepts`: in the prose below the mapping table, change "Client gates on `launchSource === \"electron\"` as proxy for \"immutable bundle\"" to "Client gates on `bundleImmutable` (derived from starter in this phase; future immutable transports extend `computeBundleImmutable` without sweeping call sites)." Caveman style.
- [ ] 5.2 Update `docs/architecture.md` line 884 (currently "Hidden when `launchSource === \"electron\"` (immutable bundle)") to "Hidden when `bundleImmutable === true` on `/api/health`. Currently derived from Electron starter; contract is install-root immutability."
- [ ] 5.3 Update `packages/shared/src/AGENTS.md` (the per-directory per-file record): add a row (or extend existing `dashboard-starter.ts` row) noting `computeBundleImmutable` export and its derivation contract. Caveman style. (The retired `docs/file-index-shared.md` does not exist; per-file records live in the nearest directory `AGENTS.md` tree — here `packages/shared/src/AGENTS.md`.)
- [ ] 5.4 No AGENTS.md change needed — `launch-source-types.ts` is already a per-file detail, not architectural backbone.

## 6. Verification

- [ ] 6.1 `npm test` runs green across shared, server, client packages.
- [ ] 6.2 Manual smoke: launch via Electron → `curl /api/health | jq .bundleImmutable` returns `true`; launch via `pi` bridge → `false`; launch via `pi-dashboard start` → `false`. PiUpdateBadge visible in the latter two, hidden in the first. Core sub-group hidden in the first, visible in the latter two.
- [ ] 6.3 OpenSpec validate: `openspec validate add-bundle-immutable-health-flag --strict`.
