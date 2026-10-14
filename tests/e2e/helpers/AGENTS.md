# DOX — tests/e2e/helpers

One row per file. Non-source area. Rows split out of `tests/e2e/AGENTS.md` (byte cap). See change: add-focus-mode-and-card-block-toggles.

| File | Purpose |
|------|---------|
| `__tests__/evidence-path.test.ts` | Unit tests (vitest `tests` project) for… → see `__tests__/evidence-path.test.ts.AGENTS.md` |
| `__tests__/anchor-probe-send.test.ts` | E10: `installAnchorProbe` WebSocket.send wrapper forwards string/Blob/offset view/ArrayBuffer unchanged after the TS 7 `BufferSource` copy. Fake Page + stub globals, no browser. See change: migrate-typecheck-to-ts7. |
| `__tests__/ui-capture.test.ts` | `captureStates` with a fake page: matrix = states × themes × widths paths, `only` filter + unknown id, archived/missing refusal, flag-off writes nothing, empty `stubs` rejected. See change: retro-ux-identity-connectivity. Also `overflowOf` BVA, sr-only floor skip, `CaptureResult.overflow`. See change: fix-slot-pill-legend-and-stale-overflow. |
| `__tests__/lifecycle.test.ts` | Unit tests (vitest `tests` project) for `tests/e2e/lifecycle.ts` harness failure diagnostics. → see `__tests__/lifecycle.test.ts.AGENTS.md` |
| `__tests__/playwright-config.test.ts` | Unit tests (vitest `tests` project) for root `playwright.config.ts`. → see `__tests__/playwright-config.test.ts.AGENTS.md` |
| `acp.ts` | ACP spec helpers: `ACP_REPLY`, `spawnAcpSession(page, agentId)` (picker chevron → menu item → main button, returns the new card). Seeded agents `qmt`, `qmt-slow`, `qmt-perm`, `qmt-durable`. See change: add-acp-session-driver. |
| `card-sections.ts` | Card-block / focus-mode L3 glue: opens the card-section settings surfaces, toggles a block, waits for the `card_sections_updated` echo. See change: add-focus-mode-and-card-block-toggles. |
| `computed-contrast.ts` | In-page probes ported from `mockups/ux-probe.cjs… → see `computed-contrast.ts.AGENTS.md` |
| `evidence-path.ts` | Resolves a change's `measurements.json` WITHOUT creating it. → see `evidence-path.ts.AGENTS.md` |
| `fake-google.ts` | Fake Google (authorize/token/revoke/Gmail) run in-container + `docker exec` control helpers. → see `fake-google.ts.AGENTS.md` |
| `folder-collapse.ts` | Folder-collapse L3 glue: bus setup/teardown… → see `folder-collapse.ts.AGENTS.md` |
| `index.ts` | E2E helpers. `gotoDashboard(page)` navigates `/`, waits… → see `index.ts.AGENTS.md` |
| `openspec-board.ts` | OpenSpec-board drop-targeting E2E helpers. Fixture… → see `openspec-board.ts.AGENTS.md` |
| `operator-session.ts` | `OperatorSession`: arms an `operate` login-session cookie for the harness browser + REST (narrows the trust-any seed, restores the snapshot). Same flow as `mcp-token-settings.spec.ts`. See change: add-credential-vault. |
| `vault-seed.ts` | `VaultSeed` REST seeding/reset for the vault specs; `SAMPLE_GIT_SUBJECT` (`dir:hub:/fixtures/sample-git`). See change: add-credential-vault. |
| `ui-capture.ts` | `captureStates(page,{change,surface,states,only?,themes?,widths?})`: per state × theme × width install stubs, `setThemeMode`, `open`, optional screenshot (`RETRO_UX_CAPTURE=1`, active change only → `mockups/after/<surface>/<state>--<theme>-<mode>--<width>.png`), returns contrast/size/focus probe lists + `measured`. Exports `UiState`, `RETRO_UX_THEMES`, `RETRO_UX_WIDTHS`. See change: retro-ux-identity-connectivity. `UiState.overflowRoot?`/`overflowTopExempt?` opt into `overflowFailures`; `CaptureResult.overflow` (`[]` when undeclared). See change: fix-slot-pill-legend-and-stale-overflow. |
| `windowed-session.ts` | Shared glue for L3 specs needing a REAL replay window. → see `windowed-session.ts.AGENTS.md` |
