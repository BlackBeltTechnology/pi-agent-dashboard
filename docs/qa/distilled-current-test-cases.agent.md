# distilled-current-test-cases — index

Code-verified current-state Playwright test cases. Generated 2026-07-04. Companion to `archived-frontend-test-cases.md`.

## Nature
- 340 distinct code-verified cases distilled from 1811 historic candidates (431 archived changes).
- Every case checked vs CURRENT source `packages/client/src` + plugin `src/client`. Drifted dropped.
- Pipeline: 1811 → drop 102 drifted + 41 no-UI → 1668 clustered 18 surfaces → 482 code-grounded → dedup vs 32 existing `tests/e2e/*.spec.ts` → 340.

## Legend
- `[NEW]` coverage gap, no e2e spec (320 cases). `[COVERED]` existing spec asserts it (20). `[target]` component/`data-testid`.
- Caveat: grounded in source digest (testids/text/handlers), not running app. Confirm selector before authoring.

## Summary by Surface (table)
- Session Cards/List/Sidebar 57 (55 NEW). Chat & Message Rendering 42 (38). Composer & Command Input 37 (35). Tool-Call Renderers 23 (22). Flows 20. Subagent Inspector 2. Goals & Automation 21. Settings/Provider Auth/Packages 39 (36). Internal Editor Pane 19 (18). Diff/Git/Worktrees 16. Terminal 4. Theme 5. Mobile/Routing/Nav 7. OpenSpec 13. File Preview & Media 10. Interactive Renderers ask_user 9. Status Bar & Banners 16. TOTAL 340 (320 NEW / 20 COVERED).

## Section = one surface, each a checkbox list of `[ ] NEW/[x] COVERED [target] <assertion>`
- Session Cards, List & Sidebar — testids: session-card-*, session-activity-bar/row/stop/overflow, background-drawer-*, header-app-bar, settings-btn, session-search-input, workspace-filter-input, queue-count-badge, session-status-icon, state-pill, worktree-pill, git-init/branch-btn, OPENSPEC, folder-toggle/ended, placeholder-session-card, drag-handle, sidebar-collapse, workspace-drag-handle, sortable-pinned-group, InlineRenameInput, mobile-card-attached-chip.
- Chat & Message Rendering — MarkdownContent, ToolCallStep, tool-collapse/show-full-output, tool-stop/force-stop-button, reasoning-block/body, pending-prompt/steer-card, chat-view-modified-pill/popover, scroll-to-bottom, chat-history-skeleton, ChatView, MinimalChatView, LinkifiedText.
- Composer & Command Input — composer-root (multiline, `/` `@` autocomplete, drafts, history walk), ImagePreviewStrip, stop/force-stop-button, model-selector/dropdown/refresh, send-button, queue-followup-*, InputComposer.
- Tool-Call Renderers & Output — tool-collapse-output, collapsed-group, BashToolRenderer, AgentToolRenderer, BashOutputCard, GenericToolRenderer, tool/bash-show-full-output, rich-diff, DiffView, EditToolRenderer, ReadToolRenderer.
- Flows — flow-agent-detail, flow-summaries/summary-toggle, flow-graph, flows-new-edit-button, flow-launch-run, SessionFlowActions, flow-activity-badge, FlowDashboard, flow-question-card, flow-questions-transcript, FlowAgentCard.
- Subagent Inspector — SubagentDetailView, SubagentPopoutPage.
- Goals & Automation — goal-chip, goal-control-pause, run-result-panel, create-automation-dialog, create-model-selector, trigger-categories, create-cron, automation-def, goals-board-new, goal-create-dialog, goal-form-*, goal-card-verdict, automation-run/triage, create-action-picker, automation-board-back, run-result-empty.
- Settings, Provider Auth & Packages — settings-content/nav-rail/save-bar, unsaved-count/dialog, discard-btn, bypass-urls-textarea, ProviderAuthSection, test-pill, proxy-toggle, default-model-input, second-port-input, listen-interface-select, trusted-networks-*, diagnostics-*, whats-new-update, package-search-input, installed-packages-section, package-op-banner, plugin-settings-row, RecommendedExtensions.
- Internal Editor Pane — markdown-preview, preview-tab, OpenFileButton, EditorTabs, MarkdownViewer, MonacoBuffer, md-dirty-dot, EditorFileTree, tree-toggle, editor-search-*, regex-toggle, live-preview-launch, preview-back.
- Diff, Git & Worktrees — worktree-base-combobox, worktree-source-pr/checkout/fork, worktree-gh-hint, worktree-new-branch-input, worktree-dialog-existing/orphan/branch-reuse, FileDiffView.
- Terminal — terminal-card, TerminalView.
- Theme — theme-toggle, theme-picker.
- Mobile, Routing & Navigation — mobile-kebab-btn, mobile-action-menu, LandingPage.
- OpenSpec — new-change-name, np-create, board-session-row, folder-openspec-section, folder-archive/specs-btn, folder-openspec-pending-spinner, board-filter-text, group-section-header, board-add-group, board-new-proposal, stepper-node.
- File Preview & Media — ImageLightbox, lightbox-backdrop, ZoomControls, MermaidBlock.
- Interactive Renderers (ask_user) — SelectRenderer, MultiselectRenderer, InputRenderer, ConfirmRenderer, AskUserToolRenderer.
- Status Bar & Banners — ConnectionStatusBanner, limit-exceeded-banner, error-banner-dismiss/retry, retry-banner-*, spawn-error/timeout-banner, Toast, context-usage-bar, TokenStatsBar, working-status.
