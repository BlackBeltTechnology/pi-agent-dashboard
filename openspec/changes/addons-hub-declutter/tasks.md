## 1. Server: flag dashboard-managed bridge rows

- [ ] 1.1 Add optional `dashboardManaged?: boolean` to `InstalledPackage` in `packages/shared/src/rest-api.ts`; verify shared `tsc --noEmit` passes.
- [ ] 1.2 Write failing enricher tests: path in `dashboardPluginBridges` only, in `_dashboardManagedPackages` only, in neither, `~`-prefixed spelling, project-scope row never flagged, both records missing; verify they fail.
- [ ] 1.3 Add a third parameter `{ managedPaths }` to `enrichInstalledRows` (keep `resourcesPath` second, default unchanged); canonicalise with `~`/resolve/`realpathSync.native` fallback; compute the set in `package-routes.ts` only for `scope=global` from `listManagedBridges()` + `listManagedPackageOwnership()`, with one debug log when the registry is non-empty and nothing matches; add a symlinked-home test; verify 1.2 passes and existing enricher + `isBundled` tests still pass.

## 2. Page id rename: `packages` → `add-ons`

- [ ] 2.1 Add failing `SettingsPanel.test.tsx` cases: `/settings/add-ons` renders Add-ons; `/settings/packages` and `?tab=packages` replace-navigate to `/settings/add-ons` with no extra history entry; verify they fail.
- [ ] 2.2 Replace `packages` with `add-ons` in `VALID_SETTINGS_TABS` and the `SettingsTab` union; add `packages: "add-ons"` to `SETTINGS_PAGE_ALIASES`; switch `activeTab === "packages"` usages; verify 2.1 passes and `npx tsc -b` (workspace) reports no new errors.
- [ ] 2.3 Folder: failing tests (DirectorySettings + ShellContent) for default page `add-ons`, `…/settings/packages` → `…/settings/add-ons` (replace), and the pi-resources redirect target; then update `ShellContent.tsx` whitelist/default/redirect (also add the missing `cards` id), `App.tsx` whitelist/default and BOTH pi-resources redirects (`App.tsx:~2394` and `renderPiResourcesRedirect` at `~2793`), the `DirectorySettingsPage` union, `topItems`, and every `buildFolderSettingsUrl(…, "packages")` caller (`rg -n 'buildFolderSettingsUrl\([^)]*"packages"' packages/client/src` empty); add a test that `…/settings/cards` renders the Session cards page; verify tests pass.
- [ ] 2.4 Point in-app links at the new paths (`PiUpdateBadge.tsx`, `RuntimeUpdateBadge.tsx`, `plugin-row-parts.tsx`) and sweep `rg -n "settings/packages" packages tests/e2e qa docker docs README.md` (excluding archived changes); also `rg -n "tab=packages|'packages'|\"packages\"" packages/client/src/lib/nav packages/client/src/lib/layout packages/client/src/components/shell` for page-id literals; update every in-repo target except tests that assert the redirect; verify both greps list only those tests and redirect notes.
- [ ] 2.5 Update `docs/` mentions of `/settings/packages` and "Pi Ecosystem" via DocScribe (caveman style); verify the grep in 2.4 is clean for `docs/`.

## 3. Rail: ADD-ONS group and collapsed Plugins subtree

- [ ] 3.1 Failing tests: rail group `ADD-ONS` containing `Add-ons`, `Plugins`, `OpenSpec`; Plugins subtree collapsed by default with child count and `aria-expanded="false"`; auto-expanded on `/settings/plugins/flows` without writing storage; explicit toggle persisted across remount; verify they fail.
- [ ] 3.2 Implement in `SettingsPanel.tsx` nav groups + Plugins children renderer with `dashboard:settings-plugins-expanded`; verify 3.1 and the existing Plugins-nav and Models-nav scenarios pass.
- [ ] 3.3 Add `ADD-ONS` / `Add-ons` labels (en/hu/zh) to the reserved-label sources in `lib/settings-promotions.ts`, replacing the `settings.packages` / `settings.groupExtensions` rail entries (keep `packages.extensions` — Resources › Extensions); add a unit test asserting `RESERVED_SETTINGS_LABELS` contains the folded `add-ons` in every shipped locale and no longer needs `Packages`; verify it and the SettingsPanel rail-label test pass.

## 4. Add-ons page content

- [ ] 4.1 Rename the section heading `Pi Ecosystem` → `Add-ons` with new i18n keys (en/hu/zh); remove old keys only where the i18n orphan test requires; verify `UnifiedPackagesSection.test.tsx`, the i18n coverage check and `lib/__tests__/i18n-orphans.test.ts` pass.
- [ ] 4.2 Add `visibleInstalledRows()` and `isLocalSourceRow()` to `lib/package/installed-list-helpers.ts` and use them in `UnifiedPackagesSection`, `InstalledPackagesList` and `PackageBrowser` for rendering, counts, chip and banner; unit-test the helpers and a component fixture of nine bridge rows + 13 local rows; verify no bridge row renders and counts exclude them.
- [ ] 4.3 `RecommendedExtensions`: add `hideGlobalInstalled` (filters `installed.scope === "global"`); global Add-ons page passes it; "all installed" single-line state; tests for the three "Recommended once" scenarios incl. folder-only install; verify pass.
- [ ] 4.4 `PackageRow`: drop second source line + inline Reset link; `local` badge description names published target/version; menu label "Reset to published version (<version>)" with no brackets when the version is unknown; keep confirm + `busy || locked` gating; update `PackageRow.override.test.tsx` and `PackageRowReset.test.tsx` incl. the locked and unknown-version scenarios; verify pass.
- [ ] 4.5 Installed filter (text + `Local source` + `Update available` chips; empty sub-groups hidden only while filtering; empty state with npm-search link) and local-source banner sharing the chip predicate, whose `Show` clears other filters; tests for the filter and banner scenarios incl. `Show` while a text filter is active; verify pass.

## 5. Explainer, legend, tooltips

- [ ] 5.1 Add `AddonsExplainer` (disclosure semantics, dismissal in `dashboard:addons-explainer-dismissed`, header reopen link that focuses it) + legend; i18n en/hu/zh; tests for first-visit, persisted dismissal, reopen-focus, keyboard toggle; verify pass.
- [ ] 5.2 Part-label tooltips (accessible description) on row part chips; test that an `extension` chip exposes the plain-language text; verify pass.
- [ ] 5.3 Copy check: no "spawn" words (ui-terminology scan test), no raw colour literals (`node scripts/theme-token-guard.mjs` clean); verify both.

## 6. Verification

- [ ] 6.1 `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log` green; `npm run quality:changed` clean.
- [ ] 6.2 Isolated-env visual check (non-8000 ports, per frontend-mockup-loop-dashboard) in base dark, base light and one non-base palette at 375/768/1440. Pass = rail shows `ADD-ONS › Add-ons`; heading `Add-ons`; zero rows named `index.ts`; no recommended entry both as a row and as a card; explainer visible on first load and collapsed after dismiss + reload; `/settings/packages` lands on `/settings/add-ons`. Any miss fails the task.
