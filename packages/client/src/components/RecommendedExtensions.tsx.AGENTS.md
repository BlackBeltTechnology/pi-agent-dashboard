# RecommendedExtensions.tsx — index

Panel rendering curated recommended extensions. Exports `RecommendedExtensions`. Props: `scope`, `cwd`. Uses `useRecommendedExtensions` + `usePackageOperations`. Per-entry card: status pill (required/suggested/optional/active), scope pill, companion-plugin badge, `unlocks` + `skillsRegistered` + `requirements` chips, action button (Install/Activate/Remove by `activeInPi` + `installed.scope`). Bulk "Install all missing" button. See changes: `add-plugin-activation-ui`, `recommend-monorepo-extensions`, `align-pi-080-and-publish-baseline-packages`.
