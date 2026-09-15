## Context

See `proposal.md` — Why. Wiring today:

- `App.tsx:2440-2441` — `onOpenTerminals` and `onOpenEditor` both `navigate(\`/folder/${enc}/editor\`)`.
- `App.tsx` matches `/folder/:encodedCwd/editor` with `useRoute`; `useSearchParams` from wouter is already imported and used for other folder routes.
- `FolderEditorView` → `SplitWorkspaceProvider autoSurfaceTerminals` → `useTerminalPaneTabs({ autoSurface, terminals, dispatch, onCreateTerminal, … })`, which exposes `createTerminal()` (creates at cwd, opens the new tab active) and `openTerminal(id)`; its reconcile plan (D3 in the hook's header) opens `term:` tabs for live terminals but activates none.
- Terminal creation is async: `onCreateTerminal(cwd)` posts to the server; the new terminal appears in `terminals` on a later render, and the hook already opens the created one active (per "Create from the pane").

## Goals / Non-Goals

**Goals:** one-shot activate-or-create driven by a URL flag; zero change to the plain editor entry; deterministic in tests.

**Non-Goals:** a dedicated `/terminals` route (removed by `terminals-in-tabbed-panes`, not reintroduced); focusing a *specific* terminal id from the URL; changing how the session split handles terminals.

## Decisions

### D1 — Signal via `?focus=terminal` on the existing editor route

A search parameter keeps the route table and the `useRoute` non-shadowing analysis untouched. `App.tsx` reads it with the already-imported `useSearchParams` and passes `focusTerminal: boolean` to `FolderEditorView` → `SplitWorkspaceProvider` → `useTerminalPaneTabs`. *Alternative rejected:* navigation state (`history.state`) — not visible in tests or bookmarks and lost on reload.

### D2 — One-shot inside `useTerminalPaneTabs`, after reconcile

Add `focusOnMount?: boolean` to the hook. A `useRef(false)` `focusHandled` flag gates an effect that runs after the existing reconcile effect (same dependency on `terminals`): if `focusOnMount && !focusHandled.current` — when at least one non-ephemeral terminal at the cwd exists, `openTerminal(newestId)` (newest = max `createdAt`; fall back to last in array) and set the flag; else call `createTerminal()` and set the flag. Because the flag is set before the async creation lands, the subsequent `terminals` update cannot trigger a second creation. The hook already opens a created terminal's tab active, so no extra activation is needed on that path.

*Why in the hook, not the provider:* the hook owns the reconcile and both affordances; the provider only threads props. Keeps the one-shot next to the state it reads.

### D3 — No URL rewrite after consumption

The parameter stays in the URL. A reload with `?focus=terminal` re-runs the one-shot on the new mount: a terminal now exists, so it activates rather than creates. Rewriting the URL would add a `navigate` inside an effect for no behavioural gain.

## Risks / Trade-offs

- [Reload immediately after creation, before the server registered the terminal] → a second terminal is created; bounded to one per mount and only on that race. Acceptable for a quick action.
- [Ephemeral terminals present but no non-ephemeral] → treated as "none exists" → create; matches the pane's own filtering.
- [Playwright spec needs the created terminal's tab title] → assert on the active tab having a `term:` id via the existing tab testids rather than the title text.

## Migration Plan

Client-only; `npm run build && curl -X POST …/api/restart`. No rollback concerns.
