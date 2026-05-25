
# PI Dashboard

## Project Overview

Web-based dashboard for monitoring and interacting with pi agent sessions remotely. Three-component architecture: bridge extension + Node.js server + React web client.

## STOP — Docs-First Gate

**Before any build / run / install / setup / release / "how do I X" question: `grep -i <keyword> docs/faq.md README.md docs/` FIRST. No source reads until that returns nothing.**

If you read a script, config, or source file before grepping docs on a how-to, what-is question, you violated the protocol. Re-grep, then answer.

- ❌ User: "how do I ..." → read `<src files>` → guess answer
- ✅ User: "how do I ..." → `grep -ni '<words>' docs/faq.md` → quote the FAQ entry

- ❌ User: "what is ..." → read `scripts/build-installer.sh`, `forge.config.ts` → guess answer
- ✅ User: "what is ..." → `grep -ni '<words>' docs/index-*.md` → quote the entry

Full protocol (index-first for code questions, file-index splits, etc.) is in [Investigation Protocol — Index First](#investigation-protocol--index-first) below.

## Code Instructions

Behavioral guidelines to reduce common LLM coding mistakes. Bias toward caution over speed. For trivial tasks, use judgment.

### 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask via `ask_user`.
- If multiple interpretations exist, present them — don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.
- **Never speculate about code you have not opened.** If the user references a specific file, read it before answering. No claims about the codebase without investigation — grounded, hallucination-free answers only.
- Before any major change, check in with the user and confirm the plan.

### 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.
- **DRY:** if the same pattern appears in multiple places, extract a shared helper/class/component. Don't pre-extract for a single call site.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

### 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it — don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: every changed line should trace directly to the user's request.

### 4. Goal-Driven Execution (TDD)

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For implementation, use **TDD**: write or update tests first to define expected behaviour, verify they fail, then write the minimal implementation to make them pass.

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

### 5. Communication

- At every step, give a high-level explanation of what changed — don't dump diffs without summary.
- Use `ask_user` (not plain-text questions) when you need clarification, confirmation, or a choice.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

## Documentation Update Protocol

**Default assumption: your update does NOT belong in AGENTS.md.** AGENTS.md loads into every agent's context on every turn — every byte costs tokens. Route by kind:

| Kind of update | Goes in |
|---|---|
| New file, or per-file detail / change-history / contract / "See change: …" annotation | Matching per-area split `docs/file-index-<area>.md` (see `docs/file-index.md`). Add row in path-alphabetical order. |
| New top-level area / new split file | New row in `docs/file-index.md` splits table. Pointer in AGENTS.md only if architectural backbone. |
| Data flow, persistence, reconnection, protocol, config reference | `docs/architecture.md` |
| End-user / developer setup, prerequisites, CI badges, project structure | `README.md` |
| Cross-cutting rule EVERY agent needs on EVERY turn (rare) | AGENTS.md, ≤ 200 chars per row, no inline change history |

Rules:

1. **AGENTS.md "Key Files" rows MUST stay ≤ 200 characters** — one terse purpose, no change-history, no contracts, no "See change: …" parentheticals.

2. **Per-file detail goes into `docs/file-index-<area>.md`.** Search the matching split for the path; if a row exists, append/update; else add in path-alphabetical order.

3. **If a split grows past ~50 KB**, sub-split it (e.g. `file-index-server-routes.md`) and update `docs/file-index.md`.

4. **Long-form docs** (architecture decisions, rationale, protocol details) belong in `docs/architecture.md` or `docs/<topic>.md`. Reference from AGENTS.md with a one-line pointer, never inline.

5. **When you create a new split doc**, add a one-line pointer in AGENTS.md so future agents find it.

6. **Every write under `docs/` MUST be delegated to a general-purpose subagent with the caveman-style rule passed verbatim in its prompt.** Main agent orchestrates, never edits `docs/` directly.

   **Caveman style** (all `docs/` prose — file-index rows, architecture notes, topic docs):
   - Short declarative fragments. Drop articles (a/an/the) and most copulas (is/are/was) when meaning survives.
   - Subject → verb → object, present tense. No hedging, no marketing voice, no "we", no "you".
   - One fact per line/row. No restating context the file already establishes.
   - Prefer concrete tokens (paths, function names, env vars, ports, exit codes) over prose.
   - Keep symbols/identifiers verbatim; only connective tissue compresses.
   - Example — verbose: "This module is responsible for parsing the user's input and then dispatching it to the correct handler based on the command prefix." Caveman: "Parses user input. Dispatches to handler by command prefix."

Why this exists: AGENTS.md ballooned to 107 KB (~27k tokens) by accreting per-change annotations on every row over months. Split was already done (file-index.md exists) but agents kept appending to AGENTS.md instead.

## Architecture

See [docs/architecture.md](docs/architecture.md) for full details.
- See [docs/electron-bootstrap-flow.md](docs/electron-bootstrap-flow.md) for the Electron app→server bootstrap state machine and end states.

- **Bridge Extension** (`src/extension/`) — Runs in every pi session, forwards events via WebSocket
- **Dashboard Server** (`src/server/`) — Aggregates events, in-memory + JSON persistence, dual WebSocket servers
- **Web Client** (`src/client/`) — React + Tailwind responsive UI
- **Shared Types** (`src/shared/`) — Protocol definitions shared across components

## Commands

```bash
npm install          # Install dependencies
npm test             # Run all tests (vitest)
npm run test:watch   # Watch mode
npm run build        # Build web client (Vite)
npm run dev          # Start Vite dev server
npm run reload       # Reload all connected pi sessions
npm run reload:check # Type-check + reload all pi sessions
pi-dashboard         # Start dashboard server
pi-dashboard --dev   # Start with Vite proxy
```

## Running Tests

Pipe test output to a tmp file, then grep — avoids re-running to inspect errors:

```bash
npm test 2>&1 | tee /tmp/pi-test.log        # run once, capture all output
grep -nE 'FAIL|Error|✗|✘' /tmp/pi-test.log   # find failures
grep -n -A 20 'FAIL ' /tmp/pi-test.log        # failure + context
```

Always grep the file — never rerun `npm test` just to see errors.

## Cross-Platform QA Testing

VM-based QA testing for verifying clean-state installation and runtime across platforms.

```bash
cd qa
make build-linux-x86    # Build Ubuntu x86 base image (Packer + VMware)
make test-linux-x86     # Clone → boot → run tests → destroy
make manual-linux-x86   # Clone with GUI for manual testing
make clean              # Destroy all cloned VMs
```

| File | Purpose |
|------|---------|
| `qa/Makefile` | Build/test/manual/clean targets for all platforms |
| `qa/packer/*.pkr.hcl` | Packer templates per platform (Ubuntu, Windows, macOS) |
| `qa/packer/scripts/` | Provisioning scripts (common, linux, macos, windows) |
| `qa/packer/vars/` | OS-version-specific variables (ISO URL, checksum, VM specs) |
| `qa/packer/http/` | Auto-install configs (cloud-init, autounattend.xml) |
| `qa/scripts/` | VM lifecycle (clone, wait-ssh, destroy, run-test) |
| `qa/tests/` | Test suite (install, server, websocket, terminal, git) |
| `qa/README.md` | Full setup and usage documentation |

## Investigation Protocol — Index First

**Before reading source, consult `docs/file-index.md` and the relevant `docs/file-index-<area>.md` split.** The index is the cheapest map of the codebase — every architecturally significant file has a one-line purpose plus change-history pointers. Reading source blind wastes tokens and risks hallucination.

**For "how do I X" / build / run / setup questions: grep `README.md` + `docs/` first.** These already document every supported workflow (build, install, release, QA, troubleshooting). Reading source before checking docs wastes tokens and produces wrong answers (e.g. claiming a feature is missing when it ships). Check `docs/faq.md` for recurring questions.

Workflow for any non-trivial "where is X" / "how does Y work" question:

1. **Pick the split** from `docs/file-index.md` table (shared / extension / server / client / electron / plugins / skills-misc) by path prefix or topic.
2. **Delegate harvesting to a subagent** (`Explore` preferred). Give it:
   - the user's question,
   - the split file(s) to read,
   - explicit instruction: *"return only rows + file paths relevant to the question — no source reads, no speculation."*
3. **Receive a short list** of candidate files (≤ ~10 rows). Only then open source for the ones that matter.
4. If the split lacks coverage, fall back to `rg` / `Explore` over the source tree — and add the missing row per the Documentation Update Protocol.

Why subagents: the splits are large (`file-index-server.md`, `file-index-client.md` each > 20 KB). Loading them into the main context on every question pollutes the budget. A subagent reads the split, returns the 5–10 relevant rows, and discards the rest.

Do **not**:
- Grep source before checking the index.
- Read a whole split file into the main agent's context — delegate.
- Trust the AGENTS.md "Key Files" backbone as exhaustive; it is a subset.

## Key Files

> **Full file map**: see [`docs/file-index.md`](docs/file-index.md) — a thin index of per-area split files (`docs/file-index-<area>.md`). Read the relevant split on demand when locating a file or understanding its full responsibilities (incl. change-history annotations).

This section lists only the **architectural backbone** — the files agents touch most often or need to know about for any non-trivial change. For everything else (renderers, individual tool cards, narrow helpers, build/CI internals) consult the appropriate split via `docs/file-index.md`.

### Protocol & types
| File | Purpose |
|------|---------|
| `src/shared/protocol.ts` | Extension↔Server WebSocket message types |
| `src/shared/browser-protocol.ts` | Server↔Browser WebSocket message types |
| `src/shared/types.ts` | Data models (Session, Workspace, Event) |
| `src/shared/config.ts` | Shared config loader (`~/.pi/dashboard/config.json`) |
| `src/shared/semaphore.ts` | Tiny FIFO semaphore (`createSemaphore(max)`) |
| `src/extension/bridge.ts` | Main bridge extension entry; PromptBus patch site, sync/tracker/flow composition; sessionPrompt routes through slash-dispatch (extension-cmd dispatch + stopgap) before template fallback. See change: fix-extension-slash-commands-in-dashboard. |
| `src/extension/bridge-context.ts` | Shared mutable state type + helpers for bridge modules; hosts `isExtensionSlashCommand`, `hasDispatchCommand`, `DASHBOARD_NATIVE_COMMANDS` (= {"roles"}). See change: fix-extension-slash-commands-in-dashboard. |
| `src/extension/slash-dispatch.ts` | Shared `tryDispatchExtensionCommand` helper: routing-step 9 (three-way decision: pi.dispatchCommand 0.71+ → server-routed via RPC keeper UDS when headless → stopgap). See change: fix-extension-slash-commands-in-dashboard, add-rpc-stdin-dispatch-with-keeper-sidecar. |
| `packages/server/src/rpc-keeper/dispatch-router.ts` | Handles `dispatch_extension_command` extension→server message. Forwards pi RPC line via `headlessPidRegistry.writeRpc`; emits optimistic `command_feedback {completed}` or {error}. See change: add-rpc-stdin-dispatch-with-keeper-sidecar. |
| `packages/server/src/rpc-keeper/keeper-manager.ts` | Server-side helper: `spawnKeeperFor`, `writeRpc(sessionId)`, `writeRpcToSockPath`, `killKeeper`, `discoverExistingKeepers`. Singleton via `getKeeperManager()` in process-manager.ts. See change: add-rpc-stdin-dispatch-with-keeper-sidecar. |
| `packages/server/src/rpc-keeper/keeper.cjs` | CJS-pure RPC keeper sidecar; spawns pi as child, owns stdin pipe, listens on per-session UDS / named pipe; outlives dashboard server. See change: add-rpc-stdin-dispatch-with-keeper-sidecar. |
| `src/extension/session-sync.ts` | Session register, replay, and switch/fork handling |
| `src/extension/model-tracker.ts` | Model/thinking-level/git/name change detection |
| `src/extension/flow-event-wiring.ts` | Flow event listener registration (flow:* → event_forward) |
| `src/extension/connection.ts` | WebSocket with exponential backoff; auto-start suppression on `server_restarting` |
| `src/extension/server-probe.ts` | TCP probe to detect running server |
| `src/shared/server-identity.ts` | Identity-verified health check (`isDashboardRunning`) |
| `src/shared/mdns-discovery.ts` | mDNS advertise/discover/browse for `_pi-dashboard._tcp` |
| `src/extension/server-launcher.ts` | Auto-start server as detached process; logs to `~/.pi/dashboard/server.log` |
| `src/extension/command-handler.ts` | Command routing: `!`/`!!` bash, `/compact`, slash commands; slash else-arm now gates through extension-dispatch helper before `sendUserMessage`. See change: fix-extension-slash-commands-in-dashboard. |
| `src/extension/prompt-expander.ts` | Slash command → prompt template expansion |
| `src/extension/dev-build.ts` | Dev build-on-reload helper (client build + server shutdown) |
| `src/extension/server-auto-start.ts` | mDNS-first → health check → auto-start with concurrent launch detection |
| `src/shared/session-meta.ts` | Session metadata sidecar (.meta.json) read/write helpers |
| `src/extension/process-metrics.ts` | Lightweight CPU/memory/event-loop metrics for heartbeats |
| `src/extension/process-scanner.ts` | Child process detection via ps + PGID tracking and PGID-based kill |
| `src/client/components/ProcessList.tsx` | Session card process list with elapsed time and kill button |
| `src/extension/git-info.ts` | Git branch/remote/PR detection (polled every 30s) |
| `src/extension/git-link-builder.ts` | Git remote URL parsing and platform-specific links |
| `src/server/git-operations.ts` | Server-side git commands: branch listing, checkout, init, stash pop |
| `src/client/components/BranchPicker.tsx` | Typeahead branch picker with keyboard navigation |
| `src/client/components/BranchSwitchDialog.tsx` | Checkout orchestration: dirty-state stash, pop prompt |
| `src/client/lib/git-api.ts` | Client-side fetch helpers for git API endpoints |
| `src/client/hooks/useImagePaste.ts` | Reusable clipboard-image-paste hook (controlled/uncontrolled modes) |
| `src/extension/prompt-bus.ts` | PromptBus — unified prompt routing to registered adapters |
| `src/extension/dashboard-default-adapter.ts` | Built-in PromptBus adapter rendering prompts as dashboard chat dialogs |
| `src/extension/ui-modules.ts` | Extension UI System Phase 1+2: refresh, throttle, manage |
| `src/client/components/extension-ui/GenericExtensionDialog.tsx` | Phase-1 modal renderer for `ExtensionUiModule` (table/grid/form) |
| `src/client/components/extension-ui/decorator-utils.ts` | Phase-2 helper `decoratorsOfKind` filter over `Session.uiDecorators` |
| `src/client/components/extension-ui/FooterSegmentSlot.tsx` | Phase-2 slot rendering footer-segment descriptors as inline pills |
| `src/client/components/extension-ui/AgentMetricSlot.tsx` | Phase-2 slot rendering agent-metric descriptors inside FlowAgentCard |
| `src/client/components/extension-ui/BreadcrumbSlot.tsx` | Phase-2 slot rendering breadcrumb as step indicator at FlowDashboard top |
| `src/client/components/extension-ui/GateSlot.tsx` | Phase-2 slot aggregating gate descriptors per flowId (most-restrictive-wins) |
| `src/client/components/extension-ui/ToastSlot.tsx` | Phase-2 slot rendering toast descriptors top-right with auto-dismiss + cap-of-5 |
| `src/client/lib/mdi-icon-lookup.ts` | `resolveMdiIcon(key)` against `@mdi/js` exports; null on unknown key |
| `src/client/lib/prompt-component-registry.ts` | Client component registry for prompt types (placement, component) |
| `src/extension/ask-user-tool.ts` | `ask_user` tool registration (confirm/select/multiselect/input/batch via flat oneOf schema) |
| `src/extension/multiselect-polyfill.ts` | `polyfillMultiselect` — bridge-patched multiselect with TUI fallback |
| `src/extension/multiselect-list.ts` | `MultiSelectList` pi-tui Component (↑↓/Space/Enter/Esc keyboard contract) |
| `src/shared/openspec-activity-detector.ts` | Detects OpenSpec activity from tool events; rejects flag-shaped tokens |
| `src/shared/openspec-poller.ts` | OpenSpec CLI polling: `buildOpenSpecData` with optional design + specs probe factories |
| `src/shared/openspec-design-evidence.ts` | Pure rule evaluator + fs probe for OpenSpec design-artifact override (R1/R2/R3) |
| `src/shared/openspec-specs-evidence.ts` | Pure rule evaluator + fs probe for OpenSpec specs-artifact override |
| `.pi/skills/openspec-shared/scripts/effective-status.sh` | Bash wrapper around `openspec status` applying R1/R2/R3 promotion |
| `src/shared/state-replay.ts` | Synthesizes events from pi entries (shared, used by server + bridge) |
| `src/shared/dashboard-plugin/slot-types.ts` | Frozen slot taxonomy: `SlotId`, `Multiplicity`, `PayloadTier`, `SLOT_DEFINITIONS` |
| `src/shared/dashboard-plugin/ui-primitives.ts` | UI primitive registry contracts: `UI_PRIMITIVE_KEYS`, `UiPrimitiveMap`, per-primitive prop interfaces. See `docs/plugin-ui-primitives.md`. |
| `packages/dashboard-plugin-runtime/src/ui-primitive-{registry,context}.tsx` | Registry runtime: `createUiPrimitiveRegistry`, `registerUiPrimitive`, `<UiPrimitiveProvider>`, `useUiPrimitive` (strict), `useUiPrimitiveOrNull` (soft). |
| `packages/dashboard-plugin-runtime/src/test-support/withUiPrimitiveProvider.tsx` | Test helper that wraps a render in a UiPrimitiveProvider populated with mock impls. |
| `src/shared/dashboard-plugin/manifest-types.ts` | `PluginManifest` and `PluginClaim` interfaces |
| `src/shared/dashboard-plugin/slot-props.ts` | `SlotPropsMap` and `SlotProps<SlotId>` typed prop contracts per slot id |
| `src/shared/dashboard-plugin/plugin-status.ts` | `PluginStatus` (for `/api/health`) and `PluginConfigUpdate` (WS payload) |
| `src/shared/plugin-bridge-register.ts` | Plugin bridge entry registration in pi `settings.json#dashboardPluginBridges` |
| `packages/dashboard-plugin-runtime/src/slot-registry.ts` | `createSlotRegistry()` typed `Map<SlotId, ClaimEntry[]>` with filter helpers |
| `packages/dashboard-plugin-runtime/src/manifest-validator.ts` | Hand-rolled manifest validator throwing `ManifestValidationError` |
| `packages/dashboard-plugin-runtime/src/plugin-context.tsx` | PluginContextProvider + per-plugin hook layer (config/log/send/router/registry) |
| `packages/dashboard-plugin-runtime/src/slot-consumers.tsx` | One component per slot id, wrapping contributions in `SlotErrorBoundary` |
| `packages/dashboard-plugin-runtime/src/slot-error-boundary.tsx` | Per-claim React error boundary; isolates failing claim from siblings |
| `packages/dashboard-plugin-runtime/src/vite-plugin/index.ts` | `viteDashboardPluginsPlugin` — generates plugin-registry.tsx, watches manifests |
| `packages/dashboard-plugin-runtime/src/server/loader.ts` | `discoverPlugins` + `loadServerEntries` (failure-isolated) + `getPluginStatusStore` |
| `packages/dashboard-plugin-runtime/src/server/server-context.ts` | `createServerPluginContext` — per-plugin scoped logger + config |
| `packages/dashboard-plugin-runtime/src/server/config-validator.ts` | Ajv JSON-Schema 7 validation for plugin config writes |
| `packages/dashboard-plugin-runtime/src/server/plugin-status-store.ts` | In-memory `PluginStatusStore` for `/api/health.plugins[]` |
| `packages/dashboard-plugin-runtime/src/server/requirement-probes.ts` | Declarative requirement probes (piExtensions/binaries/services); 30s cache. See change: add-plugin-activation-ui. |
| `src/server/routes/plugin-activation-routes.ts` | REST routes: GET /api/plugins, POST /api/plugins/:id/toggle. See change: add-plugin-activation-ui. |
| `src/server/routes/plugin-config-routes.ts` | `POST /api/config/plugins/:id` — validates and merges plugin config (auth-gated) |
| `packages/demo-plugin/` | Private fixture plugin exercising settings-section + tool-renderer slots |
| `packages/dashboard-plugin-skill/` | Pi skill `dashboard-plugin-scaffold`. Modes: `new` (scaffold packages/<id>-plugin/), `augment` (inject manifest + src/dashboard/ into pi-extension at cwd). |
| `src/shared/stats-extractor.ts` | Extracts token/cost stats from turn_end events |
| `src/server/session-stats-reader.ts` | Reads cumulative stats + context usage from session JSONL files |
| `src/server/server.ts` | HTTP + WebSocket server (composes route modules + wiring) |
| `src/server/routes/session-routes.ts` | REST routes: sessions, events, session-diff |
| `src/server/routes/git-routes.ts` | REST routes: git branches, checkout, init, stash-pop |
| `src/server/routes/file-routes.ts` | REST routes: file read, browse, browse-flags, browse-mkdir, readme, pinned-dirs |
| `packages/server/src/routes/manifest-route.ts` | Dynamic `/manifest.json` route. Pure `stripPort` + `resolveManifestSource` + `buildManifestBody`; registered before fastify-static. |
| `src/server/routes/openspec-routes.ts` | REST routes: openspec-archive, pi-resources, pi-resource-file |
| `src/server/routes/system-routes.ts` | REST routes: config, health, shutdown, tunnel, editors |
| `src/server/event-wiring.ts` | Pi gateway → browser gateway event forwarding; UI cache + activity stamping + unread trigger |
| `src/server/idle-timer.ts` | Auto-shutdown idle timer with sleep-wake resilience |
| `src/server/session-bootstrap.ts` | Startup session discovery and OpenSpec polling init |
| `src/server/pi-gateway.ts` | Extension WebSocket gateway (port 9999) |
| `src/server/browser-gateway.ts` | Browser WebSocket gateway (dispatches to handler modules) |
| `src/server/browser-handlers/handler-context.ts` | Shared context type for browser message handlers |
| `src/server/browser-handlers/subscription-handler.ts` | Subscribe/unsubscribe with batched replay; replays UI state |
| `src/server/browser-handlers/session-action-handler.ts` | Send prompt, abort, resume, spawn, shutdown, force kill, flow control |
| `src/server/browser-handlers/session-action-helpers.ts` | Pure helpers for session-action-handler (`shouldInterceptReload`) |
| `src/client/components/ImageLightbox.tsx` | Full-size image lightbox with zoom/pan, Esc/backdrop close |
| `src/client/components/CollapsedToolGroup.tsx` | Collapsed group of repeated tool calls with expand toggle |
| `src/client/lib/group-tool-calls.ts` | Groups consecutive identical tool calls for chat display |
| `src/client/lib/collapse-retried-errors.ts` | Pure helpers `findRetriedErrorIds` + `findActiveInteractiveToolResultIds` for chat dedup |
| `src/client/components/RetriedErrorBadge.tsx` | One-line "tool failed — retried" pill replacing collapsed errored ToolCallStep |
| `src/server/browser-handlers/session-meta-handler.ts` | Rename, hide, unhide, attach/detach proposal, fetch, list |
| `src/server/proposal-attach-naming.ts` | Pure helpers `attachRenameTarget` + `detachShouldClearName` (idempotent auto-rename) |
| `src/server/browser-handlers/terminal-handler.ts` | Create, kill, rename terminals |
| `src/server/browser-handlers/directory-handler.ts` | Pin/unpin dirs, reorder, openspec refresh, pi-gateway forwards |
| `src/server/memory-event-store.ts` | In-memory event buffer with LRU eviction, per-session cap, payload truncation |
| `src/server/memory-session-manager.ts` | Pure in-memory session registry |
| `src/client/components/FolderOpenSpecSection.tsx` | Folder-level OpenSpec UI: change list, refresh, bulk archive, attach-spawn |
| `src/server/pending-attach-registry.ts` | In-memory FIFO queue of pending `attachProposal` intents per cwd (60s TTL) |
| `src/client/components/ArchiveBrowserView.tsx` | Searchable archive browser: date-grouped list, two-level nav |
| `src/client/hooks/useArchiveListing.ts` | Fetch hook + pure helpers for archive endpoint |
| `src/server/openspec-archive.ts` | Scans `openspec/changes/archive/` and returns ArchiveEntry list |
| `src/client/components/SessionOpenSpecActions.tsx` | Session-level OpenSpec: searchable attach dialog, action buttons, detach |
| `src/client/components/DialogPortal.tsx` | Portal wrapper rendering dialogs at document.body with scroll lock |
| `src/client/components/PinDirectoryDialog.tsx` | Dialog to pin a directory (wraps PathPicker) |
| `src/client/components/PathPicker.tsx` | Reusable keyboard-first path picker with typeahead directory list |
| `src/client/lib/browse-api.ts` | Client-side browse API helper for PathPicker |
| `src/server/browse.ts` | Directory listing + classification for the browse API |
| `src/server/pi-resource-scanner.ts` | Discovers pi extensions, skills, prompts from local/global/package sources |
| `src/server/package-manager-wrapper.ts` | Wraps pi's DefaultPackageManager; adds `move()` for scope-to-scope moves |
| `src/server/package-source-helpers.ts` | Pure `parseSourceKind` + `computeIdentity` (npm/git/https/path identity rules) |
| `src/shared/tool-registry/registry.ts` | `ToolRegistry` — single-source resolver for every external binary/module |
| `src/shared/tool-registry/definitions.ts` | Registers standard tool set with ordered strategy chains |
| `packages/shared/bin/pi-dashboard-resolve-tool.cjs` | Shell-callable resolver wrapper (CommonJS, no TS deps) for build-time tools |
| `src/shared/__tests__/no-hardcoded-node-modules-paths.test.ts` | Repo-lint: forbid hardcoded `node_modules/electron` / `node_modules/node-pty` |
| `src/shared/tool-registry/strategies.ts` | Reusable resolution strategies (override / managed / npm-global / where / bare-import) |
| `src/shared/tool-registry/overrides.ts` | Read/write `~/.pi/dashboard/tool-overrides.json` with atomic write |
| `src/shared/tool-registry/types.ts` | `ToolDefinition`, `Strategy`, `Resolution`, error classes |
| `src/shared/tool-registry/index.ts` | Barrel export + `getDefaultRegistry()` singleton accessor |
| `src/server/routes/tool-routes.ts` | REST routes for `/api/tools*` (list, rescan, override, diagnostics) |
| `packages/server/src/pi-version-skew.ts` | Pure pi version compatibility helpers (`readPiCompatibility`, `computeCompatibility`) |
| `packages/shared/src/legacy-managed-dir.ts` | `detectLegacyManagedDir({homedir?})` returns `{present, path, pkgCount, sizeMb}`; surface for Doctor advisory + server CLI startup log |
| `src/client/lib/tools-api.ts` | Client-side fetch helpers for `/api/tools*` |
| `src/client/components/ToolsSection.tsx` | Settings → General → Tools section (per-tool status/source/override UI) |
| `src/server/npm-search-proxy.ts` | Cached proxy for npm registry search (`keywords:pi-package`) and README |
| `src/server/routes/package-routes.ts` | REST routes: search, readme, installed, install, remove, update, check-updates |
| `src/client/components/SortablePinnedGroup.tsx` | Drag-to-reorder wrapper for pinned directory groups |
| `src/server/preferences-store.ts` | Global UI preferences (pinned dirs, session order) in `preferences.json` |
| `src/server/meta-persistence.ts` | Per-session debounced `.meta.json` writer |
| `src/server/session-scanner.ts` | Startup session discovery scanning `~/.pi/agent/sessions/` |
| `src/server/migrate-persistence.ts` | One-time migration from `sessions.json` + `state.json` to `.meta.json` |
| `src/server/session-order-manager.ts` | Per-cwd session ordering with persistence; `moveToFront` semantic |
| `src/server/directory-service.ts` | Server-side session discovery, event loading, OpenSpec polling (mtime-gated) |
| `src/server/pending-fork-registry.ts` | Tracks pending fork operations for session placement |
| `src/server/pending-resume-registry.ts` | Queues prompts for auto-resume of ended sessions |
| `src/server/pending-resume-intent-registry.ts` | In-memory user-resume intent map (60s TTL); 4-way intent contract on reattach |
| `src/server/reattach-placement.ts` | Pure `decideReattachAction` + I/O `applyReattachPolicy` for bridge-reattach placement |
| `src/server/json-store.ts` | Atomic JSON file read/write helpers |
| `src/server/process-manager.ts` | Session spawning via `selectMechanism` → tmux/wt/wsl-tmux/headless |
| `src/shared/platform/detached-spawn.ts` | `spawnDetached` + `waitForNoCrash` + `waitForReady` primitives |
| `src/shared/platform/node-version-check.ts` | `isKnownBadNode` + `buildNodeVersionWarning` (nodejs/node#58515 ranges) |
| `src/shared/platform/preload-fastify.ts` | Resolver returning native path to `preload-fastify.cjs` for `--require` injection |
| `packages/server/preload-fastify.cjs` | CJS preload populating `require.cache` with fastify + ajv-compiler |
| `src/shared/platform/spawn-mechanism.ts` | `SpawnMechanism` enum + `selectMechanism` selector + `sessionFlagsToArgv` |
| `src/shared/platform/process-identify.ts` | `findPidByMarker` + `isProcessLikePi` + `isPiCommandLine` |
| `src/shared/platform/process.ts` | Sole source of process termination + liveness primitives (kill/alive/group) |
| `src/shared/platform/node-spawn.ts` | Sole source of `node --import <loader> <entry>` argv construction |
| `src/shared/__tests__/no-raw-node-import.test.ts` | Repo-lint: forbid raw `--import`/`--loader` argv outside `node-spawn.ts` |
| `src/shared/__tests__/no-direct-process-kill.test.ts` | Repo-lint: forbid `process.kill(` outside `platform/` |
| `src/server/editor-registry.ts` | Detects available native editors (running processes + CLI) |
| `src/server/editor-manager.ts` | Lifecycle manager for code-server child processes |
| `src/server/editor-proxy.ts` | Reverse proxy for `/editor/:id/*` to code-server instances |
| `src/server/editor-detection.ts` | Auto-detect code-server/openvscode-server binary on PATH |
| `src/server/routes/editor-routes.ts` | REST routes: editor start, stop, heartbeat, status, detect |
| `src/server/event-status-extraction.ts` | Extracts session status/tool updates; hosts `isActivityEvent` + `isUnreadTrigger` |
| `src/server/viewed-session-tracker.ts` | Per-browser viewed-session map; gates unread-trigger stamping |
| `src/server/headless-pid-registry.ts` | Maps headless child PIDs to session IDs |
| `src/server/auth.ts` | OAuth2 authentication: provider registry, JWT helpers, user allowlist |
| `src/server/provider-auth-handlers.ts` | Pi provider OAuth handlers (Anthropic, Codex, GitHub Copilot, Gemini CLI, Antigravity) |
| `src/server/provider-auth-storage.ts` | Read/write `~/.pi/agent/auth.json` with lockfile for pi provider credentials |
| `src/server/routes/provider-auth-routes.ts` | REST routes: provider OAuth authorize/exchange/callback, device-code, API key CRUD |
| `src/server/routes/provider-routes.ts` | REST routes: custom LLM provider CRUD + connection probe |
| `src/server/model-proxy/auth-gate.ts` | Fastify `onRequest` hook for `/v1/*`: uniform proxy-key auth, backoff, scope check |
| `src/server/model-proxy/api-key-store.ts` | Pure helpers: `hashKey`, `verifyKey`, `generateKey`, `findApiKey`, `recordKeyUsage`, `keyHasScope` |
| `src/server/model-proxy/concurrency.ts` | `ConcurrencyTracker`: server-wide + per-key + per-provider caps; throws `ConcurrencyError` |
| `src/server/model-proxy/failed-auth-backoff.ts` | Per-IP exponential backoff (10ms→10s cap) for failed proxy-key auth |
| `src/server/model-proxy/internal-registry.ts` | Server-resident model registry: reads auth/providers/models.json + pi-ai built-ins |
| `src/server/model-proxy/internal-auth-storage.ts` | Wraps `provider-auth-storage.ts`; handles OAuth-refresh-on-expiry via pi-ai per-provider helpers |
| `src/server/model-proxy/registry-singleton.ts` | Lazy singleton: `getModelRegistry()`, `refreshModelRegistry()`, `getModelProxyStatus()` |
| `src/server/model-proxy/recursion-guard.ts` | `isSelfPointing(baseUrl, origins)`: detects dashboard-pointing custom provider baseUrls |
| `src/server/model-proxy/request-log.ts` | Append-mode JSONL request log at `~/.pi/dashboard/model-proxy.jsonl`; 50MB rotation |
| `src/server/model-proxy/streamer.ts` | `streamCompletion(opts, streamSimple, registry?)`: resolves creds then streams via pi-ai |
| `src/server/model-proxy/convert/` | Lifted MIT converters: OpenAI↔pi-ai, Anthropic↔pi-ai (format conversions, SSE output) |
| `src/server/routes/model-proxy-routes.ts` | Route handlers: `GET /v1/models`, `POST /v1/chat/completions`, `POST /v1/messages` |
| `src/server/routes/model-proxy-api-key-routes.ts` | REST CRUD for proxy API keys: list, create, revoke, purge (JWT-gated) |
| `src/server/routes/model-proxy-refresh-routes.ts` | `POST /api/model-proxy/refresh`: JWT-gated manual registry refresh |
| `src/client/components/ModelProxySection.tsx` | Settings section: proxy toggle, second-port, API key table + reveal-once banner |
| `src/client/lib/model-proxy-api.ts` | Client fetch helpers: `listApiKeys`, `createApiKey`, `revokeApiKey`, `deleteApiKey`, `refreshRegistry` |
| `src/server/provider-probe.ts` | Pure per-API probe builders + I/O `probeProvider` (8s timeout, no apiKey echo) |
| `src/extension/provider-register.ts` | Reads `providers.json`, calls `pi.registerProvider`, hot-reload on credentials change |
| `src/client/lib/providers-api.ts` | Client fetch helper for `/api/providers/test` connection probe |
| `src/client/components/ProviderAuthSection.tsx` | Settings section: OAuth login buttons, device-code modal, API key inputs |
| `packages/client/src/components/PluginsSection.tsx` | Settings ▸ Plugins activation list; toggle + missing-requirement install. See change: add-plugin-activation-ui. |
| `src/server/auth-plugin.ts` | Fastify plugin: auth routes, onRequest hook, WS upgrade validation |
| `src/server/config-api.ts` | Config REST API: read (redacted), write (partial merge), secret preservation |
| `src/client/components/SettingsPanel.tsx` | Settings UI: all dashboard config fields, grouped form, save to server |
| `src/client/hooks/useAuthStatus.ts` | Client auth status hook and login redirect helper |
| `src/server/localhost-guard.ts` | Network access guard (loopback/trusted/authenticated, CIDR/wildcard bypass) |
| `src/server/server-pid.ts` | PID file management for daemon mode |
| `src/client/components/ServerSelector.tsx` | Server selector dropdown (open-only probing, transactional staging-socket switch) |
| `packages/client/src/lib/staging-socket.ts` | `openStagingSocket(url, {timeoutMs})` — single-settle WS staging helper |
| `packages/client/src/lib/server-switch.ts` | `performServerSwitch` two-phase transaction (stage → commit) |
| `packages/client/src/components/ConnectionStatusBanner.tsx` | Disconnection banner (>3s non-OPEN, hidden during staging switch) |
| `src/client/components/KnownServersSection.tsx` | Settings section: list/add/remove persisted known remote servers |
| `src/client/components/NetworkDiscoverySection.tsx` | Settings section: mDNS network scan with manual-add fallback on empty result |
| `src/client/lib/parse-host-input.ts` | Pure `parseHostInput(input, defaultPort)` accepting URLs/host:port/IPv6 |
| `src/client/lib/known-servers-api.ts` | Client-side fetch helpers for known servers CRUD and discovery endpoints |
| `src/server/routes/known-servers-routes.ts` | REST routes: known servers CRUD, on-demand mDNS discovery scan |
| `src/server/terminal-manager.ts` | PTY lifecycle, ring buffer, spawn/attach/kill terminals |
| `src/server/terminal-gateway.ts` | Binary WebSocket upgrade handler for `/ws/terminal/:id` |
| `scripts/fix-pty-permissions.cjs` | Postinstall: fix node-pty spawn-helper execute permissions |
| `src/server/tunnel.ts` | Zrok tunnel with reserved shares, binary detection, PID tracking |
| `src/client/components/TunnelButton.tsx` | Unified tunnel/QR button (icon state varies by tunnel status) |
| `src/client/components/QrCodeDialog.tsx` | QR code dialog showing tunnel URL with copy/disconnect/setup |
| `public/manifest.json` | PWA web app manifest for installability |
| `public/sw.js` | Minimal service worker for PWA installability |
| `src/client/components/ZrokInstallGuide.tsx` | OS-aware zrok installation guide view |
| `src/server/cli.ts` | CLI entry: start/stop/restart/status; `cmdRestart` delegates to `/api/restart` when up |
| `src/server/restart-helper.ts` | Cross-platform `/api/restart` orchestrator (detached node-built-ins-only spawner) |
| `packages/shared/src/server-launcher.ts` | `launchDashboardServer` — single shared spawn primitive (jiti loader, argv, env, log header, readiness) used by Bridge / Standalone / Electron starters |
| `src/shared/platform/paths.ts` | OS-aware path primitives (`normalizePath`, `samePath`, `parsePathInput`) |
| `src/client/lib/session-grouping.ts` | Sessions grouped by directory; `resolveSessionGroupPath` (pin > jjState.workspaceRoot > cwd) |
| `src/shared/platform/` | Unified cross-OS primitives barrel (exec/runner/git/openspec/npm/process/binary-lookup/...) |
| `src/shared/rest-api.ts` | REST API type definitions |
| `.pi/skills/release-cut/SKILL.md` | Release-cut skill: bump versions, promote CHANGELOG, tag, push (fires publish.yml) |
| `.pi/skills/spec-coherence-check/SKILL.md` | Skill: sweep proposals for staleness, conflicts, obsolescence |
| `.pi/skills/spec-coherence-check/references/proposal-queue-schema.md` | JSON schema for `.pi/proposal-queue.json` |
| `.pi/skills/code-review/SKILL.md` | Skill: comprehensive code review with severity labels |
| `.pi/skills/code-review/references/` | Language guides + architecture/performance/security review references |
| `.pi/skills/nano-banana-imagegen/SKILL.md` | Skill: AI image generation/editing via Google Gemini (nano-banana CLI) |
| `.pi/skills/nano-banana-imagegen/references/` | Prompting guide, example prompts |
| `.pi/skills/browser-visual-debug/SKILL.md` | Skill: visual debugging with a real browser via pi-agent-browser |
| `.pi/skills/browser-visual-debug/references/` | Dashboard recipes, responsive presets, agent-browser cheatsheet |
| `.pi/skills/browser-visual-debug/scripts/detect-dashboard.sh` | Auto-detect dashboard URL, mode, Vite dev server status |
| `packages/electron/src/main.ts` | Electron main: 6-state startup machine (check-health → attach \| wizard → spawn → health-wait → done \| loading-page-error); single-instance, tray |
| `packages/electron/src/lib/link-handling.ts` | Pure `isSameOriginUrl` + OAuth-aware `decideWillNavigate` for external-link guard |
| `packages/client/src/components/MarkdownContent.tsx` | ReactMarkdown renderer (chat/thinking/READMEs/previews); external-link hardening + KaTeX math + `pi-asset:` image scheme |
| `packages/client/src/lib/SessionAssetsContext.tsx` | Per-session image-asset registry context resolving `pi-asset:<hash>` srcs in `MarkdownContent` |
| `packages/extension/src/markdown-image-inliner.ts` | Bridge helper rewriting assistant `![alt](path)` → `![alt](pi-asset:<hash>)` (SHA-256/16, MIME allowlist, 5 MB/img + 20 MB/msg caps) |
| `packages/client/src/__tests__/no-bare-external-anchor.test.ts` | Repo-lint: forbid bare `<a href="http(s)://">` without `target="_blank"` |
| `packages/electron/src/lib/pick-node.ts` | `pickNodeForServer` — 2 strategies: bundled → execpath-fallback (corrupted-install signal) |
| `packages/electron/src/lib/ensure-windows-path.ts` | Re-export shim of shared `ensureWindowsSystemPath` (prepends System32/Wbem/PowerShell/OpenSSH/WindowsApps on Win; no-op on POSIX) |
| `packages/electron/src/lib/server-lifecycle.ts` | Thin `selectLaunchSource + spawnFromSource` shim; `setSpawnedPid` + `decideShutdownOnQuit` ownership rule |
| `packages/electron/src/lib/launch-source.ts` | `selectLaunchSource()` resolver — 3 strategies: attach \| devMonorepo \| bundled; `spawnFromSource` |
| `packages/shared/src/bridge-register.ts` | Shared bridge registration: `findBundledExtension(baseDir)` + `registerBridgeExtension(path)`; non-destructive cleanup, AppImage guard. Used by server startup and Electron wizard. |
| `packages/shared/src/pi-package-resolver.ts` | Resolves pi `packages[]` (npm/git/https/abs/rel) to install dir + entry path. Tier-2 fallback for plugin peer imports across npm/git/local installs. See change: add-shared-pi-package-resolver. |
| `packages/electron/src/lib/doctor.ts` | Doctor diagnostic: checks all binaries, versions, server status, offers setup |
| `packages/shared/src/doctor-core.ts` | Shared doctor primitives: types, SECTION_OF, SUGGESTIONS, safeExec/safeCheck/assumedMandatory, runSharedChecks, formatDoctorReportMarkdown |
| `packages/electron/src/lib/doctor-bridge-contract.ts` | Typed `DoctorBridge` interface + frozen `DOCTOR_IPC_CHANNELS` (channel-name-drift lint) |
| `packages/electron/src/lib/doctor-window.ts` | `openDoctorWindow()` factory + IPC handlers (`doctor:run` etc.); concurrent-run serialization; closed→null leak fix |
| `packages/electron/src/preload/doctor-preload.ts` | Preload bridge exposing `window.electron.doctor` to `doctor.html` |
| `packages/electron/src/renderer/doctor.html` | Hand-rolled Doctor renderer — sections, status pills, suggestion callouts, toolbar |
| `packages/server/src/routes/doctor-routes.ts` | `GET /api/doctor` route — auth-gated; runs `runSharedChecks`; 200 + fallback row on internal failure |
| `packages/client/src/lib/doctor-api.ts` | Client fetch helper for `/api/doctor` with `DoctorFetchError` typed envelope |
| `packages/client/src/components/DiagnosticsSection.tsx` | Settings → Diagnostics — fetch, sections, suggestions, copy-to-clipboard with textarea fallback |
| `packages/electron/src/lib/app-menu.ts` | App menu with About dialog and Doctor on all platforms |
| `packages/electron/src/lib/tray.ts` | System tray with platform-specific icons |
| `packages/electron/src/lib/dependency-detector.ts` | Detects pi/openspec/Node on PATH (AppImage + Win-ext guards) |
| `packages/electron/src/lib/bundled-node.ts` | Resolves bundled Node.js/npm paths in Electron resources |
| `packages/electron/src/lib/wizard-window.ts` | Single-window factory for the slim welcome wizard |
| `packages/electron/src/renderer/wizard.html` | 179-LOC welcome card + `[Launch dashboard]` CTA + Advanced disclosure |
| `packages/electron/forge.config.ts` | Electron Forge config: DMG/DEB/AppImage/NSIS makers; arch-tagged DMG; macOS 10.15 floor |
| `packages/electron/scripts/build-installer.sh` | Build script: native + Docker cross-platform; `--mac-both` arm64+x64 sequence |
| `packages/electron/scripts/docker-make.sh` | Docker entrypoint: bundles server, native deps, runs Forge make |
| `packages/electron/scripts/Dockerfile.build` | Docker image for cross-platform builds (node:22-bookworm-slim) |
| `packages/electron/scripts/bundle-server.mjs` | Bundles server + workspace deps into `resources/server/`. Runs `npm install --omit=dev`. Phase 1 GO/NO-GO guard asserts node-pty prebuild triples |
| `packages/shared/src/recommended-extensions.ts` → `BUNDLED_EXTENSION_IDS` | Single source of truth for bundled extension ids in Electron installer |
| `packages/electron/scripts/test-server-launch.sh` | Docker-based test for server launch on clean Linux |
| `packages/electron/scripts/test-electron-install.sh` | Full e2e Docker test: install, wizard, server launch, health check |
| `packages/electron/scripts/test-electron-install-inner.sh` | Inner test script run inside Docker container |
| `packages/electron/resources/icon.png` | Master 1024×1024 app icon |
| `.github/workflows/publish.yml` | CI: build matrix × 6 (platform,arch); idempotent ordered npm publish; lockfile regen + verify in prepare; no-bash-on-Windows |
| `scripts/verify-lockfile-versions.mjs` | Sanity gate: asserts every cross-ref in `package-lock.json` is `^<root.version>`; runs after `npm install --package-lock-only` in `prepare` |
| `packages/shared/src/__tests__/publish-workflow-contract.test.ts` | Repo-lint: pin electron job's `needs:` array and `fail-fast: false` |
| `packages/shared/src/__tests__/no-bash-on-windows.test.ts` | Repo-lint: forbid `shell: bash` on steps reachable on Windows runners |

## Build & Restart Workflow

The dashboard has three components that need rebuilding depending on what changed:

### After bridge extension changes (`src/extension/`)
Reload all connected pi sessions to pick up the new bridge code:
```bash
npm run reload          # Reload all pi sessions
npm run reload:check    # Type-check first, then reload
```

### After server changes (`src/server/`, `src/shared/`)
Restart the dashboard server. The server runs TypeScript directly via jiti (pi's TypeScript loader), so no separate build step is needed — just restart:
```bash
# Graceful restart via API (preserves current dev/prod mode)
curl -X POST http://localhost:8000/api/restart

# Or via CLI
pi-dashboard restart              # production mode
pi-dashboard restart --dev        # dev mode

# Manual stop + start
pi-dashboard stop && pi-dashboard start
pi-dashboard stop && pi-dashboard start --dev
```

### After client changes (`src/client/`)
- **Dev mode**: Vite hot-reloads automatically, no action needed. Start with `npm run dev`.
- **Production mode**: Rebuild the client and restart the server:
  ```bash
  npm run build
  curl -X POST http://localhost:8000/api/restart
  ```

### After OpenSpec apply finishes (full rebuild)
When an openspec-apply-change skill completes implementation, do a full rebuild and restart:
```bash
npm run build
curl -X POST http://localhost:8000/api/restart
npm run reload
```

### Check current mode
```bash
curl -s http://localhost:8000/api/health | jq .mode
# Returns "dev" or "production"
```

### Dev mode with production fallback
In `--dev` mode, the server proxies to Vite for HMR. If Vite is not running, it **automatically falls back** to serving the production build from `dist/client/`. This means `pi-dashboard start --dev` always works — no 502 errors.

### Fault-tolerant restart
- `POST /api/restart` waits for the old server to exit, starts a new one, and verifies health
- `POST /api/restart` with body `{"dev": true}` or `{"dev": false}` switches modes
- `pi-dashboard stop` kills stale processes holding the ports (via `lsof`), not just the PID file
- **Single restart path** (change: fix-restart-bridge-auto-start-race): `/api/restart` is the single source of truth. `pi-dashboard restart` (CLI) probes `isDashboardRunning(port)` and **delegates to `/api/restart`** when the dashboard is up; only when no dashboard is running does it fall back to local `cmdStop` + `cmdStart`. The `restart-helper.ts` orchestrator runs detached, kills the previous PID explicitly (SIGTERM → SIGKILL), then spawns the replacement. Before exit, the server broadcasts `server_restarting { reason, quiesceMs }` to every connected pi bridge so bridges suppress their auto-start spawn step for the quiesce window (5 s for restart, 60 s for shutdown) and don't race the orchestrator. Discovery + reconnection still run during the window so bridges pick up the new server as soon as it advertises.

## OpenSpec Conventions

When creating OpenSpec change artifacts, always place them at `openspec/changes/<name>/` — never nest under subdirectories like `active/` or `archive/`. Prefer using `openspec change new <name>` CLI to scaffold the directory structure correctly.

## Diagram Style

When creating diagrams, use Mermaid syntax (```mermaid blocks) instead of ASCII box drawings. This applies to explore mode, design documents, and all other artifacts.


