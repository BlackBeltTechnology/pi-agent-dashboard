# .pi/skills/rebuild-package-diagrams/scripts/variability.mjs — index

`readConfigInputs`, `getPath`, `variabilityDraft`, `evaluate`, `readVariability`, `checkVariability` (`appDir` cite lines incl. UTF-16, `complete` coverage), `variabilityData` (byVariant/byCustomer/unreachable/findings), CSV, findings md, FeatureIDE xml. See change: add-customer-variability.

`readConfigInputs` → `missing` variant ids; `checkVariability` reports `ui/_effective/<id>.json missing` (no ENOENT crash). Cites via `appFile`. CSV via shared `csvRows`. PR #817 local review.
