# DOX — tests/e2e/helpers

One row per file. Non-source area. Rows split out of `tests/e2e/AGENTS.md` (byte cap). See change: add-focus-mode-and-card-block-toggles.

| File | Purpose |
|------|---------|
| `__tests__/evidence-path.test.ts` | Unit tests (vitest `tests` project) for… → see `__tests__/evidence-path.test.ts.AGENTS.md` |
| `card-sections.ts` | Card-block / focus-mode L3 glue: opens the card-section settings surfaces, toggles a block, waits for the `card_sections_updated` echo. See change: add-focus-mode-and-card-block-toggles. |
| `computed-contrast.ts` | In-page probes ported from `mockups/ux-probe.cjs… → see `computed-contrast.ts.AGENTS.md` |
| `evidence-path.ts` | Resolves a change's `measurements.json` WITHOUT creating it. → see `evidence-path.ts.AGENTS.md` |
| `fake-google.ts` | Fake Google (authorize/token/revoke/Gmail) run in-container + `docker exec` control helpers. → see `fake-google.ts.AGENTS.md` |
| `folder-collapse.ts` | Folder-collapse L3 glue: bus setup/teardown… → see `folder-collapse.ts.AGENTS.md` |
| `index.ts` | E2E helpers. `gotoDashboard(page)` navigates `/`, waits… → see `index.ts.AGENTS.md` |
| `openspec-board.ts` | OpenSpec-board drop-targeting E2E helpers. Fixture… → see `openspec-board.ts.AGENTS.md` |
| `windowed-session.ts` | Shared glue for L3 specs needing a REAL replay window. → see `windowed-session.ts.AGENTS.md` |
