## 0. Preconditions

- [ ] 0.1 Confirm `addons-hub-feature-catalog` is archived (catalog + toggle endpoints on develop); verify `rg -n "api/addons/catalog" packages/server/src` finds the route.

## 1. Folder catalog mode

- [ ] 1.1 Failing joiner tests for every `folderState` (added-here incl. "1 of N extensions" for the kb-extension filter fixture, off-here, partly-off-here, inherited, dashboard-only) and loose-count reporting; verify they fail.
- [ ] 1.2 Implement folder mode in `addons-catalog.ts` and `?scope=folder&cwd=` in `addons-routes.ts` with existing cwd validation (400 on invalid); verify 1.1 + route tests pass.

## 2. Folder toggle

- [ ] 2.1 Failing route tests: off writes the all-empty `autoload:false` delta and leaves global settings untouched; plugin feature writes only the pi delta and keeps the plugin enabled; `trust_required` writes nothing; re-enable removes only owned deltas (`notOwned` otherwise); 400 for dashboard-only, core, added-here; verify they fail.
- [ ] 2.2 Implement reusing `resource-activation-toggle.ts` delta helpers, `resolveToggleTrust` and ownership records; verify 2.1 passes.
- [ ] 2.3 `security-hardening` + `doubt-driven-review` pass over cwd validation and the write path; record outcome in design.md; verify no open blocker.

## 3. Folder Add-ons page

- [ ] 3.1 Replace `DirectorySettings/PackagesPage.tsx` with the folder Add-ons view (heading + scope switch, strip, explainer, tabs); component test for the strip-arithmetic scenario; verify pass.
- [ ] 3.2 Groups (Added in this folder incl. `.pi/` files row linking to Resources, From Global with switches and badges, collapsed Dashboard-only) + `Added here` / `Turned off here` / text filters; tests; verify pass.
- [ ] 3.3 Switch flow: optimistic badge, strip update, trust dialog + retry, reload-sessions offer; tests for the three page scenarios; verify pass.
- [ ] 3.4 Discover tab (recommended not active here, folder-default install dialog); verify existing install tests pass.

## 4. Issues tab

- [ ] 4.1 Failing tests for the three `addons-issues` scenarios incl. health 404 degradation; verify they fail.
- [ ] 4.2 Implement the Issues tab + rail count (reuse `MissingRequirementsBlock`, `CopyableErrorBlock`); mount `PackageHealthPanel` when the health endpoint responds; verify 4.1 passes.
- [ ] 4.3 Add a coordination note to `openspec/changes/add-package-health-cleanup/proposal.md` (if still active) that its panel mounts in the Add-ons Issues tab; verify `openspec validate add-package-health-cleanup` still passes.
- [ ] 4.4 Retro UX for #875 (`PackageHealthPanel` shipped without a mockup): capture its as-built stale/missing/duplicate/clean states in base dark/light and nord dark at 375/1440 before 4.2 mounts it; conform it to the Issues tab in `mockups/extensions-hub/index.html` (tokens and `--severity-*` per `ui-contract.md`; 11 Tailwind palette classes in `PackageHealthPanel.tsx`/`UnifiedPackagesSection.tsx` today); keep its `data-testid`s; probes (`tests/e2e/helpers/computed-contrast.ts`) pass in every captured theme.

## 5. Verification

- [ ] 5.1 `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log` green; `npm run quality:changed` clean; theme-token guard clean.
- [ ] 5.2 Isolated env (non-8000 ports, temp HOME): turn off `pi-web-access` in folder A, start sessions in A and B, confirm it loads only in B; re-enable in A, confirm `.pi/settings.json` is back to its original content; screenshots dark/light at 375/1440 vs `mockups/extensions-hub/folder.html`.
