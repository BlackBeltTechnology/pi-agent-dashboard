## Why

Three open issues share one surface: how a file reference reaches the editor pane, and what the pane does to the user's edits there.

- [#1137](https://github.com/BlackBeltTechnology/pi-agent-dashboard/issues/1137) — a full-path file link opens the legacy `FilePreviewOverlay` instead of the editor pane.
- [#1157](https://github.com/BlackBeltTechnology/pi-agent-dashboard/issues/1157) — `~/…` links resolve to "not found" (or the legacy overlay) when the file is outside the session cwd.
- [#1166](https://github.com/BlackBeltTechnology/pi-agent-dashboard/issues/1166) — unsaved Edit-mode changes vanish silently on tab close / session switch.

Verified root causes (all CONFIRMED against current code):

1. `packages/client/src/components/tool-renderers/FileLink.tsx:60` — `canSplitOpen = !!ws && !absolute && …`; absolute and tilde tokens (`absolute: true`, `linkify-tool-output.ts:237,245`) always reach `void openFile(result.resolved, line)` (`FileLink.tsx:96`), which `useFileOpenRouting.ts:52` routes to the overlay. When no split exists for the session there is no `buildEditorUrl` deep link either (`OpenFileButton.tsx:45` has one; `FileLink` does not).
2. `packages/server/src/lib/resolve-file-mention.ts:82-83` — anchors `[cwd, canonCwd?, ~/.pi]` + grants; any other candidate returns `null`, which `FileLink.tsx:85` renders as a struck-through "not found". The mention never reaches `/api/file`, whose gate (`file-routes.ts` `gateReadPath`) is the one that raises the grant prompt (operator click) or the denial notice. Spec scenario "home file outside ~/.pi rejected → null" encodes this.
3. `MarkdownViewer.tsx:42-44,90` and `EditablePreviewTab.tsx:45-46,82` hold `content`/`buffer` in local `useState`; `EditorPane.tsx:375-388` `closeTabAt` only guards handler tabs (`f?.handlerMode`), the pane close button (`EditorPane.tsx:518`) calls `updateSplit({mode:"closed"})`, `useSessionActions.ts:264` `handleSelect` navigates unconditionally, and there is no `beforeunload` in the pane (only `InstructionsPage.tsx:186`, `SettingsPanel`). The viewer is keyed by tab path (`EditorPane.tsx:280,364`), so each leave unmounts the buffer. Plugin file-handler tabs already have a guard (`use-file-handler-pane.ts` `guardTabClose`, `close-risk.ts`); built-in editable tabs do not.

Not already fixed: archive sweep (`2026-07-17-non-disruptive-file-open`, `2026-10-22-composer-dock-collapse-and-file-open`, `2026-06-07-unify-file-link-openability`) shows the out-of-folder Open was explicitly deferred; no active change overlaps.

## What Changes

- `FileLink`: route resolved links to the editor pane — `normalizeUnderCwd(resolved, cwd)` → `ws.openInSplit`; no live split but a `sessionId` → `navigate(buildEditorUrl(...))`; overlay only when there is no session id. Offline-fallback (resolve request failure) unchanged.
- `resolve-file-mention.ts` + `POST /api/file/resolve-mention`: a candidate that fails containment returns `{ resolved, kind, outside: true }` with **no stat** (no existence oracle); contained-missing still returns `null`. Client `ResolveMentionResult` gains `outside?: boolean`. *(Security posture — confirmed (owner, 2026-11-20), see `design.md` D1.)*
- Editor pane: tabs outside the cwd are **editable**. `POST /api/file/write` (today cwd-only via `isWritableMdTarget`) gains a grant gate: a text-doc write whose realpath is outside the cwd runs the same `evaluateContainment` path-grant check as reads (an un-granted path suspends the request for the operator grant prompt; a denied/expired/ineligible miss → `403` with the denial remedy fields, the save fails with a clear error and the buffer is kept). No new preference. Extension allowlist, dashboard-state refusal, `mtime` 409 and atomic write are unchanged. *(Confirmed (owner, 2026-11-20), `design.md` D2.)*
- Unsaved-edits guard for built-in editable tabs: a small dirty registry in `SplitWorkspaceContext` (viewers publish `{dirty, save}`), a `confirmLeave` helper with a Save / Discard / Cancel dialog, wired into single tab close, bulk close (`planBulkClose` risk list), pane close, `handleSelect` (sidebar session switch) and a `beforeunload` handler.

## Capabilities

### New Capabilities
- none

### Modified Capabilities
- `tool-output-linkification`: "Server-side file-mention resolution" (outside-containment result), "Click routing — remote/mobile preview fallback" (overlay only without editor pane); ADDED "File links open in the editor pane".
- `internal-monaco-editor-pane`: ADDED "Files outside the session folder SHALL edit and save only through the path grant gate", "Leaving with an unsaved built-in buffer SHALL ask first".
- `scoped-markdown-editing`: MODIFIED "Write target authorization SHALL be allowlist-bounded" (grant-admitted out-of-cwd text docs), ADDED "An out-of-cwd write SHALL be gated by the path grant prompt".
- `editor-pane-chrome`: "Bulk close SHALL confirm once when it would lose work" (built-in unsaved tabs).

## Non-goals

- Guarding browser back/forward and non-sidebar route changes (wouter has no blocker; only owned chokepoints + `beforeunload`).
- Guarding tab *switch* (buffer is dropped there too today; see DECISIONS D3 — follow-up: keep-alive buffers).
- A preference gate for out-of-folder open/edit (reuse the grant prompt only); watching outside files (a tab outside the cwd gets no live changed-on-disk push — the save-time `mtime` 409 still protects it); writes outside the cwd in global scope (no `cwd` → still `~/.pi/agent` only); a write-specific grant mode (a grant remains a subtree grant, see `design.md` D2 risk).
- Removing `FilePreviewOverlay` (still the no-session fallback).
- Fixing stale `openEditor`/`ToolContext.editors` wording in the "Click routing — localhost editor" requirement (pre-existing drift).

## Relationship

Archived: `2026-06-07-unify-file-link-openability` (introduced absolute tokens), `2026-07-17-non-disruptive-file-open` (split open helper), `2026-10-22-composer-dock-collapse-and-file-open` (deferred this out-of-folder follow-up), `add-editor-pane-file-handlers` (handler unsaved guard this change mirrors). Reuses `path-anchor-grants` / `preview-denial-remedy` unchanged. No active overlap (grep of `openspec/changes/*/proposal.md` negative). #1137/#1157 and #1166 are independent but touch the same pane; keep in one change since both modify `EditorPane` close/open paths.

## Discipline Skills

- `security-hardening` — resolve endpoint now returns a path for uncontained input (no stat, no existence leak); `POST /api/file/write` newly admits out-of-cwd text docs through the path grant gate (read grant now also admits allowlisted writes).
- `review-code` — non-trivial change, run before commit.
- `doubt-driven-review` — before locking the `outside: true` response shape (public route payload, additive) and before landing the write-gate widening (read grant ⇒ text-doc write; prompt copy names read access).
- `react-expert` subagent checkpoint: ≥3 React components touched + new registry hook.

## Impact

- Client: `tool-renderers/FileLink.tsx`, `lib/api/resolve-mention-api.ts`, `split/SplitWorkspaceContext.tsx` (registry + `confirmLeave`), `editor-pane/{MarkdownViewer,EditablePreviewTab,EditorPane,BulkCloseConfirm}.tsx`, `editor-pane/file-handler/close-risk.ts` (extend `planBulkClose` lookups), `split/LayoutModeSwitch.tsx` (chat segment closes the pane), `hooks/useSessionActions.ts` (`handleSelect`), new unsaved-dialog component.
- Server: `lib/resolve-file-mention.ts`, `lib/writable-md-target.ts` (split extension/state check from scope check), `routes/file-routes.ts` (resolve response mapping; `prepareMdWrite` + `/api/file/write` grant gate with the live request/reply for the hold), `docs/security/http-route-inventory.md` rows (DocScribe).
- Compatibility: `outside` is an additive response field; old clients ignore it and keep seeing `{resolved}` (they open the legacy overlay, whose read is still gated). Write gate is additive: only requests that already 403'd (out-of-cwd text docs) can now succeed, and only after a grant. Rollback: revert; no data/migration; existing grants are not changed. Newer client + older server: `outside` absent → `null` → not-found (today's behaviour).
