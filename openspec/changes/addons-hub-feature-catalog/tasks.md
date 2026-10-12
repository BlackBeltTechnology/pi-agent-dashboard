## 1. Shared types

- [ ] 1.1 Add `AddonFeature`, `AddonFeatureKind`, `AddonOrigin`, `AddonCatalogResponse`, `AddonToggleRequest`, `AddonToggleResponse` (`restartRequired`, `filtered`, `restored`, `keptOn`, `restoreSkipped`) to `packages/shared/src/rest-api.ts`; verify shared `tsc --noEmit` passes.

## 2. Pure joiner

- [ ] 2.1 Write failing unit tests for `packages/server/src/addons/addons-catalog.ts` covering every joining rule and scenario in `addons-feature-catalog` (Goal, apple-tools, shared package, built-in plugin, plain package, core features, one-package-one-feature invariant); verify they fail.
- [ ] 2.2 Implement the joiner using `packageIdentity` and `package.json`-name matching; verify 2.1 passes.
- [ ] 2.3 Add origin classification tests (first-party, mixed + author label, community, upstream, local checkout of a first-party package) and implement; verify pass.

## 3. Catalog endpoint

- [ ] 3.1 Add `GET /api/addons/catalog` in `packages/server/src/routes/addons-routes.ts` (auth-gated like `/api/plugins`), gathering inputs from existing modules; route test with fixtures; verify 200 shape and that update flags come from the cached check-updates data.

## 4. Combined toggle

- [ ] 4.1 Extend `resource-entry-ownership.ts` with `recordRestore` / `takeRestore` (atomic tmp+rename, keyed by settings path + identity); unit tests incl. concurrent writes; verify pass.
- [ ] 4.2 Failing route tests for `POST /api/addons/:featureId/toggle`: disable Goal writes the all-empty filter and disables the plugin; enable restores exactly; shared package kept on; 400 for `core:*`; 404 unknown; 409 unparseable settings (no plugin change); plugin-toggle failure rolls the settings entry back; hand-edited entry → `restoreSkipped`; verify they fail.
- [ ] 4.3 Implement with the existing serialised settings writer and the plugin toggle path (ordering per design D5) and one log line per toggle; verify 4.2 passes.
- [ ] 4.4 Run `doubt-driven-review` on the write/restore path; record findings in design.md; verify no open blocker.

## 5. Client: Installed tab

- [ ] 5.1 `useAddonCatalog` hook (fetch + refresh on package/plugin events already broadcast); test refresh on `package_operation_complete` and `plugin_config_update`; verify pass.
- [ ] 5.2 Feature row component (origin badge, part chips with tooltips, version/update, switch incl. `aria-checked="mixed"`, expander with the two panels and actions); component tests for Goal row and partial state; verify pass.
- [ ] 5.3 Confirmation dialog for combined off naming what stops and `keptOn`; session-reload offer after success; tests; verify pass.
- [ ] 5.4 Delivered-by strip, filter chips, grouping control (4 modes, plain-language headings); tests per scenario; verify pass.
- [ ] 5.5 Replace the Core/Recommended/Other rendering in the Add-ons section with the feature list; keep `local` badge + menu reset behaviour; update `UnifiedPackagesSection` tests or retire them with equivalent feature-list tests; verify pass.

## 6. Client: Updates and Discover tabs

- [ ] 6.1 Tabs with `?tab=` URL state and counts; tests for reload persistence and unknown value; verify pass.
- [ ] 6.2 Updates tab (features with updates + pi core, What's new links, Update all → FIFO enqueue); test four enqueues; verify pass.
- [ ] 6.3 Discover tab: move recommended-not-installed cards (with origin + parts), npm search, type filter, install-from-source; verify existing `PackageBrowser` tests still pass.
- [ ] 6.4 Data-driven explainer example (first installed `agent-and-dashboard` feature, fallback to static copy); test; verify pass.

## 7. Verification

- [ ] 7.1 `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log` green; `npm run quality:changed` clean; `node scripts/theme-token-guard.mjs` clean.
- [ ] 7.2 Isolated-env check (non-8000 ports): disable Goal from the hub, start a new session, confirm `pi-goal-hermes` tools are absent; re-enable, confirm the settings entry equals the original; screenshots dark/light/one palette at 375/1440.
