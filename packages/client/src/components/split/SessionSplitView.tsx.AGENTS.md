# SessionSplitView.tsx — index

Connects context → `SplitWorkspace` (editor slot=`EditorPane`), passing `mode`/`onModeChange`. `SplitRouteSync` opens split from `/session/:id/editor` deep-link via `openInSplit` (else `mode:"split"`). See change: split-editor-workspace. See change: editor-layout-modes.

See change: attach-flow-before-run — `SplitRouteSync` applies each route target once: `lastKeyRef` keyed `sessionId|file|line|url` (CanvasDriver pattern), reset when route inactive. Opener identity change (split close recreates openers via `split.mode`) no longer re-opens the split while URL still `/session/:id/editor?file=`. New file/line/url/session or back/forward re-applies. Test: `components/__tests__/SplitRouteSync.test.tsx`.

See change: consolidate-flow-agent-cards — the apply-once key gains a per-open `nonce` (optional prop, appended as `nonce ?? ""`): a FRESH nonce re-applies an otherwise-identical target, so closing the pane X or the file's tab no longer blocks re-opening; a re-render at the SAME nonce with recreated openers stays a no-op (D8). Nonce comes from the opener (flows-plugin `useOpenFileInEditor` stamps `history.state.openNonce`), read in `App.tsx` via wouter `useHistoryState` only while the editor route matches. See change: consolidate-flow-agent-cards.
