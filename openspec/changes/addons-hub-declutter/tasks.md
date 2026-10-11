## 1. Server: flag dashboard-managed bridge rows

- [ ] 1.1 Add optional `dashboardManaged?: boolean` to `InstalledPackage` in `packages/shared/src/rest-api.ts`; verify `tsc --noEmit` on shared passes.
- [ ] 1.2 Write failing tests in the enricher test file for the three `installed-package-row-enrichment` scenarios (recorded bridge path, unrelated local package, missing registry) incl. a `~`-prefixed spelling; verify they fail.
- [ ] 1.3 In `packages/server/src/package/installed-package-enricher.ts`, resolve `listManagedBridges()` values once per enrich pass and set `dashboardManaged` by resolved-path equality; verify 1.2 passes.

## 2. Page id rename: `packages` → `add-ons`

- [ ] 2.1 Add failing `SettingsPanel.test.tsx` cases: `/settings/add-ons` renders Add-ons; `/settings/packages` and `?tab=packages` replace-navigate to `/settings/add-ons` with no extra history entry; verify they fail.
- [ ] 2.2 Replace `packages` with `add-ons` in `VALID_SETTINGS_TABS`, keep `"packages"` in the `SettingsTab` union marked `@deprecated`; add `packages: "add-ons"` to `SETTINGS_PAGE_ALIASES`; make an aliased route param replace-navigate (`resolveSettingsPage` callers); switch `activeTab === "packages"` to `"add-ons"`; verify 2.1 passes.
- [ ] 2.3 Point in-app links at `/settings/add-ons` (`PiUpdateBadge.tsx`, `RuntimeUpdateBadge.tsx`, `plugin-row-parts.tsx`); verify `rg -n 'settings/packages' packages/client/src` lists only tests asserting the redirect.
- [ ] 2.4 Folder: failing `DirectorySettings.test.tsx` cases for default page `add-ons`, `…/settings/packages` → `…/settings/add-ons` (replace), and `pi-resources` redirect target; then update the `DirectorySettingsPage` union, `topItems`, the App.tsx `VALID_FOLDER_SETTINGS_PAGES` list + default, the redirect, and `buildFolderSettingsUrl` callers; verify tests pass.
- [ ] 2.5 Update `docs/architecture.md` mentions of `/settings/packages` via DocScribe (caveman style); verify `rg -n 'settings/packages' docs/architecture.md` returns only the redirect note.

## 3. Rail: ADD-ONS group and collapsed Plugins subtree

- [ ] 3.1 Failing tests: rail group label `ADD-ONS` with item `Add-ons`; Plugins subtree collapsed by default with child count and `aria-expanded="false"`; auto-expanded on `/settings/plugins/flows` without writing storage; explicit toggle persisted across remount; verify they fail.
- [ ] 3.2 Implement in `SettingsPanel.tsx` nav groups + Plugins children renderer with `dashboard:settings-plugins-expanded`; verify 3.1 and the existing Plugins-nav scenarios pass.

## 4. Add-ons page content

- [ ] 4.1 Rename section heading `Pi Ecosystem` → `Add-ons` (new i18n keys en/hu/zh; keep old keys unused-free); verify `UnifiedPackagesSection.test.tsx` updated assertions pass and the i18n coverage check passes.
- [ ] 4.2 Exclude `dashboardManaged` rows from Core/Recommended/Other and from `InstalledPackagesList` / `PackageBrowser` installed rows; test with a fixture containing nine bridge rows; verify none render and counts exclude them.
- [ ] 4.3 `RecommendedExtensions`: add `hideActive` prop; global Add-ons page passes it; "all installed" single-line state; tests for both "Recommended once" scenarios; verify pass.
- [ ] 4.4 `PackageRow`: drop second source line + inline Reset link; `local` badge carries the published target/version description; menu reset + confirm unchanged; update `PackageRow.override.test.tsx` and `PackageRowReset.test.tsx`; verify pass.
- [ ] 4.5 Installed filter (text + `Local source` + `Update available` chips, empty state with npm-search link) and local-source banner with `Show`; component tests for the filter and banner scenarios; verify pass.

## 5. Explainer, legend, tooltips

- [ ] 5.1 Add `AddonsExplainer` (details/summary semantics, dismissal in `dashboard:addons-explainer-dismissed`, header reopen link that focuses it) + legend; i18n en/hu/zh; tests for first-visit, persisted dismissal, reopen-focus, keyboard toggle; verify pass.
- [ ] 5.2 Part-label tooltips (accessible description) on row part chips; test that an `extension` chip exposes the plain-language text; verify pass.
- [ ] 5.3 Copy check: no "spawn" words, no raw colour literals (`node scripts/theme-token-guard.mjs` clean); verify both.

## 6. Verification

- [ ] 6.1 `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log` green; `npm run quality:changed` clean.
- [ ] 6.2 Isolated-env visual check (non-8000 ports, per frontend-mockup-loop-dashboard): Add-ons page in base dark, base light and one non-base palette at 375/768/1440; compare against `mockups/extensions-hub/index.html` for naming, explainer and once-only rules.
