# Design: fix-archive-fold-key-and-filter-chips

## Context

### Root cause of the missing `Archive (N)` fold

- The server index is keyed by `pathKey(resolveSessionGroupPath(row), platform)`, where `platform = deps.platform ?? process.platform` (`packages/server/src/session/session-archive.ts:137`, `:149-156`).
- `pathKey` normalises separators and trailing slashes, and lowercases on every platform except `linux` (`packages/shared/src/session-group-path.ts:40-44`).
- The index key goes on the wire:
  - `countsByKey()`, which becomes `sessions_snapshot.archivedCountByCwd` (`session-archive.ts:262-268`, `packages/server/src/pairing/browser-gateway.ts:2007-2012`)
  - `session_archived.cwd` (`session-archive.ts:235`, `:327`)
  - `archived_count_updated.cwd` (`session-archive.ts:258`, `:380`, `:410`, `:427`)
- The client stores the map verbatim (`packages/client/src/hooks/useMessageHandler.ts:1781`, `:787-791`, `:811-818`).
- The fold reads it with the raw display path: `archivedCountMap?.get(group.cwd)` (`packages/client/src/components/session/SessionList.tsx:2802`).
- The same raw `group.cwd` keys the page cache and the expanded set, while the invalidation loop iterates the server keys (`SessionList.tsx:547-606`, `packages/client/src/hooks/useArchivedSessions.ts:35`).
- On darwin/win32, `"/Users/x/Proj"` never equals `"/users/x/proj"`, so the count reads as 0 and the fold is hidden.
- A live check found 203 archived rows on one macOS host, all with mixed-case `cwd`.

### Why the client cannot normalise on its own today

- The client's platform guess `inferPlatform()` returns `"linux"` for every `/`-rooted path (`session-group-path.ts:20-31`, used at `SessionList.tsx:642-650`).
- A macOS server is therefore indistinguishable from a Linux one. The client has no other source for the server's platform: `browser-protocol.ts` carries no server-platform field.

### Paths that already work

- The listing endpoint re-normalises its `cwd` query with `pathKey` (`session-archive.ts:440-443`), so any spelling of a folder resolves its bucket.
- Archive *search* groups items by `item.groupPath`, the display path (`SessionList.tsx:617-628`). It shares the raw-spelling fragility with the fold. It works today only when the live group's spelling equals the row's spelling.

### Funnel toggle inconsistency

- The popover (`SessionList.tsx:2994-3026`) holds two different controls:
  - a hand-rolled `<button>` with `mdiArchiveOutline` and the lowercase label `archive` (`:3007-3021`)
  - `ToggleButton` with the label `Hidden` and no icon (`:3022-3024`; `ToggleButton` at `:378-403`)
- The panel is `flex flex-col`, whose default stretch already gives both buttons equal width. The visible mismatch is case, icon presence and the missing selected mark, not width.
- `ToggleButton` is also used by the Sessions/Folders scope toggles (`SessionList.tsx:2955-2969`).

## Goals / Non-Goals

**Goals**
- The fold renders on every host platform whenever a folder has archived sessions. This includes pinned folders, worktree groups and trailing-separator or case spelling variants.
- One key function drives the fold's count lookup, page cache, expanded state, invalidation, and archive-search grouping, and it is the server's own `pathKey`.
- Both funnel toggles look and behave as one family (option A in `mockups/filter-funnel-chips`). The Sessions/Folders scope toggles are unchanged.

**Non-Goals**
- Changing the server's index keying, its wire keys, the listing endpoint or archive search semantics.
- Replacing `inferPlatform()` for non-archive uses such as collapse and pin keys.
- The popover options B and C, and hint text under each toggle.

## Decisions

### D1. The snapshot carries the server's path-key platform; the client keys all archive state with it

- **Server.** `sessions_snapshot` gains an optional `pathKeyPlatform: "linux" | "darwin" | "win32"` (additive, `browser-protocol.ts` next to `archivedCountByCwd` at `:676`).
  - The gateway fills it from the same platform the archive index uses: expose `sessionArchive.platform` and send it alongside `archivedCountByCwd` (`browser-gateway.ts:2007-2012`).
  - The wire keys stay the index keys. No emitter changes.
- **Client state.**
  - `App.tsx` adds `useState<NodeJS.Platform | undefined>` next to `archivedCountMap` (`App.tsx:816`). It adds the setter to the handler-deps bundle (`App.tsx:~1228`) and passes the value to `SessionList` as `archiveKeyPlatform` (`App.tsx:2270`).
  - `useMessageHandler` gains an optional `setPathKeyPlatform` dep (deps interface `~:198-202`, destructure `~:335`). On `sessions_snapshot` it assigns `msg.pathKeyPlatform` **unconditionally**, `undefined` included, next to the count replace at `:1781`. A reconnect to an older server therefore clears a stale platform.
  - `clearInMemoryState` (`App.tsx:1027-1036`) resets it to `undefined` next to `archivedCountMap`, so a server switch never reuses another host's platform.
