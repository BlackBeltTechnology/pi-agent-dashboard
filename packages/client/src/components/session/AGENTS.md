# DOX — packages/client/src/components/session

Files in this directory. One row per source file. See change: fold-oversized-agents-directories.

| File | Purpose |
|------|---------|
| `agent-card-utils.ts` | Re-export shim. Forwards to `@blackbelt-technology/pi-dashboard-client-utils/agent-card-utils`. Symbol moved in change `complete-flows-plugin-migration` (Layer 0). |
| `AgentCardShell.tsx` | Re-export shim. Forwards to `@blackbelt-technology/pi-dashboard-client-utils/AgentCardShell`. Symbol moved in change `complete-flows-plugin-migration` (Layer 0). |
| `ComposerSessionActions.tsx` | Composer-side session-action strip. Hosts OpenSpec artifact chips + action buttons + Git groups. → see `ComposerSessionActions.tsx.AGENTS.md` |
| `ContextUsageBar.tsx` | Progress bar showing context-window usage. Exports `ContextUsageBar`. → see `ContextUsageBar.tsx.AGENTS.md` |
| `CountBadges.tsx` | Shared `+adds −dels` count badges. See change: add-change-summary-table. |
| `DashboardSpawnButtons.tsx` | Sidebar spawn-button stack. Exports `DashboardSpawnButtons`. → see `DashboardSpawnButtons.tsx.AGENTS.md` |
| `ElapsedBadge.tsx` | Elapsed-time badge. Exports `ElapsedBadge`, `formatElapsed`. Static when `duration` set; live ticking (1s interval) when only `startedAt` set. Formats <1s / Ns / Nm Ns / Nh Nm. |
| `MissingRequiredBanner.tsx` | Top banner for missing `required` recommended extensions (`useRecommendedExtensions`). → see `MissingRequiredBanner.tsx.AGENTS.md` |
| `PlaceholderSessionCard.tsx` | Skeleton card shown while a new session spawns. Exports `PlaceholderSessionCard`. Pulse-animated bars mimicking `SessionCard` layout; shows "Starting new session…" text. |
| `QueuePanel.tsx` | Read-only follow-up cycler. Pi ExtensionAPI exposes no queue mutation (verified through pi 0.76.0). → see `QueuePanel.tsx.AGENTS.md` |
| `RecoveryOfferHost.tsx` | Sticky top-right cold-start recovery-offer notification; never auto-dismisses. Reopen routes candidates through resume; dismiss DURABLE (`recovery_dismiss` consumes the on-disk liveness marker — no re-appear on reconnect/reload/restart). See change: fix-recovery-offer-dismiss-and-phantom-reopen. |
| `RetriedErrorBadge.tsx` | Compact badge collapsing a tool error→retry pair into one line. Click expands to full `ToolCallStep`. → see `RetriedErrorBadge.tsx.AGENTS.md` |
| `SessionActivityBar.tsx` | Pure component. Renders one row per unresolved `bash` toolCall: `⏵ <command> <elapsed> [⏹]`. → see `SessionActivityBar.tsx.AGENTS.md` |
| `SessionBanner.tsx` | Composed session-status banner. Error anchor (red) + retry sub-line (amber) in one surface, driven by… → see `SessionBanner.tsx.AGENTS.md` |
| `SessionCard.tsx` | Gates both `<ContextUsageBar>` mounts on `useDisplayPrefs(session.id).contextUsageBar` → see `SessionCard.tsx.AGENTS.md` |
| `SessionHeader.tsx` | Session chat header (desktop + mobile). Renders name/rename (`InlineRenameInput`), model, thinking level, pi… → see `SessionHeader.tsx.AGENTS.md` |
| `SessionList.tsx` | Main sidebar session list. DnD-ordered (`@dnd-kit`) pinned/unpinned + workspace tiers, folder grouping,…… → see `SessionList.tsx.AGENTS.md` |
| `SessionSidebar.tsx` | Legacy compact session sidebar. Active + ended (`<details>`) lists with status dots, source icons, model,… → see `SessionSidebar.tsx.AGENTS.md` |
| `SessionSubcard.tsx` | Inset titled panel wrapper grouping session-card sections (OPENSPEC, WORKSPACE, PROCESS, MEMORY, FLOWS). → see `SessionSubcard.tsx.AGENTS.md` |
| `SortablePinnedGroup.tsx` | dnd-kit sortable wrapper for a pinned folder group (`data.type: "pinned-group"`), drop indicator via… → see `SortablePinnedGroup.tsx.AGENTS.md` |
| `SortableSessionCard.tsx` | dnd-kit sortable wrapper for a session card (`data.type: "session"`). Drag handle props fed to descendant `SessionCard` via `DragHandleCtx`. Exports `SortableSessionCard`, `useSessionCardDragHandle`. |
| `SpawnErrorBanner.tsx` | Renders structured spawn error: code→hint, preflight reasons, stderr details, timeout banner. → see `SpawnErrorBanner.tsx.AGENTS.md` |
| `SpawnErrorToastHost.tsx` | App-level toast container for off-screen `spawn_error` events. Raw red → `--severity-error-*`. → see `SpawnErrorToastHost.tsx.AGENTS.md` |
| `StatePill.tsx` | Color-coded OpenSpec ChangeState pill (`PLANNING`=zinc, `READY`=blue, `IMPLEMENTING`=amber, `COMPLETE`=green)… → see `StatePill.tsx.AGENTS.md` |
| `TasksPopover.tsx` | Modal popover listing parseable tasks from an attached change's `tasks.md`, grouped by heading, native… → see `TasksPopover.tsx.AGENTS.md` |
| `TokenStatsBar.tsx` | Exports `TokenStatsBar`. Renders per-turn butterfly chart (input up / output down) + stats panel +… → see `TokenStatsBar.tsx.AGENTS.md` |
