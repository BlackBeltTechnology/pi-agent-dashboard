## 1. Shared wire types

- [ ] 1.1 Add optional `publishedVariantSource?: string` and `publishedVariantVersion?: string` to `InstalledPackage` in `packages/shared/src/rest-api.ts`, with doc comments naming the two resolution paths (recommended manifest vs npm-name lookup).
- [ ] 1.2 Add `"reset"` to the `PackageAction` union in `packages/shared` and `packages/server/src/package-manager-wrapper.ts` (keep both in sync).

## 2. Server — published-variant resolution (enricher)

- [ ] 2.1 Write unit tests for a `resolvePublishedVariant(pkg)` helper: recommended row → `RECOMMENDED_EXTENSIONS` npm source; non-recommended local row whose `package.json name` resolves on npm → `npm:<name>` + latest version; purely-local row with no published match → undefined; plain npm row → undefined.
- [ ] 2.2 Implement `resolvePublishedVariant`: recommended path via `matchRecommendedEntry()` (offline); non-recommended path via an npm-registry name lookup. Cache results per `name` with a TTL; on cache-miss/offline/registry-error, return undefined (never block the list).
- [ ] 2.3 Decide the non-recommended gating signal (design.md open question): name-only vs name + repository-URL match. Implement the chosen guard and note the decision in a code comment.
- [ ] 2.4 Populate `publishedVariantSource` / `publishedVariantVersion` in `enrichInstalledRows` (the enricher feeding `/api/packages/installed`). Verify recommended rows keep working offline.

## 3. Server — atomic reset operation + route

- [ ] 3.1 Write tests for the atomic reset op: success (install `npm:<name>` first, then remove local/git entry, same scope, emits `package_operation_complete { action: "reset" }`); install-failure leaves the local entry intact + reports failure; install-ok-remove-fail reports partial success naming both specs.
- [ ] 3.2 Implement the composite reset op in `package-manager-wrapper.ts`, modeled on the existing `move` op (install-new + remove-old), swapping source-kind instead of scope. Reuse the composite-operation WS protocol.
- [ ] 3.3 Add `POST /api/packages/reset-to-npm { source, scope }` in `packages/server/src/routes/package-routes.ts` that invokes the op; validate `source` is a currently-installed local/git entry with a resolvable published variant before acting.

## 4. Client — operations queue

- [ ] 4.1 Add a `reset` action to `packages/client/src/lib/package-queue.ts` (post to `/api/packages/reset-to-npm`), consuming the `reset` completion via the existing `move`-style path (prefer reuse over a new handler).
- [ ] 4.2 Unit-test the queue reset path (enqueue → running → complete; partial-success surfaced).

## 5. Client — PackageRow rendering

- [ ] 5.1 Write component tests: a row with `publishedVariantSource` renders TWO source lines (installed path + published link with available version) and an inline "Reset to npm"; the `⋮` menu shows "Reset to published version"; a row without it renders one line and no reset; plain npm rows unchanged.
- [ ] 5.2 Add props to `PackageRow.tsx` for `publishedVariantSource` / `publishedVariantVersion` / `onResetToNpm`; render the second source line + inline reset + the `⋮`-menu item. Keep the item distinct from the latent generic `onReset` ("Reset (reinstall)").
- [ ] 5.3 Implement the confirm dialog: names the discarded local/git link AND the exact published target; copy says "link", not files; note "install runs first".

## 6. Client — wire into the lists (extended scope)

- [ ] 6.1 In `InstalledPackagesList.tsx` / `UnifiedPackagesSection.tsx`, pass `publishedVariantSource` + wire `onResetToNpm` for ANY local/git row that has it — not only the Recommended group.
- [ ] 6.2 On success, collapse the row to a plain npm row (override pill gone, npm badge). On partial success, render the existing `PartialSuccessBanner` with a "Remove local link" retry.

## 7. Tests — integration

- [ ] 7.1 Server integration test for `/api/packages/reset-to-npm` covering success + both failure modes against a fake package manager.
- [ ] 7.2 Add a Playwright E2E scenario in `tests/e2e/` (docker harness): an override row exposes the reset action and, after confirm, becomes a plain npm row. Track under `openspec/changes/reset-override-to-npm/` follow-up if the harness scenario is deferred.

## 8. Docs

- [ ] 8.1 Update `packages/shared/src/AGENTS.md`, `packages/server/src/routes/AGENTS.md`, `packages/server/src/AGENTS.md`, `packages/client/src/components/AGENTS.md`, and `packages/client/src/lib/AGENTS.md` rows for the touched files (caveman style), each with `See change: reset-override-to-npm`.
- [ ] 8.2 Add a cross-reference from the `switch-extension-source` skill (this is its GUI equivalent) so the two stay semantically aligned.
