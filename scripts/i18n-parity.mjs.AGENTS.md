# i18n-parity.mjs — index

Catalog parity gate: every key in the union of zh-CN (`i18n-zh-CN.ts`) + hu + plugin catalogs exists in each. Also verifies the static `RESERVED_LABEL_TRANSLATIONS` table in `i18n.tsx` against the catalogs (`--fix` regenerates; drift fails). See change: shrink-client-entry-lazy-islands.
