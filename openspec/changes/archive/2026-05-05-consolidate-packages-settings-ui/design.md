## Context

The Settings → Packages tab today renders two sibling `<Section>` components fed by two unrelated data sources:

- `PiCoreVersionsSection` consumes `GET /api/pi-core/status` (backed by `pi-core-checker.ts`), which returns globally-installed `npm list -g` packages whose names match either a hardcoded whitelist (`@mariozechner/pi-coding-agent`, `@blackbelt-technology/pi-agent-dashboard`, …) **or a `pi-*` heuristic** (`pi-coding-agent`, `pi-agent-browser`, `@scope/pi-anything`).
- The "Installed Global Packages" block (inline in `SettingsPanel.tsx`) consumes `GET /api/packages/installed` (backed by `package-manager-wrapper.ts → pm.listConfiguredPackages()`), which returns rows from pi's `settings.json packages[]` with only `{ source, scope }`.

Empirical overlap (from the user's screenshot): `pi-agent-browser`, `@tintinweb/pi-subagents`, `pi-web-access` appear in **both** lists — once as ecosystem (Update-only, version shown) and once as installed (Uninstall-only, no version). Same package, two rows, inconsistent affordances.

Pi's `DefaultPackageManager.listConfiguredPackages()` already returns each row with an `installedPath` field (verified in `pi-coding-agent/dist/core/package-manager.js:687`). Every pi extension has a `package.json` with a `version` field (verified for `pi-flows@0.1.0`, the user's screenshot data). So the version data we need is already on disk, just not surfaced through `/api/packages/installed`.

`RECOMMENDED_EXTENSIONS` and `BUNDLED_EXTENSION_IDS` already exist in `packages/shared/src/recommended-extensions.ts` with stable ids, displayNames, and source URLs — they're the natural cross-reference for "which installed package corresponds to which curated entry."

## Goals / Non-Goals

**Goals:**
- One unified `<Section>` in the Packages tab with three sub-groups (Core, Recommended Extensions, Other Packages), each rendered with the same row component.
- Every row shows: display name, source caption, source-type badge, current version, latest version (when known), Update button (when applicable), kebab menu for Uninstall + README + Reset.
- A package appears in exactly one group. Priority: Core → Recommended → Other.
- The change is small: ~70 LoC across 3 files (proposal-level estimate); no new endpoint, no data-model change, only an additive enrichment to one existing route.
- Tools section in Settings → General stays as-is.

**Non-Goals:**
- Fixing the bundled-extensions-can't-update bug (no `.git` directory after `cpSync`). The `[⋯] → Reset` action is the UX workaround; the actual fix (don't strip `.git` from the bundle, or detect missing `.git` in pi's `updateGit`) is a separate, smaller change.
- Restructuring the `Tools` settings section (orthogonal: binary/module resolver diagnostic).
- Changing `RECOMMENDED_EXTENSIONS` membership or the bundling policy.
- Removing or renaming `GET /api/pi-core/*` endpoints. They stay; only their internal heuristic tightens.
- Server-side classification into groups. The client classifies via cross-reference against `RECOMMENDED_EXTENSIONS` ids, because the manifest already lives in `@blackbelt-technology/pi-dashboard-shared` and is imported on both sides.

## Decisions

### Decision 1: Client-side group classification, not server-side

We add `isRecommended: boolean` and `isBundled: boolean` flags to each `/api/packages/installed` row, but we do NOT add a `group: "core" | "recommended" | "other"` field. The client matches each row to a `RECOMMENDED_EXTENSIONS` entry by source (already done by the existing `useRecommendedExtensions` hook), and the Core group is fed by a separate hook (`usePiCoreVersions`) that is already in place.

**Rationale:**
- Two independent hooks today render two independent data shapes. Reusing them avoids creating a new endpoint and a new shape to keep in sync.
- Group identity (Core / Recommended / Other) is a render concern; the data model only needs to be enriched enough that the client can classify. `isRecommended` + `isBundled` + `displayName` + `version` is sufficient.

**Alternative considered:** A new `GET /api/packages/unified` that returns `{ core, recommended, other }`. Rejected because it duplicates two existing endpoints, requires two clients to migrate, and the merge logic is trivial in the client where both hooks already exist.

### Decision 2: Strict whitelist in `pi-core-checker.ts`, drop the heuristic

`pi-core-checker.ts` will list ONLY:
- `@mariozechner/pi-coding-agent`
- `@oh-my-pi/pi-coding-agent`
- `@blackbelt-technology/pi-agent-dashboard`
- `@blackbelt-technology/pi-model-proxy`

Any global npm package matching `pi-*` that is NOT in this list will no longer appear in `GET /api/pi-core/status`. It will appear in `GET /api/packages/installed` IF it is also configured in pi's `settings.json packages[]` — which is the canonical, user-visible source of truth for "what extensions does pi load."

**Rationale:** The duplication in the screenshot is caused entirely by this heuristic. The whitelist covers every known case (pi tools that need self-update). New core tools added in the future need a one-line addition; that's a fair trade for eliminating the duplicate-row bug.

**Alternative considered:** Keep the heuristic but server-side filter rows that already appear in `settings.json packages[]`. Rejected — more code, fragile (e.g., a user can have `pi-agent-browser` globally installed without listing it in `packages[]`), and the heuristic was tagged "tracked tech debt" in `pi-core-checker.ts` from the start.

