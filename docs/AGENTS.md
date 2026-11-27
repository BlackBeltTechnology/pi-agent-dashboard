# DOX — docs

Files in this directory. One row per file. Topic docs + repo-root config (root config files have no directory owner; catalogued here). Supersedes deleted `docs/file-index*.md` splits. See change: migrate-file-index-to-agents-tree.

| File | Purpose |
|------|---------|
| `CONTRIBUTING.md` | (repo root) Human-facing contribution guide. Spec-first 5-phase pipeline (EXPLORE→PLAN→BUILD→SHIP→CI). 6 Mermaid diagrams + PNGs, cross-ref docs/pipeline-map/. |
| `acme-dns01-certs.md` | ACME DNS-01 domain cert guide. See change: add-acme-dns01-certs. |
| `acp-sessions.md` | ACP agent sessions: `acpAgents`/`acp.*` config, pi-vs-ACP matrix, hosts A/B, replay. → see `acp-sessions.md.AGENTS.md` |
| `agent-teams-in-process.md` | Agent Teams in-process teammate mode guide: choosing mode + precedence (`TeamCreate` > template >… → see `agent-teams-in-process.md.AGENTS.md` |
| `agent-teams.md` | Agent Teams templates, teammate types, hooks, plan approval guide: template format, `/agent-team`, start… → see `agent-teams.md.AGENTS.md` |
| `architecture-notes/worker-offload-roadmap.md` | Worker offload roadmap. Main-loop CPU + sync-fs work → worker_threads. → see `architecture-notes/worker-offload-roadmap.md.AGENTS.md` |
| `architecture.md` | Full architecture reference (bridge + server + client, data flow, protocols). → see `architecture.md.AGENTS.md` |
| `biome.json` | (repo root) Biome 2.5.1 config. formatter off. vcs defaultBranch develop. → see `biome.json.AGENTS.md` |
| `blender-wasm.md` | Headless Blender via WASM. `packages/blender`, bin `pi-blender`, MCP `blender-wasm`. Node 24 JSPI. 5 tools. MEMFS sandbox. sha512 pin. See change: add-blender-wasm-mcp. |
| `chat-display-preferences.md` | `DisplayPrefs` gate chat chrome (thinking, tool cards, results, separators, stats bars). → see `chat-display-preferences.md.AGENTS.md` |
| `chat-gateway.agent.md` | Pull-only companion for `chat-gateway.md`. Setup, boundaries, team controls, config keys, dashboard-session… → see `chat-gateway.agent.md.AGENTS.md` |
| `chat-gateway.md` | Operator setup guide for `@blackbelt-technology/pi-dashboard-chat-gateway-plugin`. → see `chat-gateway.md.AGENTS.md` |
| `chat-motion.md` | Fluid chat motion. `chatMotion` pref (rollback PATCH). Arrival entry, paced reveal, trailing edge, glide follow-scroll attributed as `pin-bottom`, idle/energy bound. See change: add-fluid-chat-motion. |
| `ci.md` | Affected-test CI, budget lane, nightly rerun-once. ci.yml jobs; `decide()` layers; fail-safes. → see `ci.agent.md`. See change: speed-up-ci-affected-tests, stabilize-blocking-test-lanes. |
| `ci.agent.md` | Pull-only map for `ci.md`: selection, budget lane, rerun-once. → see `ci.md`. |
| `code-quality.md` | Biome ratchet. Rules graduate one-way off→warn→error; cleanup lands first, severity flip second. CodeQL ratchet section. → see `code-quality.md.AGENTS.md` |
| `codeql-baseline.json` | (repo root) CodeQL ratchet baseline; edit via `scripts/codeql-local.mjs`. → see `codeql-baseline.json.AGENTS.md` |
| `context-mode-roi-report.md` | ROI analysis. context-mode MCP plugin vs kb extension. Verdict: trim not drop. → see `context-mode-roi-report.md.AGENTS.md` |
| `context-mode-roi-report.pdf` | Rendered PDF of context-mode-roi-report.md. 13 pages. Built via document-converter facade (DOCX) + LibreOffice (DOCX→PDF). |
| `craft-apps.md` | ArtCraft craft apps (13) headless via `pi-craft`. Provision `<CRAFT_HOME>/<app>/<v>/`;… → see `craft-apps.md.AGENTS.md` |
| `craft-web-plugin.md` | ArtCraft web editors in editor pane. Provision, sandbox/CSP, shim v3, §14 spikes, §15 `craft_control` live… → see `craft-web-plugin.md.AGENTS.md` |
| `credential-vault.md` | Hub `vault.json`: encrypted at rest (§12), bindings, grants, TLS trust gate. → see `credential-vault.md.AGENTS.md` |
| `default-model-role-ref.md` | Settings `defaultModel` `@role[:level]` follows role. Resolve per use; pi mirror; re-mirror rule; unresolved fallback. See change: default-model-follows-role. |
| `doctor-skill.md` | Modular doctor diagnostic skill. Router + 10 capability modules + _lib. → see `doctor-skill.md.AGENTS.md` |
| `electron-bootstrap-flow.md` | Electron startup state machine. `app.whenReady()` → dashboard window. → see `electron-bootstrap-flow.md.AGENTS.md` |
| `electron-build-methods.md` | 3 Electron build paths: local native (`npm run electron:build`), Docker cross-compile (--windows/--linux), CI publish.yml (tag push). Per-platform artifact/signing/node-pty matrix. |
| `electron-immutable-bundle.md` | Invariant: Electron bundle read-only at runtime. Runtime overlay in `~/.pi/dashboard/runtime/versions/<X>/`… → see `electron-immutable-bundle.md.AGENTS.md` |
| `electron-server-windows.md` | Paired-server windows. Main-process discovery + knock pairing + fp keyring; one window per server, partition… → see `electron-server-windows.md.AGENTS.md` |
| `electron-session.md` | Implementation session log. 21 phases. Branding/icons, packaging (NSIS/AppImage), `__dirname`/tsx saga, dead… → see `electron-session.md.AGENTS.md` |
| `embedding-chat-view.md` | Subpath export `@blackbelt-technology/pi-dashboard-web/chat-embed` mounts live chat in sibling workspace. → see `embedding-chat-view.md.AGENTS.md` |
| `examples/c4-example.md` | C4-model diagram example. Mermaid fenced blocks: `C4Context`, `C4Container`. → see `examples/c4-example.md.AGENTS.md` |
| `faq.md` | Recurring how-to + troubleshooting Q&A → see `faq.md.AGENTS.md` |
| `features.md` | Full feature catalog. 562 capabilities. Derived from README.md + openspec/specs/. Categorized by surface. → see `features.md.AGENTS.md` |
| `heap-limits.md` | V8 heap reference. Config keys `sessionHeap` (`maxOldSpaceMb` 512, `initialOldSpaceMb`, `maxSemiSpaceMb`) +… → see `heap-limits.md.AGENTS.md` |
| `grammar-checker.md` | User + dev feature doc. LLM grammar + spelling + style check for composer + OpenSpec Explore/New Change…… → see `grammar-checker.md.AGENTS.md` |
| `grammar-model-guidance.md` | Recommended LLM models for composer grammar check + latency/quality/cost tradeoffs. → see `grammar-model-guidance.md.AGENTS.md` |
| `gmail-plugin.agent.md` | Pull-only companion for `gmail-plugin.md`. Sign-in, error codes, setup run/steps/checkpoints/handoff, lease gates, levels, tools, routes, storage, security. → see `gmail-plugin.md` |
| `gmail-plugin.md` | Gmail tools, levels, lease delegation → Google Connect, legacy fallback, REST 410/503, storage (rollback… → see `gmail-plugin.md.AGENTS.md` |
| `google-plugin.md` | Google Connect owner: clients (built-in + own), accounts/grants/products, sign-in paths + return page,… → see `google-plugin.md.AGENTS.md` |
| `identity-auth-plugin-guide.md` | Build dashboard auth plugin. Three-way split; login view + resolver + host access policy; break-glass. → see `identity-auth-plugin-guide.md.AGENTS.md` |
| `identity-plane.md` | Multi-user identity ref. Gate on `request.principal`/`ws.principal`; owner-equality every session road; break-glass D23; `ctx.identity` D24. → see `identity-plane.md.AGENTS.md` |
| `install-invoice-bot-extension.md` | Install `@blackbelt-technology/invoicebot` (local `../pi-invoice-bot`) as global pi extension. → see `install-invoice-bot-extension.md.AGENTS.md` |
| `installation-windows.md` | Windows 10/11 install guide. 2 paths: Electron Setup.exe NSIS (per-user, bundled Node) + tarball/npm (advanced). Runtime layout `%USERPROFILE%\.pi-dashboard\` + `%USERPROFILE%\.pi\`. |
| `kb-freshness.md` | kb freshness budget (`KB_FRESHNESS_BUDGET_MS`). See change: bound-kb-search-freshness. |
| `kb-git-scope.md` | kb `git` scope (`scope:"git"`): commits/PRs/issues, `git.*` config, request budget, lease, credentials, rollback. See change: add-kb-git-forge-scope. |
| `kb-read-discipline.md` | Trust verdicts on `kb_search` agents hits (FRESH/STALE/MOVED/GONE/UNVERIFIED, cap 8, ack sidecar v2) + search… → see `kb-read-discipline.md.AGENTS.md` |
| `knip-baseline.json` | (repo root) Knip dead-code baseline. Per-class debt counts, measured 2026-10-12. Debt ceiling, not target. → see `knip-baseline.json.AGENTS.md` |
| `knip.json` | (repo root) Knip 6.32.2 whole-graph dead-code config. 66 workspaces. → see `knip.json.AGENTS.md` |
| `managed-services.md` | Managed services layer. `pi.tools` vs services; `services.json` / `services-run/<id>/` files; drivers… → see `managed-services.md.AGENTS.md` |
| `migration/slot-pill-actions-to-folder-menu.md` | Plugin-author migration guide. `SlotPill.actions?: ReactNode` removed; replace with `useFolderMenuItem` +… → see `migration/slot-pill-actions-to-folder-menu.md.AGENTS.md` |
| `models/` | AI-model catalog dir (AI Search channel, by function + hardware tier). Generated by `youtube-srt` skill; `picks.md` hand-curated. → see `models/AGENTS.md` |
| `obs-studio.md` | OBS Studio plugin, `packages/obs-studio-plugin/`. `pi-obs` CLI ↔ obs-websocket. → see `obs-studio.md.AGENTS.md` |
| `passkey-users.md` | Passkey login + user directory ref. Enable via `auth.passkeys.enabled`; `groupTiers` fail-closed; tiers… → see `passkey-users.md.AGENTS.md` |
| `perf-ws-broadcast-load.md` | WS broadcast load harness. Measures head-of-line blocking on single browser WS. `createDrainingWs` timing-aware fake socket drives real gateway. Test-only, regression-gated. |
| `plan/electron-app.md` | Comprehensive Electron desktop-app plan. Bundle dashboard standalone macOS/Linux/Windows, zero prereqs,… → see `plan/electron-app.md.AGENTS.md` |
| `playwright.config.ts` | (repo root) Playwright config. testDir `tests/e2e`, `use.baseURL` imports `BASE_URL` from lifecycle.ts,… → see `playwright.config.ts.AGENTS.md` |
| `playwright.electron.config.ts` | (repo root) Playwright config for Electron-E2E suite. testDir `tests/e2e-electron`. → see `playwright.electron.config.ts.AGENTS.md` |
| `pi-settings-editor.md` | pi global `settings.json` editor (Settings → pi). REST `/api/pi-settings`. Shared schema, etag, lock + tmp+rename. → see `pi-settings-editor.md.AGENTS.md` |
| `plugin-apps.md` | Plugin React apps embedded + standalone. `<EmbeddedApp>` (`./embedded-app`), `EmbeddedAppShellProvider`,… → see `plugin-apps.md.AGENTS.md` |
| `plugin-claim-gates.md` | `predicate` vs `shouldRender` contract for plugin claims; slot-claims invalidation store; badge-gate rule;… → see `plugin-claim-gates.md.AGENTS.md` |
| `plugin-intent-protocol.md` | Server-driven plugin UI. Plugins emit JSON intent trees; clients render via local primitive registry. → see `plugin-intent-protocol.md.AGENTS.md` |
| `plugin-seams.md` | Plugin authoring guide. 3 seams (credentials store (encrypted at rest), ctx.oauth flow, bridge→server request… → see `plugin-seams.md.AGENTS.md` |
| `plugin-ui-primitives.md` | Plugins access dashboard React primitives via runtime registry. `useUiPrimitive(key)` lookup. → see `plugin-ui-primitives.md.AGENTS.md` |
| `pnpm-workspace.yaml` | (repo root) pnpm workspace + config source of truth (package.json `pnpm.*` ignored when this exists). → see `pnpm-workspace.yaml.AGENTS.md` |
| `team-plugin.md` | Phase 1 AI Team. `packages/team-plugin` + `packages/team-app`. → see `team-plugin.md.AGENTS.md` |
| `vendored-relay-refresh.md` | Operator page for the vendored Playwright relay: per-file provenance kinds, the non-reorderable fetch →… → see `vendored-relay-refresh.md.AGENTS.md` |
| `vitest.workers.ts` | (repo root) Single source of truth for the vitest parallel worker target: exports `PARALLEL_MAX_WORKERS`, `BUDGET_TEST_EXCLUDE` → see `vitest.workers.ts.AGENTS.md` |
| `publishing-plugins.md` | Publish plugin package to npm. Lockstep versioning, OIDC Trusted Publisher, erasable plugin TS. → see `publishing-plugins.md.AGENTS.md` |
| `release-process.md` | Cut release how-to. Promote CHANGELOG `[Unreleased]` → versioned, bump + tag; CI publishes npm + Electron +… → see `release-process.md.AGENTS.md` |
| `research/agent-bash-sandboxing.md` | Research, explore-only, no change/impl. Isolates arbitrary-bash file/dir access (path-gate: read/write/edit… → see `research/agent-bash-sandboxing.md.AGENTS.md` |
| `research/agent0-self-evolving-loop-adaptation.md` | Research artifact. Explore-mode, no change / no impl. Agent0 (arXiv 2511.16043) → pi-dashboard. → see `research/agent0-self-evolving-loop-adaptation.md.AGENTS.md` |
| `research/anti-slop-prose-multilingual.md` | Research. No impl. AI-prose tell linter for YouTube, en+hu; two-layer universal+locale override model; new… → see `research/anti-slop-prose-multilingual.md.AGENTS.md` |
| `research/arex-deep-research-models.md` | Research. No impl. AREX models (`AREX-Turbo`/`AREX-Base`/`AREX-2`), Apache-2.0, XML tool calls; register via `models.json`. → see `research/arex-deep-research-models.md.AGENTS.md` |
| `research/astabrief-local-report-generation.md` | Research. No impl. AstaBrief-8B (Ai2, Apache-2.0): excerpts → cited report, one pass; not agent. → see `research/astabrief-local-report-generation.md.AGENTS.md` |
| `research/auto-trigger-plan-proposal.md` | Research. Auto-trigger `plan-proposal` on `proposal.md` draft. Explore-mode, no change / no impl. → see `research/auto-trigger-plan-proposal.md.AGENTS.md` |
| `research/bridge-transport-and-identity.md` | Research. No impl. P2P vs WebSocket for bridge↔server. → see `research/bridge-transport-and-identity.md.AGENTS.md` |
| `research/browser-probe-and-ship-traps.md` | Research. Method half of 2026-08-26/27 marketing-site session: headless-browser probes verify… → see `research/browser-probe-and-ship-traps.md.AGENTS.md` |
| `research/browser-provider-registry.md` | Research artifact. Explore-mode, no change / no impl. Verdict: named-browsers registry, NOT Chrome extension;… → see `research/browser-provider-registry.md.AGENTS.md` |
| `research/browser-relay-playwright-extension.md` | Research artifact. Explore-mode, no impl. Verdict: reuse MS Playwright Extension… → see `research/browser-relay-playwright-extension.md.AGENTS.md` |
| `research/cactus-whistle-hungarian.md` | Research. → see `research/cactus-whistle-hungarian.md.AGENTS.md` |
| `research/clm-system-one.md` | Research. CLM as System One backend. Wire `/v1/systemone`, `http` kind. → see `research/clm-system-one.md.AGENTS.md` |
| `research/containerized-spawn.md` | Research. No impl. Container spawn (docker/podman) for pi: A whole-pi-in-container vs B tool delegation… → see `research/containerized-spawn.md.AGENTS.md` |
| `research/context-injection-ab-test.md` | A/B non-inferiority experiment: pi context injections. Harness `scripts/ab-context/`. → see `research/context-injection-ab-test.md.AGENTS.md` |
| `research/dmd-phased-dmd-video-distillation.md` | Research. DMD / DMD2 / Phased DMD (arXiv 2510.27684, CVPR 2026) few-step distillation of video diffusion… → see `research/dmd-phased-dmd-video-distillation.md.AGENTS.md` |
| `research/flux-3-video-production.md` | Research + plan only. FLUX 3 as optional `--backend flux3` i2v + keyframe backend for `video-production`. → see `research/flux-3-video-production.md.AGENTS.md` |
| `research/gae-geometry-native-autoencoder-skill.md` | Research + skill plan. TencentARC GAE (Geometry-Native Autoencoder, arXiv 2609.24981) → proposed `gae-world-gen` skill. Plan only. → see `research/gae-geometry-native-autoencoder-skill.md.AGENTS.md` |
| `research/grammar-backend-architecture.md` | Architecture decision record. Composer "writing" backend: LanguageTool (Java, ~25 ms, offline, deterministic,… → see `research/grammar-backend-architecture.md.AGENTS.md` |
| `research/headroom-pi-integration.md` | Research. Maps Headroom (local context-compression layer, shrinks tool outputs/logs/RAG before LLM,… → see `research/headroom-pi-integration.md.AGENTS.md` |
| `research/hermes-memory-pressure-kb-archive.md` | Research. Decrease pi-hermes-memory pressure + keep most-relevant entries via a kb-indexed cold… → see `research/hermes-memory-pressure-kb-archive.md.AGENTS.md` |
| `research/ideogram-4.5-video-production.md` | Research + integration plan. Ideogram 4.5 (2026-09-30, precise multi-turn image edit + T2I, hosted API) →… → see `research/ideogram-4.5-video-production.md.AGENTS.md` |
| `research/inspatio-world-1.5-video-production.md` | Research + skill plan. InSpatio-World 1.5 (arXiv 2604.07209, real-time camera-controllable 4D world model) →… → see `research/inspatio-world-1.5-video-production.md.AGENTS.md` |
| `research/kb-search-retrieval-quality-investigation.md` | Research. Diagnose `kb_search` "sometimes similar, but unrelevant records" — feeds openspec… → see `research/kb-search-retrieval-quality-investigation.md.AGENTS.md` |
| `research/kb-search-system-one-rerank.md` | Research. No impl. System One `Choice`/`Noul` rerank + lane router for `kb_search`; union design… → see `research/kb-search-system-one-rerank.md.AGENTS.md` |
| `research/lora-dataset-from-pi-logs.md` | Research doc. Turns repo pi session JSONL logs into SFT dataset for LoRA adaptation of ~1T-param base model;… → see `research/lora-dataset-from-pi-logs.md.AGENTS.md` |
| `research/marketing-site-static-rewrite.md` | Implementation record. `site/` dropped Astro 5 + Tailwind + Preact + MDX for one hand-written static page. → see `research/marketing-site-static-rewrite.md.AGENTS.md` |
| `research/ming-image-design-skill.md` | Research. Local-runnable Ming image/design model → pi `ming-design` skill; web + slides consumers. → see `research/ming-image-design-skill.md.AGENTS.md` |
| `research/mira-scene-deck3d.md` | Research artifact. Explore-mode, no change / no impl. Mira-Scene (arXiv 2609.23796) single-image→3D scene for deck3d… → see `research/mira-scene-deck3d.md.AGENTS.md` |
| `research/mobile-app-bubblewrap-vs-capacitor.md` | Research artifact. Explore-mode, no impl. Mobile app: Bubblewrap vs Capacitor; verdict native Kotlin host. → see `research/mobile-app-bubblewrap-vs-capacitor.md.AGENTS.md` |
| `research/native-rewrite-go-rust-candidates.md` | Research. No impl. Which server parts merit Go/Rust rewrite. Verdict: not yet — bottleneck is spawn/IO/polling, not CPU. → see `research/native-rewrite-go-rust-candidates.md.AGENTS.md` |
| `research/neutral-shell-deploy-and-pairing-durability.md` | Research artifact. Explore-mode, no change / no impl. Test shell at pi-dashboard.dev/app/: no release needed… → see `research/neutral-shell-deploy-and-pairing-durability.md.AGENTS.md` |
| `research/oci-cwd-delegation.md` | Research. No impl. OCI image from CWD (crane/oras/umoci/buildah,… → see `research/oci-cwd-delegation.md.AGENTS.md` |
| `research/omp-agent-parallel-support.md` | Research. No impl. Parallel pi+omp agents, per-session selectable, both… → see `research/omp-agent-parallel-support.md.AGENTS.md` |
| `research/openspec-apply-checkbox-granularity.md` | Research. No impl. OpenSpec apply batches `tasks.md` ticks per phase. → see `research/openspec-apply-checkbox-granularity.md.AGENTS.md` |
| `research/oh-my-pi-feature-adaptation.md` | Research artifact. omp (oh-my-pi, pi-mono fork) → pi-dashboard feature adaptation. → see `research/oh-my-pi-feature-adaptation.md.AGENTS.md` |
| `research/ovis-omni-embedding-kb-eval.md` | Research. Local feasibility of `ATH-MaaS/Ovis-Omni-Embedding-3B` (omni embedding, not chat) + 3-question kb retrieval eval plan. → see `research/ovis-omni-embedding-kb-eval.md.AGENTS.md` |
| `research/pami-text-to-hoi-motion.md` | Research. → see `research/pami-text-to-hoi-motion.md.AGENTS.md` |
| `research/phonon-2-hungarian-asr-eval.md` | Research. Phonon-2 (Fermion Research, English-only QAT compression of `parakeet-tdt-0.6b-v3`) for Hungarian… → see `research/phonon-2-hungarian-asr-eval.md.AGENTS.md` |
| `research/pi-bolt-aot-runtime-spike.md` | Research. No impl. Pi-Bolt (AOT-compiled pi v1.3.0 fork): opt-in runtime, not default; 5 integration breaks; server NOT via AOT toolchain. → see `research/pi-bolt-aot-runtime-spike.md.AGENTS.md` |
| `research/pixelumm-video-production.md` | Research. NVIDIA PixelUMM (arXiv 2609.38597, encoder-free pixel-space UMM, 15.2B, Qwen3-8B MoT) ×… → see `research/pixelumm-video-production.md.AGENTS.md` |
| `research/point2part-mesh-part-editor.md` | Research. No impl. Point2Part (arXiv 2609.38180, CMU) point-prompted 3D part partition → 3D mesh editor… → see `research/point2part-mesh-part-editor.md.AGENTS.md` |
| `research/querymt-agent-backend.md` | Research. No impl. Can query.mt (`qmtcode`) replace pi under dashboard?… → see `research/querymt-agent-backend.md.AGENTS.md` |
| `research/qwen-audio-and-omni-models.md` | Research. Qwen cloud audio/omni landscape + measured transcription test. → see `research/qwen-audio-and-omni-models.md.AGENTS.md` |
| `research/reverse-engineering-for-rebuild.md` | Research artifact. Web research: code→spec→clean-room rebuild (MirrorCode, AgentModernize, Reversa,… → see `research/reverse-engineering-for-rebuild.md.AGENTS.md` |
| `research/reverse-engineering-gap-analysis.md` | Research artifact. Gap matrix: `reverse-spec-from-code` vs greenfield vs rebuild target; nobody verifies… → see `research/reverse-engineering-gap-analysis.md.AGENTS.md` |
| `research/reverse-spec-from-code-session.md` | Method playbook. HOW `reverse-spec-from-code` skill + 102-spec backfill built in one pi session. → see `research/reverse-spec-from-code-session.md.AGENTS.md` |
| `research/reverse-spec-from-code.md` | Research artifact. `reverse-spec-from-code` skill prompt tuning + generator-model-loss experiment. → see `research/reverse-spec-from-code.md.AGENTS.md` |
| `research/session-derived-taste-learning.md` | Research. Taste-learning vs CommandCode. Verdict: DO NOT BUILD. → see `research/session-derived-taste-learning.md.AGENTS.md` |
| `research/session-guideline-fast-vs-research-ab.md` | A/B test — @fast vs @research model for SessionGuideline subagent. N=1 input session 019f8680. → see `research/session-guideline-fast-vs-research-ab.md.AGENTS.md` |
| `research/site-3d-background-field.md` | Research record. Ribbon candidate vs fleet. Extruded ribbons read 3D; lean+Z-stagger sells depth; shared scene, no stacked canvases; opacity capped 0.58/0.42. A11y trap + session-hazard lessons. |
| `research/sub1b-stt-diarization-benchmark.md` | Sub-1B open-source STT+diarization benchmark. 4 engines: MOSS-Transcribe-Diarize 0.9B Q5_K GGUF ~1x RT local… → see `research/sub1b-stt-diarization-benchmark.md.AGENTS.md` |
| `research/test-suite-performance.md` | Research. WHY `npm test` takes 12 min: 728.81s wall / 1456 files, 3547 worker-s ÷ 8 workers… → see `research/test-suite-performance.md.AGENTS.md` |
| `research/t3code-feature-adaptation.md` | Research artifact. t3code (multi-provider web GUI wrapping Codex/Claude/Cursor/OpenCode) → pi-dashboard… → see `research/t3code-feature-adaptation.md.AGENTS.md` |
| `research/trusted-types-enforce-results.md` | Research results 2026-10-22. Trusted Types `enforce` run: X6/F1/F2/F3/F6/P1 0 violations; EML `srcDoc`… → see `research/trusted-types-enforce-results.md.AGENTS.md` |
| `research/trusted-types-spike.md` | Research spike, no impl. Trusted Types vs client XSS: partial (string DOM sinks, 11 sites); OIDC `javascript:` bug Phase 0. → see `research/trusted-types-spike.md.AGENTS.md` |
| `research/typesafe-system-one-decision-points.md` | Research. No impl. TypeSafe `jev` (System One) `Choice`/`Score`/`Noul`… → see `research/typesafe-system-one-decision-points.md.AGENTS.md` |
| `research/understand-anything-integration.md` | Research. Adapt Egonex-AI/Understand-Anything (MIT; turns any codebase/docs into interactive… → see `research/understand-anything-integration.md.AGENTS.md` |
| `research/unified-context-manager-exploration.md` | Research artifact. Explore-mode, no change / no impl. Status: exploration in progress; supersedes… → see `research/unified-context-manager-exploration.md.AGENTS.md` |
| `research/user-browser-in-editor-view.md` | Explore-mode research record. `user_browser` tool: agent drives browser, page renders in dashboard editor… → see `research/user-browser-in-editor-view.md.AGENTS.md` |
| `research/video-upscaling-dossier.md` | Research, verified 2026-10-04 (§12 log). Low-res draft → one-step refine for video-production: SoL-Refiner… → see `research/video-upscaling-dossier.md.AGENTS.md` |
| `research/webgl-field-and-glass-bands.md` | Implementation record. pi-dashboard.dev visual system: `site/field.js` WebGL slab field + `site/index.html`… → see `research/webgl-field-and-glass-bands.md.AGENTS.md` |
| `runtime-plugin-clients.md` | Runtime-delivered plugin clients: import map, `/host/*` shims, trustedPlugins pin. → see `runtime-plugin-clients.md.AGENTS.md` |
| `security-map.md` | Security audit: trust boundaries, ports/protocols, gate chain, tool-call guards, findings glance. → see `security-map.md.AGENTS.md` |
| `service-bootstrap.md` | 3 starters (Electron/Bridge/Standalone) × 2 surfaces (GUI/shell). Tool resolution (pi, openspec, node, tsx, bridge). `DASHBOARD_STARTER` env, `launchSource` on `/api/health`. |
| `session-actions-menu.md` | Desktop session card `⋯` menu. `deriveSessionMenu` → `SessionActionsMenu`; groups… → see `session-actions-menu.md.AGENTS.md` |
| `skill-atlas.md` | Skill Atlas plugin graph doc. → see `skill-atlas.md.AGENTS.md` |
| `skills-as-subagents.md` | Skill↔subagent bridge analysis. Wrap skill via thin `.pi/agents/<Name>.md` (model role, `inherit_context`,… → see `skills-as-subagents.md.AGENTS.md` |
| `slash-command.md` | Bridge routes typed `/foo` chat text to pi handlers. `parseSendPrompt` + `bridge.ts::sessionPrompt` 11-step… → see `slash-command.md.AGENTS.md` See change: update-pi-core-1-0-adopt-apis. |
| `system-one.md` | Shared decision registry. `@blackbelt-technology/pi-system-one` library (`predict` over… → see `system-one.md.AGENTS.md` |
| `ui-contract.md` | (repo root) Cross-screen design control plane. Single source of truth for visual consistency. → see `ui-contract.md.AGENTS.md` |
| `untrusted-plugin-ui-gap.md` | Read-only gap analysis. Untrusted plugin UI via descriptor protocol vs React path. 53% claims blocked. → see `untrusted-plugin-ui-gap.md.AGENTS.md` |
| `user-features.md` | End-user feature subset curated from features.md. → see `user-features.md.AGENTS.md` |
| `vitest.config.ts` | (repo root) Root Vitest config. `defineConfig`. Vitest 4 dropped `vitest.workspace.ts`. → see `vitest.config.ts.AGENTS.md` |
