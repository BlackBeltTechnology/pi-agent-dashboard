# DOX — packages/client/src/lib/layout

Files in this directory. One row per source file. See change: fold-oversized-agents-directories.

| File | Purpose |
|------|---------|
| `editor-pane-state.ts` | Per-session pane state + localStorage persistence under `pi-dashboard:editor-pane:<sessionId>`. → see `editor-pane-state.ts.AGENTS.md` |
| `folder-pane-id.ts` | Namespaced localStorage key for the folder-scoped editor pane. Exports `FOLDER_PANE_PREFIX` (`folder:`), `folderPaneId(cwd)`, `isFolderPaneId(id)`. Disjoint from UUID session-id key space. See change: remove-external-editor-integration. |
| `mobile-depth.ts` | Computes `MobileShell` nav depth from route-match flags. Exports `MobileDepthInput`, `getMobileDepth(input)`… → see `mobile-depth.ts.AGENTS.md` |
| `rail-width.ts` | Per-session browse-rail width, localStorage `pi-dashboard:rail:<id>`, clamp [160,480], default 224. `useRailWidth`. Independent of outer split ratio. See change: split-editor-workspace. |
| `sidebar-dnd.ts` | Shared drag-and-drop helpers for sidebar `SessionList`. Exports `sameTypeClosestCenter` (type-aware collision… → see `sidebar-dnd.ts.AGENTS.md` |
| `split-state.ts` | Per-session split state (`open`,`ratio`,`orientation`), localStorage key `pi-dashboard:split:<id>`. → see `split-state.ts.AGENTS.md` |
| `use-terminal-pane-tabs.ts` | Terminal-tab slice for an editor pane. Hosts terminals as virtual `term:<id>` tabs (`terminal` viewer kind) beside file tabs. Pure planners `stripTermId`/`openTerminalIds`/`reconcileTerminalTabs`. Hook `useTerminalPaneTabs({cwd,terminals,autoSurface,paneState,dispatch,ensureOpen,on*})` → `{terminals,createTerminal,openTerminal,killTerminal,closeTerminalTab,renameTerminal,onTerminalTitle}`. Effect: D5 reconcile (drop stale `term:` tabs on set-change/mount, keyed off id-signature), D3 auto-surface (folder, open every live id) OR opt-in create→open (split, `pendingCreateRef`). Filters ephemeral. `closeTerminalTab`=closeByPath+kill (D4). Exports `TERM_TAB_PREFIX`, `TerminalPaneTabs`. See change: terminals-in-tabbed-panes. |
| `useSplitRatio.ts` | Split-divider drag math. `ratioFromPointer`, `clampWidth`, `useSplitRatio(containerRef,orientation,onRatioChange)`. See change: split-editor-workspace. |
