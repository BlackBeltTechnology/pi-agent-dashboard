# RecommendedExtensions.tsx — index

Panel rendering curated recommended extensions. Exports `RecommendedExtensions`. Props: `scope`, `cwd`. Uses `useRecommendedExtensions` + `usePackageOperations`. Per-entry card: status pill (required/suggested/optional/active), scope pill, companion-plugin badge, `unlocks` + `skillsRegistered` + `requirements` chips, action button (Install/Activate/Remove by `activeInPi` + `installed.scope`). Bulk "Install all missing" button. See changes: `add-plugin-activation-ui`, `recommend-monorepo-extensions`, `align-pi-080-and-publish-baseline-packages`.

## addons-hub-declutter

New prop `hideGlobalInstalled`: drops entries installed global AND active (folder-only install and on-disk-inactive entries keep a card); all-installed → single `rec-all-installed` line. Skill chips use `PartChip`. See change: addons-hub-declutter.
