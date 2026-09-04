# PI Dashboard — Feature Catalog

Derived from README.md + openspec/specs/ (562 capabilities).

## Sessions

- Real-time session mirroring via bridge extension WebSocket forwarding.
- Bidirectional prompts: dashboard → session, session → dashboard.
- Session stats: tokens, cost, model, thinking level, context-usage bar.
- Elapsed-time counters per session.
- Session spawn. Headless default; tmux; Windows Terminal strategies.
- rpc-keeper sidecar per headless session.
- Spawn preflight + spawn-register watchdog + spawn failure NDJSON log + spawn error toast/banner.
- Placeholder spawn card during startup.
- On-demand loading of historical sessions.
- Session resume. Auto-resume on prompt to ended session.
- Fork from message. entryId-accurate.
- Session rename + auto session namer.
- Session tags.
- Per-card hide + show-hidden toggle.
- Session search + folder filter.
- Session ordering persisted per directory.
- Drag-reorder sessions.
- Session grouping by cwd. OS-aware path equality.
- Force-kill escalation: soft abort → SIGTERM → SIGKILL.
- Session-card status stripes + reduced-motion static cue.
- ask_user pulse indicator.
- Needs-you attention rollup per folder.
- Uncommitted-working-tree pill + ahead/behind drift.
- Session diff endpoint + commit selected files from card (commit-draft via bridge).
- Process tracking of session child processes.
- Shutdown/liveness recovery markers.
- Viewed-session unread gating.

## Chat & transcript

- Streaming messages + reasoning/thinking blocks.
- Optimistic pending card for in-flight turns.
- Mid-turn prompt queue.
- Prompt delivery ack.
- Markdown rendering: mermaid, syntax highlight, ASCII-table detection, KaTeX math (remark-math + rehype-katex).
- Local-image inlining via `pi-asset:<hash>` channel.
- Inline image tool results + artifact path inlining.
- Image paste from clipboard.
- Image lightbox.
- Tool-call rendering + tool renderer registry + tool burst/consecutive grouping.
- Per-turn change summary + line-delta summary.
- Tool output URL linkification.
- Loopback URLs open internal split viewer.
- Chat scroll lock + scroll-to-bottom + refresh.
- Per-session draft persistence (`chat-draft:<sessionId>`) + ArrowUp/ArrowDown history recall.
- Command autocomplete (`/`) + `@file` autocomplete.
- `!`/`!!` bang bash execution + inline terminal.
- `/view` dashboard-local command.
- Hide debug/raw events.
- Chat display preferences.
- Transcript virtualization + frame-coalesced event batching + idle zero-layout cost.
- Lazy-expand full fidelity.
- History backfill by seq range.
- Replay-stream compaction.
- Chat history loading indicator.
- Selection preservation.

## Workspace & navigation

- Pinned directories.
- Folder workspaces + drag reorder.
- Folder actions menu + action bar + call-to-action banner.
- Folder status capsule.
- Directory card layout, home page, settings page.
- Full-path display in group headers.
- Folder-path URL codec.
- Resizable sidebar.
- Sidebar two-row header.
- Collapsible folder groups.
- Session card subcards.
- URL routing + shell overlay routes.
- Theme system: CSS custom properties, theme gallery, panel elevation, MDI icons, focus ring, skeleton, empty state, status non-hue channel.
- Toast notifications.
- Dialog primitive + portal + escape layering + overlay z-scale.
- Popover positioning + pane clipping boundary.
- Mobile resilience: responsive breakpoints, swipe drawer, mobile action menus.
- PWA manifest + install prompt.
- i18n catalog coverage. English + Simplified Chinese via Settings → General → Interface. `VITE_PI_DASHBOARD_DEFAULT_LANGUAGE`.
- Animation pause when document hidden.

## Editor, files, terminal

