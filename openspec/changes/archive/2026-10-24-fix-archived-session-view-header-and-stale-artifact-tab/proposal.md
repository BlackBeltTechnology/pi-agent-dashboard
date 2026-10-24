## Why

Follow-up to `add-session-ui-deep-links-for-agents` (#1034). Opening an archived
session read-only (`/session/<id>?archived=1`, with or without `&embed=1`) shows
two defects:

1. The session header reads "No session selected". `renderSessionDetail` in
   `packages/client/src/App.tsx` already synthesizes a header row from the
   archived summary (`archivedSummaryToSession`), but passed
   `sessions.get(selectedId)` to `SessionHeader` — the archived id is never in
   the live `sessions` Map by design, so the header got `undefined`.
2. The editor pane shows "Couldn't load … HTTP 400" for a persisted tab. Same
   shared cause: `SplitWorkspaceProvider` got `cwd={selectedSession?.cwd ?? ""}`
   from the live map → empty `cwd` → `GET /api/file?cwd=&path=…` → server 400
   `cwd and path parameters required` (correct server behaviour; not a 404
   because the request itself was malformed). With the cwd fixed, the stale
   `openspec/changes/<name>/proposal.md` tab (the change has since been archived)
   would only say "File no longer exists".

## What Changes

- Extract `archivedSummaryToSession` into
  `packages/client/src/lib/session/archived-read-only-session.ts` and add
  `viewedSession(id, sessions, archivedReadOnlyId, summaries)` (live row, else
  synthesized archived row).
- `App.tsx`: archived-view detection is `selectedId === archivedReadOnlyId`; `SessionHeader` gets the resolved
  row; the archived view hides tag edit + seek-to-card; the composer gating
  (`readOnly`) is unchanged; editor pane `cwd` resolves through `viewedSession`.
  Reveal in sidebar is omitted for the archived view (MODIFIED
  `session-card-seek`).
- Archived header placeholder while the summary loads ("Loading archived
  session…") and on fetch failure ("Archived session unavailable"); never "No
  session selected". Frozen underlays (behind a route-backed overlay, whose URL
  may not carry `?archived=1`) are out of scope.
- Editor pane issues no `/api/file` request while its `cwd` is empty (archived
  summary loading or failed) — it shows the matching notice instead.
- Editor pane, in **every** session (a live/ended session can hold the same stale
  tab after `ship-change` archives the change): a missing
  `openspec/changes/<name>/…` artifact whose change exists in the folder archive
  keeps the `File no longer exists: <path>` line and adds "Archived as <dir>" +
  **Open archived copy**, which opens `openspec/changes/archive/<dir>/…` and
  closes the stale tab. Pure mapping in
  `packages/client/src/lib/openspec/archived-artifact-path.ts` (reuses
  `matchArchiveEntries`); archive listing via the existing `useArchiveEntries`
  cache (prior art: `resolve-archived-attached-proposal`). Archive listing
  pending or failed → plain missing message.

## Capabilities

### New Capabilities

### Modified Capabilities

- `archived-session-listing`: read-only view renders the session header and
  scopes the editor pane to the archived session's folder.
- `internal-monaco-editor-pane`: missing artifact of an archived change offers
  the archived copy.
- `session-card-seek`: no Reveal in sidebar control in the read-only archived
  view (no live sidebar card).

## Impact

Client only: `App.tsx`, `components/editor-pane/CappedViewer.tsx`,
`components/editor-pane/EditorPane.tsx` (empty-cwd guard), two new pure lib
modules, i18n keys `editor.changeArchived` / `editor.openArchivedCopy` plus the
two archived-header strings in `lib/i18n/i18n-hu.ts` + `lib/i18n/i18n-zh-CN.ts`
(the only locale files; English is the in-code default). No server, protocol or
persisted-format change (Open archived copy is an ordinary user open + close).

## Discipline Skills

- `systematic-debugging` — applied for the root cause (header + empty-cwd 400).
- `security-hardening` — checked, not triggered: the archived path is derived
  from the user's own persisted tab path and stays cwd-relative, read through
  the unchanged `/api/file` containment; no new endpoint or trust boundary.
- No latency budget, new endpoint/external call, or irreversible step.