- **Client key function.** `SessionList` defines `archiveKey(p) = pathKey(p, archiveKeyPlatform ?? collapsePlatform)`. When an older server sends no field, the fallback reproduces today's behaviour.
- **Client call sites.** `archiveKey(group.cwd)` replaces raw `group.cwd` at:
  - the fold's count lookup and `getArchivedPage`
  - `toggleArchiveExpanded`
  - the `archiveExpanded` membership
  - `loadArchivedFirst` / `loadArchivedMore` / `retryArchived` for folder keys
- **Invalidation loop.** `archiveExpanded` and the page cache store folded keys only. The loop iterates server keys, so `archiveExpanded.has(cwd)` (`SessionList.tsx:598`) and `archivedCountMap?.get(cwd)` (`:604`) now compare folded against folded with no further edit (`SessionList.tsx:590-606`).
- **Fetch.** The `cwd` query sends the folded key. The server's `pathKey` is idempotent, so it resolves the same bucket. `isAbsolute` still passes because folding keeps the root.
- **Archive search grouping.** `archivedMatchesByGroup` keys by `archiveKey(item.groupPath)` (`SessionList.tsx:617-628`). Every reader looks it up with `archiveKey(<group cwd>)`. Today the readers are:
  - the folder-visibility gate (`:1417`, `:1425`)
  - `renderArchiveMatches` (`~:2042`)

  The implementer greps `archivedMatchesByGroup` and `archivedCountMap` and converts every hit. No raw-`cwd` read of either map may remain.
- **Why this covers pins and worktrees.**
  - A pinned live group uses the pin spelling as `cwd` (`packages/client/src/lib/session/session-grouping.ts:160-168`). The server buckets a pin-hit row under `pathKey(row.cwd)`, which equals `pathKey(pin)` by definition of a pin hit (`session-group-path.ts:58-68`).
  - A worktree group's `cwd` is the main path, which is the same input the server keys.

*Alternatives considered*
- **Display-path wire keys.** Key the wire by the newest row's `groupPath`. Two reviewers rejected it because it breaks pinned spellings, regresses Linux trailing-separator matching, loses folders with mixed spellings and leaves stale keys on representative change.
- **Client case-insensitive fallback.** On Linux it conflates folders that differ only in case.

### D2. One toggle component for both funnel entries

- Extend the local `ToggleButton` (`SessionList.tsx:378`) with an optional `icon` (mdi path). When `icon` is given, it renders the leading icon, `w-full justify-start`, and a trailing `mdiCheck` shown only while `active` (`aria-hidden`). Without `icon`, the markup is byte-identical to today, so the scope toggles are unchanged.
- Use it for both funnel entries:
  - `Archived` with `mdiArchiveOutline`
  - `Hidden` with `mdiEyeOffOutline`
- Keep:
  - the test ids `search-include-archive` and `show-hidden-toggle`
  - `aria-pressed`
  - persistence
  - the badge
  - focus-first-toggle (`SessionList.tsx:579`)
- Colours stay on the existing token classes (`var(--accent)`, `var(--accent-soft)`, `var(--border-secondary)`, `var(--text-*)`).
- i18n:
  - In `packages/client/src/lib/i18n-en-source.json`, change `sessionList.includeArchive` from `archive` to `Archived`, and the in-code fallback with it.
  - `hu` and `zh-CN` keep their existing translations. The Title-Case requirement concerns the English label.
- New imports: `mdiCheck`, `mdiEyeOffOutline` (`SessionList.tsx:13`).

## Risks / Trade-offs

- **Older-server compatibility.** A client against a server without `pathKeyPlatform` falls back to `collapsePlatform`, which is today's behaviour: the fold stays broken on macOS until the server updates. There is no regression.
- **Newer server, older client.** The extra snapshot field is ignored, so behaviour is unchanged.
- **Lowercased `cwd` in fetch URLs** on darwin/win32 appears in server logs (`session-routes.ts:190`). This is cosmetic only.
- **Case-variant live groups (pre-existing).** Client grouping still uses `inferPlatform()` (`session-grouping.ts:107`), so on macOS `/Users/x/Proj` and `/users/x/proj` render as two live groups. Both now fold to one archive key and both show the same `Archive (N)`. They share one expanded state and one page cache, so expanding either expands both. This is accepted: the counts are correct, and unifying live grouping is out of scope.
- **Worktree under a case-variant pin (known limitation).** On darwin, suppose the user pins `/Users/x/Proj/.worktrees/w` and a worktree session reports `cwd = /users/x/proj/.worktrees/w`. The server pin-hits, because it folds case (`session-archive.ts:144-146`, `session-group-path.ts:63-64`), and buckets the row under the worktree path. The client does not pin-hit, because it infers `linux`, and groups the session under its main path. That archived row then counts under the worktree key, which has no live group, so the main folder's fold excludes it. Search still reaches it. Fixing this means giving client grouping the server platform, which is a separate change.
- **Pre-existing mdi exception.** The Sessions/Folders scope toggles have no icon today, contrary to the broad mdi-icon-system "buttons display an MDI icon" rule. This change keeps them unchanged and does not widen the gap.
- **Pill-token guard anchor.** `packages/client/src/lib/__tests__/card-pill-surfaces-no-literals.test.ts:113-128` locates a JSX element whose literal `data-testid` is `"search-include-archive"`. After D2 that test id is passed as a `testId` prop to `ToggleButton`, which the guard already scans. The guard drops the archive anchor (theme-system delta), and its `found` check becomes three regions.