- Internal Monaco editor pane per session. Folder-scoped `[Editor]` route.
- Split chat+editor workspace.
- Editor file search (dual mode).
- Filesystem browser + directory browse API.
- File/URL preview (ViewTarget union).
- Diff viewer. Split + unified. Two-level file tree.
- Open-in-editor buttons.
- Scoped markdown editing. Instructions page, directory + global scope.
- Markdown preview with fuzzy search + zoomable mermaid (zoom/pan, click-vs-drag threshold).
- Integrated terminal (xterm.js + node-pty) per folder. Hosted as editor-pane tab.
- Live-server preview embed.
- Ripgrep detection.
- PTY permission repair.

## OpenSpec integration

- Change browsing, specs browser, archive browser.
- OpenSpec board + status visuals.
- Change grouping + per-group ordering.
- Change-state derivation.
- Task parsing from tasks.md + task toggle.
- Attach proposal to session (combo box, manual attach).
- Artifact reader + clickable artifact letters + local-artifact evidence promotion.
- Explore/run-config dialogs.
- Frontend buttons emit skill slash commands.
- Server-side polling per directory. `pollIntervalSeconds`, `maxConcurrentSpawns`, `changeDetection`, `jitterSeconds`.
- openspec CLI provisioning in-session.
- Profile config write.
- Spec integrity CI gate.

## Git & worktrees

- Git branch detection + branch selector + branch switch API.
- Folder HEAD polling.
- Worktree create dialog (+Worktree). Lifecycle remove endpoint. Auto-init on spawn. Project-declared worktree-init hook. Init feedback tracking.
- Commit action.
- cwd containment checks.

## Flows (pi-flows)

- Flow dashboard card grid.
- Agent cards + agent detail view.
- Flow graph edges.
- Flow summary view.
- Flow launcher + searchable select dialog.
- Abort + autonomous-mode toggle.
- Flow panel collapse persistence.
- Flow activity badge + running-status pill on card.
- Flow event bridge + server-side flow state.
- Flow question routing via PromptBus priority.
- Flow abort race (<100 ms).
- Flow authoring tool renderers (flow_write/agent_write).
- Edit-mode settings.
- anthropic-bridge activation, peer probe, status route, settings UI.
- Custom-provider auth pre-registration for flow agents.

## Automations & goals

- Automation folder format. Per-folder + global scope.
- Trigger registry. Schedule/cron five-field, file trigger.
- Action registry. Fan-out multi-action spawn. Run lifecycle dispatch by action kind.
- Template interpolation (type-preserving whole-token).
- Flow input wiring (read-only).
- Automation content view via shell slots.
- Goals: folder-scoped goal records + goals folder page.
- Rich goal authoring (judge/budget/criteria).
- Goal supervisor + respawning state.
- Status relay + persistence.
- Detail stats gauges.
- Command-surface tiering.

## Knowledge base (kb)

- Directory-scoped SQLite/FTS5 markdown index.
- Field-weighted BM25 ranking.
- Markdown chunking + frontmatter structural indexing.
- Layered config + init.
- Indexing pipeline with include/exclude/extension filters.
- DOX directory tree (`AGENTS.md` per directory). Source-tree walk. File-index migration. Row-cap foldering.
- Auto-reindex on markdown edit (debounced, hash-gated).
- Folder KB slot + settings + stats + non-blocking index jobs + cwd guard.
- Retrieval eval harness (golden set, P@K/MRR).

## Providers, models, proxy

- Browser OAuth sign-in: Anthropic, OpenAI Codex, GitHub Copilot, Gemini CLI, Antigravity.
- API keys for other providers.
- Credentials live-synced to running sessions (`credentials_updated`).
- Custom LLM providers (OpenAI-/Anthropic-/Google-compatible). Connection Test + live registration.
- Custom-provider model registry + metadata discovery.
- Model selector in status bar + per-session models_list refresh.
- Roles/presets ownership of `~/.pi/agent/providers.json#roles|rolePresets|activePreset`. Roles settings UI. Role-name validation. `list_models` agent tool.
- Provider quota surfacing.
- pi retry policy editor + retry state + retried-error suppression.
- OpenAI-compatible model proxy on `/v1`. `/v1/models`, `/v1/chat/completions`, `/v1/messages`. `pi-proxy-*` keys only. Credential-kind aware filtering. Always-on lifetime.

