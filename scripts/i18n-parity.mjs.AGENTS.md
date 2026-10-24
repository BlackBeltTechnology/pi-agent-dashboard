# i18n-parity.mjs — index

Catalog parity gate: every key in the union of zh-CN (`i18n-zh-CN.ts`) + hu + plugin catalogs exists in each. Also verifies the static `RESERVED_LABEL_TRANSLATIONS` table in `i18n.tsx` against the catalogs (`--fix` regenerates; drift fails). See change: shrink-client-entry-lazy-islands. Plugin catalogs listed via `execFileSync("find", argv)` (no shell; failure → empty list). `i18n-migrate-auto-keys.mjs` likewise uses `execFileSync("grep", argv)`. Contract: `packages/shared/src/__tests__/i18n-scripts-no-shell.test.ts`. See change: triage-codeql-alert-debt.
