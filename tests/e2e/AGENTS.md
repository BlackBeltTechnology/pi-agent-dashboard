# DOX — tests/e2e

Files in this directory. One row per file. Non-source area (migrated from `docs/file-index-skills-misc.md`; source of truth now here). See change: migrate-file-index-to-agents-tree.

| File | Purpose |
|------|---------|
| `README.md` | Docs for browser E2E. Prerequisites: Docker, `npx… → see `README.md.AGENTS.md` |
| `access-grants-revoke.spec.ts` | L3 access-grant remedy journey: denial → grant → admitted… → see `access-grants-revoke.spec.ts.AGENTS.md` |
| `access-grant-dialog.spec.ts` | L3 for the access-grant prompt dialog + YOLO UI (change… → see `access-grant-dialog.spec.ts.AGENTS.md` |
| `anthropic-bridge-activation.spec.ts` | L3 spec (change: add-flow-plugin-e2e-tests). → see `anthropic-bridge-activation.spec.ts.AGENTS.md` |
| `archive-fold.spec.ts` | L3 for the per-folder `Archive (N)` fold (test-plan #F4… → see `archive-fold.spec.ts.AGENTS.md` |
| `asciidoc-preview.spec.ts` | L3 AsciiDoc preview styling (change: asciidoc-support… → see `asciidoc-preview.spec.ts.AGENTS.md` |
| `diagram-preview.spec.ts` | L3 diagram preview (.puml and adoc hydration) in the… → see `diagram-preview.spec.ts.AGENTS.md` |
| `automation-fanout.spec.ts` | L3 fan-out E2E (test-plan F5/F6). Creates an `actions:`… → see `automation-fanout.spec.ts.AGENTS.md` |
| `automation-identity-restart.spec.ts` | L3: automation run identity survives a restart (#F1/#F2). → see `automation-identity-restart.spec.ts.AGENTS.md` |
| `background-stream-selection.spec.ts` | #F11 — held selection survives a background session stream. → see `background-stream-selection.spec.ts.AGENTS.md` |
| `copy-insecure-context.spec.ts` | L3 test-plan #X3 (change: fix-long-session-ux-degradation… → see `copy-insecure-context.spec.ts.AGENTS.md` |
| `drag-body-style.spec.ts` | #F23 — breakpoint flip unmounts dragger mid-drag; body… → see `drag-body-style.spec.ts.AGENTS.md` |
| `idle-fx-pause.spec.ts` | L3 for idle FX pause (test-plan #F16-#F20): idle delay… → see `idle-fx-pause.spec.ts.AGENTS.md` |
| `long-session-settle.spec.ts` | L3 test-plan #P4 (change: fix-long-session-ux-degradation… → see `long-session-settle.spec.ts.AGENTS.md` |
| `mobile-viewport-bound.spec.ts` | L3 mobile viewport bound (test-plan F12-F15, change… → see `mobile-viewport-bound.spec.ts.AGENTS.md` |
| `bind-reachability-advisory.spec.ts` | L3 for the bind-vs-trust advisory (test-plan F1–F19, X5… → see `bind-reachability-advisory.spec.ts.AGENTS.md` |
| `blackhole-settings.spec.ts` | L3 spec (change: add-blackhole-plugin). Covers test-plan… → see `blackhole-settings.spec.ts.AGENTS.md` |
| `blackhole-session-pipeline.spec.ts` | L3 blackhole session pipeline (add-blackhole-session-pipeli… → see `blackhole-session-pipeline.spec.ts.AGENTS.md` |
| `bridge-contention-health.spec.ts` | L3 contention health surface (test-plan #F6). → see `bridge-contention-health.spec.ts.AGENTS.md` |
| `browser-relay.spec.ts` | L3 for the browser relay (change: add-browser-relay… → see `browser-relay.spec.ts.AGENTS.md` |
| `bus-client-goal-plugin-action.spec.ts` | L3/P1 `BusClient` host scripting… → see `bus-client-goal-plugin-action.spec.ts.AGENTS.md` |
| `chat-attachment-two-phase.spec.ts` | Two-phase attachment render E2E (change… → see `chat-attachment-two-phase.spec.ts.AGENTS.md` |
| `chat-pane-below-floor-allocation.spec.ts` | L3 below-floor chat pane allocation. → see `chat-pane-below-floor-allocation.spec.ts.AGENTS.md` |
| `chat-render-fx.spec.ts` | Browser E2E gate for `reduce-chat-render-cpu-umbrella`… → see `chat-render-fx.spec.ts.AGENTS.md` |
| `chat-render-perf.spec.ts` | ADVISORY opt-in perf probe for `reduce-chat-render-cpu-umbr… → see `chat-render-perf.spec.ts.AGENTS.md` |
| `chat-transcript-virtualization.spec.ts` | L3 gate for virtualize-chat-transcript-tanstack (Phase 2… → see `chat-transcript-virtualization.spec.ts.AGENTS.md` |
| `compaction-boundary-replay.spec.ts` | L3 for change replay-compaction-boundary (F1/F2). Real… → see `compaction-boundary-replay.spec.ts.AGENTS.md` |
| `origin-gate.spec.ts` | L3 cross-site gates in browser reality (#F1-#F3): hostile… → see `origin-gate.spec.ts.AGENTS.md` |
| `csp.spec.ts` | Baseline CSP e2e (§7). Asserts a CSP header (report-only… → see `csp.spec.ts.AGENTS.md` |
| `ctx-running-render.spec.ts` | Browser E2E for `fix-ctx-running-render`. Drives… → see `ctx-running-render.spec.ts.AGENTS.md` |
| `custom-entry-fallback.spec.ts` | L3 (change: render-inline-reasoning-and-custom-entries… → see `custom-entry-fallback.spec.ts.AGENTS.md` |
| `custom-entry-om-renderer.spec.ts` | L3 (change: add-custom-entry-renderer-slot, F15). → see `custom-entry-om-renderer.spec.ts.AGENTS.md` |
| `custom-entry-replay-parity.spec.ts` | L3 (change: render-inline-reasoning-and-custom-entries… → see `custom-entry-replay-parity.spec.ts.AGENTS.md` |
| `dashboard-slash.spec.ts` | Browser E2E: spawn session → `/dashboard:server-health`… → see `dashboard-slash.spec.ts.AGENTS.md` |
| `directory-home.spec.ts` | L3 for the `/folder/:encodedCwd` directory home page… → see `directory-home.spec.ts.AGENTS.md` |
| `editor-pane.spec.ts` | Playwright E2E for internal Monaco editor pane (change… → see `editor-pane.spec.ts.AGENTS.md` |
| `durable-session-diff.spec.ts` | L3 (change: fix-session-diff-durable-source, #F1): after… → see `durable-session-diff.spec.ts.AGENTS.md` |
| `empty-model-selector.spec.ts` | L3 for `open-empty-model-selector`. Proves the… → see `empty-model-selector.spec.ts.AGENTS.md` |
| `model-favorites-cross-surface.spec.ts` | L3 F3 of model-picker-everywhere-favorites. → see `model-favorites-cross-surface.spec.ts.AGENTS.md` |
| `keeper-log-health.spec.ts` | L3 (test-plan #F1, #F2): `/api/health` carries… → see `keeper-log-health.spec.ts.AGENTS.md` |
| `ended-session-endedat.spec.ts` | L3 for the evidence-based `endedAt` invariant (test-plan… → see `ended-session-endedat.spec.ts.AGENTS.md` |
| `explicit-model-preserved.spec.ts` | L3 for `fix-default-model-clobbers-explicit-model`… → see `explicit-model-preserved.spec.ts.AGENTS.md` |
| `extension-slash-inprocess.spec.ts` | L3 in-process extension slash dispatch (test-plan F1, F2). → see `extension-slash-inprocess.spec.ts.AGENTS.md` |
| `enhance-tool-call-grouping.spec.ts` | Playwright spec for universal tool-call grouping (change → see `enhance-tool-call-grouping.spec.ts.AGENTS.md` |
| `error-lifecycle.spec.ts` | Playwright spec. Single-card error-lifecycle surface… → see `error-lifecycle.spec.ts.AGENTS.md` |
| `faux-ask.spec.ts` | Faux-provider ask_user round trip. → see `faux-ask.spec.ts.AGENTS.md` |
| `faux-text.spec.ts` | Playwright spec. Faux `[[faux:plain-text]]` roundtrip.… → see `faux-text.spec.ts.AGENTS.md` |
| `faux-tool.spec.ts` | Faux-provider tool-call round trip. → see `faux-tool.spec.ts.AGENTS.md` |
| `file-mention-resolve.spec.ts` | L3 server-side-file-mention-resolution (S19). → see `file-mention-resolve.spec.ts.AGENTS.md` |
| `file-preview-survives-churn.spec.ts` | Playwright spec. Rendered-DOM regression for hoisted… → see `file-preview-survives-churn.spec.ts.AGENTS.md` |
| `fixtures.ts` | The suite's `test`/`expect` entry point — EVERY spec… → see `fixtures.ts.AGENTS.md` |
| `flow-live-no-double-render.spec.ts` | L3 (change: render-inline-reasoning-and-custom-entries, F1). → see `flow-live-no-double-render.spec.ts.AGENTS.md` |
| `flow-roundtrip.spec.ts` | L3 spec (change: add-flow-plugin-e2e-tests). Real pi-flows… → see `flow-roundtrip.spec.ts.AGENTS.md` |
| `folder-action-banner.spec.ts` | L3 for `add-folder-action-banner` (test-plan #E6, #F1… → see `folder-action-banner.spec.ts.AGENTS.md` |
| `folder-actions-menu.spec.ts` | Playwright spec. Folder actions menu after the slot-pill… → see `folder-actions-menu.spec.ts.AGENTS.md` |
| `folder-collapse-persistence.spec.ts` | L3 folder collapse survives reload, fresh context, pin… → see `folder-collapse-persistence.spec.ts.AGENTS.md` |
| `folder-collapse-seek.spec.ts` | L3 `persist-folder-collapse-server-side` #F5/#F6/#F8: Seek… → see `folder-collapse-seek.spec.ts.AGENTS.md` |
| `folder-collapse-worktree.spec.ts` | L3 persist-folder-collapse-server-side #F4/#F7. → see `folder-collapse-worktree.spec.ts.AGENTS.md` |
| `folder-membership-drag.spec.ts` | L3 for `drag-folders-across-workspaces` (test-plan… → see `folder-membership-drag.spec.ts.AGENTS.md` |
| `followup-image-queue.spec.ts` | L3 for `fix-bridge-followup-image-drop` (test-plan #F1… → see `followup-image-queue.spec.ts.AGENTS.md` |
| `gateway-board-mobile.spec.ts` | 6.8/6.9 (D11) — the readiness board at 375×667: one 52px… → see `gateway-board-mobile.spec.ts.AGENTS.md` |
| `gateway-origin-surfaces.spec.ts` | L3 for the transport/identity CLIENT surfaces (test-plan… → see `gateway-origin-surfaces.spec.ts.AGENTS.md` |
| `gateway-primary-offer.spec.ts` | F7/F8 of add-zrok-custom-reserved-name. → see `gateway-primary-offer.spec.ts.AGENTS.md` |
| `gateway-qr-selector.spec.ts` | Browser E2E for the Gateway single-QR network selector… → see `gateway-qr-selector.spec.ts.AGENTS.md` |
| `gateway-readiness-board.spec.ts` | F1–F6 + F9 — readiness board, poll lifecycle and the… → see `gateway-readiness-board.spec.ts.AGENTS.md` |
| `gateway-reserved-name.spec.ts` | Setup step 3 — the reserved-name control and its typed… → see `gateway-reserved-name.spec.ts.AGENTS.md` |
| `gateway-url-action.spec.ts` | L3 spec (change: config-override-oauth-redirect-base… → see `gateway-url-action.spec.ts.AGENTS.md` |
| `git-panel.spec.ts` | Scenario 5.2 spec. Calls `ensureGitSession`. Asserts… → see `git-panel.spec.ts.AGENTS.md` |
| `global-setup.ts` | Playwright globalSetup. `PW_E2E_USE_RUNNING=1` → only… → see `global-setup.ts.AGENTS.md` |
| `global-teardown.ts` | Playwright globalTeardown. Managed (marker present, not… → see `global-teardown.ts.AGENTS.md` |
| `headless-reload-dispatch.spec.ts` | L3 fix-out-of-band-reload #F1–#F3. → see `headless-reload-dispatch.spec.ts.AGENTS.md` |
| `helpers/__tests__/evidence-path.test.ts` | Unit tests (vitest `tests` project) for… → see `helpers/__tests__/evidence-path.test.ts.AGENTS.md` |
| `host-gate-allow.spec.ts` | L3 for the Host-gate operator flow (test-plan #F9/#F10… → see `host-gate-allow.spec.ts.AGENTS.md` |
| `helpers/folder-collapse.ts` | Folder-collapse L3 glue: bus setup/teardown… → see `helpers/folder-collapse.ts.AGENTS.md` |
| `helpers/evidence-path.ts` | Resolves a change's `measurements.json` WITHOUT creating it. → see `helpers/evidence-path.ts.AGENTS.md` |
| `helpers/index.ts` | E2E helpers. `gotoDashboard(page)` navigates `/`, waits… → see `helpers/index.ts.AGENTS.md` |
| `helpers/openspec-board.ts` | OpenSpec-board drop-targeting E2E helpers. Fixture… → see `helpers/openspec-board.ts.AGENTS.md` |
| `helpers/windowed-session.ts` | Shared glue for L3 specs needing a REAL replay window. → see `helpers/windowed-session.ts.AGENTS.md` |
| `host-pressure-badge.spec.ts` | L3 for `fix-false-unresponsive-badge` (#F3, #F4).… → see `host-pressure-badge.spec.ts.AGENTS.md` |
| `history-backfill-gap.spec.ts` | L3 for `fix-lazy-history-backfill-ux` (F1–F6, F8–F11, X3… → see `history-backfill-gap.spec.ts.AGENTS.md` |
| `history-backfill-perf.spec.ts` | L3 P1/P2 for `fix-lazy-history-backfill-ux`, metric… → see `history-backfill-perf.spec.ts.AGENTS.md` |
| `inline-screenshot.spec.ts` | Playwright E2E for inline agent screenshot artifacts… → see `inline-screenshot.spec.ts.AGENTS.md` |
| `inline-terminal-transcript.spec.ts` | L3 gate for `preserve-inline-terminal-transcript`: F1… → see `inline-terminal-transcript.spec.ts.AGENTS.md` |
| `kb-folder-slot.spec.ts` | Playwright spec. KB folder slot end-to-end in Docker… → see `kb-folder-slot.spec.ts.AGENTS.md` |
| `large-session-replay.spec.ts` | L3 wire-level gate for `compact-warm-replay-stream`… → see `large-session-replay.spec.ts.AGENTS.md` |
| `lazy-feature-bootstrap.spec.ts` | L3 cold-landing gate (F1, P1). → see `lazy-feature-bootstrap.spec.ts.AGENTS.md` |
| `lazy-mdi-icon-set.spec.ts` | L3 lazy MDI icon set (P1, F2). → see `lazy-mdi-icon-set.spec.ts.AGENTS.md` |
| `lifecycle.ts` | Shared E2E lifecycle module. Port dynamic: probes free… → see `lifecycle.ts.AGENTS.md` |
| `list-models-registry-ready.spec.ts` | L3 `list_models` registry-readiness discriminator. → see `list-models-registry-ready.spec.ts.AGENTS.md` |
| `manage-worktrees.spec.ts` | L3 for the manage-worktrees surface (test-plan F4, F3, F7… → see `manage-worktrees.spec.ts.AGENTS.md` |
| `mcp-client-folder-mobile.spec.ts` | L3 mobile folder MCP page (extract-mcp-client-plugin). → see `mcp-client-folder-mobile.spec.ts.AGENTS.md` |
| `mcp-client-settings-a11y.spec.ts` | L3 accessibility floor for the mcp-client settings section… → see `mcp-client-settings-a11y.spec.ts.AGENTS.md` |
| `mcp-token-settings.spec.ts` | L3 for the Settings → Paired Devices MCP-client token flow… → see `mcp-token-settings.spec.ts.AGENTS.md` |
| `mermaid-colorize.spec.ts` | Playwright spec. Mermaid default-node colorization… → see `mermaid-colorize.spec.ts.AGENTS.md` |
| `model-proxy-oauth-filter.spec.ts` | Playwright spec (`request` fixture, no page). Model-proxy… → see `model-proxy-oauth-filter.spec.ts.AGENTS.md` |
| `navigation.spec.ts` | Scenario 5.6 spec. Registers `page.on(pageerror)`.… → see `navigation.spec.ts.AGENTS.md` |
| `network-guard.spec.ts` | L3 flagship refusal (test-plan #S20, change… → see `network-guard.spec.ts.AGENTS.md` |
| `notify-channel.spec.ts` | Playwright spec. Drives `[[faux:notify-probe]]` (→… → see `notify-channel.spec.ts.AGENTS.md` |
| `notify-min-level.spec.ts` | L3 spec (change: gate-notify-rows-by-level). Drives… → see `notify-min-level.spec.ts.AGENTS.md` |
| `oauth-redirect-base.spec.ts` | L3 spec (change: config-override-oauth-redirect-base… → see `oauth-redirect-base.spec.ts.AGENTS.md` |
| `openspec-artifact-dialog.spec.ts` | L3 openspec-artifact-dialog-desktop. → see `openspec-artifact-dialog.spec.ts.AGENTS.md` |
| `openspec-board-drop-contrast.spec.ts` | L3 fix-openspec-board-drop-targeting: contrast. → see `openspec-board-drop-contrast.spec.ts.AGENTS.md` |
| `openspec-board-drop-indicator.spec.ts` | L3 fix-openspec-board-drop-targeting: indicator. → see `openspec-board-drop-indicator.spec.ts.AGENTS.md` |
| `openspec-board-drop.spec.ts` | L3 spec (change: fix-openspec-board-drop-targeting). Drop… → see `openspec-board-drop.spec.ts.AGENTS.md` |
| `openspec-board-worktree-availability.spec.ts` | L3 worktree availability on the OpenSpec board (test-plan… → see `openspec-board-worktree-availability.spec.ts.AGENTS.md` |
| `openspec-connect-coverage.spec.ts` | L3 connect coverage, fix-connect-snapshot-frame-loss… → see `openspec-connect-coverage.spec.ts.AGENTS.md` |
| `openspec-init-affordances-folder.spec.ts` | L3 folder-section slice (add-openspec-init-affordances). → see `openspec-init-affordances-folder.spec.ts.AGENTS.md` |
| `openspec-locality-gate.spec.ts` | L3 spec (change: scope-openspec-auto-attach-to-session-cwd). → see `openspec-locality-gate.spec.ts.AGENTS.md` |
| `optimistic-prompt.spec.ts` | Playwright E2E for optimistic-prompt-progress. Two faux… → see `optimistic-prompt.spec.ts.AGENTS.md` |
| `out-of-cwd-session-diffs.spec.ts` | L3 spec (change: opt-in-out-of-cwd-session-diffs). Faux… → see `out-of-cwd-session-diffs.spec.ts.AGENTS.md` |
| `overlay-layering.spec.ts` | Browser E2E gate for `add-overlay-layering-system`… → see `overlay-layering.spec.ts.AGENTS.md` |
| `overlay-layout.spec.ts` | L3 GENERIC reachability gate for ALL route-backed overlays… → see `overlay-layout.spec.ts.AGENTS.md` |
| `oversized-event-liveness.spec.ts` | L3 per-event size ceiling (bound-subagent-event-serializati… → see `oversized-event-liveness.spec.ts.AGENTS.md` |
| `package-queue-visible.spec.ts` | Browser E2E gate for `unify-pi-core-into-package-queue`… → see `package-queue-visible.spec.ts.AGENTS.md` |
| `pairing-qr.spec.ts` | Browser E2E for the camera-scannable pairing QR (change… → see `pairing-qr.spec.ts.AGENTS.md` |
| `security-pair-link.spec.ts` | Browser E2E for the Security→Gateway pairing link… → see `security-pair-link.spec.ts.AGENTS.md` |
| `paging-empty-reply-exhausted.spec.ts` | L3 #F8: empty page reply hides "more"; no same-offset retry. → see `paging-empty-reply-exhausted.spec.ts.AGENTS.md` |
| `paging-exhausted-reconnect-rearm.spec.ts` | L3 #X4: reconnect snapshot re-arms a stale exhausted mark. → see `paging-exhausted-reconnect-rearm.spec.ts.AGENTS.md` |
| `pi-runtime.spec.ts` | L3 spec: version-neutral pi runtime verification vault… → see `pi-runtime.spec.ts.AGENTS.md` |
| `pi-runtime-picker.spec.ts` | L3 spec for the Settings → Developer "Pi runtime" picker… → see `pi-runtime-picker.spec.ts.AGENTS.md` |
| `plugin-hash-parity.spec.ts` | L3 F3: clientBuild matched; banner hidden. → see `plugin-hash-parity.spec.ts.AGENTS.md` |
| `plugin-settings-pages.spec.ts` | L3 spec (test-plan rows F1-F14, X1-X5, X7; change… → see `plugin-settings-pages.spec.ts.AGENTS.md` |
| `popover-container-clip.spec.ts` | Browser E2E gate for `fix-popover-container-clip` (F5–F8… → see `popover-container-clip.spec.ts.AGENTS.md` |
| `project-trust-headless-spawn.spec.ts` | L3 spec (test-plan #X4, change: adopt-pi-074-080-features). → see `project-trust-headless-spawn.spec.ts.AGENTS.md` |
| `quota-context-strip.spec.ts` | L3 (change: move-quota-to-context-strip; F7–F9, X3). Stubs… → see `quota-context-strip.spec.ts.AGENTS.md` |
| `real-flow-regression.spec.ts` | L3 spec (change: add-flow-plugin-e2e-tests, D5 follow-up). → see `real-flow-regression.spec.ts.AGENTS.md` |
| `reap-core.ts` | Pure, side-effect-free reap logic, unit-tested at L1 in → see `reap-core.ts.AGENTS.md` |
| `reasoning-auto-collapse.spec.ts` | Playwright E2E for reasoning-auto-collapse-timer. Two tests. → see `reasoning-auto-collapse.spec.ts.AGENTS.md` |
| `reasoning-inline-flow.spec.ts` | L3 (change: render-inline-reasoning-and-custom-entries… → see `reasoning-inline-flow.spec.ts.AGENTS.md` |
| `recommended-local-name-match.spec.ts` | L3 spec (test-plan #F3, change… → see `recommended-local-name-match.spec.ts.AGENTS.md` |
| `recommended-requires.spec.ts` | Playwright E2E for recommended-extension `requires` probe… → see `recommended-requires.spec.ts.AGENTS.md` |
| `reconcile-heal.spec.ts` | Playwright spec (task 5.1, change… → see `reconcile-heal.spec.ts.AGENTS.md` |
| `redesign-provider-add-flow.spec.ts` | L3: Add-provider dialog + section-owned flows. → see `redesign-provider-add-flow.spec.ts.AGENTS.md` |
| `redesign-providers-list.spec.ts` | L3: the connected list. → see `redesign-providers-list.spec.ts.AGENTS.md` |
| `reducer-poisoned-cache-heal.spec.ts` | L3 reducer-poisoned cache heal. → see `reducer-poisoned-cache-heal.spec.ts.AGENTS.md` |
| `registry-shed-sidebar-convergence.spec.ts` | L3 #F7: shed registry burst reconciles the sidebar on drain. → see `registry-shed-sidebar-convergence.spec.ts.AGENTS.md` |
| `remote-transcript-read.spec.ts` | L3 D12 READ half of add-pi-gateway-transport-identity. → see `remote-transcript-read.spec.ts.AGENTS.md` |
| `replay-delta-on-reload.spec.ts` | Playwright spec. Strategy A: reload of seen session… → see `replay-delta-on-reload.spec.ts.AGENTS.md` |
| `replay-in-flight-pill.spec.ts` | Playwright spec. Replay-in-flight pill: visible over a… → see `replay-in-flight-pill.spec.ts.AGENTS.md` |
| `replay-truncate.spec.ts` | Playwright spec. Strategy B: full replay in fresh browser… → see `replay-truncate.spec.ts.AGENTS.md` |
| `resource-activation-trust.spec.ts` | L3 spec (change: project-scope-disable-global-resources). → see `resource-activation-trust.spec.ts.AGENTS.md` |
| `resource-scope-routes.spec.ts` | S-25 scope × path decision table: the 10 resource… → see `resource-scope-routes.spec.ts.AGENTS.md` |
| `route-backed-overlay.spec.ts` | Route-backed overlay contract: S-12/S-12b (one overlay per… → see `route-backed-overlay.spec.ts.AGENTS.md` |
| `scroll-to-top.spec.ts` | Browser E2E gate for `fix-chat-scroll-to-top-estimate-drift… → see `scroll-to-top.spec.ts.AGENTS.md` |
| `session-context-injection.spec.ts` | L3 context injection via `[[faux:echo-system-context]]`. → see `session-context-injection.spec.ts.AGENTS.md` |
| `session-ended-orphan-heal.spec.ts` | L3 #F6/#F7: a session killed while holding a long-running… → see `session-ended-orphan-heal.spec.ts.AGENTS.md` |
| `session-heap-settings.spec.ts` | L3 heap settings copy, save round-trip, coupling warning… → see `session-heap-settings.spec.ts.AGENTS.md` |
| `session-reap.spec.ts` | L3 gate on the reap fixture itself, driven headless over… → see `session-reap.spec.ts.AGENTS.md` |
| `session-spawn.spec.ts` | Scenario spec 5.1, authoritative WS round-trip. Clears… → see `session-spawn.spec.ts.AGENTS.md` |
| `session-state-honesty.spec.ts` | L3 rendered-honesty gate (change… → see `session-state-honesty.spec.ts.AGENTS.md` |
| `session-tags.spec.ts` | E2E for change add-session-tags (task 7.2). Spawns a fresh… → see `session-tags.spec.ts.AGENTS.md` |
| `sessions-page-stub-group.spec.ts` | L3 for the `sessions_page` stub-group paging path. → see `sessions-page-stub-group.spec.ts.AGENTS.md` |
| `settings-default-model-catalogue.spec.ts` | L3 gate on the zero-session Default Model picker… → see `settings-default-model-catalogue.spec.ts.AGENTS.md` |
| `severity-contrast.spec.ts` | L3 gate for `unify-message-severity-colors` +… → see `severity-contrast.spec.ts.AGENTS.md` |
| `settings-provider-auth-corrupt-authfile.spec.ts` | L3: corrupt auth.json + repair. → see `settings-provider-auth-corrupt-authfile.spec.ts.AGENTS.md` |
| `skill-provenance.spec.ts` | L3 for the Resources skills grid (F1-F10, X7). Fulfils… → see `skill-provenance.spec.ts.AGENTS.md` |
| `smoke.spec.ts` | Smoke spec, wiring proof only. Asserts shell renders… → see `smoke.spec.ts.AGENTS.md` |
| `spawn-correlation-recovery.spec.ts` | L3 F2–F6 late spawn register clears banner + adds card. → see `spawn-correlation-recovery.spec.ts.AGENTS.md` |
| `split-composer-overflow.spec.ts` | Browser E2E gate for `fix-split-composer-overflow`. Opens… → see `split-composer-overflow.spec.ts.AGENTS.md` |
| `subagent-detail-dialog.spec.ts` | Playwright spec (change: fix-subagent-live-detail-reliabili… → see `subagent-detail-dialog.spec.ts.AGENTS.md` |
| `subagent-inspector.spec.ts` | L3 spec (change: add-flow-plugin-e2e-tests). Drives… → see `subagent-inspector.spec.ts.AGENTS.md` |
| `subagent-pull-measurements.spec.ts` | RECORDED-EVIDENCE measurement rows for the subagent pull… → see `subagent-pull-measurements.spec.ts.AGENTS.md` |
| `subagent-pull-under-load.spec.ts` | L3 open-inspector PULL path (verify-subagent-pull-under-loa… → see `subagent-pull-under-load.spec.ts.AGENTS.md` |
| `subagent-thin-tick-liveness.spec.ts` | L3 subagent push/pull split: terminal fidelity after… → see `subagent-thin-tick-liveness.spec.ts.AGENTS.md` |
| `subagent-tick-throttle.spec.ts` | L3 cadence rows for the subagent-tick throttle (change → see `subagent-tick-throttle.spec.ts.AGENTS.md` |
| `submodule-folder-grouping.spec.ts` | L3 checkout-root resolver (change… → see `submodule-folder-grouping.spec.ts.AGENTS.md` |
| `streaming-latch-heal.spec.ts` | L3 (change: fix-stuck-streaming-status-latch, test-plan… → see `streaming-latch-heal.spec.ts.AGENTS.md` |
| `superseded-heal.spec.ts` | Playwright spec (task 7.1, change… → see `superseded-heal.spec.ts.AGENTS.md` |
| `tail-only-loading-head.spec.ts` | L3 for the loading head's TERMINAL states (F11, F13, F16 +… → see `tail-only-loading-head.spec.ts.AGENTS.md` |
| `tail-only-scroll-perf.spec.ts` | ADVISORY opt-in scroll-smoothness probe for `tail-only`… → see `tail-only-scroll-perf.spec.ts.AGENTS.md` |
| `tail-only-settings.spec.ts` | L3 for the `replayWindowMode` control (F14, F15) plus X8. → see `tail-only-settings.spec.ts.AGENTS.md` |
| `tail-only-splice-anchor.spec.ts` | L3 gate for D7a (F9, F10, F18). Asserts the anchor BY THE… → see `tail-only-splice-anchor.spec.ts.AGENTS.md` |
| `tail-only-trigger-suppression.spec.ts` | L3 for D7's suppression model (F5, F6, F8, F20). Asserts… → see `tail-only-trigger-suppression.spec.ts.AGENTS.md` |
| `table-copy.spec.ts` | Playwright spec (change: fix-table-copy-empty-clipboard… → see `table-copy.spec.ts.AGENTS.md` |
| `terminal-tab.spec.ts` | Terminal-as-tab spec (change: terminals-in-tabbed-panes). → see `terminal-tab.spec.ts.AGENTS.md` |
| `terminal.spec.ts` | Scenario 5.4 spec. `ensureGitSession`, clicks session card… → see `terminal.spec.ts.AGENTS.md` |
| `tmux-session-shutdown.spec.ts` | L3 gate for the tmux shutdown leak (test-plan #T2): spawn… → see `tmux-session-shutdown.spec.ts.AGENTS.md` |
| `tool-burst.spec.ts` | Playwright spec for temporal burst grouping. Sends… → see `tool-burst.spec.ts.AGENTS.md` |
| `tool-collapse-narration.spec.ts` | Playwright spec for the semantic-first composition flip.… → see `tool-collapse-narration.spec.ts.AGENTS.md` |
| `tool-created-files.spec.ts` | L3 spec (change: detect-tool-created-files, U1+U3).… → see `tool-created-files.spec.ts.AGENTS.md` |
| `tool-output-links.spec.ts` | Playwright E2E for tool-output file-link behaviour… → see `tool-output-links.spec.ts.AGENTS.md` |
| `tool-output-selection.spec.ts` | L3 selectable-tool-output-links (task 3.2). → see `tool-output-selection.spec.ts.AGENTS.md` |
| `uncommitted-indicator-commit.spec.ts` | E2E uncommitted-indicator + commit-from-card. → see `uncommitted-indicator-commit.spec.ts.AGENTS.md` |
| `worktree-grouping-survives-remove.spec.ts` | L3 fix-worktree-grouping-lost-on-remove. → see `worktree-grouping-survives-remove.spec.ts.AGENTS.md` |
| `worktree-init-feedback.spec.ts` | Playwright E2E for friendly worktree-init feedback (Level… → see `worktree-init-feedback.spec.ts.AGENTS.md` |
| `zrok-v2-tunnel.spec.ts` | L3 (change: support-zrok-v2, F1/F2/F3). Stubs… → see `zrok-v2-tunnel.spec.ts.AGENTS.md` |
| `mcp-session-token.spec.ts` | L3 (change: wire-mcp-session-token, test-plan #F1, #F5… → see `mcp-session-token.spec.ts.AGENTS.md` |
| `mcp-tiered-token.spec.ts` | F6/F7 (expand-mcp-tiered-surface): observe token's… → see `mcp-tiered-token.spec.ts.AGENTS.md` |
| `identity-matrix/` | L3 D21 identity SETUP MATRIX (change: add-multi-user-identity-plane, test-plan LK-*). One dashboard process per operator setup (`scenarios.ts` A–J) vs an in-process fake OIDC issuer running the interactive auth-code+PKCE flow; `setup-matrix.spec.ts` (boot log, pre-auth endpoints, localhost vs remote REST/WS) + `browser-login.spec.ts` (rendered root, plugin-frontend sign-in → API/WS → sign-out). No docker. `npm run build && npm run test:e2e:identity-matrix`; optional `PW_CHROMIUM_EXECUTABLE`. `security.spec.ts`: identity abuse cases against the live servers (forged/tampered/expired/foreign bearers, floor path tricks, spoofed forwarding headers, local token, ws-ticket replay, IdP-down fail-closed, handoff replay, login CSRF, open redirect, XSS, token storage). |
