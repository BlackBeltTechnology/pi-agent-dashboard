## Why

The **Terminals** quick action on the directory home page (`data-testid="directory-home-open-terminals"`) navigates to exactly the same route as **Editor** — `/folder/<cwd>/editor` — so the two buttons are indistinguishable (#373, re-validated after the `FolderActionBar` button was removed: the wiring moved to `DirectoryHomeView`, the defect did not).

The folder pane's `autoSurfaceTerminals` opens a `term:` tab for every live terminal at the cwd, and — because the pane reducer's `openFile` defaults to `activate: true` — the *last terminal in set order* ends up active. So with terminals present the landing tab is arbitrary, and with **no** terminal nothing terminal-related happens at all. Neither outcome is "open my terminals".

## What Changes

- **Terminal-focused entry to the folder pane.** The editor route SHALL accept a one-shot `?focus=terminal` search parameter. When present, the folder pane SHALL — once its terminal set is known — activate the tab of the **most recently created** non-ephemeral terminal at the cwd; if none exists it SHALL create one terminal at the cwd, whose tab auto-surface then opens active. The request is honoured at most once and the parameter is then **consumed** from the URL.
- **Snapshot-readiness gate.** The one-shot SHALL NOT act on an empty terminal set that merely means "the WebSocket snapshot has not arrived yet", mirroring the cold-load guard the pane's reconcile already applies. Readiness is the existing `snapshotGeneration` signal.
- **Directory home wiring.** `onOpenTerminals` navigates to `/folder/<cwd>/editor?focus=terminal`; `onOpenEditor` is unchanged.
- **Testable tabs.** `EditorTabs` tabs gain a stable `data-testid` + path attribute so a browser test can assert which tab is active without depending on title text.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `terminal-viewer-tab`: new requirement — a terminal-focused entry deterministically activates or creates a terminal tab in the folder pane, gated on terminal-set readiness and consumed once.
- `directory-home-page`: the Terminals quick action targets the terminal-focused entry, distinct from the Editor action.

## Impact

- `packages/client/src/App.tsx` — `onOpenTerminals` target; read `focus=terminal` on the editor route and pass `focusTerminal` + `terminalsReady` + `onFocusConsumed` to **both** `FolderEditorView` call sites (`:2417` desktop, `:2515` `renderFolderEditor` for the mobile shell).
- `packages/client/src/components/folder/FolderEditorView.tsx`, `packages/client/src/components/split/SplitWorkspaceContext.tsx` — thread the flags.
- `packages/client/src/lib/layout/use-terminal-pane-tabs.ts` — one-shot activate-or-create, ordered after the reconcile effect.
- `packages/client/src/components/editor-pane/EditorTabs.tsx` — add `data-testid="editor-tab"` + `data-tab-path` (shared component; additive only).
- Tests: `packages/client/src/lib/__tests__/use-terminal-pane-tabs.test.ts`, `packages/client/src/components/__tests__/DirectoryHomeView.test.tsx`, `tests/e2e/directory-home.spec.ts`.
- No server or shared-type change.

## Discipline Skills

- `review-code` — before commit.
- `systematic-debugging` — on tap: the defect class here is an effect-ordering / async-snapshot race, exactly where a guessed fix fails twice.

No other checkpoint applies: no untrusted input, no new endpoint, no latency budget.
