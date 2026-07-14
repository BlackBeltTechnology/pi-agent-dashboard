# PackageRow.tsx — index

Generic installed-package row used across unified packages sections. Exports `PackageRow`, `PackageRowProps`. Renders display name, `SourceType` badge, `isOverride` → compact amber `override` pill (aria-label "Declared as npm:<name> but installed from a <source> source"; informational only, does NOT gate Update), source caption, version pill, optional Update button, what's-new icon (`whatsNewKind` "breaking"/"info" → `onShowWhatsNew`), kebab menu (Move → scope, View README, Reset, Uninstall). Uses `usePopoverFlip` for menu flip. See changes: `consolidate-packages-settings-ui`, `unify-package-management-ui`, `pi-update-whats-new-panel`, `improve-pi-update-detection`, `flag-package-source-overrides`.


## reset-override-to-npm

Props `publishedVariantSource`, `publishedVariantVersion`, `onResetToNpm`. When both source+handler set: 2nd source line (published spec + `<v> available`) + inline `\u21ba Reset to npm` + `\u22ee` "Reset to published version" (distinct from generic `onReset`). Both open an in-row confirm dialog (names local link \u2192 published target; "link" not files; installs first); `onResetToNpm` fires on accept. See change: reset-override-to-npm.
