## Context

**Terminals today** live in `App` state: `terminals: Map<id, TerminalSession>` (each has `id`, `cwd`, `title`, `ephemeral`). Non-ephemeral terminals surface through the standalone `TerminalsView` (mounted at `/folder/:cwd/terminals`), which renders its own tab strip + one `TerminalView` (an xterm that attaches to the server PTY over WS by `terminalId`). Ephemeral terminals back the inline `!!` chat cards and are explicitly excluded from content-area tabs. Create/kill/rename/title flow through `App` handlers (`handleCreateTerminal(cwd)`, `handleKillTerminal(id)`, …).

**The editor pane tab system** (`editor-pane/`) already owns everything `TerminalsView` reimplements: a tab strip (`EditorTabs`), a pure reducer with **virtual (non-file) tabs** — `live:<url>` and `diff:<path>` — deduped by full path, and a `viewer-registry` mapping each `ViewerKind` to a component. `SplitWorkspaceContext` lifts the pane state and carries the pane `cwd`. `TerminalView` is already a self-contained component given a `terminalId` + `onClose`/`onTitle` — it needs no file content.

The change `remove-external-editor-integration` adds a **folder-scoped editor pane** at `/folder/:cwd/editor` (same `EditorPane`, rooted at a folder cwd). That pane is the natural home for the folder-level terminal surface — so the two "editor pane" hosts (session split + folder pane) both gain terminal tabs from one mechanism.

## Goals / Non-Goals

**Goals:**
- One terminal-hosting mechanism: a `terminal` viewer kind + `term:<id>` virtual tab, reused by both panes.
- Session split hosts terminal tabs (cwd = session cwd); folder pane hosts terminal tabs (cwd = folder cwd) — the latter replaces `TerminalsView`.
- Remove the `/folder/:cwd/terminals` route + `TerminalsView`.
- Preserve terminal identity, server PTY/WS lifecycle, rename, kill, title, and terminal-limit behavior unchanged.
- Leave inline `!!` terminal cards (ephemeral) untouched.

