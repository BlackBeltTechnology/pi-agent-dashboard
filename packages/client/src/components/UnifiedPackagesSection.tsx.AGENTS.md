# UnifiedPackagesSection.tsx — index

Exports `UnifiedPackagesSection`. Settings → Packages "Pi Ecosystem" section. Sub-groups Core / Recommended Extensions / Other Packages via `PackageRow`. Drives core updates (`/api/pi-core/update`), installed-package update checks, `WhatsNewDialog` for pi core changelog. `launchSource === "electron"` hides Core group. Helpers `npmNameFromSource`, `relativeTime`, `isPiCorePkg`, `SubGroupHeader`, `EmptyHint`.
