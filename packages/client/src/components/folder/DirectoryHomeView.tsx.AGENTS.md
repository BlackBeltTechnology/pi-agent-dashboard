# DirectoryHomeView.tsx — index

Directory home page for the bare `/folder/:encodedCwd` route. SUPERSEDED layout: see `redesign-directory-home-split` below. Renders for ANY groupable cwd. Exports `DirectoryHomeView`, `DirectoryHomeViewProps`, `SpawnFromHomeOpts`. See change: add-directory-home-page, enable-workspace-folder-home-page.

See change: redesign-folder-workspace-add-flow — the eligibility guard is REMOVED. Gone: the `pinnedDirectories`/`workspaceFolders`/`pinnedDirectoriesLoaded`/`workspacesLoaded`/`onPinDirectory` props, the cold-load loading gate (`directory-home-loading`), the miss notice + pin CTA (`directory-home-not-pinned`), and the `directoryHome.notPinnedTitle`/`notPinnedBody`/`pinCta` i18n keys. Props are now just `cwd`, `sessions`, `onSpawnSession`, `onSelectSession`, and the quick-action openers. App drops the `workspaceFolderSet` memo + the two loaded flags (`pinnedDirsLoaded`/`workspacesLoaded` and their `useMessageHandler` setters).

## fix-popover-pane-bounded-height

- Mounts `PopoverBoundaryProvider value={paneRef}` on its own `directory-home` scroll pane (`flex-1 flex flex-col min-w-0 min-h-0 overflow-auto`), so the focal `CommandInput`'s popovers (composer dropdown, model / thinking selectors) measure the pane instead of the viewport.

## redesign-directory-home-split

- Pre-session pane inside Chat|Split|Editor. Header (name, path, `LayoutModeSwitch`, gear `directory-home-settings`) above `SplitWorkspace(chat=pane, editor=<EditorPane/>)`. Hosts split only when `useOptionalSplitWorkspace()` sessionId `isFolderPaneId`; else pane alone (mobile, isolated tests).
- Pane = starters (`flex-1 min-h-0 overflow-auto`) then `CommandInput` as LAST child → `max-h-[40%]` resolves vs pane → natural height (#877).
- Props: `cwd`, `commands`, `commandsOrigin`, `models`, `defaultModel`, `defaultThinkingLevel`, `favorites`, `onToggleFavorite`, `onOpenProviderSettings`, `folderGitMap`, `sessionCount`, `onSpawnSession` (returns `requestId`), `failedSpawn`, `onWorktreeSpawnStart/Abort/Spawned`, `onOpenSettings`. GONE: `sessions`, `onSelectSession`, `onOpenTerminals`, `onOpenEditor`; testids `directory-home-session-*`, `directory-home-open-*`.
- Send: `onSpawnSession(cwd, undefined, {initialPrompt, model?, thinkingLevel?})`. Default model/thinking pre-selected, tagged `default`, sent explicitly. Run-location `<select data-testid="run-location">` only when `folderGitMap.get(cwd)` is a string; `New worktree…` opens `WorktreeSpawnDialog` → exactly one spawn for the worktree path.
- In-flight: ref guard (double Enter = one spawn); `failedSpawn.requestId` match → re-enable + restore draft. Page never navigates (App owns).

- YOLO signal is the dock footer: `<ComposerDock session={undefined} cwd openLane={null}/>` replaces `YoloComposerStrip` directly above `CommandInput` (no lanes, `data-footer-only`). See change: add-composer-dock (8.2).
