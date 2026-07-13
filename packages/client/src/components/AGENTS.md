# DOX — packages/client/src/components

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `ActionButton.tsx` | `<ActionButton action options pendingLabel>` thin wrapper over `useAsyncAction.bind`. → see `ActionButton.tsx.AGENTS.md` |
| `AddToWorkspaceMenu.tsx` | Popover menu listing workspaces plus `+ New workspace…` entry. Surfaced on folder action bar. Exports `AddToWorkspaceMenu`. Closes on outside click / Escape. |
| `agent-card-utils.ts` | Re-export shim. Forwards to `@blackbelt-technology/pi-dashboard-client-utils/agent-card-utils`. Symbol moved in change `complete-flows-plugin-migration` (Layer 0). |
| `AgentCardShell.tsx` | Re-export shim. Forwards to `@blackbelt-technology/pi-dashboard-client-utils/AgentCardShell`. Symbol moved in change `complete-flows-plugin-migration` (Layer 0). |
| `ArchiveBrowserView.tsx` | Browser view for archived OpenSpec changes. Exports `ArchiveBrowserView`. → see `ArchiveBrowserView.tsx.AGENTS.md` |
| `BashOutputCard.tsx` | Renders `!`/`!!`/slash-exec bash output card (command header, exit badge, output pre). → see `BashOutputCard.tsx.AGENTS.md` |
| `BranchCombobox.tsx` | Collapsed typeahead combobox. Trigger button + popover with filter input + `BranchListbox`. → see `BranchCombobox.tsx.AGENTS.md` |
| `BranchListbox.tsx` | Presentational branch list. Splits local/remote with separator. Current-branch `●` marker. Remote badge. → see `BranchListbox.tsx.AGENTS.md` |
| `BranchPicker.tsx` | Typeahead branch picker with keyboard navigation. Delegates row rendering + keyboard nav to `BranchListbox`. → see `BranchPicker.tsx.AGENTS.md` |
| `BranchSwitchDialog.tsx` | Modal dialog for git branch switch. Exports `BranchSwitchDialog`. → see `BranchSwitchDialog.tsx.AGENTS.md` |
| `ChangeSummaryBlock.tsx` | Per-turn change-summary block in chat stream. Collapses to `N files · +X −Y`. Gated on `displayPrefs.changeSummaryTable`. Deltas via `buildTurnSummaries`. See change: add-change-summary-table. |
| `ChatView.tsx` | `msg.view` rows render as `<PreviewCard target={msg.view}>` (right-aligned, `bubbleMax` width) BEFORE… → see `ChatView.tsx.AGENTS.md` |
| `ChatViewMenu.tsx` | Discord-style ⚙ View popover mounted in chat toolbar. Edits per-session `displayPrefsOverride` via… → see `ChatViewMenu.tsx.AGENTS.md` |
| `CloseWorktreeDialog.tsx` | Confirms worktree removal. Handles `active_sessions` guard: shuts listed sessions down then retries with… → see `CloseWorktreeDialog.tsx.AGENTS.md` |
| `CollapsedToolGroup.tsx` | Renders collapsed group of repeated tool calls. Exports `CollapsedToolGroup`. Expanded view iterates `group.rendered` — `toolResult`→`ToolCallStep`; `thinking`/non-empty `assistant`→inline text (`data-testid=collapsed-group-narration`); empty/separator skipped. Count badge = `group.messages` (toolResult-only). See change: collapse-tool-calls-across-narration. → see `CollapsedToolGroup.tsx.AGENTS.md` |
| `CommandFeedbackCard.tsx` | Inline card showing slash-command execution feedback. Exports `CommandFeedbackCard`. Status map `started`/`completed`/`error` → icon + color + label. Shows `message` only on `error`. |
| `CommandInput.tsx` | Chat composer textarea + autocomplete. Exports `CommandInput`, `parseViewCommand`, `shouldWalkFileQuery`,… → see `CommandInput.tsx.AGENTS.md` |
| `ComposerSessionActions.tsx` | Composer-side session-action strip. Hosts OpenSpec stepper + action buttons + Git groups. Hidden when no session selected. See change: redesign-session-card-and-composer. |
| `ConnectionStatusBanner.tsx` | Disconnection banner: appears only after active WebSocket has been non-`OPEN` for &gt;3s continuously; hidden… → see `ConnectionStatusBanner.tsx.AGENTS.md` |
| `ContextUsageBar.tsx` | Progress bar showing context-window usage. Exports `ContextUsageBar`. → see `ContextUsageBar.tsx.AGENTS.md` |
| `CopyButton.tsx` | Clipboard copy button with copied-state check icon. Exports `CopyButton`. Calls `navigator.clipboard.writeText`; resets state after 1500ms. Fails silently when Clipboard API unavailable. |
| `CountBadges.tsx` | Shared `+adds −dels` count badges. See change: add-change-summary-table. |
| `CwdGonePill.tsx` | Red `cwd gone` pill next to `WorktreePill` when `session.cwdMissing`. See change: add-worktree-lifecycle-actions. |
| `DashboardSpawnButtons.tsx` | Sidebar spawn-button stack. Exports `DashboardSpawnButtons`. → see `DashboardSpawnButtons.tsx.AGENTS.md` |
| `DiagnosticsSection.tsx` | Settings → Diagnostics. Fetches `/api/doctor`. Groups by section in fixed order, omits empty sections (no n/a… → see `DiagnosticsSection.tsx.AGENTS.md` |
| `DialogPortal.tsx` | Re-export shim. Forwards to `@blackbelt-technology/pi-dashboard-client-utils/DialogPortal`. Symbol moved in change `complete-flows-plugin-migration` (Layer 0). |
| `DiffFileTree.tsx` | Two-level file tree of changed files. Exports `DiffFileTree`, `FileSelection`. → see `DiffFileTree.tsx.AGENTS.md` |
| `DiffPanel.tsx` | Diff renderer for a selected file. Exports `DiffPanel`. Modes: `diff` (split/unified via… → see `DiffPanel.tsx.AGENTS.md` |
| `DiffView.tsx` | Minimal line-by-line unified-diff renderer. Exports `DiffView`. Colors `+` lines green, `-` lines red, `@@` hunk headers blue. No syntax highlighting. |
| `DraggableChangeRow.tsx` | dnd-kit draggable wrapper for OpenSpec change rows. Exports `DraggableChangeRow`. → see `DraggableChangeRow.tsx.AGENTS.md` |
| `EditorInstallGuide.tsx` | Install guide shown when `code-server` not found. Exports `EditorInstallGuide`. → see `EditorInstallGuide.tsx.AGENTS.md` |
| `EditorView.tsx` | Embedded VS Code editor panel. Exports `EditorView`. State: loading/ready/error/not_found. → see `EditorView.tsx.AGENTS.md` |
| `ElapsedBadge.tsx` | Elapsed-time badge. Exports `ElapsedBadge`, `formatElapsed`. Static when `duration` set; live ticking (1s interval) when only `startedAt` set. Formats <1s / Ns / Nm Ns / Nh Nm. |
| `ErrorBoundary.tsx` | Generic React error boundary. Exports `ErrorBoundary`. Catches render errors via `getDerivedStateFromError`;… → see `ErrorBoundary.tsx.AGENTS.md` |
| `ExploreDialog.tsx` | Modal dialog for OpenSpec Explore prompts. Textarea + `useImagePaste` for pasted images; `Cmd/Ctrl+Enter` sends `onSend(text, images?)`. Renders shared `ImagePreviewStrip`. Exports `ExploreDialog`. |
| `FileDiffView.tsx` | Split-pane session-diff view replacing `ChatView`. Left `DiffFileTree`, right `DiffPanel`; auto-selects first… → see `FileDiffView.tsx.AGENTS.md` |
| `FilePreviewContext.tsx` | Owns hoisted file-preview open-state above chat message list. → see `FilePreviewContext.tsx.AGENTS.md` |
| `FilePreviewOverlay.tsx` | Modal overlay. Reads file via `/api/file?cwd&path`. Routes by ext: `.md`/`.mdx` → `MarkdownContent`; image →… → see `FilePreviewOverlay.tsx.AGENTS.md` |
| `FirstLaunchDisplayModal.tsx` | One-shot preset picker (simple / standard / everything) shown when `/api/preferences/display.global ===… → see `FirstLaunchDisplayModal.tsx.AGENTS.md` |
| `FolderActionBar.tsx` | Sidebar folder-group action bar. Buttons: Terminals(N), Editor (code-server status-colored), native editors… → see `FolderActionBar.tsx.AGENTS.md` |
| `FolderNeedsYouPill.tsx` | Folder-header "N need you" rollup pill. Counts chat-routed ask_user child sessions; excludes widget-bar via… → see `FolderNeedsYouPill.tsx.AGENTS.md` |
| `FolderOpenSpecSection.tsx` | Slim single-line navigation entry `OpenSpec (N) →` to board route + Refresh + Specs/Archive buttons. → see `FolderOpenSpecSection.tsx.AGENTS.md` |
| `FolderSpawnButtons.tsx` | Stacked spawn buttons in folder header: `+ New Session` (green, always) + `+ New Worktree` (orange, gated by `showWorktree`). Min-height 44px on mobile. Exports `FolderSpawnButtons`. |
| `Gateway/` | Reusable Gateway (tunnel-providers) UI sections + hosts (dialog + settings page). → see `Gateway/AGENTS.md`. See change: add-tunnel-providers. |
| `FrontmatterProperties.tsx` | Obsidian-style YAML frontmatter Properties panel. Exports `extractFrontmatter` (leading `---` block parser),… → see `FrontmatterProperties.tsx.AGENTS.md` |
| `GroupedAttachDialog.tsx` | Grouped attach dialog with pill filters + collapsible sections for OpenSpec change selection. See change: add-openspec-change-grouping. |
| `ImageLightbox.tsx` | Portal full-screen image overlay with `useZoomPan` (wheel/pointer/touch zoom+pan, 0.25–10x). Closes on Escape + backdrop click via document listeners. Exports `ImageLightbox`. |
| `ImagePreviewStrip.tsx` | Pasted-image thumbnail grid + error banner shared by `CommandInput` and `ExploreDialog`. → see `ImagePreviewStrip.tsx.AGENTS.md` |
| `InlineRenameInput.tsx` | Autofocusing inline text input for rename. Enter → `onConfirm(trim)`, Escape/blur → `onCancel`; `confirmedRef` guards double-fire. Exports `InlineRenameInput`. |
| `InlineTerminalCard.tsx` | Inline interactive terminal card. Live → bounded `TerminalView` reattach via `terminalId`. Frozen → read-only xterm replays transcript. Independent from LLM. See change: add-inline-terminal-card. |
| `InstallBanner.tsx` | Mobile-only PWA install banner (`md:hidden`). Shows iOS Share→Add-to-Home-Screen hint or generic install… → see `InstallBanner.tsx.AGENTS.md` |
| `InstallButton.tsx` | Icon-only install-app button (`mdiDownload`). Renders null when `!canInstall` or `isInstalled`. Exports `InstallButton`. |
| `InstalledPackagesList.tsx` | Shared installed-packages list for Settings + Pi Resources. → see `InstalledPackagesList.tsx.AGENTS.md` |
| `KnownServersSection.tsx` | Settings section managing persisted known remote servers. → see `KnownServersSection.tsx.AGENTS.md` |
| `LandingPage.tsx` | Onboarding landing screen. Three-step gated flow: credentials → pin folder → spawn session; step states… → see `LandingPage.tsx.AGENTS.md` |
| `MarkdownContent.tsx` | ReactMarkdown renderer (chat/thinking/flow agent detail/READMEs/previews); KaTeX math + `pi-asset:` image… → see `MarkdownContent.tsx.AGENTS.md` |
| `MarkdownPreviewView.tsx` | Markdown preview pane with header (back + title + `MarkdownSearch`) and optional tab bar (`PreviewTab[]`). → see `MarkdownPreviewView.tsx.AGENTS.md` |
| `MarkdownSearch.tsx` | In-markdown fuzzy search overlay. `fuse.js` index over text blocks; exact-substring match first, fuzzy… → see `MarkdownSearch.tsx.AGENTS.md` |
| `MergeConfirmDialog.tsx` | Fetches `/api/git/worktree/diff-stat`; renders 5-line summary; delete-branch checkbox. → see `MergeConfirmDialog.tsx.AGENTS.md` |
| `MermaidBlock.tsx` | Renders fenced mermaid blocks via lazy `mermaid.render()`. → see `MermaidBlock.tsx.AGENTS.md` |
| `MissingRequiredBanner.tsx` | Top banner for missing `required` recommended extensions (`useRecommendedExtensions`). → see `MissingRequiredBanner.tsx.AGENTS.md` |
| `MobileActionMenu.tsx` | Kebab session-action menu for mobile. Rows: rename, hide/unhide, resume/fork, native editors, OpenSpec… → see `MobileActionMenu.tsx.AGENTS.md` |
| `MobileOverlay.tsx` | Mobile sidebar overlay (`md:hidden`): fixed backdrop + left 72-width panel. Exports `HamburgerButton` (menu trigger) and `MobileOverlay`. |
| `MobileShell.tsx` | Two-panel mobile shell (list + detail) with CSS-transform slide transitions and `useSwipeBack` (finger-tracked transform). Depth 0=list, 1=detail, 2=preview reuses detail panel. Exports `MobileShell`. |
| `ModelProxySection.tsx` | Settings panel section for model proxy. Exports `ModelProxySection`, `ModelProxyConfig`. → see `ModelProxySection.tsx.AGENTS.md` |
| `ModelSelector.tsx` | Variant C: grouped by provider, pinned ★ Favorites group, per-row star toggle, capability badges (🧠/👁… → see `ModelSelector.tsx.AGENTS.md` |
| `NetworkDiscoverySection.tsx` | Settings section for mDNS server discovery. Exports `NetworkDiscoverySection`. → see `NetworkDiscoverySection.tsx.AGENTS.md` |
| `NewChangeDialog.tsx` | Dialog launching `/skill:openspec-new-change`. Exports `NewChangeDialog`, `formatNewChangePrompt(name,… → see `NewChangeDialog.tsx.AGENTS.md` |
| `NewWorkspaceDialog.tsx` | Single-input dialog creating a workspace. Exports `NewWorkspaceDialog`. Validates trimmed name 1–80 chars (`NAME_MAX`), calls `onCreate(name)`. Auto-focuses input. See change: `folder-workspaces`. |
| `openspec-helpers.tsx` | Shared OpenSpec UI helpers. Exports `LETTER_MAP`, `artifactLetter(id)`, `statusColor(status)`,… → see `openspec-helpers.tsx.AGENTS.md` |
| `OpenSpecActivityBadge.tsx` | Session-card sub-badge showing active OpenSpec phase. Exports `OpenSpecActivityBadge`. → see `OpenSpecActivityBadge.tsx.AGENTS.md` |
| `OpenSpecBoardView.tsx` | Full-page OpenSpec kanban board. Route `/folder/:encodedCwd/openspec`. → see `OpenSpecBoardView.tsx.AGENTS.md` |
| `OpenSpecGroupManager.tsx` | CRUD manager: create/rename/recolor/reorder(dnd-kit)/delete groups. See change: add-openspec-change-grouping. |
| `OpenSpecGroupPicker.tsx` | Per-row chip+dropdown assigning change to group; inline create. See change: add-openspec-change-grouping. |
| `OpenSpecGroupPills.tsx` | Pill row filtering OpenSpec changes by group; single-select; "Manage groups…" link. See change: add-openspec-change-grouping. |
| `OpenSpecGroupSection.tsx` | Collapsible group section header with color swatch, name, count, body slot. See change: add-openspec-change-grouping. |
| `OpenSpecGroupsSettingsSection.tsx` | Settings section listing cwds with per-cwd group manager. See change: add-openspec-change-grouping. |
| `OpenSpecProfileSection.tsx` | Settings section. Sets global OpenSpec profile (core/expanded/custom) + workflow multiselect. → see `OpenSpecProfileSection.tsx.AGENTS.md` |
| `OpenSpecStepper.tsx` | 7-node pills+lines stepper. Exports OpenSpecStepper, deriveStepperState. Variants sidebar \| compact. See change: redesign-session-card-and-composer. |
| `PackageBrowser.tsx` | Main package management surface. Exports `PackageBrowser`. → see `PackageBrowser.tsx.AGENTS.md` |
| `PackageCard.tsx` | Search-result card for one npm package. Exports `PackageCard`. → see `PackageCard.tsx.AGENTS.md` |
| `PackageInstallConfirmDialog.tsx` | Pre-install confirmation dialog. Exports `PackageInstallConfirmDialog`. Shows source + optional name + scope. → see `PackageInstallConfirmDialog.tsx.AGENTS.md` |
| `PackageReadmeDialog.tsx` | Dialog fetching + rendering a package README. Exports `PackageReadmeDialog`. → see `PackageReadmeDialog.tsx.AGENTS.md` |
| `PackageRow.tsx` | Generic installed-package row used across unified packages sections. Exports `PackageRow`, `PackageRowProps`. → see `PackageRow.tsx.AGENTS.md` |
| `PairLanding.tsx` | Browser `/pair` landing — phone-camera counterpart of the Electron shell `PairView`. Exports `PairLanding`. Decodes payload from `location.hash` (`decodePayloadString`); runs challenge (pin `fingerprint == payload.id`, refuse on mismatch) → redeem → shows confirm code on this phone → poll → `storeDeviceBearer` → `window.location.href="/"`. Error+restart affordance on missing/invalid hash, expired/rejected poll. Same-origin `/api/pair/*` (public routes). D12 desktop typed-approval unchanged. Mounted by `main.tsx` when `pathname === "/pair"` (pre-auth, no WS). See change: make-pairing-qr-camera-scannable. |
| `PairingView.tsx` | Settings→Security operator pairing view. Exports `PairingView`. Fetches `GET /api/pair/payload`; renders QR (`qrcode` idiom) + base64url copy-string + fingerprint + 60s TTL countdown + `urls[]`. `no_reachable_endpoint`→empty state (start tunnel + localhost note; never implies plain-http LAN pairs). Typed confirm-code → `approvePairing` (`POST /api/pair/approve`). NOTE: still renders a bare-payload (non-scannable) QR + own `encodePayloadString` — not migrated to the scannable deep link (follow-up to make-pairing-qr-camera-scannable). See change: wire-nonzrok-pairing-view. |
| `PathPicker.tsx` | Reusable keyboard-first path picker with typeahead directory list. → see `PathPicker.tsx.AGENTS.md` |
| `PiLogo.tsx` | Inline SVG brand mark (geometric Π). Exports `PiLogo`. Props: `size` (default 24), `className`, `title`. → see `PiLogo.tsx.AGENTS.md` |
| `PinDirectoryDialog.tsx` | Dialog to pin directory (wraps PathPicker) |
| `PiUpdateBadge.tsx` | Header badge counting available pi-core updates. Exports `PiUpdateBadge`. → see `PiUpdateBadge.tsx.AGENTS.md` |
| `PiVersionAdvisory.tsx` | NEW. Settings→General advisory. Reads `usePiCompatibility`. → see `PiVersionAdvisory.tsx.AGENTS.md` |
| `PlaceholderSessionCard.tsx` | Skeleton card shown while a new session spawns. Exports `PlaceholderSessionCard`. Pulse-animated bars mimicking `SessionCard` layout; shows "Starting new session…" text. |
| `PairedDevicesSection.tsx` | Settings → Security → Paired Devices. Lists bearer-paired devices (label, last-seen), per-device revoke-with-confirm (deletes registry row via `revokePairedDevice`). Exports `PairedDevicesSection`. See change: add-server-keypair-pairing. |
| `PluginSettingsHost.tsx` | Wraps `SettingsSectionByPluginSlot` from dashboard-plugin-runtime so per-plugin settings sections mount inside Plugins tab below activation row. See change: add-plugin-activation-ui. |
| `PluginsSection.tsx` | Settings ▸ Plugins activation list. Renders every plugin (enabled or not) with display name, description,… → see `PluginsSection.tsx.AGENTS.md` |
| `PluginStalenessBanner.tsx` | Banner on stale plugin bundle. Fetches `/api/health.bundleHash` on mount. → see `PluginStalenessBanner.tsx.AGENTS.md` |
| `PrCombobox.tsx` | Typeahead combobox for PR selection. Fetches `GET /api/git/pull-requests` lazily on first open. → see `PrCombobox.tsx.AGENTS.md` |
| `PreviewCard.tsx` | Inline chat-message card for `/view` rows. Header: icon (per renderer kind) + target label + `⤢ expand`… → see `PreviewCard.tsx.AGENTS.md` |
| `PreviewOverlayView.tsx` | Full-viewport shell for overlay routes `/folder/:cwd/view?path=` + `/pi-view?url=`. → see `PreviewOverlayView.tsx.AGENTS.md` |
| `ProcessList.tsx` | Repurposed as BackgroundProcessesDrawer (filename kept). Renders bridge PGID scan as collapsible drawer under… → see `ProcessList.tsx.AGENTS.md` |
| `ProjectInitButton.tsx` | Presentational "Set up project" scaffold button (indigo, `mdiFolderPlusOutline`, testid `project-init-btn`). Props `{ cwd, status, onInitializeProject? }`. Renders iff `status.hasHook===false && status.configured===false && !!onInitializeProject` (strict `===false`; absent `configured`/state ③ → nothing). Click → `onInitializeProject(cwd)` spawns interactive project-init session. Split out of `WorktreeInitButton`'s polymorphic no-hook branch. See change: distinguish-initialize-actions. |
| `ProposeDialog.tsx` | Name-only dialog launching `/skill:openspec-propose`. Exports `ProposeDialog`, `formatProposePrompt(name)`. → see `ProposeDialog.tsx.AGENTS.md` |
| `ProviderAuthSection.tsx` | Settings section for LLM provider auth. Exports `ProviderAuthSection`. → see `ProviderAuthSection.tsx.AGENTS.md` |
| `QrCodeDialog.tsx` | Dialog showing tunnel URL as QR code for mobile access. Exports `QrCodeDialog`. ORPHANED by add-tunnel-providers: `TunnelButton` now opens `Gateway/GatewayDialog` instead; retained (still unit-tested) but no longer mounted. → see `QrCodeDialog.tsx.AGENTS.md` |
| `QueuePanel.tsx` | Read-only follow-up cycler. Pi ExtensionAPI exposes no queue mutation (verified through pi 0.76.0). → see `QueuePanel.tsx.AGENTS.md` |
| `RawEventCard.tsx` | Collapsible card showing one raw event in the event log. Exports `RawEventCard`. → see `RawEventCard.tsx.AGENTS.md` |
| `RecommendedExtensions.tsx` | Panel rendering curated recommended extensions. Exports `RecommendedExtensions`. Props: `scope`, `cwd`. → see `RecommendedExtensions.tsx.AGENTS.md` |
| `ResizableSidebar.tsx` | Drag-to-resize + collapse sidebar shell. Takes `SidebarState` (from `useSidebarState`). Clamp width 180–500px. Collapsed strip width 28px. Exports `ResizableSidebar`. |
| `ResourceCard.tsx` | One pi-resource as a card. Exports `ResourceCard`. Scope/source badges, path line, `ActivationToggle` (omitted for `agent` — no pi activation dim). Agent variant: `◆ model`+`🔧 tools` badges. Theme variant: swatch strip from `resource.colors` replaces desc. See change: resources-card-tabs. |
| `ResourceCardGrid.tsx` | Auto-fill grid of `ResourceCard` for one type. Exports `ResourceCardGrid`, `ResourceType`, `countResources`. Flattens loose+package resources across `scopes`; search box + optional `All/Local/Global` scope filter. `themes` not in scope → empty. See change: resources-card-tabs. |
| `ResourceGridPanel.tsx` | Loading/error/refresh chrome + `ResourceReloadBanner` around `ResourceCardGrid`. Exports `ResourceGridPanel`. Shared by Directory Settings (local+global, filter) + Settings (global-only, `◇ global` pill). Caller owns the `usePiResources` fetch. See change: resources-card-tabs. |
| `resource-tree.tsx` | Activation primitives reused by `ResourceCard`. Exports `ActivationToggle` (`role=switch`) + `ResourceReloadBanner`. Legacy `MergedScopeSection`/`ResourceItem`/`ResourceGroup`/`PackageItem` tree removed once both surfaces moved to cards. See change: folder-resource-activation-toggle, resources-card-tabs. |
| `RetriedErrorBadge.tsx` | Compact badge collapsing a tool error→retry pair into one line. Click expands to full `ToolCallStep`. → see `RetriedErrorBadge.tsx.AGENTS.md` |
| `RichDiff.tsx` | Pure rich-diff rendering primitive over `@git-diff-view/react` + lowlight. → see `RichDiff.tsx.AGENTS.md` |
| `SearchableSelectDialog.tsx` | Re-export shim. Forwards to `@blackbelt-technology/pi-dashboard-client-utils/SearchableSelectDialog`. Symbol migrated in change `complete-flows-plugin-migration` (Layer 0). |
| `ServerSelector.tsx` | Server selector dropdown showing persisted known servers. → see `ServerSelector.tsx.AGENTS.md` |
| `SessionActivityBar.tsx` | Pure component. Renders one row per unresolved `bash` toolCall: `⏵ <command> <elapsed> [⏹]`. → see `SessionActivityBar.tsx.AGENTS.md` |
| `SessionBanner.tsx` | Composed session-status banner. Error anchor (red) + retry sub-line (amber) in one surface, driven by… → see `SessionBanner.tsx.AGENTS.md` |
| `SessionCard.tsx` | Gates both `<ContextUsageBar>` mounts on `useDisplayPrefs(session.id).contextUsageBar` → see `SessionCard.tsx.AGENTS.md` |
| `SessionDiffContext.tsx` | `SessionDiffProvider` — one `useSessionDiff` per session, shared by rail/diff-tab/takeover; refreshes on edit signal. See change: add-change-summary-table. |
| `SessionHeader.tsx` | Session chat header (desktop + mobile). Renders name/rename (`InlineRenameInput`), model, thinking level, pi… → see `SessionHeader.tsx.AGENTS.md` |
| `SessionList.tsx` | Main sidebar session list. DnD-ordered (`@dnd-kit`) pinned/unpinned + workspace tiers, folder grouping,… → see `SessionList.tsx.AGENTS.md` |
| `SessionOpenSpecActions.tsx` | OpenSpec action panel for a session (attach/detach, New/Propose/Explore, Continue/FF/Apply/Verify/Archive,… → see `SessionOpenSpecActions.tsx.AGENTS.md` |
| `SessionSidebar.tsx` | Legacy compact session sidebar. Active + ended (`<details>`) lists with status dots, source icons, model,… → see `SessionSidebar.tsx.AGENTS.md` |
| `SessionSplitView.tsx` | Connects context → `SplitWorkspace` (editor slot=`EditorPane`). `SplitRouteSync` opens split from `/session/:id/editor` deep-link via `openInSplit`. See change: split-editor-workspace. |
| `SessionSubcard.tsx` | Inset titled panel wrapper grouping session-card sections (OPENSPEC, WORKSPACE, PROCESS, MEMORY, FLOWS). → see `SessionSubcard.tsx.AGENTS.md` |
| `SettingsPanel.tsx` | Settings UI: left-nav rail + page content… → see `SettingsPanel.tsx.AGENTS.md` |
| `SkillInvocationCard.tsx` | Collapsible card rendering a `<skill>` user invocation. Purple-tinted, wrench icon, default-collapsed body… → see `SkillInvocationCard.tsx.AGENTS.md` |
| `SortablePinnedGroup.tsx` | dnd-kit sortable wrapper for a pinned folder group (`data.type: "pinned-group"`), drop indicator via… → see `SortablePinnedGroup.tsx.AGENTS.md` |
| `SortableSessionCard.tsx` | dnd-kit sortable wrapper for a session card (`data.type: "session"`). Drag handle props fed to descendant `SessionCard` via `DragHandleCtx`. Exports `SortableSessionCard`, `useSessionCardDragHandle`. |
| `SortableWorkspace.tsx` | dnd-kit sortable wrapper for a workspace tier (`data.type: "workspace"`), drop indicator. → see `SortableWorkspace.tsx.AGENTS.md` |
| `SortableWorkspaceFolder.tsx` | dnd-kit sortable wrapper for a folder inside a workspace (`data.type: "workspace-folder"`, carries `wsId`). → see `SortableWorkspaceFolder.tsx.AGENTS.md` |
| `SpawnErrorBanner.tsx` | Renders structured spawn error: code→hint, preflight reasons, stderr details, timeout banner. See change: spawn-failure-diagnostics. |
| `SpawnErrorToastHost.tsx` | App-level toast container for off-screen `spawn_error` events. → see `SpawnErrorToastHost.tsx.AGENTS.md` |
| `SpecsBrowserView.tsx` | Full-page main specs reader for a cwd. Combobox jump-to-spec + `MarkdownPreviewView` (searchable). Backed by `useMainSpecsReader`. Props: `cwd`, `onBack`. Exports `SpecsBrowserView`. |
| `SplitDivider.tsx` | Draggable divider (outer chat/editor + inner rail). Reports pointer coord; orientation-aware cursor. See change: split-editor-workspace. |
| `SplitToggleButton.tsx` | Session-header split/unsplit toggle. Consumes context; renders null without session. See change: split-editor-workspace. |
| `SplitWorkspace.tsx` | Pure layout. Chat slot alone when closed; chat+divider+editor when open. Horizontal desktop / vertical stack mobile. Flex-grow from ratio. See change: split-editor-workspace. |
| `SplitWorkspaceContext.tsx` | Per-session provider. Lifts `useSplitState`+`useEditorPaneState`. → see `SplitWorkspaceContext.tsx.AGENTS.md` |
| `StatePill.tsx` | Color-coded OpenSpec ChangeState pill (`PLANNING`=zinc, `READY`=blue, `IMPLEMENTING`=amber, `COMPLETE`=green)… → see `StatePill.tsx.AGENTS.md` |
| `StatusBar.tsx` | Forwards favorites + onToggleFavorite props to ModelSelector → see `StatusBar.tsx.AGENTS.md` |
| `TasksPopover.tsx` | Modal popover listing parseable tasks from an attached change's `tasks.md`, grouped by heading, native… → see `TasksPopover.tsx.AGENTS.md` |
| `TerminalCard.tsx` | Sidebar terminal card. Cyan border, console icon, name (`InlineRenameInput` rename), relative age,… → see `TerminalCard.tsx.AGENTS.md` |
| `TerminalsView.tsx` | Tabbed terminal content area for a cwd. Filters ephemeral terminals. → see `TerminalsView.tsx.AGENTS.md` |
| `TerminalView.tsx` | xterm.js terminal emulator wrapper with keep-alive. Adds `heightPx?` bounded fixed-height variant for inline… → see `TerminalView.tsx.AGENTS.md` |
| `ThemePicker.tsx` | Palette dropdown for theme selection. Lists `THEMES` with color swatches, flip-aware (`usePopoverFlip`), outside-click close. Reads/writes `useThemeContext`. Exports `ThemePicker`. |
| `ThemeProvider.tsx` | React context provider wrapping `useTheme` hook. Exports `ThemeProvider`, `useThemeContext` (throws outside provider). |
| `ThemeToggle.tsx` | Exports `ThemeToggle`. Three-button light/system/dark switcher; reads `preference`/`setPreference` from `useThemeContext`. Renders mdi icons, `data-testid="theme-toggle"`. |
| `ThinkingBlock.tsx` | Exports `ThinkingBlock`. Collapsible reasoning panel; props `content`, `isStreaming`, `defaultExpanded`,… → see `ThinkingBlock.tsx.AGENTS.md` |
| `ThinkingLevelSelector.tsx` | Thinking-level picker. Optional prop `supportedLevels` filters `THINKING_LEVELS` to supported set (canonical… → see `ThinkingLevelSelector.tsx.AGENTS.md` |
| `Toast.tsx` | `ToastMessage.variant?: "error"|"success"|"info"` default "error". `useToast.showToast(text, variant?)` additive. Success green, info neutral, error red. See change: add-async-action-feedback. |
| `TokenStatsBar.tsx` | Exports `TokenStatsBar`. Renders per-turn butterfly chart (input up / output down) + stats panel +… → see `TokenStatsBar.tsx.AGENTS.md` |
| `ToolBurstGroup.tsx` | Renders temporal BURST group (data from `lib/group-tool-bursts.ts`). Exports `ToolBurstGroup({burst,toolContext,turnActive})`. ONE unified `<GroupFrame>` (slots leftGlyph/title/meta/motionClass/chevron/body) routes all 4 states — no per-state branch. `expanded = override ?? (prefs.toolGroupDefaultCollapsed ? false : isRunning)`; live header/animation key off `isRunning` not `expanded`. Header: running `⟳ Working · N done · $ <live cmd>` + shimmer (`tool-group-shimmer`) + spin-pulse; done·1-call `<toolIcon> <getSummary> · dur` (`tool-burst-summary`, NOT `1 tool calls`); done·N `✓ N tool calls` + per-kind icon+count chips (`tool-burst-breakdown`) + dur; `N failed` badge (`tool-burst-failed-badge`) when any member errored; completion flash (`tool-group-flash`) on running→done flip. Counts over UNDERLYING calls (nested ×N contributes N). Body grows in flow — NO max-height/inner scroll; absorbed `thinking`→real `<ThinkingBlock>` (gated by `prefs.reasoning`, threads `turnActive`), non-empty `assistant`→narration `<div>`. Prefs-gated via `toolCallPrefKey`; null if zero visible. See changes: group-tool-call-bursts, collapse-tool-calls-across-narration, enhance-tool-call-grouping. |
| `ToolCallStep.tsx` | Renders tool-call card. Adds `showResultBody?: boolean` prop (default `true`); when `false` hides result body… → see `ToolCallStep.tsx.AGENTS.md` |
| `ToolsSection.tsx` | Settings → General → **Tools** section. One row per registered tool: status badge, source, truncated path,… → see `ToolsSection.tsx.AGENTS.md` |
| `TunnelButton.tsx` | Exports `TunnelButton`. Unified tunnel/QR button. Polls `/api/tunnel-status` every 30s. → see `TunnelButton.tsx.AGENTS.md` |
| `UnifiedPackagesSection.tsx` | Exports `UnifiedPackagesSection`. Settings → Packages "Pi Ecosystem" section. → see `UnifiedPackagesSection.tsx.AGENTS.md` |
| `WhatsNewDialog.tsx` | Exports `WhatsNewDialog` + `WhatsNewDialogProps`. Modal rendering parsed CHANGELOG between two versions. → see `WhatsNewDialog.tsx.AGENTS.md` |
| `WhatsNewPackageRow.tsx` | Exports `WhatsNewPackageRow` + `WhatsNewPackageRowProps`. → see `WhatsNewPackageRow.tsx.AGENTS.md` |
| `WorkspaceHeader.tsx` | Exports `WorkspaceHeader`. Header row for workspace container: name (double-click → `InlineRenameInput`),… → see `WorkspaceHeader.tsx.AGENTS.md` |
| `WorktreeActionsMenu.tsx` | Exports `WorktreeActionsMenu` + `__resetGhAvailableCache`. → see `WorktreeActionsMenu.tsx.AGENTS.md` |
| `WorktreeInitButton.tsx` | Hook-run-only Initialize control per directory/worktree row. Accepts shared `status`/`onStatusChange` (row-owned probe) or self-probes standalone. friendlier-worktree-init: store-driven — reads `useInitRun(cwd)`, renders `WorktreeInitChip` (running/done/failed) instead of raw `<pre>`; labels "Review & trust changes" when `needsInit:false && trusted:false` (hook edited); subscribes by cwd. See change: friendlier-worktree-init. → see `WorktreeInitButton.tsx.AGENTS.md` |
| `WorktreeInitChip.tsx` | Presentational worktree-init status chip (variant A/D1). running → `⚙ Initializing… · {elapsed}` + slim indeterminate bar + ghost lastLine + collapsed `<details>` log; done → green `✓ Initialized`; failed → red `✕ {label} · {code}` + Retry + opt-in log (sticky). `variant` manual/auto. Reused by button, session-card sub-state, stack. See change: friendlier-worktree-init. |
| `WorktreeInitStack.tsx` | Concurrent-init corner surface (variant E2). Reads `useAllInitRuns()`; renders only for ≥ 2 runs. Summary header + ≤ 4 rows (`+N more`) per cwd; failed row holds it open with Dismiss (`initStore.dismiss`). See change: friendlier-worktree-init. |
| `WorktreeSpawnDialog.tsx` | Fullscreen `+Worktree` dialog. Lists existing worktrees (one-click `Spawn →`) + create-new form (base picker,… → see `WorktreeSpawnDialog.tsx.AGENTS.md` |
| `ZoomControls.tsx` | Re-export shim. Re-exports `ZoomControls` from `@blackbelt-technology/pi-dashboard-client-utils/ZoomControls`. Symbol migrated in change `complete-flows-plugin-migration` (Layer 0). |
| `ZrokInstallGuide.tsx` | Exports `ZrokInstallGuide`. Tunnel setup install guide. `useServerOs` fetches `/api/tunnel-status` for… → see `ZrokInstallGuide.tsx.AGENTS.md` |
