## Why

Settings ▸ Packages is hard to scan and repeats itself. On a real install (38 `packages[]` entries) the page shows every recommended extension twice (Pi Ecosystem rows + Browse cards), nine dashboard-managed plugin bridges as rows named `index.ts`, and three lines per local-override row (path, npm name, Reset to npm). Users also do not know what an "extension", a "skill" or a "plugin" is, yet the UI uses all three words without explanation. This change removes the noise and explains the words. It is phase 1 of 3 of the Add-ons hub (see Non-goals).

## What Changes

- **Rename** Settings ▸ Packages to **Add-ons**: rail group `EXTENSIONS` → `ADD-ONS` (still holding Add-ons, Plugins, OpenSpec), nav item `Packages` → `Add-ons`, section heading `Pi Ecosystem` → `Add-ons`; both new labels join the reserved-label set promoted plugins cannot take. Route `/settings/add-ons`; `/settings/packages` and `?tab=packages` redirect (history `replace`). Folder settings page id `packages` → `add-ons` with the same redirect.
- **Explainer**: a dismissible "What are extensions and plugins?" card on the Add-ons page (extension / skill / dashboard plugin / package, plus a worked example), a one-line legend, and a plain-language tooltip on every part chip. Dismissal persists; a header link reopens it.
- **Hide bridge rows**: `packages[]` entries the dashboard recorded as its own (`dashboardPluginBridges` / `_dashboardManagedPackages`) are flagged by the server and no longer render as installed rows.
- **Recommended shown once**: a recommended extension installed globally renders only in the installed list; the Browse panel lists the recommended entries not installed globally (a folder-only install keeps its card).
- **Compact local overrides**: a local/git row with a published variant renders one source line plus a `local` badge; "Reset to published version (<version>)" stays in the row's `⋮` menu with its existing confirm + `locked` gating (inline "Reset to npm" link removed). A banner counts local-source rows and filters to exactly those rows.
- **Filter installed**: a text filter and chips (`Local source`, `Update available`) over the installed list.
- **Plugins rail collapsed**: the Plugins nav children (plugin settings pages) start collapsed under an expandable `Plugins` entry; they auto-expand when a child page is active; the user's choice persists.

Mockup: `mockups/extensions-hub/index.html` (root mockups dir, shared with follow-up changes).

## Non-goals

- One row per feature (plugin + bridge + required pi package), "who delivers it" badges, combined enable switch, Updates/Discover tabs — change `addons-hub-feature-catalog`.
- Folder effective-set view and per-folder off switch — change `addons-hub-folder-view`.
- Stale/missing/duplicate `packages[]` cleanup — change `add-package-health-cleanup`.
- Bulk "Reset all to npm" (reset rides `moveTracker`, not the queue; a bulk path needs its own design).

## Capabilities

### New Capabilities
- `addons-hub`: the Add-ons page — naming, concept explainer, legend and tooltips, installed-list filter, recommended-once rule, local-override compaction, hidden bridge rows.

### Modified Capabilities
- `settings-panel`: canonical URL aliases (`packages` → `add-ons`), page-id registry (`add-ons` replaces `packages`), Plugins nav group collapsed by default, nav group `Extensions` → `Add-ons` (Settings panel view, Resources-group distinctness).
- `url-routing`: folder settings overlay path defaults to `add-ons`; `packages` segment redirects.
- `package-browse`: the Installed Packages section skips `dashboardManaged` rows; heading wording `Pi Ecosystem` → `Add-ons`.
- `directory-settings-page`: folder `Packages` page becomes `Add-ons` (`add-ons` id, `packages` redirects).
- `pi-core-version-ui`: local/git rows with a published variant render one source line + `local` badge; reset stays menu-only.
- `installed-package-row-enrichment`: rows carry a `dashboardManaged` flag for plugin-bridge entries.

## Impact

- Client: `SettingsPanel.tsx` (nav groups, page aliases, Plugins children), `lib/settings-promotions.ts` (reserved labels), `shell/ShellContent.tsx` (live folder-settings page whitelist + default), `UnifiedPackagesSection.tsx`, `PackageRow.tsx`, `PackageBrowser.tsx` / `RecommendedExtensions.tsx`, `DirectorySettings.tsx`, `App.tsx` folder page whitelist, `route-builders.ts`, badges linking `/settings/packages` (`PiUpdateBadge`, `RuntimeUpdateBadge`, `plugin-row-parts`), i18n catalogs (en/hu/zh).
- Shared: `VALID_SETTINGS_TABS`, `InstalledPackage.dashboardManaged`.
- Server: installed-package enricher reads managed bridge paths (`listManagedBridges`).
- Compatibility: old URLs keep working through redirects. No settings-file or protocol migration. Rollback = revert; no persisted data depends on the new ids except the localStorage keys for the explainer and rail state (harmless if orphaned).

## Discipline Skills

None of the checkpoint triggers apply: no auth, untrusted input, secrets or latency budget; no new endpoint (one optional field on an existing response); nothing irreversible. Standard `review-code` before commit only.
