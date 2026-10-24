## Context

Line refs marked HEAD are `git show HEAD:<path>` (pre-change).

Read-only archived open (`archive-sessions-lazy-load`) keeps the session out of
the live `sessions` Map and seeds a header row from
`GET /api/sessions/archived/:id` (HEAD `packages/client/src/App.tsx:825-842`,
`fetchArchivedSessionById`). `renderSessionDetail` (HEAD `App.tsx:2477`) already
synthesizes that row for its own locals (HEAD `App.tsx:423`
`archivedSummaryToSession`, gated by `readOnly = !frozen && selectedId ===
archivedReadOnlyId`, HEAD `App.tsx:2483`), but two consumers kept reading the
live map:

- Header: HEAD `App.tsx:2519` `session={sessions.get(selectedId)}` → `undefined`
  → `SessionHeader` renders "No session selected"
  (`packages/client/src/components/session/SessionHeader.tsx:279-284`).
- Editor pane: HEAD `App.tsx:3220` `cwd={selectedSession?.cwd ?? ""}` where
  `selectedSession` is live-only (HEAD `App.tsx:1842`) → empty cwd →
  `packages/server/src/routes/file-routes.ts:386` returns 400
  `cwd and path parameters required` (malformed request, so never 404).
  `CappedViewer`'s probe maps only 404 to "missing"; any other status mounts
  the viewer with size 0 (HEAD `CappedViewer.tsx:77-82`), and the viewer's own
  `/api/file` request then surfaces "Couldn't load … HTTP 400".

`SessionHeader` always renders `LayoutModeSwitch`
(`SessionHeader.tsx:126` menu variant, `:252` inline) and only renders
Resume/Fork when `onResume` is set (`SessionHeader.tsx:329`), so passing the
synthesized row with `onResume` undefined yields a read-only header with the
layout switch.

The stale `openspec/changes/<name>/proposal.md` tab is persisted per session
under `pi-dashboard:editor-pane:<sessionId>`
(`packages/client/src/lib/layout/editor-pane-state.ts`), not auto-opened from
the attachment. `CappedViewer` probes `/api/file` and maps only 404 to the
missing message (HEAD `packages/client/src/components/editor-pane/CappedViewer.tsx:77`).
`EditorPane` keys the viewer on `sessionId\0cwd\0path…`
(`packages/client/src/components/editor-pane/EditorPane.tsx:277-280`), so a cwd
change remounts the viewer and re-probes.

## Decisions

