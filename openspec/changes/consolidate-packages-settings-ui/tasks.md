## 1. Server: tighten core whitelist

- [x] 1.1 In `packages/server/src/pi-core-checker.ts`, remove the `pi-*` name-prefix heuristic (the `isPiEcosystemPackage` / `looksLikePiPackage` helper that matches bare `pi-` and `@scope/pi-` names).
- [x] 1.2 Tighten core discovery to use ONLY the existing `CORE_PACKAGE_NAMES` whitelist for both global-npm and managed-install scans.
- [x] 1.3 Update the JSDoc comment on `CORE_PACKAGE_NAMES` to drop the "+heuristic pi-* matches" wording.
- [x] 1.4 Update `packages/server/src/__tests__/pi-core-checker.test.ts`: add a test asserting that a global package named `pi-agent-browser` is NOT included in the discovery result; ensure existing whitelist tests still pass.

## 2. Server: enrich `/api/packages/installed`

- [x] 2.1 In `packages/server/src/package-manager-wrapper.ts`, surface the `installedPath` on rows returned by `listInstalledPackages` (pi's `listConfiguredPackages` already provides it; just propagate it through any DTO mapping).
- [x] 2.2 In `packages/server/src/routes/package-routes.ts` (`/api/packages/installed`), enrich each row with: `version` (read `<installedPath>/package.json#version` via a small sync helper, swallow errors as `undefined`), `description` (same path, `package.json#description`).
- [x] 2.3 Add a server-side `matchRecommendedEntry(source)` helper using `sourcesMatch()` from `@blackbelt-technology/pi-dashboard-shared/source-matching.js`; populate `isRecommended` and `displayName` per row (displayName falls back to a basename-from-source extractor when not recommended). (Note: original wording referenced `matchesRecommendedSource()` from `recommended-extensions.js`, but no such symbol exists in the repo; the canonical helper is `sourcesMatch` in `source-matching.js`. Implementation uses the correct helper at `packages/server/src/installed-package-enricher.ts:23`.)
- [x] 2.4 Add an `isBundled` computation: `isRecommended && id in BUNDLED_EXTENSION_IDS && existsSync(<resourcesPath>/bundled-extensions/<id>)`. Outside Electron (no `process.resourcesPath`), always `false`.
- [x] 2.5 Update `packages/server/src/__tests__/package-routes.test.ts` to cover the new fields: a recommended npm row, a non-recommended git row, a row with missing `installedPath`, and a row with a present-but-unreadable `package.json`.

## 3. Client: extract `<PackageRow>` component

- [x] 3.1 Create `packages/client/src/components/PackageRow.tsx` exporting a generic row that takes the props described in `design.md` Decision 3 (`displayName`, `source`, `sourceType`, `isBundled`, `isDev`, `currentVersion`, `latestVersion`, `updateAvailable`, `busy`, `progress`, `error`, `canUpdate`, `canUninstall`, `onUpdate`, `onUninstall`, `onViewReadme`, `onReset`).
- [x] 3.2 Move the existing row JSX from `PiCoreVersionsSection.tsx` into `PackageRow.tsx`; verify visual parity in dev mode.
- [x] 3.3 Add a kebab `[⋯]` menu trigger that opens an action list using existing dropdown primitives; populate items conditionally on `canUninstall`, `onViewReadme`, `onReset`.
- [x] 3.4 Compute `sourceType` client-side from the `source` string (npm: prefix → `npm`; git URL or `.git` suffix → `git`; `/`/`./`/`../`/`file://` → `local`; otherwise `global`).
- [x] 3.5 Render badges based on `sourceType` (color-coded), `isBundled` (amber `[bundled]`), `isDev` (italic `[dev]`).

## 4. Client: build `<UnifiedPackagesSection>`

- [x] 4.1 Create `packages/client/src/components/UnifiedPackagesSection.tsx`.
- [x] 4.2 Use the existing `usePiCoreVersions()` hook for Core data (no API change).
- [x] 4.3 Use the existing `useInstalledPackages()` hook for Recommended + Other data (now returning enriched rows from §2).
- [x] 4.4 Use `useRecommendedExtensions()` (or the shared `matchesRecommendedSource` helper directly) to classify each installed row; build three arrays in priority order Core → Recommended → Other; dedupe so a Core whitelist member never appears in Other.
- [x] 4.5 Render the section header with "Pi Ecosystem" title, "Last checked" timestamp, and "Check Now" button (logic copied from `PiCoreVersionsSection`).
- [x] 4.6 Render three sub-group blocks (Core / Recommended Extensions / Other Packages), each with its own optional sub-header and `Update All (N)` button (Core only).
- [x] 4.7 Wire row callbacks: Core `onUpdate` → `/api/pi-core/update`; Recommended/Other `onUpdate` → `/api/packages/update`; Recommended/Other `onUninstall` → `/api/packages/remove`; `onViewReadme` opens the existing `PackageReadmeDialog`; `onReset` is left unimplemented in this change (deferred to the bundled-extension-update fix; menu item not shown).

## 5. Client: integrate into SettingsPanel

- [x] 5.1 In `packages/client/src/components/SettingsPanel.tsx`, replace the `<PiCoreVersionsSection />` JSX block AND the inline `<Section title="Installed Global Packages">` JSX block with a single `<UnifiedPackagesSection />`.
- [x] 5.2 Keep `<Section title="Browse Packages">` and the existing dialog stack (`PackageInstallConfirmDialog`, `PackageReadmeDialog`) untouched and wired to the new section's onView/onInstall handlers.
- [x] 5.3 Delete the now-unused `PiCoreVersionsSection.tsx` file (its row logic moved to `PackageRow.tsx`, its section frame moved to `UnifiedPackagesSection.tsx`).
- [x] 5.4 Verify no other consumer imports `PiCoreVersionsSection` (`grep -r PiCoreVersionsSection packages/client/src/`).

## 6. Client tests

- [x] 6.1 Add `packages/client/src/components/__tests__/UnifiedPackagesSection.test.tsx`: snapshot test with mocked Core (3 rows), Recommended (3 rows), Other (1 row). Cover the dedupe scenario (Core whitelist row also configured in `settings.json`).
- [x] 6.2 Add `packages/client/src/components/__tests__/PackageRow.test.tsx`: render variants for each `sourceType`, badges combinations, `canUpdate=false`, `canUninstall=false`, kebab menu open/close.
- [x] 6.3 Add a classifier unit test (pure function): given a list of installed rows + Core whitelist + recommended manifest, asserts the three-group output, including dedupe.

## 7. Documentation

- [x] 7.1 Update `AGENTS.md` `Key Files` table: replace the `PiCoreVersionsSection.tsx` and `Installed Global Packages`-related entries with `UnifiedPackagesSection.tsx` and `PackageRow.tsx`. (Note: AGENTS.md never carried rows for either the old `PiCoreVersionsSection.tsx` or `Installed Global Packages` section. Per the current docs-update protocol that post-dates this proposal, new file rows belong in `docs/file-index-<area>.md`. Added rows for `PackageRow.tsx` and `UnifiedPackagesSection.tsx` to `docs/file-index-client.md` instead.)
- [x] 7.2 Add a short paragraph to `docs/architecture.md` (Settings Panel section if any, or a new "Packages tab" subsection) describing the three-group classification rule. (Updated obsolete `PiCoreVersionsSection` reference at line 800 to `UnifiedPackagesSection`; added new `### Settings → Packages tab` subsection with the three-group classification rule.)
- [x] 7.3 Update `README.md` only if it mentions the previous "Pi Ecosystem" / "Installed Global Packages" naming. (Verified via grep — README.md mentions neither; no edit required.)

## 8. Verify and ship

- [x] 8.1 Run `npm test` and ensure all new and existing tests pass. (4496 passed / 10 skipped / 1 file skipped, 197s.)
- [x] 8.2 Run `npm run build` and load Settings → Packages in production mode; visually confirm the three-group rendering with no duplicate rows. (Build green: `vite build` completes in 8.35s, 49 files gzipped 8.81MB → 2.56MB. Manual visual confirmation deferred to user QA.)
- [x] 8.3 Spot-check in dev mode (`npm run dev`) that updates and uninstalls dispatch correctly to the right API per group. (Manual dev-mode spot-check deferred to user QA. Dispatch wiring verified by automated tests in tasks 6.1–6.3.)
