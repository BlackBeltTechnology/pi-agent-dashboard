## Why

The Settings → Packages tab currently shows three loosely-related lists ("Pi Ecosystem", "Tools", "Installed Global Packages") that visually overlap and confuse users. The "Pi Ecosystem" section uses a `pi-*` heuristic in `pi-core-checker.ts` that sweeps in extension packages (`pi-agent-browser`, `@tintinweb/pi-subagents`, `pi-web-access`) which already appear in "Installed Global Packages" — so the same package shows up twice with inconsistent affordances (Update-only above, Uninstall-only below). Meanwhile "Installed Global Packages" rows show only the raw source string with no version, no description, and no badges, which is strictly less informative than the Ecosystem rows directly above them.

The goal is to keep the cleaner "Pi Ecosystem" visual language and apply it to every package row: every row gets a display name, source caption, source-type badge, and current/latest version. Rows are grouped by identity (Core / Recommended / Other), not by source type. Each package appears in exactly one group. The "Tools" section is unrelated (it's a binary/module resolver diagnostic) and stays where it is in the General tab.

## What Changes

- Drop the `pi-*` package-name heuristic in `pi-core-checker.ts`; the Pi Ecosystem "Core" group becomes a strict whitelist (`@mariozechner/pi-coding-agent`, `@oh-my-pi/pi-coding-agent`, `@blackbelt-technology/pi-agent-dashboard`, `@blackbelt-technology/pi-model-proxy`).
- Add a `version: string | undefined` field to each row returned by `GET /api/packages/installed`, read from `<installedPath>/package.json#version` via pi's existing `listConfiguredPackages()` results.
- Add a `displayName`, `description`, `isBundled: boolean`, and `isRecommended: boolean` to each row in `GET /api/packages/installed` so the client can render a friendly identity and badges without a second fetch (cross-referenced against `RECOMMENDED_EXTENSIONS` and `BUNDLED_EXTENSION_IDS` from the shared package manifest).
- Replace the two sibling sections in the Packages tab with a single `UnifiedPackagesSection` that renders three groups with one shared row component:
  - **Core** — the strict-whitelist tools, Update only, no Uninstall (keeps existing `/api/pi-core/update` flow).
  - **Recommended Extensions** — rows whose source matches an entry in `RECOMMENDED_EXTENSIONS`; show version, Update button if available, kebab menu with Uninstall + View README + Reset.
  - **Other Packages** — every remaining row from `/api/packages/installed`; same row component, same affordances.
- Remove duplicate appearances: a package is classified into exactly one group, in priority order Core → Recommended → Other.
- The existing `Browse Packages` section below stays unchanged.
- The existing `Tools` section in Settings → General stays unchanged (orthogonal: it's a binary/module resolver diagnostic, not package management).

## Capabilities

### New Capabilities

(none — this is a UI consolidation over existing capabilities)

### Modified Capabilities

- `pi-core-version-ui`: drop the `pi-*` heuristic; the Core group becomes a strict whitelist; the Settings section name becomes a sub-heading inside the unified packages section.
- `pi-core-version-check`: drop the `pi-*` heuristic from server-side core package discovery (the same heuristic, on the data side).
- `package-update`: `GET /api/packages/installed` rows gain `version`, `displayName`, `description`, `isBundled`, `isRecommended` fields; the response shape is additive (no breaking change for the `source` and `scope` fields existing clients already consume).

## Impact

- Affected code:
  - `packages/server/src/pi-core-checker.ts` — drop the heuristic; tighten to whitelist.
  - `packages/server/src/routes/package-routes.ts` (`/api/packages/installed`) — enrich rows with `version` + recommended/bundled cross-reference.
  - `packages/server/src/package-manager-wrapper.ts` — surface `installedPath` on the per-row result so the route can read the package.json (already present internally; just needs to flow out).
  - `packages/client/src/components/SettingsPanel.tsx` — replace two sibling `<Section>` blocks (`Pi Ecosystem` from `PiCoreVersionsSection` + `Installed Global Packages`) with one `<UnifiedPackagesSection>`.
  - `packages/client/src/components/PiCoreVersionsSection.tsx` — generalized into `UnifiedPackagesSection.tsx`; the existing `PackageRow` JSX is reused.
- Affected APIs:
  - `GET /api/packages/installed` — additive fields. No removals.
  - `GET /api/pi-core/status` — unchanged externally; internally drops the heuristic.
- Dependencies: none new.
- Tests: enrichment fields covered by `package-routes.test.ts`; whitelist enforcement covered by `pi-core-checker.test.ts`; render snapshot covered by a new `UnifiedPackagesSection.test.tsx`.
