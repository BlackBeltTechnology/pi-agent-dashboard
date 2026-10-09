## Why

When many sessions are active across multiple workspace folders, the sidebar becomes overwhelming — all folders can be expanded simultaneously, making it hard to find and focus on the sessions you're currently working with. An accordion pattern (only one folder open at a time) would reduce visual clutter and improve navigation.

## What Changes

- Workspace folder groups will behave as an **accordion**: expanding one folder automatically collapses all others.
- The existing collapse/expand toggle on folder headers remains, but clicking to expand a folder now collapses the previously open one.
- Clicking an already-open folder header collapses it (all folders closed is a valid state).
- Persisted collapsed state in localStorage adapts to store which single folder is expanded (or none), instead of a set of collapsed folders.

## Capabilities

### New Capabilities

_(none — this modifies an existing capability)_

### Modified Capabilities

- `collapsible-groups`: Change from independent collapse/expand per folder to accordion behavior where at most one folder is expanded at a time.

## Impact

- **Code**: `packages/client/src/components/SessionList.tsx` — `handleToggleCollapse` logic changes from toggling a set to setting a single expanded key (or null).
- **Storage**: `packages/client/src/lib/session-filter-storage.ts` — persistence format changes from a set of collapsed cwds to a single expanded cwd string (or null). Migration needed for existing localStorage data.
- **Tests**: Existing collapsible-groups tests need updating for accordion semantics.
- **UX**: Users who relied on having multiple folders open simultaneously will need to adapt. This is a minor behavioral **BREAKING** change in the sidebar.
