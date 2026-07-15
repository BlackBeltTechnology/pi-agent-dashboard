## 1. Shared wire types

- [x] 1.1 Add optional `publishedVariantSource?: string` and `publishedVariantVersion?: string` to `InstalledPackage` in `packages/shared/src/rest-api.ts`, with doc comments naming the two resolution paths (recommended manifest vs npm-name lookup).
- [x] 1.2 Add `"reset"` to the `PackageAction` union in `packages/shared` and `packages/server/src/package-manager-wrapper.ts` (keep both in sync). (Wire `action` union in `browser-protocol.ts#PackageOperationCompleteMessage` also widened.)

## 2. Server — published-variant resolution (enricher)

- [x] 2.1 Write unit tests for a `resolvePublishedVariant(pkg)` helper: recommended row → `RECOMMENDED_EXTENSIONS` npm source; non-recommended local row whose `package.json name` resolves on npm → `npm:<name>` + latest version; purely-local row with no published match → undefined; plain npm row → undefined. (`resolve-published-variant.test.ts`.)
- [x] 2.2 Implement `resolvePublishedVariant`: recommended path via `matchRecommendedEntry()` (offline); non-recommended path via an npm-registry name lookup (`fetchPackageMeta`, TTL-cached in `npm-search-proxy`); on offline/registry-error, return undefined (never block the list).
- [x] 2.3 Non-recommended gating: chose NAME-ONLY (no repository-URL cross-check); documented in a code comment on `resolvePublishedVariant` with the collision risk + confirm-dialog mitigation.
- [x] 2.4 Populate `publishedVariantSource` / `publishedVariantVersion` via `attachPublishedVariants` in the `/api/packages/installed` route. Recommended rows resolve offline (source), version best-effort.

## 3. Server — atomic reset operation + route

- [x] 3.1 Write tests for the atomic reset op: success (install `npm:<name>` first, then remove local/git entry, same scope, emits `package_operation_complete { action: "reset" }`); install-failure leaves the local entry intact + reports failure; install-ok-remove-fail reports partial success. (`package-manager-wrapper-reset.test.ts`.)
- [x] 3.2 Implement `reset()` + `executeReset()` in `package-manager-wrapper.ts`, modeled on `move` (install-first / remove-second), emitting `action: "reset"` with `moveId = resetId` to reuse the composite WS protocol. `InvalidResetRequestError` added.
- [x] 3.3 Add `POST /api/packages/reset-to-npm { source, scope, cwd? }`; resolves the published variant server-side (authoritative), validates the row is installed + has a resolvable variant before acting.

## 4. Client — operations queue

- [x] 4.1 Reset reuses the existing move-style path (NOT the source-keyed queue): `resetToNpm` fetch helper in `packages-api.ts`, `usePackageOperations.resetToNpm`, and the `move-tracker` (kind: `"reset"`) moveId-keyed partial-success machinery. (Design-preferred reuse; the queue is install/remove/update-only.)
- [x] 4.2 Unit-test the reset tracker path (register → running → complete; partial-success sticky; reset-specific copy) in `move-tracker.test.ts`.

## 5. Client — PackageRow rendering

- [x] 5.1 Component tests (`PackageRowReset.test.tsx`): dual source line + inline reset; `⋮` "Reset to published version"; no-variant row → single line + no reset; plain npm unchanged; confirm gates the action.
- [x] 5.2 Added `publishedVariantSource` / `publishedVariantVersion` / `onResetToNpm` props to `PackageRow.tsx`; renders the second source line + inline `↺ Reset to npm` + a `⋮`-menu item distinct from generic `onReset`.
- [x] 5.3 Confirm dialog inside `PackageRow`: names the discarded local link → exact published target, copy says "link" (files not deleted) + "published version installs first".

## 6. Client — wire into the lists (extended scope)

- [x] 6.1 Wired `publishedVariantSource` + `onResetToNpm` in both `InstalledPackagesList.tsx` and `UnifiedPackagesSection.tsx` for ANY row that has the field (recommended + other).
- [x] 6.2 Success collapses to a plain npm row automatically (server drops the local entry → next `installed` refetch has no override/no variant). Partial success renders the shared kind-aware `PackagePartialSuccessBanner` with a "Remove local link" retry.

## 7. Tests — integration

- [x] 7.1 Route-level integration tests for `/api/packages/reset-to-npm` (success + not-installed + no-variant + busy + invalid-request) against a fake wrapper, in `package-routes.test.ts`.
- [ ] 7.2 DEFERRED (tracked follow-up): Playwright E2E in `tests/e2e/` requires seeding a local override whose npm variant is installable in the container (network + fixture). Deferred per the task's own allowance; server + component + tracker paths are covered by unit/integration tests above.

## 8. Docs

- [x] 8.1 Updated `packages/shared/src/AGENTS.md`, `packages/server/src/routes/AGENTS.md`, `packages/server/src/AGENTS.md`, `packages/client/src/components/AGENTS.md`, and `packages/client/src/lib/AGENTS.md` rows (caveman style), each `See change: reset-override-to-npm`.
- [x] 8.2 Added a GUI-equivalent cross-reference in the `switch-extension-source` skill.
