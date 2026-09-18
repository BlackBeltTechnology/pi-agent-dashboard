## Why

Folder collapse state is lost on every page reload. The cause is not missing
persistence — it is a self-destructing prune. `SessionList.tsx` runs
`pruneStaleCollapsedGroups(new Set(sessions.map((s) => s.cwd)))` on every change
in session count — first at the `sessions_snapshot` after connect, then again on
every spawn, archive, and ended-session page — and **writes the pruned set back
to localStorage**. The prune assumes every rendered folder group key is some
loaded session's raw `cwd`. That assumption is false for four of the five
sources a folder group key comes from:

| Group key source | In `knownCwds`? |
|---|---|
| `session.cwd` | yes |
| `session.gitWorktree.mainPath` (worktree groups, via `resolveSessionGroupPath`) | **no** |
| `pinnedDirectories[]` (pin string used verbatim as the display `cwd`) | **only if** a live session's raw `cwd` happens to equal the pin string |
| `stubGroupCwds` (ended-only folders the client holds no session for) | **no** |
| `workspaces[].folders[]` (rendered regardless of session count) | **no** |

Neither side normalizes through `pathKey()`, so trailing-separator and case
drift break the match even when the path is conceptually the same. On a
worktree-heavy checkout the overlap between stored keys and `knownCwds` is
effectively empty, so one prune at connect empties the entire store — which is
why the observed symptom is "every folder is expanded again after a reload".

Folder collapse is also the only sidebar collapse state stored client-side.
Workspace collapse (`setWorkspaceCollapsed`) and pinned directories already
live in the server's `preferences.json`. Moving folder collapse there removes
the inconsistency and makes the state survive a browser profile, a different
device, and a cache clear.

## What Changes

- **BREAKING (storage location)**: folder collapse state moves from browser
  `localStorage` (`dashboard:collapsedGroups`) to server-side
  `preferences.json`, becoming global across browsers and devices — matching
  how workspace collapse already behaves.
- **Remove the prune entirely, replacing it with nothing.** Collapsed folder
  paths are short strings; a stale entry costs bytes and nothing else, because
  a folder that is not rendered cannot be collapsed. Every correct prune needs
  to know the complete rendered key-space — precisely the knowledge whose
  absence caused this bug. Re-introducing a prune re-introduces the bug class.
- New `collapsedFolders: string[]` preference, canonicalized with the shared
  `pathKey()` helper on **both** write and read, so a worktree `mainPath`, a
  pin string, and a session `cwd` that denote the same folder agree. Both sides
  derive the platform via `inferPlatform()` — never `process.platform`, which
  would fold case on macOS on the server only and re-break the match.
- New `set_folder_collapsed { path, collapsed }` browser-protocol message,
  mirroring the existing `set_workspace_collapsed`, plus a dedicated
  `collapsed_folders_updated` broadcast that is **also unicast in the
  connect snapshot** beside `pinned_dirs_updated` and `workspaces_updated` —
  without that, a reload mounts with every folder expanded and never corrects.
- The message carries an explicit target state and the reveal path uses an
  ADD-ONLY expand, never a toggle: with state arriving asynchronously, a
  guarded toggle can re-collapse a folder a second seek just opened.
- One-shot migration: an existing `dashboard:collapsedGroups` localStorage
  value is unioned into the server's set after the connect snapshot, and the
  local key removed only once an echo confirms delivery.
- `SessionList` stops owning collapse state: `collapsedGroups` becomes a prop
  fed from the server broadcast, and `handleToggleCollapse` emits upward.

## Capabilities

### New Capabilities
<!-- None. This change modifies where existing behavior stores its state. -->

### Modified Capabilities
- `collapsible-groups`: the "Collapse state persistence" requirement changes
  from localStorage to server-side `preferences.json`, keyed by canonicalized
  path; its "Prune stale collapsed entries" scenario is **removed** (the prune
  is the defect); a new requirement covers key canonicalization so a folder
  reached by worktree main path, pin string, or session cwd resolves to one
  key; a new scenario covers the one-shot localStorage migration.
