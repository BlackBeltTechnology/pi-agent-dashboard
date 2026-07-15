# UnifiedPackagesSection.tsx — index

Exports `UnifiedPackagesSection`. Settings → Packages "Pi Ecosystem" section. Sub-groups Core / Recommended Extensions / Other Packages via `PackageRow`. Installed rows pass `isOverride: isSourceOverride(pkg)` (forwarded through `WhatsNewPackageRow`'s `{...rowProps}` spread) → `override` pill; Update affordance unchanged. Drives core updates (`/api/pi-core/update`), installed-package update checks, `WhatsNewDialog` for pi core changelog. `launchSource === "electron"` hides Core group. Helpers `npmNameFromSource`, `relativeTime`, `isPiCorePkg`, `SubGroupHeader`, `EmptyHint`. See change: flag-package-source-overrides.


## reset-override-to-npm

Installed rows forward `publishedVariantSource/Version` + `onResetToNpm` (\u2192 `operations.resetToNpm(source,{scope:"global"})`) through `WhatsNewPackageRow`\u2019s `{...rowProps}`. Wrapped in a `<div>` that also renders `PackagePartialSuccessBanner` on `moveState.phase==="partial-success"`. See change: reset-override-to-npm.