### Decision 3: Reuse the existing PackageRow visual (PiCoreVersionsSection's row)

The current `PiCoreVersionsSection.tsx` already has a clean row layout (display name, source caption, badge, version, optional Update). We extract that JSX into a generic `<PackageRow>` component that takes:

```ts
interface PackageRowProps {
  displayName: string;
  source: string;                  // shown as caption
  sourceType: "npm" | "git" | "local" | "global";
  isBundled?: boolean;
  isDev?: boolean;
  currentVersion?: string;
  latestVersion?: string | null;
  updateAvailable: boolean;
  busy: boolean;
  progress?: string;
  error?: string;
  canUpdate: boolean;              // false → no Update button
  canUninstall: boolean;           // false → no Uninstall in menu (Core)
  onUpdate?: () => void;
  onUninstall?: () => void;
  onViewReadme?: () => void;
  onReset?: () => void;
}
```

The Core group passes `canUninstall: false`. The Recommended and Other groups pass `canUninstall: true`. The Update button delegates to either `/api/pi-core/update` (for Core) or `/api/packages/update` (for everything else) — chosen by which `onUpdate` handler is wired in.

**Rationale:** Component reuse ensures the three groups are visually identical and any future cosmetic improvement applies everywhere automatically.

### Decision 4: Source-type badges derived client-side

The `sourceType` is computed client-side from the raw `source` string:
- starts with `npm:` → `"npm"`
- matches `https?://.*\.git`/`git@`/`ssh://` → `"git"`
- starts with `/` or `./` or `../` or `file://` → `"local"`
- otherwise (Core only) → `"global"`

**Rationale:** The classification is a pure function of the source string. Computing it server-side would just move pure logic across a network boundary.

### Decision 5: Version field optional, missing version is silent

If `<installedPath>/package.json` is unreadable or missing `version`, the row renders without a version pill — no error, no "unknown" label. This handles edge cases like:
- A `local` source pointing to a directory that hasn't been built yet.
- A bundled extension whose copy was interrupted mid-flight.

The `latestVersion` field stays as today: `string | null` where `null` means "registry unreachable" (already handled by the existing UI in `PiCoreVersionsSection`).

## Risks / Trade-offs

- **[Risk]** A user has `@mariozechner/pi-coding-agent` global-installed AND has it referenced as a local dev source in `settings.json packages[]`. → It will appear in BOTH Core (whitelist) and Other (settings.json). Mitigation: client-side dedupe — if a row's npm-name matches a Core whitelist entry, suppress the Other-group occurrence.

- **[Risk]** Reading `package.json` on every `/api/packages/installed` call adds disk I/O. → Negligible: pi's `listConfiguredPackages` already returns `installedPath`, the read is a single sync `readFileSync`+`JSON.parse` per row, and the rows are O(10) in practice. No caching needed.

- **[Risk]** The `RECOMMENDED_EXTENSIONS` source string and the `settings.json packages[]` source string may differ subtly (trailing slash, `.git` suffix, scope prefix). → Mitigation: use the existing `matchesRecommendedSource()` helper from `packages/shared/src/recommended-extensions.ts` which already normalizes these forms (it's used by `useRecommendedExtensions`).

- **[Trade-off]** A package globally-npm-installed (`pi-flow-tool`) but NOT listed in `settings.json packages[]` won't appear anywhere in the new UI. → Acceptable: pi doesn't load it either, so showing it would mislead. Users can still add it via Browse Packages → Install.

- **[Trade-off]** No "promote to Core" UX for users with custom pi tools. → Acceptable: the Core group is reserved for tools the dashboard self-updates as part of its own bootstrap. Custom tools belong in Other.

## Migration Plan

This is purely a UI/server-enrichment change with no data migration:

1. Land server changes (`pi-core-checker.ts` whitelist, `/api/packages/installed` enrichment). Existing client code continues to work because all new fields are additive.
2. Land client changes (`UnifiedPackagesSection.tsx` replacing the two sibling sections). Old `PiCoreVersionsSection` is renamed/refactored; no consumers outside the Packages tab.
3. No database migration. No config migration. No user-visible data loss.

**Rollback:** Single-PR revert of the SettingsPanel.tsx change restores the old visual; the server enrichment is a strict superset and stays harmless even if the client is rolled back.

## Open Questions

1. Should `[⋯] → Reset` be in this change, or deferred to a separate "fix bundled-extension updates" change? **Tentative answer:** ship it here as a no-op-when-not-bundled menu item; the underlying `rm -rf installedPath + reinstall` action is small and aligns with the goal of one consistent action surface.

2. Should the "Other Packages" group have its own header copy, or just an unlabeled separator? **Tentative answer:** label it explicitly with a short helper sentence ("Locally-developed and user-added.") so users understand why their dev-mode `file://` rows live in a separate visual group from curated extensions.

3. Should we surface `[bundled]` as a badge for the user, or keep it server-side only as a flag for `canUpdate`/`onReset` decisions? **Tentative answer:** show it. Users with a fresh Electron install will see exactly which extensions came pre-loaded, and that transparency is worth the visual cost.
