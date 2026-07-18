# DOX — packages/client/src/components/packages

Files in this directory. One row per source file. See change: fold-oversized-agents-directories.

| File | Purpose |
|------|---------|
| `InstallBanner.tsx` | Mobile-only PWA install banner (`md:hidden`). Shows iOS Share→Add-to-Home-Screen hint or generic install… → see `InstallBanner.tsx.AGENTS.md` |
| `InstallButton.tsx` | Icon-only install-app button (`mdiDownload`). Renders null when `!canInstall` or `isInstalled`. Exports `InstallButton`. |
| `InstalledPackagesList.tsx` | Shared installed-packages list for Settings + Pi Resources. → see `InstalledPackagesList.tsx.AGENTS.md` |
| `PackageBrowser.tsx` | Main package management surface. Exports `PackageBrowser`. → see `PackageBrowser.tsx.AGENTS.md` |
| `PackageCard.tsx` | Search-result card for one npm package. Exports `PackageCard`. → see `PackageCard.tsx.AGENTS.md` |
| `PackageInstallConfirmDialog.tsx` | Pre-install confirmation dialog. Exports `PackageInstallConfirmDialog`. Shows source + optional name + scope. → see `PackageInstallConfirmDialog.tsx.AGENTS.md` |
| `PackagePartialSuccessBanner.tsx` | Shared kind-aware partial-success banner for composite package ops (move + reset). → see `PackagePartialSuccessBanner.tsx.AGENTS.md` |
| `PackageReadmeDialog.tsx` | Dialog fetching + rendering a package README. Exports `PackageReadmeDialog`. → see `PackageReadmeDialog.tsx.AGENTS.md` |
| `PackageRow.tsx` | Generic installed-package row used across unified packages sections. Exports `PackageRow`, `PackageRowProps`. → see `PackageRow.tsx.AGENTS.md` |
| `PiUpdateBadge.tsx` | Header badge counting available pi-core updates. Exports `PiUpdateBadge`. → see `PiUpdateBadge.tsx.AGENTS.md` |
| `PiVersionAdvisory.tsx` | NEW. Settings→General advisory. Reads `usePiCompatibility`. → see `PiVersionAdvisory.tsx.AGENTS.md` |
| `PluginSettingsHost.tsx` | Wraps `SettingsSectionByPluginSlot` from dashboard-plugin-runtime so per-plugin settings sections mount inside Plugins tab below activation row. See change: add-plugin-activation-ui. |
| `PluginsSection.tsx` | Settings ▸ Plugins activation list. Renders every plugin (enabled or not) with display name, description,… → see `PluginsSection.tsx.AGENTS.md` |
| `PluginStalenessBanner.tsx` | Banner on stale plugin bundle. Fetches `/api/health.bundleHash` on mount. → see `PluginStalenessBanner.tsx.AGENTS.md` |
| `ProjectInitButton.tsx` | Presentational "Set up project" scaffold button (indigo, `mdiFolderPlusOutline`, testid `project-init-btn`). → see `ProjectInitButton.tsx.AGENTS.md` |
| `RecommendedExtensions.tsx` | Panel rendering curated recommended extensions. Exports `RecommendedExtensions`. Props: `scope`, `cwd`. → see `RecommendedExtensions.tsx.AGENTS.md` |
| `UnifiedPackagesSection.tsx` | Exports `UnifiedPackagesSection`. Settings → Packages "Pi Ecosystem" section. → see `UnifiedPackagesSection.tsx.AGENTS.md` |
| `WhatsNewDialog.tsx` | Exports `WhatsNewDialog` + `WhatsNewDialogProps`. Modal rendering parsed CHANGELOG between two versions. → see `WhatsNewDialog.tsx.AGENTS.md` |
| `WhatsNewPackageRow.tsx` | Exports `WhatsNewPackageRow` + `WhatsNewPackageRowProps`. → see `WhatsNewPackageRow.tsx.AGENTS.md` |
| `ZrokInstallGuide.tsx` | Exports `ZrokInstallGuide`. Tunnel setup install guide. `useServerOs` fetches `/api/tunnel-status` for… → see `ZrokInstallGuide.tsx.AGENTS.md` |
