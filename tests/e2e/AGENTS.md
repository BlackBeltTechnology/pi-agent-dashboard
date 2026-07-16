# DOX — tests/e2e

Files in this directory. One row per file. Non-source area (migrated from `docs/file-index-skills-misc.md`; source of truth now here). See change: migrate-file-index-to-agents-tree.

| File | Purpose |
|------|---------|
| `bus-client-goal-plugin-action.spec.ts` | L3/P1 (change: add-dashboard-bus-client-scripting). Drives `BusClient` from host against the harness (port from `.pi-test-harness.json`): connect, spawn (spawn_result + new-session poll), `plugin("goal",…)` no-throw/no-drop, `plugin("flows",…)`→NoPluginHandlerError. Needs `PI_SPAWN_STRATEGY=headless`. |
| `chat-render-fx.spec.ts` | Browser E2E gate for `reduce-chat-render-cpu-umbrella` (umbrella-own surface not gated by… → see `chat-render-fx.spec.ts.AGENTS.md` |
| `chat-render-perf.spec.ts` | ADVISORY opt-in perf probe for `reduce-chat-render-cpu-umbrella` (tasks 2.8/4.4/5.1). → see `chat-render-perf.spec.ts.AGENTS.md` |
| `chat-transcript-virtualization.spec.ts` | Browser E2E gate for `virtualize-chat-transcript-tanstack` (Phase 2 Step B) + preserved `chat-scroll-lock`. → see `chat-transcript-virtualization.spec.ts.AGENTS.md` |
| `scroll-to-top.spec.ts` | Browser E2E gate for `fix-chat-scroll-to-top-estimate-drift` (the ONLY layer that reproduces the… → see `scroll-to-top.spec.ts.AGENTS.md` |
| `ctx-running-render.spec.ts` | Browser E2E for `fix-ctx-running-render`. Drives `[[faux:ctx-batch-running]]` (single `ctx_batch_execute`… → see `ctx-running-render.spec.ts.AGENTS.md` |
| `dashboard-slash.spec.ts` | Browser E2E: spawn session → `/dashboard:server-health` asserts bash card + "ran locally" footer + `ok=true`;… → see `dashboard-slash.spec.ts.AGENTS.md` |
| `editor-pane.spec.ts` | Playwright E2E for internal Monaco editor pane (change: add-internal-monaco-editor-pane). → see `editor-pane.spec.ts.AGENTS.md` |
| `enhance-tool-call-grouping.spec.ts` | Playwright spec for universal tool-call grouping (change: enhance-tool-call-grouping). 3 tests, faux model. → see `enhance-tool-call-grouping.spec.ts.AGENTS.md` |
| `error-lifecycle.spec.ts` | Playwright spec. Single-card error-lifecycle surface end-to-end via faux model (no LLM). 4 tests. → see `error-lifecycle.spec.ts.AGENTS.md` |
| `faux-ask.spec.ts` | Playwright spec. Sends `[[faux:ask-select]]` via `sendPrompt`. Asserts interactive select widget mounts (option button alpha visible). Needs `PI_E2E_SEED=1`. See change: add-e2e-faux-model-roundtrip. |
| `faux-text.spec.ts` | Playwright spec. Sends `[[faux:plain-text]]` via `sendPrompt`. Asserts `PLAIN_TEXT_MARKER` text renders in message DOM. Needs `PI_E2E_SEED=1`. See change: add-e2e-faux-model-roundtrip. |
| `faux-tool.spec.ts` | Playwright spec. Sends `[[faux:tool-read]]` via `sendPrompt`. Asserts read tool renderer mounts (path `src/example.ts` visible). Needs `PI_E2E_SEED=1`. See change: add-e2e-faux-model-roundtrip. |
| `tool-collapse-narration.spec.ts` | Playwright spec for the semantic-first composition flip. `[[faux:poll-narrated]]` → 4 identical `echo… → see `tool-collapse-narration.spec.ts.AGENTS.md` |
| `tool-burst.spec.ts` | Playwright spec for temporal burst grouping. Sends `[[faux:burst-heterogeneous]]` (3 distinct bash calls,… → see `tool-burst.spec.ts.AGENTS.md` |
| `tool-created-files.spec.ts` | L3 spec (change: detect-tool-created-files, U1+U3). `spawnFreshGitSession` + `dirtyMarkdown(README.md)` (out-of-band → `otherChanges`) + `[[faux:tool-bash-artifact]]` (bash writes `tool-artifact.md` in cwd → `origin:"tool"`). Opens Files panel: asserts `origin-badge` + `created by` on the tool row (U1), and the collapsed `other-changes-group` + `session-only-toggle` hides it (U3). |
| `file-mention-resolve.spec.ts` | L3 (change: server-side-file-mention-resolution, S19). Sends `[[faux:text-tildelink]]`; clicks the `~/.pi/agent/settings.json` FileLink; asserts the preview overlay opens with `file-preview-code` (seeded home file read) and NO `file-preview-error` — proves the tilde mention resolves server-side to the HOME path, not a `/`-rooted 404. Stubs `/api/open-editor`→500 (mirrors tool-output-links). Needs `PI_E2E_SEED=1`. |
| `file-preview-survives-churn.spec.ts` | Playwright spec. Rendered-DOM regression for hoisted file-preview overlay. → see `file-preview-survives-churn.spec.ts.AGENTS.md` |
| `gateway-qr-selector.spec.ts` | Browser E2E for the Gateway single-QR network selector (change: add-gateway-qr-network-selector; automates… → see `gateway-qr-selector.spec.ts.AGENTS.md` |
| `git-panel.spec.ts` | Scenario 5.2 spec. Calls `ensureGitSession`. Asserts page-level `git-branch-btn` (title "Switch branch")… → see `git-panel.spec.ts.AGENTS.md` |
| `global-setup.ts` | Playwright globalSetup. `PW_E2E_USE_RUNNING=1` → only verify `/api/health` (30s). → see `global-setup.ts.AGENTS.md` |
| `global-teardown.ts` | Playwright globalTeardown. Managed (marker present, not fast path) → run `docker/test-down.sh` with… → see `global-teardown.ts.AGENTS.md` |
| `helpers/index.ts` | E2E helpers. `gotoDashboard(page)` navigates `/`, waits for `header-app-bar`, and arms a one-per-page… → see `helpers/index.ts.AGENTS.md` |
| `inline-screenshot.spec.ts` | Playwright E2E for inline agent screenshot artifacts (change: inline-agent-screenshot-artifacts, automates… → see `inline-screenshot.spec.ts.AGENTS.md` |
| `kb-folder-slot.spec.ts` | Playwright spec. KB folder slot end-to-end in Docker harness. → see `kb-folder-slot.spec.ts.AGENTS.md` |
| `list-models-registry-ready.spec.ts` | Playwright spec (L3). Live proof of the `list_models` registry-readiness discriminator. → see `list-models-registry-ready.spec.ts.AGENTS.md` |
| `lifecycle.ts` | Shared E2E lifecycle module. Port dynamic: probes free port in managed mode; `PW_E2E_PORT` (default 18000) +… → see `lifecycle.ts.AGENTS.md` |
| `model-proxy-oauth-filter.spec.ts` | Playwright spec (`request` fixture, no page). Model-proxy OAuth-incompatible filtering. → see `model-proxy-oauth-filter.spec.ts.AGENTS.md` |
| `mermaid-colorize.spec.ts` | Playwright spec. Mermaid default-node colorization end-to-end via faux model. → see `mermaid-colorize.spec.ts.AGENTS.md` |
| `navigation.spec.ts` | Scenario 5.6 spec. Registers `page.on(pageerror)`. `gotoDashboard`, clicks `settings-btn`, asserts… → see `navigation.spec.ts.AGENTS.md` |
| `oversized-event-liveness.spec.ts` | Playwright E2E for the per-event size ceiling (change: bound-subagent-event-serialization). → see `oversized-event-liveness.spec.ts.AGENTS.md` |
| `optimistic-prompt.spec.ts` | Playwright E2E for optimistic-prompt-progress. Two faux round-trip tests. → see `optimistic-prompt.spec.ts.AGENTS.md` |
| `pairing-qr.spec.ts` | Browser E2E for the camera-scannable pairing QR (change: make-pairing-qr-camera-scannable). → see `pairing-qr.spec.ts.AGENTS.md` |
| `project-init-button.spec.ts` | Playwright E2E for the polymorphic Initialize button (Level 1). → see `project-init-button.spec.ts.AGENTS.md` |
| `README.md` | Docs for browser E2E. Prerequisites: Docker, `npx playwright install chromium`. Run via `npm run test:e2e`. → see `README.md.AGENTS.md` |
| `reasoning-auto-collapse.spec.ts` | Playwright E2E for reasoning-auto-collapse-timer. Two tests. → see `reasoning-auto-collapse.spec.ts.AGENTS.md` |
| `reconcile-heal.spec.ts` | Playwright spec (task 5.1, change: fix-stuck-tool-card-on-dropped-event). → see `reconcile-heal.spec.ts.AGENTS.md` |
| `recommended-requires.spec.ts` | Playwright E2E for recommended-extension `requires` probe (change:… → see `recommended-requires.spec.ts.AGENTS.md` |
| `reducer-poisoned-cache-heal.spec.ts` | Playwright E2E for `fix-reducer-crash-undefined-toolname` (manual tasks 5.1+5.2). 2 tests, faux model. → see `reducer-poisoned-cache-heal.spec.ts.AGENTS.md` |
| `replay-delta-on-reload.spec.ts` | Playwright spec. Strategy A: reload of seen session resubscribes lastSeq>0 (delta replay). → see `replay-delta-on-reload.spec.ts.AGENTS.md` |
| `replay-truncate.spec.ts` | Playwright spec. Strategy B: full replay in fresh browser context pre-truncates heavy (>200-line) tool result… → see `replay-truncate.spec.ts.AGENTS.md` |
| `session-context-injection.spec.ts` | Playwright spec. Spawns session, sends `[[faux:echo-system-context]]`, asserts rendered text contains… → see `session-context-injection.spec.ts.AGENTS.md` |
| `anthropic-bridge-activation.spec.ts` | L3 spec (change: add-flow-plugin-e2e-tests). Asserts the flows-anthropic-bridge regression via… → see `anthropic-bridge-activation.spec.ts.AGENTS.md` |
| `flow-roundtrip.spec.ts` | L3 spec (change: add-flow-plugin-e2e-tests). Real pi-flows engine + faux agents. → see `flow-roundtrip.spec.ts.AGENTS.md` |
| `real-flow-regression.spec.ts` | L3 spec (change: add-flow-plugin-e2e-tests, D5 follow-up). → see `real-flow-regression.spec.ts.AGENTS.md` |
| `subagent-detail-dialog.spec.ts` | Playwright spec (change: fix-subagent-live-detail-reliability D4). → see `subagent-detail-dialog.spec.ts.AGENTS.md` |
| `subagent-inspector.spec.ts` | L3 spec (change: add-flow-plugin-e2e-tests). Drives `[[faux:subagent-spawn]]` — parent emits an `Agent` tool… → see `subagent-inspector.spec.ts.AGENTS.md` |
| `session-tags.spec.ts` | E2E for change add-session-tags (task 7.2). Spawns a fresh git session (`spawnFreshGitSession`), selects it,… → see `session-tags.spec.ts.AGENTS.md` |
| `session-spawn.spec.ts` | Scenario spec 5.1, authoritative WS round-trip. Clears onboarding gate, clicks `onboarding-step-2-cta` opens… → see `session-spawn.spec.ts.AGENTS.md` |
| `csp.spec.ts` | Baseline CSP e2e (§7). Asserts a CSP header (report-only or enforce) present on `/` with… → see `csp.spec.ts.AGENTS.md` |
| `smoke.spec.ts` | Smoke spec, wiring proof only. Asserts shell renders (title `PI Dashboard` + `header-app-bar`), no… → see `smoke.spec.ts.AGENTS.md` |
| `split-composer-overflow.spec.ts` | Browser E2E gate for `fix-split-composer-overflow`. Opens `split-toggle` at viewport 1280 (≥ md); asserts composer `send-button` right edge stays within `split-chat-pane` bounds + toolbar folds to `overflow-button` (`⋯`). Container-query fold discriminator. |
| `superseded-heal.spec.ts` | Playwright spec (task 7.1, change: fix-stuck-tool-card-superseded-heal). → see `superseded-heal.spec.ts.AGENTS.md` |
| `table-copy.spec.ts` | Playwright spec (change: fix-table-copy-empty-clipboard, automates manual task 5.1). → see `table-copy.spec.ts.AGENTS.md` |
| `terminal.spec.ts` | Scenario 5.4 spec. `ensureGitSession`, clicks session card to select, clicks `open-inline-terminal-button`,… → see `terminal.spec.ts.AGENTS.md` |
| `terminal-tab.spec.ts` | Terminal-as-tab spec (change: terminals-in-tabbed-panes). Opens the session split, asserts no terminal tab until `+ Terminal` (`new-terminal-launch`, opt-in D3), then create → `term:<id>` tab + live xterm (`Terminal input` textbox) + close-tab kills it (D4). Folder auto-surface/reconcile stay L1 (harness-flaky). |
| `tool-output-links.spec.ts` | Playwright E2E for tool-output file-link behaviour (change: selectable-tool-output-links). → see `tool-output-links.spec.ts.AGENTS.md` |
| `uncommitted-indicator-commit.spec.ts` | Playwright E2E for the uncommitted-indicator + commit-from-card feature (change:… → see `uncommitted-indicator-commit.spec.ts.AGENTS.md` |
| `worktree-init-feedback.spec.ts` | Playwright E2E for friendly worktree-init feedback (Level 1, change: friendlier-worktree-init; automates… → see `worktree-init-feedback.spec.ts.AGENTS.md` |
| `tool-output-selection.spec.ts` | Playwright E2E for selectable tool-output links (task 3.2, change: selectable-tool-output-links). → see `tool-output-selection.spec.ts.AGENTS.md` |
