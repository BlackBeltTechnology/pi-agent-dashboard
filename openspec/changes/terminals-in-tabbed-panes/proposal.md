## Why

Terminals are currently a **separate full-screen folder view**: the sidebar `[Terminals(N)]` button navigates to `/folder/:cwd/terminals`, which mounts `TerminalsView` — a bespoke tab strip + `TerminalView` list that duplicates tab machinery the internal Monaco editor pane already owns (`EditorTabs`, virtual tabs like `live:<url>` and `diff:<path>`, per-kind viewer registry). This split-brain means a user must leave the chat/editor context to reach a terminal, and terminal tabs can't sit beside file tabs while reading code. Terminals belong **inside the tabbed content pane**, alongside files.

## What Changes

- Add a `terminal` **viewer kind** to the editor-pane tab system: a terminal opens as a virtual `term:<terminalId>` tab rendered by the existing `TerminalView`, registered in `viewer-registry`.
- **Terminal tabs in the session split** (`/session/:id/editor` / `SessionSplitView`): open/create a terminal as a tab beside file tabs; terminal cwd = session cwd.
- **Terminal tabs in the folder-scoped pane** (`/folder/:cwd/editor`, introduced by change `remove-external-editor-integration`): the same tab system provides the **folder-level tabbed terminal surface**; terminal cwd = folder cwd. This replaces the standalone `TerminalsView`.
- **BREAKING**: Remove the `/folder/:cwd/terminals` route and the standalone full-screen `TerminalsView`. The sidebar `[Terminals(N)]` button no longer navigates to a dedicated view; it opens the folder-scoped pane with a terminal tab (retargeted, not a separate screen).
- Add a "new terminal" affordance to the editor-pane tab strip (or its header) so terminals can be created from within the pane.
- Preserve terminal identity/lifecycle: `TerminalSession` state, server PTY/WS lifecycle, rename, kill, title updates, and terminal-limit handling are unchanged — only the *host surface* moves.
- **Out of scope / unchanged**: inline terminal cards (`InlineTerminalCard`, ephemeral, `!!` in chat) stay exactly as they are.

## Capabilities

### New Capabilities
- `terminal-viewer-tab`: A terminal can be hosted as a tab (`term:<id>`, `terminal` viewer kind) inside any editor pane — the session split and the folder-scoped pane — reusing `TerminalView`, `EditorTabs`, and the viewer registry. Covers open/create/activate/close/rename of terminal tabs and their cwd scoping.

### Modified Capabilities
- `terminals-view`: The folder `[Terminals(N)]` button and terminal surfacing move from the standalone `/folder/:cwd/terminals` screen to terminal tabs inside the tabbed pane; the dedicated route + `TerminalsView` component are REMOVED.
- `split-editor-workspace`: The split editor slot's pane hosts terminal tabs in addition to file/diff/live-server tabs; a "new terminal" affordance is ADDED to the pane.

## Impact

- **Depends on**: `remove-external-editor-integration` (provides the folder-scoped editor pane at `/folder/:cwd/editor` that becomes the folder-level terminal surface). Land that change first.
- **Client**: new `terminal` `ViewerKind` (`packages/shared/src/file-kind.ts`), `viewer-registry` entry wrapping `TerminalView`; editor-pane tab-open flow extended for `term:` tabs (no content fetch, no file-tree row); `EditorPane`/`EditorTabs` gain a new-terminal control; `App.tsx` drops the `/folder/:cwd/terminals` route + `TerminalsView` mount and retargets `onOpenTerminals`; terminal state (`terminals` map, `getTerminalsForCwd`, create/kill/rename handlers) threaded into the pane context instead of `TerminalsView`.
- **Removed**: `TerminalsView.tsx` (+ tests); `/folder/:cwd/terminals` route and its title/derive plumbing.
- **Shared**: `ViewerKind` union gains `"terminal"`; persisted pane state must tolerate `term:` tabs (validator allowlist update).
- **Tests**: delete `TerminalsView` tests; add terminal-tab open/close/rename coverage in the pane; e2e for terminal-in-split and terminal-in-folder-pane.
- **Docs / OpenSpec**: update `terminals-view` + `split-editor-workspace` specs; per-directory `AGENTS.md` rows.

## Discipline Skills

- `doubt-driven-review` — folding a stateful, session-lifecycle-bearing terminal into the file-oriented tab/persistence model is non-trivial; review the state/scoping model before it stands.
- `code-simplification` — this collapses two tab systems (TerminalsView + EditorTabs) into one; ensure `TerminalsView` and its plumbing are fully removed with no orphans.
