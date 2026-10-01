# severity-contrast.spec.ts — index

L3 gate for `unify-message-severity-colors` + `unify-retry-visibility` (card retry-label contrast). Sweeps 5 tiers × 9 themes × {light,dark} via `localStorage`… → see `severity-contrast.spec.ts.AGENTS.md`

See change: align-ui-with-theme-tokens. `readTiers(page, tiers, prefix)` parameterised by token family; separate `TINT_TIERS` sweep (5 tints × 18 combos, own ≥ 55/90 AA, AA on base dark+light); `EXCEPTIONS` + `tokyo-night/light/{blue,purple}: 2.5`; E1 asserts `--severity-*` equals `fixtures/severity-baseline.json` in all 18 combos.