## Extensions, packages, plugins

- Package browse/search (npm registry)/install/update/remove/move between global and project scope.
- Installed-row enrichment.
- Source matching + local-install name resolution.
- Auto-reload of sessions after package ops.
- Recommended-extensions manifest (`packages/shared/src/recommended-extensions.ts`) + `GET /api/packages/recommended`.
- Bundled extensions in Electron.
- pi resources view + resource scanning + cross-scope disable.
- pi core version check/UI + changelog display.
- Dashboard plugin runtime. 10 React slots. Manifest `pi-dashboard-plugin`. Vite-generated registry. `registerPlugin(ctx)`.
- Plugin config persistence. Plugin session side-channel store. Plugin manifest staleness check.
- Plugin intent protocol. Plugin UI primitive registry. Shell slots + per-claim error boundary.
- dashboard-plugin-scaffold skill.
- Extension UI System. `ui:list-modules` probe. `table`/`grid`/`form` modules. Row actions. Confirm gates.
- Extension RPC dispatch.
- Bundled skills: pi-dashboard `/dashboard:*` slash commands (incl. LLM-free `executable: bash` templates), browser, doctor, project-init.

## Interaction & PromptBus

- PromptBus adapters (TUI, dashboard, custom). Priority + first-response-wins + cross-adapter dismissal.
- Dialogs confirm/select/input/editor/multiselect survive page refresh and server restart.
- Multiselect bridge polyfill + dashboard MultiselectRenderer.
- Concurrent ask_user prompts (no id dedup drop).
- ask_user timeout `askUserPromptTimeoutSeconds` (`≤0` = wait forever).
- notify message channel.
- Interactive renderers.
- ui-proxy wrapping of `ctx.ui.*`.
- `dashboard:ui` events (`confirm`/`select`/`input`/`notify`).

## Subagents

- Subagent inspector. Inline expand + popout overlay route.
- Live cadence + buffered live frames across connection gaps.
- Details payload.
- Producer settings persistence.
- `useSessionSubagents` runtime primitive.
- Agent tool card rendering + structured partialResult.

## Server, protocol, persistence

- Dual WebSocket gateways. Browser `:8000`, pi `:9999`.
- pi gateway local transport (UDS/named pipe) + owning-user authorisation.
- In-memory event buffer + incremental event sync + seq tracking + offline outgoing queue + WS ping/pong.
- Server session reader (reads pi session JSONL from disk). Session hydration timing. meta.json per-session sidecar cache.
- JSON persistence + migration.
- Catch-all event forwarding.
- Server-side event processing + status/tool extraction.
- Event reducer (+ decomposition).
- `/api/restart`, `/api/shutdown`, restart broadcast before exit.
- PID file + daemon start/stop/status.
- Auto-shutdown when idle (`autoShutdown`, `shutdownIdleSeconds`).
- Auto-start from bridge (`autoStart`).
- Dev mode with Vite proxy + production fallback.
- `devBuildOnReload`.
- Node version guard (≥22.18) + startup recovery HTTP server.
- Boot-parent liveness.
- Home-lock single instance.
- Async semaphore.
- Event-loop spike monitoring.
- `/api/health` metrics: rss, heap, sessions, per-agent CPU/eventLoopMaxMs.
- Process-list classification.
- `piSessionsDir` resolution precedence.

## Networking, auth, security

