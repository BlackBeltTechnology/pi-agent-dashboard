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
| `PackageRow.tsx` | Generic installed-package row used across unified packages sections. Exports `PackageRow`, `PackageRowProps`. Three non-conflated op-state props `busy`/`queued`/`locked` — `locked` gates ONLY Move + Reset-to-npm. → see `PackageRow.tsx.AGENTS.md` |
| `PiUpdateBadge.tsx` | Header badge counting available pi-core updates. Exports `PiUpdateBadge`. → see `PiUpdateBadge.tsx.AGENTS.md` |
| `PiVersionAdvisory.tsx` | NEW. Settings→General advisory. Receives `compatibility` via prop (host panel polls once; hook call moved up) + optional `onChangeRuntime` rendering the `Change…` affordance (testid `pi-advisory-change`) in both alert states; renders unchanged without it. → see `PiVersionAdvisory.tsx.AGENTS.md` |
| `plugin-row-parts.tsx` | Shared presentational plugin-row parts extracted from `PluginsSection.tsx`: `StatusPill`, `CopyableErrorBlock`, `MissingRequirementsBlock`, and the `WARN_*`/`ERR_*`/`OK_*`/`LINK_*` theme-token fragments. Consumed by both the activation index and `PluginSettingsPage` chrome. See change: plugin-settings-pages. |
| `PluginsSection.tsx` | Settings ▸ Plugins activation list. Renders every plugin (enabled or not) with display name, description,… → see `PluginsSection.tsx.AGENTS.md` |
| `PluginStalenessBanner.tsx` | Banner on stale plugin bundle. Fetches `/api/health.bundleHash` on mount. → see `PluginStalenessBanner.tsx.AGENTS.md` |
| `RecommendedExtensions.tsx` | Panel rendering curated recommended extensions. Exports `RecommendedExtensions`. Props: `scope`, `cwd`. → see `RecommendedExtensions.tsx.AGENTS.md` |
| `UnifiedPackagesSection.tsx` | Exports `UnifiedPackagesSection`. Settings → Packages "Pi Ecosystem" section. Core rows read pi-core in-flight state from the singleton `packageQueue` (no local `useState`). → see `UnifiedPackagesSection.tsx.AGENTS.md` |
| `WhatsNewDialog.tsx` | Exports `WhatsNewDialog` + `WhatsNewDialogProps`. Modal rendering parsed CHANGELOG between two versions. → see `WhatsNewDialog.tsx.AGENTS.md` |
| `WhatsNewPackageRow.tsx` | Exports `WhatsNewPackageRow` + `WhatsNewPackageRowProps`. → see `WhatsNewPackageRow.tsx.AGENTS.md` |
| `ZrokInstallGuide.tsx` | Exports `ZrokInstallGuide`. Tunnel setup install guide. `useServerOs` fetches `/api/tunnel-status` for… → see `ZrokInstallGuide.tsx.AGENTS.md` Root is `flex-1 flex flex-col min-h-0` — `flex-1` was ADDED (this root never had one) and `h-full` replaced, so it sizes inside the flush Dialog's capped flex column. See change: fix-flush-dialog-scroll-and-close-collision. |
