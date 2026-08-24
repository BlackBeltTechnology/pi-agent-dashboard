# DOX — docs

Files in this directory. One row per file. Topic docs + repo-root config (root config files have no directory owner; catalogued here). Supersedes deleted `docs/file-index*.md` splits. See change: migrate-file-index-to-agents-tree.

| File | Purpose |
|------|---------|
| `FLOWS_HANDOFF_CHECKLIST.md` | (repo root) LLM handoff checklist. Verifies pi-flows + Anthropic-messages bridge + model resolution… → see `FLOWS_HANDOFF_CHECKLIST.md.AGENTS.md` |
| `architecture-notes/worker-offload-roadmap.md` | Worker offload roadmap. Main-loop CPU + sync-fs work → worker_threads. → see `architecture-notes/worker-offload-roadmap.md.AGENTS.md` |
| `architecture.md` | Full architecture reference. 3 components: bridge extension, Node server, React client. → see `architecture.md.AGENTS.md` |
| `biome.json` | (repo root) Biome 2.5.1 config. formatter off. vcs defaultBranch develop. → see `biome.json.AGENTS.md` |
| `chat-display-preferences.md` | `DisplayPrefs` gate chat chrome (thinking, tool cards, results, separators, stats bars). → see `chat-display-preferences.md.AGENTS.md` |
| `chat-gateway-exploration.md` | (repo root) Explore-mode design record. pi ↔ chat platforms (Discord/Slack/Telegram) via generalized… → see `chat-gateway-exploration.md.AGENTS.md` |
| `code-quality.md` | Biome ratchet. Rules graduate one-way off→warn→error; cleanup lands first, severity flip second. → see `code-quality.md.AGENTS.md` |
| `context-mode-roi-report.md` | ROI analysis. context-mode MCP plugin vs kb extension. Verdict: trim not drop. → see `context-mode-roi-report.md.AGENTS.md` |
| `context-mode-roi-report.pdf` | Rendered PDF of context-mode-roi-report.md. 13 pages. Built via document-converter facade (DOCX) + LibreOffice (DOCX→PDF). |
| `doctor-skill.md` | Modular doctor diagnostic skill. Router + 7 capability modules + _lib. → see `doctor-skill.md.AGENTS.md` |
| `electron-bootstrap-flow.md` | Electron startup state machine. `app.whenReady()` → dashboard window. → see `electron-bootstrap-flow.md.AGENTS.md` |
| `electron-build-methods.md` | 3 Electron build paths: local native (`npm run electron:build`), Docker cross-compile (--windows/--linux), CI publish.yml (tag push). Per-platform artifact/signing/node-pty matrix. |
| `electron-immutable-bundle.md` | Invariant: Electron bundle read-only at runtime. No post-install `npm install`. pi/openspec/tsx ship as deps under `<resourcesPath>/server/node_modules/`. electron-updater whole-app replacement. |
| `electron-qa-smoke-test-inventory.md` | (repo root) QA/smoke test inventory. All 574 archived OpenSpec proposals. → see `electron-qa-smoke-test-inventory.md.AGENTS.md` |
| `electron-session.md` | Implementation session log. 21 phases. Branding/icons, packaging (NSIS/AppImage), `__dirname`/tsx saga, dead… → see `electron-session.md.AGENTS.md` |
| `embedding-chat-view.md` | Subpath export `@blackbelt-technology/pi-dashboard-web/chat-embed` mounts live chat in sibling workspace. → see `embedding-chat-view.md.AGENTS.md` |
| `examples/c4-example.md` | C4-model diagram example. Mermaid fenced blocks: `C4Context`, `C4Container`. → see `examples/c4-example.md.AGENTS.md` |
| `faq.md` | Recurring how-to + troubleshooting questions. Caveman style. Cross-refs README.md + docs/. → see `faq.md.AGENTS.md` |
| `install-invoice-bot-extension.md` | Install `@blackbelt-technology/invoicebot` (from a local `pi-invoice-bot` checkout) as global pi extension. → see `install-invoice-bot-extension.md.AGENTS.md` |
| `installation-windows.md` | Windows 10/11 install guide. 2 paths: Electron Setup.exe NSIS (per-user, bundled Node) + tarball/npm (advanced). Runtime layout `%USERPROFILE%\.pi-dashboard\` + `%USERPROFILE%\.pi\`. |
| `migration/from-pi-model-proxy.md` | Migration guide `@blackbelt-technology/pi-model-proxy` → dashboard built-in proxy. → see `migration/from-pi-model-proxy.md.AGENTS.md` |
| `perf-ws-broadcast-load.md` | WS broadcast load harness. Measures head-of-line blocking on single browser WS. `createDrainingWs` timing-aware fake socket drives real gateway. Test-only, regression-gated. |
| `plan/electron-app.md` | Comprehensive Electron desktop-app plan. Bundle dashboard standalone macOS/Linux/Windows, zero prereqs,… → see `plan/electron-app.md.AGENTS.md` |
| `playwright.config.ts` | (repo root) Playwright config. testDir `tests/e2e`, `use.baseURL` imports `BASE_URL` from lifecycle.ts,… → see `playwright.config.ts.AGENTS.md` |
| `playwright.electron.config.ts` | (repo root) Playwright config for Electron-E2E suite. testDir `tests/e2e-electron`, testMatch… → see `playwright.electron.config.ts.AGENTS.md` |
| `plugin-claim-gates.md` | `predicate` vs `shouldRender` contract for plugin claims. See change: auto-hide-empty-session-subcards. |
| `plugin-intent-protocol.md` | Server-driven plugin UI. Plugins emit JSON intent trees; clients render via local primitive registry. → see `plugin-intent-protocol.md.AGENTS.md` |
| `plugin-ui-primitives.md` | Plugins access dashboard React primitives via runtime registry. `useUiPrimitive(key)` lookup. Keys `UI_PRIMITIVE_KEYS`. Shell → plugin flow, complements slot system. |
| `pnpm-workspace.yaml` | (repo root) pnpm workspace + config source of truth (package.json `pnpm.*` ignored when this exists). → see `pnpm-workspace.yaml.AGENTS.md` |
| `publishing-plugins.md` | Publish new plugin package to npm. Lockstep versioning (`sync-versions.js`). First publish seeds 0.0.1 via one-shot manual publish + revert; OIDC Trusted Publisher after. |
| `release-process.md` | Cut release how-to. Promote CHANGELOG `[Unreleased]` → versioned, bump + tag; CI publishes npm + Electron + GitHub Release. Conventional Commits enforced by review only. |
| `research/auto-trigger-plan-proposal.md` | Research dossier. Auto-trigger `plan-proposal` on `proposal.md` draft. Explore-mode, no change / no impl. → see `research/auto-trigger-plan-proposal.md.AGENTS.md` |
| `research/context-injection-ab-test.md` | A/B non-inferiority experiment: pi context injections. Harness `scripts/ab-context/`. → see `research/context-injection-ab-test.md.AGENTS.md` |
| `research/headroom-pi-integration.md` | Research dossier. Maps Headroom (local context-compression layer, shrinks tool outputs/logs/RAG before LLM,… → see `research/headroom-pi-integration.md.AGENTS.md` |
| `research/hermes-memory-pressure-kb-archive.md` | Research dossier. Decrease pi-hermes-memory pressure + keep most-relevant entries via a kb-indexed cold… → see `research/hermes-memory-pressure-kb-archive.md.AGENTS.md` |
| `research/kb-search-retrieval-quality-investigation.md` | Research dossier. Diagnose `kb_search` "sometimes similar, but unrelevant records" — feeds openspec… → see `research/kb-search-retrieval-quality-investigation.md.AGENTS.md` |
| `research/lora-dataset-from-pi-logs.md` | Research doc. Turns repo pi session JSONL logs into SFT dataset for LoRA adaptation of ~1T-param base model;… → see `research/lora-dataset-from-pi-logs.md.AGENTS.md` |
| `research/mobile-app-bubblewrap-vs-capacitor.md` | Research artifact. Explore-mode, no change / no impl. Ship pi-dashboard as mobile app: Google **Bubblewrap**… → see `research/mobile-app-bubblewrap-vs-capacitor.md.AGENTS.md` |
| `research/oh-my-pi-feature-adaptation.md` | Research artifact. omp (oh-my-pi, pi-mono fork) → pi-dashboard feature adaptation. → see `research/oh-my-pi-feature-adaptation.md.AGENTS.md` |
| `research/reverse-spec-from-code-session.md` | Method playbook. HOW `reverse-spec-from-code` skill + 102-spec backfill built in one pi session. → see `research/reverse-spec-from-code-session.md.AGENTS.md` |
| `research/reverse-spec-from-code.md` | Research artifact. `reverse-spec-from-code` skill prompt tuning + generator-model-loss experiment. → see `research/reverse-spec-from-code.md.AGENTS.md` |
| `research/session-guideline-fast-vs-research-ab.md` | A/B test — @fast vs @research model for SessionGuideline subagent. N=1 input session 019f8680. → see `research/session-guideline-fast-vs-research-ab.md.AGENTS.md` |
| `research/sub1b-stt-diarization-benchmark.md` | Sub-1B open-source STT+diarization benchmark. 4 engines: MOSS-Transcribe-Diarize 0.9B Q5_K GGUF ~1x RT local… → see `research/sub1b-stt-diarization-benchmark.md.AGENTS.md` |
| `research/t3code-feature-adaptation.md` | Research artifact. t3code (multi-provider web GUI wrapping Codex/Claude/Cursor/OpenCode) → pi-dashboard… → see `research/t3code-feature-adaptation.md.AGENTS.md` |
| `research/understand-anything-integration.md` | Research dossier. Adapt Egonex-AI/Understand-Anything (MIT; turns any codebase/docs into interactive… → see `research/understand-anything-integration.md.AGENTS.md` |
| `research/user-browser-in-editor-view.md` | Explore-mode research record. `user_browser` tool: agent drives browser, page renders in dashboard editor… → see `research/user-browser-in-editor-view.md.AGENTS.md` |
| `service-bootstrap.md` | 3 starters (Electron/Bridge/Standalone) × 2 surfaces (GUI/shell). Tool resolution (pi, openspec, node, tsx, bridge). `DASHBOARD_STARTER` env, `launchSource` on `/api/health`. |
| `skills-as-subagents.md` | Skill↔subagent bridge analysis. Wrap skill via thin `.pi/agents/<Name>.md` (model role, `inherit_context`,… → see `skills-as-subagents.md.AGENTS.md` |
| `slash-command.md` | Bridge routes typed `/foo` chat text to pi handlers. `parseSendPrompt` + `bridge.ts::sessionPrompt` 11-step order. Extension command dispatch fix (`pi.dispatchCommand`, RPC keeper). |
| `vitest.config.ts` | (repo root) Root Vitest config. `defineConfig`. Vitest 4 dropped `vitest.workspace.ts`; projects live under… → see `vitest.config.ts.AGENTS.md` |
