# DOX — packages/mockup-loop/src/__tests__

Tests for packages/mockup-loop (vitest, `src/**/__tests__/**/*.test.ts`). One row per file.

| File | Purpose |
|------|---------|
| `extension.test.ts` | Tool-surface smoke: fake pi registers tools; design-system presets, init_ui_contract, score/validate shapes, serve_mockup canvas text (E32). |
| `mock-site-core.test.ts` | L1 pure modules: parseRef (E1, E2), discoverMocks (E3, E4), decisions shape/malformed/symlink/concurrency (E14, E15, X4), listAdoptable + moveMockDir (E21, E22). See change: add-live-component-mock-site. |
| `mock-site-fixture.ts` | `makeFixture()` temp project (`mockups/` + node_modules symlink to repo) and `makeServableFixture()` (real plugin config) for mock-site tests. See change: add-live-component-mock-site. |
| `mock-site-server.test.ts` | L1 real Vite dev server + plugin over HTTP: bind, HTML entry, note/body/method/type/id/status/Origin/symlink guards (E5–E13), LAN view-only (E11, skips without LAN IPv4), mock-decide CLI incl. adoptable/move (E16, E17). Bounded `stop()` close. See change: add-live-component-mock-site. |
| `mock-site-serve.test.ts` | L1 serve_mock_site with a real Vite child: reserved ports / missing config / missing vite (E18), start under 30 s + LAN text + stop + session_shutdown (E19, P2, X3), busy port (X1), crash during start (X2), no vite import (X8). See change: add-live-component-mock-site. |
| `presets.test.ts` | Design-system preset registry + contract + validators. |
