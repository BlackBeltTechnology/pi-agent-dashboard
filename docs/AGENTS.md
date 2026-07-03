# DOX — docs

Files in this directory. One row per file. Topic docs + repo-root config (root config files have no directory owner; catalogued here). Supersedes deleted `docs/file-index*.md` splits. See change: migrate-file-index-to-agents-tree.

| File | Purpose |
|------|---------|
| `.pi-test-harness.json` | (repo root) Per-worktree test-harness state. Gitignored. Written by test-up.sh to HOST_CWD. `{ project, dashboardPort, gatewayPort }`. test-down.sh removes after down. See change: parallelize-test-harness. |
| `architecture.md` | Full architecture reference. 3 components: bridge extension, Node server, React client. WS ports 9999 (bridge) + 8000 (client). In-memory + JSON persistence. `/site` marketing app product-adjacent, separate build. |
| `biome.json` | (repo root) Biome 2.5.1 config. formatter off. vcs defaultBranch develop. tier ladder (Tier A error, Tier B/C warn). a11y override client. test override noExplicitAny off. ignores css + dist + archive + fixtures. See change: add-code-quality-skill. |
| `chat-display-preferences.md` | `DisplayPrefs` storage, merge rule, transport, migration, first-launch. See change: configurable-chat-display. |
| `code-quality.md` | Biome ratchet system. tier ladder. graduation criterion. rollout phases. oracle. rough edge. See change: add-code-quality-skill. |
| `electron-bootstrap-flow.md` | Electron startup state machine. `app.whenReady()` → dashboard window. 6 states, 3 triggers, 3 end states (attach/done/loading-page-error). Health-probe `GET /api/health` port 8000. Electron launcher only. |
| `electron-build-methods.md` | 3 Electron build paths: local native (`npm run electron:build`), Docker cross-compile (--windows/--linux), CI publish.yml (tag push). Per-platform artifact/signing/node-pty matrix. |
| `electron-immutable-bundle.md` | Invariant: Electron bundle read-only at runtime. No post-install `npm install`. pi/openspec/tsx ship as deps under `<resourcesPath>/server/node_modules/`. electron-updater whole-app replacement. |
| `electron-session.md` | Implementation session log. Branding/icons, packaging formats (NSIS/AppImage), dead ends, gotchas. Records what failed + lessons. |
| `faq.md` | Recurring how-to questions. Answers point at README.md + docs/ sources. |
| `installation-windows.md` | Windows 10/11 install guide. 2 paths: Electron Setup.exe NSIS (per-user, bundled Node) + tarball/npm (advanced). Runtime layout `%USERPROFILE%\.pi-dashboard\` + `%USERPROFILE%\.pi\`. |
| `perf-ws-broadcast-load.md` | WS broadcast load harness. Measures head-of-line blocking on single browser WS. `createDrainingWs` timing-aware fake socket drives real gateway. Test-only, regression-gated. |
| `playwright.config.ts` | (repo root) Playwright config. testDir `tests/e2e`, `use.baseURL` imports `BASE_URL` from lifecycle.ts, single chromium project. globalSetup/globalTeardown = `tests/e2e/global-*.ts`. expect timeout 10s, globalTimeout 15min, retries CI?1:0. Opt-in browser E2E; not in `npm test`. `@playwright/test` pinned exact 1.61.1. chromium `channel` env-driven via `PW_CHANNEL`. See change: add-playwright-e2e. See change: parallelize-test-harness. See change: self-heal-host-playwright-browser. |
| `plugin-claim-gates.md` | `predicate` vs `shouldRender` contract for plugin claims. See change: auto-hide-empty-session-subcards. |
| `plugin-intent-protocol.md` | Server-driven plugin UI. Plugins emit JSON intent trees; clients render via local primitive registry. One server emission → identical render per client. See change: adopt-server-driven-intent-rendering. |
| `plugin-ui-primitives.md` | Plugins access dashboard React primitives via runtime registry. `useUiPrimitive(key)` lookup. Keys `UI_PRIMITIVE_KEYS`. Shell → plugin flow, complements slot system. |
| `publishing-plugins.md` | Publish new plugin package to npm. Lockstep versioning (`sync-versions.js`). First publish seeds 0.0.1 via one-shot manual publish + revert; OIDC Trusted Publisher after. |
| `release-process.md` | Cut release how-to. Promote CHANGELOG `[Unreleased]` → versioned, bump + tag; CI publishes npm + Electron + GitHub Release. Conventional Commits enforced by review only. |
| `service-bootstrap.md` | 3 starters (Electron/Bridge/Standalone) × 2 surfaces (GUI/shell). Tool resolution (pi, openspec, node, tsx, bridge). `DASHBOARD_STARTER` env, `launchSource` on `/api/health`. |
| `slash-command.md` | Bridge routes typed `/foo` chat text to pi handlers. `parseSendPrompt` + `bridge.ts::sessionPrompt` 11-step order. Extension command dispatch fix (`pi.dispatchCommand`, RPC keeper). |