- **D1 — one resolver, one archived-view flag.**
  `viewedSession(id, sessions, archivedReadOnlyId, summaries)` = live row first,
  else the synthesized row for the archived id. `renderSessionDetail` derives
  `archivedView = selectedId === archivedReadOnlyId` and
  passes `SessionHeader` `session = viewedSession(id, sessions, archivedView ?
  archivedReadOnlyId : undefined, summaries)` (the HEAD summary lookup gated on
  `readOnly`, HEAD `App.tsx:2484`, moves to `archivedView`) and
  `onRename = onSetTags = onSeekToCard = onResume = undefined` when
  `archivedView` (Reload transcript stays: it only re-reads)
  (`SessionHeader` omits each control when its callback is unwired:
  `SessionHeader.tsx:329,379`, `SessionTitleMenu.tsx:49`; title-menu omit rule
  `openspec/specs/session-header/spec.md` "Title menu SHALL hold rename, reveal,
  tags and reload"). `LayoutModeSwitch` is rendered by `SessionHeader` itself, so
  no extra wiring. `readOnly` (composer/ended-composer gating) keeps its
  `!frozen &&` definition. The top-level `selectedSession` (HEAD `App.tsx:1842`)
  stays live-only; only the pane `cwd` reads `viewedSession`. Live-first
  precedence after an unarchive is the pre-existing HEAD rule; like HEAD's
  composer gating, the control hiding follows the URL (`?archived=1` = read-only
  mode) even if the id became live meanwhile.
  `openspec/specs/session-header/spec.md` "Desktop session header SHALL be one
  row of three zones" fixes ORDER; presence of Reveal and Resume/Fork is
  conditional per `session-card-seek` (MODIFIED here) and the header's
  `onResume` gate, so no `session-header` delta is needed.
- **D1b — archived header states.** Owned by `App.tsx`: when `archivedView` has
  no row, `renderSessionDetail` renders a one-line header bar (same chrome as the
  `SessionHeader` empty branch) with "Loading archived session…", or "Archived
  session unavailable" after the summary fetch failed, instead of mounting
  `SessionHeader` (whose empty branch says "No session selected"). `App.tsx` records the failure per id (today the catch
  only comments, HEAD `App.tsx:836-838`). Neither state reads "No session
  selected".
- **D2 — explicit swap, not silent rewrite.** A stale active-change tab is not
  rewritten in persisted state on load; the notice offers one click that opens
  the archived path and closes the stale tab (`closeByPath`,
  `editor-pane-state.ts:312`) — an ordinary open + close, no format change.
  Candidates = `matchArchiveEntries`
  (`packages/client/src/lib/openspec/resolve-attachment.ts:52`); pick = newest
  `date`. `pickEntry`'s `startedAt` heuristic (`resolve-attachment.ts:56-60`)
  is not reused: a tab has no attach time, and for exact-name matches the date
  prefix order equals the name order (accepted divergence: an attachment and a
  tab of the same change MAY resolve to different same-name archives). Only the
  pane `cwd`'s archive is read — tab paths are cwd-relative, so an archive in
  another folder (e.g. a worktree's main path) could not be opened by that tab
  anyway.
- **D3 — lookup only when missing, in every session.** `CappedViewer` calls
  `useArchiveEntries(missingActiveArtifact ? cwd : null)`
  (`packages/client/src/lib/openspec/useAttachmentResolution.ts:25`; `null`
  reads nothing) — a cwd is passed only after the existence probe 404s on an
  `openspec/changes/<name>/…` path (not `archive/`). The pane always mounts
  viewers with `size: 0` (`EditorPane.tsx:317`), so a restored tab always
  probes. `CappedViewer` gates every
  non-pseudo viewer kind (`EditorPane.tsx:354`), so the notice covers every
  built-in file viewer. Listing pending or failed →
  plain missing message. Open archived copy uses the idempotent `openFile`
  (focuses an already-open archived tab) then `closeByPath` on the stale path,
  so exactly one tab remains. If the archived target is itself missing (file
  deleted during the change), that tab shows the plain missing message. The notice keeps the `File no longer exists: <path>`
  line, so `openspec/specs/composer-dock/spec.md:166` ("Open SHALL show … that
  the file no longer exists, naming its path") still holds.
- **D4 — no request with an empty cwd.** A session pane's `cwd` is empty only
  when the viewed id has no resolvable row (live sessions always carry `cwd`), so
  the guard cannot change live/ended behaviour. While it is empty `EditorPane`
  mounts no file viewer and shows a loading notice ("Archived session
  unavailable" once D1b records the failure), so no `/api/file?cwd=` request is
  issued. The remount on cwd arrival (`EditorPane.tsx:277-280`) then probes once
  with the real cwd. The same guard applies to the provider's other cwd
  consumers: no `watch_files` and no filename search while `cwd` is empty.
  (`DashboardSession.cwd` is a required string,
  `packages/shared/src/types.ts:163`.)

## Non-goals

- Frozen underlays: a route-backed overlay replaces the URL and (unverified) may drop
  `?archived=1`, so an archived id behind an overlay is not recognised as
  archived; the backdrop keeps HEAD behaviour (decided during planning).

## Risks

- `useArchiveEntries` shares the per-cwd archive cache (5 min TTL,
  `archive-cache.ts`), invalidated when the folder's active-change signature
  changes (archiving removes the change from the active set). Residual: a folder
  absent from the OpenSpec map (sig `null`) can show the plain missing message
  until the TTL expires. While the listing is pending, the plain missing message
  shows, then gains the archived line.

## Collateral candidates (advisory scan, checked)

- `session-resume` "Header Resume reuses existing resume protocol": unaffected;
  archived view never wires `onResume`.
- `session-header` "one row of three zones": order unchanged; see D1.
- `session-card-seek`: MODIFIED (Reveal omitted in archived view).
- `file-diff-view`, `extension-ui-system`, `app-decomposition`,
  `dashboard-shell-slots`, `plugin-ui-primitive-registry`, `url-routing`,
  `openspec-folder-section`, `openspec-change-dependencies`,
  `openspec-artifact-reader`: unaffected — identifier overlap only (`App.tsx`,
  `SessionHeader`, `selectedSession`); no slot, route, diff or board behaviour
  changes.
- `internal-monaco-editor-pane` persist / read-only / tree-sync / banner:
  unaffected — Open archived copy is an ordinary open + close; no write.