- mDNS discovery + known servers + server selector with transactional switch + disconnection banner.
- zrok tunnel. v2 runtime. Reserved shares. Subprocess management. Install guide. QR dialog.
- QR device pairing + neutral shell app. Device keyring. Pairing payload. Identity-first server connect. Server identity keypair.
- OAuth2 auth (github/google/keycloak/oidc) + allowlist + callback server.
- Bearer device auth tokens (revocable registry).
- MCP endpoint `POST /mcp`. Stateless. Revision 2026-07-28. Bearer required incl. localhost. Auto `~/.pi/agent/mcp.json` entry.
- Loopback bind default + CORS + trusted networks + auth bypass URL list + baseline CSP + network denial ring buffer + local IPC allowlist token.
- Credential redaction in surfaced errors.
- Service-worker network passthrough.

## Desktop (Electron)

- Setup wizard. Standalone vs power-user. API key/OAuth. Recommended extensions.
- Bundled Node runtime + managed node + bundle extraction by version marker + offline npm cache.
- Server supervision + single idempotent launch + tray Start/Restart + loading-page Start button + server log panel.
- Doctor window (`doctor.html`) + `/api/doctor` + shared `packages/shared/src/doctor-core.ts`.
- Auto-update. 60 s after launch, then 24 h.
- Window state persistence.
- Native chrome/system tray.
- Remote-connect mode (attach to Docker/remote server).
- `--debug-cdp[=port]` / `PI_DEBUG_CDP` loopback CDP.
- App icons.
- Settings persistence.
- Launch-source derivation.
- First-run marker.

## Packaging, CI, QA

- npm workspaces monorepo (pnpm, hoisted nodeLinker).
- Meta-package + package naming convention.
- Workspace publishing with npm Trusted Publishers (OIDC) + provenance.
- Release notes from CHANGELOG.
- Nightly verification (zero public npm writes).
- On-demand Electron CI build (`ci-electron.yml`, `legs` input).
- ci.yml lint+test+build.
- Docker self-contained image (server + pi + code-server + zrok + tmux, non-root) + docker test harness (collision-free per-worktree).
- Playwright browser E2E (`tests/e2e/`) + VM smoke QA (`qa/`, Packer images, VM lifecycle).
- Parallel vitest execution + isolated HOME.
- Faux-model integration tests.
- WS broadcast load harness.
- Mutation-harness crash safety.
- Dead-code detection (Knip).
- Biome code-quality loop.
- Repo convention checks.
- CodeRabbit + local review gates.
- ship-it / plan-proposal orchestrators.

## Bundled tooling packages

- document-converter (PDF/DOCX/PPTX/XLSX/HTML/CSV → markdown) + doc-summarizer skill.
- video-transcription (Soniox, speaker-diarized SRT).
- video-production CLI (Veo storyboard/render/inspect).
- nano-banana Gemini image generation CLI.
- mockup-loop (serve/score/validate mockups, design-system presets) + anti-slop-frontend.
- eng-disciplines skills: security-hardening, performance-optimization, observability-instrumentation, systematic-debugging, node-inspect-debugger, review-code, doubt-driven-review, code-simplification, scenario-design, interview-me.
- authoring-toolkit: skill-creator, skill-to-subagent, session-to-guideline, faq-mine.
- session-distiller (trajectory harvest, verified-signal extraction, cross-session distillation).
- cost-estimator.
- apple-pim tools.
- hermes memory settings.
- grammar check (opt-in composer grammar check + auth-gated service + settings plugin).
- marketing site.

## Configuration

- `~/.pi/dashboard/config.json` keys: `port` (8000), `piPort` (9999), `autoStart`, `autoShutdown`, `shutdownIdleSeconds`, `spawnStrategy` (headless|tmux), `reattachPlacement`, `devBuildOnReload`, `askUserPromptTimeoutSeconds`, `piSessionsDir`, `tunnel.*`, `auth.*`, `openspec.*`, `trustedNetworks`, `windowsGitSource`.
- Precedence: CLI flags → env → config → defaults.
- Machine-local `~/.pi/dashboard/tool-overrides.json` + ToolRegistry (pi, pi-coding-agent, openspec, npm, node, tsx, git, zrok, pi-dashboard). Strategy chain + diagnostic trail + Settings → General → Tools rescan/export.
