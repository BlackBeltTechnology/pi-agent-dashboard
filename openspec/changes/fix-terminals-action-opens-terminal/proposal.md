## Why

The **Terminals** quick action on the directory home page (`data-testid="directory-home-open-terminals"`) navigates to exactly the same route as **Editor** — `/folder/<cwd>/editor` — so it lands on the file editor. The folder pane's `autoSurfaceTerminals` opens `term:` tabs only for terminals that already exist and never activates one, so with no terminal the two buttons are indistinguishable (#373, re-validated after the `FolderActionBar` button was removed: the wiring moved to `DirectoryHomeView`, the defect did not).

## What Changes

- **Terminal-focused entry to the folder pane.** The editor route SHALL accept a one-shot `?focus=terminal` search parameter. When present, the folder pane SHALL, after its terminal reconcile, activate the most recently created non-ephemeral terminal tab at the cwd; if none exists it SHALL create one terminal at the cwd and open its tab active — exactly the pane's existing new-terminal affordance. The parameter is consumed once per mount (no repeated creation on re-render).
- **Directory home wiring.** `onOpenTerminals` navigates to `/folder/<cwd>/editor?focus=terminal`; `onOpenEditor` is unchanged.
- Regression test: the Terminals action lands on an active `term:` tab (existing terminal → that tab; none → a newly created one); the Editor action lands on the file editor with no terminal created.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `terminal-viewer-tab`: new requirement — a terminal-focused entry activates or creates a terminal tab in the folder pane.
- `directory-home-page`: the Terminals quick action targets the terminal-focused entry, distinct from the Editor action.

## Impact

- `packages/client/src/App.tsx` (`onOpenTerminals` target; read the search param on the editor route and pass `focusTerminal` to `FolderEditorView`).
- `packages/client/src/components/folder/FolderEditorView.tsx`, `packages/client/src/components/split/SplitWorkspaceContext.tsx` (thread the flag), `packages/client/src/lib/layout/use-terminal-pane-tabs.ts` (one-shot activate-or-create after reconcile).
- Tests: `use-terminal-pane-tabs` unit test, `DirectoryHomeView` test, one Playwright spec (`tests/e2e/directory-home-terminals.spec.ts`).
- No server or shared-type change.

## Discipline Skills

- `review-code` — before commit. No other checkpoint applies: no untrusted input, no new endpoint, no latency budget.
