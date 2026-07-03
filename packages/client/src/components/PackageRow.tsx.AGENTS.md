# PackageRow.tsx — index

Generic installed-package row used across unified packages sections. Exports `PackageRow`, `PackageRowProps`. Renders display name, `SourceType` badge, source caption, version pill, optional Update button, what's-new icon (`whatsNewKind` "breaking"/"info" → `onShowWhatsNew`), kebab menu (Move → scope, View README, Reset, Uninstall). Uses `usePopoverFlip` for menu flip. See changes: `consolidate-packages-settings-ui`, `unify-package-management-ui`, `pi-update-whats-new-panel`, `improve-pi-update-detection`.
