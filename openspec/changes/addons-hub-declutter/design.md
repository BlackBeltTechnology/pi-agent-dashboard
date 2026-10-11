## Context

See proposal.md › Why. Current surfaces:

- Settings ▸ Packages = `ElectronRuntimeUpdates` + `UnifiedPackagesSection` (Core / Recommended / Other) + `GlobalPackagesBrowseAndDialogs` (`PackageBrowser` with `showInstalledSection={false}`, which still mounts `RecommendedExtensions` showing installed entries as Active/Remove cards).
- Plugin bridges reach `packages[]` as plain path strings (no `_dashboardOwned` marker on this install); the authoritative record is the `dashboardPluginBridges` map, read by `listManagedBridges()` in `packages/shared/src/plugin-bridge-register.ts`.
- Page ids: shared `VALID_SETTINGS_TABS` + client-only extras; aliases in `SETTINGS_PAGE_ALIASES` (`SettingsPanel.tsx`). Folder page ids are a literal list in `App.tsx` and the `DirectorySettingsPage` union.

```mermaid
flowchart LR
  S[settings.json packages[]] --> E[installed-package-enricher]
  B[dashboardPluginBridges] --> E
  E -->|dashboardManaged| API[/api/packages/installed/]
  API --> U[UnifiedPackagesSection]
  API --> R[RecommendedExtensions]
  U --> F[filter + local banner]
```

## Goals / Non-Goals

**Goals:** fewer rows, each item once, plain words, old links keep working.

**Non-Goals:** new endpoints, per-feature row merging, folder effective view (follow-up changes); visual redesign of `PackageRow` beyond the source-line change.

## Decisions

**D1 — Bridge detection on the server, by resolved path.** The enricher compares each row's resolved path with the resolved values of `listManagedBridges()`. Alternative: a client-side `/index\.ts$/` or `src/bridge/` heuristic — rejected: would hide user-added entries and break for bundled Electron paths. Alternative: rely on `_dashboardOwned` — rejected: real `packages[]` entries are plain strings.

**D2 — Hide, don't remove.** `dashboardManaged` rows stay in `packages[]` and keep loading; only display changes. Removing them is plugin-loader territory (`dashboard-plugin-loader` spec) and out of scope.

**D3 — Page id `add-ons`, alias `packages`.** Add `add-ons` to `VALID_SETTINGS_TABS`, drop `packages`, add `packages: "add-ons"` to `SETTINGS_PAGE_ALIASES`. `SettingsTab` keeps `"packages"` as a deprecated union member so external plugin type-checks do not break (manifest `claim.tab` is inert since plugin-settings-pages). An aliased **route** param also replace-navigates (today aliases apply only to `?tab=`; verify and extend). Folder: replace `packages` with `add-ons` in the App.tsx whitelist, the union and the default; map `packages` → `add-ons` with `replace`. In-app links (`PiUpdateBadge`, `RuntimeUpdateBadge`, `plugin-row-parts`, the pi-resources legacy redirect) move to the new path directly.

**D4 — Recommended-once by filtering, not a new mode.** `RecommendedExtensions` gets a `hideActive` prop (true on the global Add-ons page) that drops entries with `activeInPi === true`; "all installed" renders one line. Folder scope keeps current behaviour (it shows cross-scope state that the folder list does not; revisited in `addons-hub-folder-view`).

**D5 — Local override = badge + menu.** `PackageRow` drops the second source line and the inline `↺ Reset to npm`; the `local` badge gets `title`/`aria-describedby` naming `publishedVariantSource` + `publishedVariantVersion`. The `⋮` reset item, confirm dialog and `locked` gating (D9 of unify-pi-core-into-package-queue) are unchanged.

**D6 — Filter is client-side over already-fetched rows.** ≤ ~100 rows; no server query. State is component-local (not persisted). The banner's `Show` sets the `Local source` chip.

**D7 — Explainer and rail state in localStorage.** Keys `dashboard:addons-explainer-dismissed` and `dashboard:settings-plugins-expanded`. Auto-expand on an active child is derived at render, never written. Explainer copy lives in i18n (en/hu/zh) — no `spawn` wording (ui-terminology).

**D8 — Explainer worked example is static copy.** It names Goal (extension by @ricoyudog + dashboard plugin). Picking an example dynamically needs the feature catalog (follow-up change).

## Risks / Trade-offs

- [Bookmark/doc links to `/settings/packages`] → redirect kept indefinitely; grep docs/README for the old path and update.
- [Hidden bridge row hides a real problem, e.g. a stale bridge path] → `add-package-health-cleanup` Issues surface still sees raw `packages[]`; `dashboardManaged` only affects rendering.
- [Inline reset link removed — one more click] → accepted; the banner + filter make local rows findable, and reset is a rare, confirm-gated action.
- [`SettingsTab` union keeps a dead member] → documented as deprecated; remove in a later major.

## Migration Plan

No data migration. Deploy = client build + server restart (enricher change). Rollback = revert the commit; orphaned localStorage keys are harmless.