- `session-card-seek`: the folder-ancestor clause currently mandates expanding
  via the localStorage collapsed-groups mutator keyed by `session.cwd`, "which
  SHALL be invoked only when the folder is collapsed (it is a toggle)". It
  becomes an ADD-ONLY expand on the *resolved group path*, so a worktree
  session's reveal targets the group that actually renders and a repeat seek
  cannot re-collapse it.
- `global-preferences`: `preferences.json` gains a `collapsedFolders` array
  alongside `pinnedDirectories` and `sessionOrder`, with the same
  absent-in-legacy-file → `[]` tolerance and debounced atomic writes.

## Impact

- `packages/shared/src/browser-protocol.ts` — `set_folder_collapsed` message;
  new `collapsed_folders_updated` broadcast (the protocol is per-concern; there
  is no aggregate preferences payload to extend).
- `packages/server/src/pairing/browser-gateway.ts` — `frameClassOf` must
  classify the new broadcast as `cls: "state"`; the `default` branch is
  `transcript`, which is shed under buffer pressure.
- `packages/client/src/hooks/useMessageHandler.ts` — incoming broadcasts are
  parsed here (beside `pinned_dirs_updated` / `workspaces_updated`), not in
  `App.tsx` directly.
- `packages/shared/src/session-group-path.ts` — no change; `pathKey()` is
  reused as the canonicalization authority for both client and server.
- `packages/server/src/persistence/preferences-store.ts` —
  `getCollapsedFolders()` / `setFolderCollapsed(dirPath, collapsed)`.
- `packages/server/src/pairing/browser-gateway.ts` — new case beside
  `set_workspace_collapsed`, plus `collapsed_folders_updated` in the
  connect-time unicast snapshot.
- `packages/client/src/components/session/SessionList.tsx` — delete the prune
  effect and the `collapsedGroups` `useState`; accept both as props; convert
  every in-place expand (`resolveFoldAncestors` reveal, `seekToFolderOpenSpec`,
  `FolderSpawnButtons` spawn handlers) from a guarded toggle to an ADD-ONLY
  expand, and canonicalize the lookup in `isFolderCollapsed`.
- `packages/client/src/lib/session/session-filter-storage.ts` — remove
  `getCollapsedGroups` / `setCollapsedGroups` / `pruneStaleCollapsedGroups`
  from the live path; retain only what the one-shot migration reads.
- `packages/client/src/App.tsx` — hold `collapsedFolders` from the broadcast;
  run the one-shot migration; dispatch `set_folder_collapsed` with no
  optimistic mirror (matching the stated `workspaces_updated` convention).
- Tests: `session-filter-storage.test.ts` (prune tests removed),
  `SessionList.test.ts` + `SessionList.seek-to-card.test.tsx` (both seed
  `dashboard:collapsedGroups` directly and must move to the prop).
- `SessionList.tsx` reveal path — `resolveFoldAncestors` must key off the
  resolved group path, not `s.cwd` (a worktree session's reveal currently
  targets a key no rendered group owns), and the reveal completion signal must
  observe the collapsed-folders echo, not only `[workspaces]`.
- Behavioral note: collapsing now costs a WebSocket round-trip where it was
  instant local state. Accepted — every sibling sidebar control already pays
  it.

## Discipline Skills

- `review-code` — non-trivial cross-package change (shared protocol + server
  persistence + client state ownership), reviewed before commit.
- `doubt-driven-review` — the storage move is user-visible and semi-
  irreversible once migrated; the local-vs-global UX call and the
  delete-the-prune decision are both stress-tested before they stand.
- `systematic-debugging` — applied to reach the root cause above; re-applied if
  the reload symptom survives the fix, which would indicate a second
  independent wipe path.