**Non-Goals:**
- No change to the terminal server, PTY spawning, or the terminal WS protocol.
- No cross-cwd terminal tabs (a pane shows only its own cwd's terminals).
- No drag-a-terminal-between-panes.

## Decisions

### D1 — `term:<terminalId>` virtual tab + `terminal` ViewerKind
Add `"terminal"` to the `ViewerKind` union (`packages/shared/src/file-kind.ts`) and register it in `viewer-registry`. A terminal opens via `dispatch({ type: "openFile", path: "term:"+id, viewer: "terminal" })` — mirroring the `live:`/`diff:` idiom, deduped by path. The registry entry parses the id out of the path and renders `<TerminalView terminalId={id} visible … />` inside a flex-column tab body (no `heightPx`, so it fills).
- **Why over a parallel terminal tab strip:** reuses `EditorTabs`, reorder, close, activation, and persistence for free (DRY); one tab model, not two.

### D2 — Terminal handlers reach the viewer via pane context, not `ViewerProps`
`ViewerProps` is `{ cwd, path, kind, mimeType, size, line? }` — it has no terminal handlers. Extend the pane context (a terminal slice on `SplitWorkspaceContext`, or a sibling `TerminalPaneContext`) exposing, for the pane's `cwd`: the `TerminalSession[]`, `createTerminal()`, `killTerminal(id)`, `renameTerminal(id,title)`, `onTitle(id,title)`. The `terminal` viewer reads this by the id parsed from its tab path. `App` threads its existing terminal state/handlers into the provider (scoped to the pane cwd) instead of into `TerminalsView`.
- **Why:** keeps `ViewerProps` file-shaped; terminal wiring stays out of the file viewers.

### D3 — Folder pane auto-surfaces cwd terminals; session split is opt-in
- **Folder pane** (`/folder/:cwd/editor`): on mount and when the terminal set changes, auto-open a `term:<id>` tab for every non-ephemeral terminal at that cwd. This preserves `TerminalsView`'s "see all my terminals" behavior in the new host.
- **Session split**: a terminal becomes a tab on explicit user action (create-terminal affordance or opening one), not auto-surfaced, so the split doesn't fill with tabs unbidden.
- **Why the asymmetry:** the folder pane *is* the terminal surface (must show them all); the split is primarily a code-reading companion (terminals are opt-in there).

### D4 — New-terminal affordance in the pane
Add a "+ Terminal" control to the pane header (or the tab strip's `+`). It calls `createTerminal()` for the pane cwd and opens the resulting `term:<id>` tab active. Rename (double-click tab / inline input) and close (`×`) route to `renameTerminal`/`killTerminal`; closing the tab kills the terminal (matching `TerminalsView` today).

### D5 — Persisted `term:` tabs reconcile against live terminals on load
Pane state persists to `localStorage`. Terminal server sessions are reconnectable, so persisting `term:` tabs is desirable — but a persisted id may be gone after a restart. On load, **reconcile**: drop any `term:<id>` tab whose id is not in the current `terminals` map for that cwd (same adjacent-activation logic as `closeTab`). Add `"terminal"` to the pane-state validator's viewer allowlist so `term:` tabs are not discarded as corrupt.
- **Alternative rejected:** never persist `term:` tabs — simpler but loses the tab across reload while the PTY keeps running (worse reconnect UX).

### D6 — Sidebar `[Terminals(N)]` button retargets, route removed
`onOpenTerminals(cwd)` stops navigating to `/folder/:cwd/terminals`; it navigates to `/folder/:cwd/editor` (the folder pane), which auto-surfaces the cwd terminals (D3). Delete the `/folder/:cwd/terminals` route match, its title/derive plumbing, and `TerminalsView`. The count badge `(N)` = non-ephemeral terminals at cwd (unchanged source).

## Risks / Trade-offs

- **[Persisted `term:` tab references a dead terminal after restart]** → D5 reconcile drops stale ids on load; validator allows `terminal` kind.
- **[Two panes attach the same terminal WS simultaneously]** (folder pane + session split both showing a cwd terminal) → `TerminalView` attaches per mount; confirm the server PTY tolerates multiple attach clients, or gate to one active attach per terminal id. **Open question — verify during implementation.**
- **[Auto-surfacing floods the folder pane with many terminals]** → matches prior `TerminalsView` behavior (it showed them all); acceptable. Ordering by creation time, active = most recent.
- **[Removing `TerminalsView` leaves dangling mounts / route plumbing]** → `rg 'TerminalsView|/folder/.*terminals|folderTermCwd'` over `packages/client/src` must return clean post-removal.
- **[Depends on Change 1]** → the folder-level surface needs the folder-scoped pane. If Change 1 is not yet landed, the session-split terminal tab still works standalone; the folder surface + button retarget wait on Change 1.

## Migration Plan

1. Shared: add `"terminal"` to `ViewerKind`; update the pane-state validator allowlist. Type-check.
2. Client: add the terminal viewer + registry entry; extend pane context with the terminal slice; thread `App` terminal state/handlers into the provider(s); add the new-terminal affordance; implement D3 auto-surface (folder) + D5 reconcile.
3. Client: retarget `onOpenTerminals` → folder pane; delete `/folder/:cwd/terminals` route + `TerminalsView` (+ tests + plumbing).
4. Tests + e2e (terminal-in-split, terminal-in-folder-pane, reconcile-after-reload); docs + spec sync.

**Rollback:** revert the change commit. Persisted `term:` tabs left in `localStorage` are dropped by the pre-existing validator once `"terminal"` is no longer an allowed kind (they fail `isValidState` → empty state fallback), so no manual cleanup.

## Open Questions

- Multi-attach: does the terminal server allow the same terminal id to be attached from two panes at once (folder + split)? If not, gate to a single active attach or a "moved here" hand-off. → verify against the terminal WS server during implementation.
- Should the session split also expose a per-tab "detach vs kill" on close, or always kill (as `TerminalsView` does)? Leaning always-kill for parity; revisit if users want persistence.
- Exact placement of the "+ Terminal" control (pane header vs tab-strip `+` vs both). → UI detail, resolve in implementation.
