# Proposal: fix-archive-fold-key-and-filter-chips

## Why

On macOS and Windows the per-folder `Archive (N)` fold never renders, so archived sessions can only be reached through search. The server keys archived counts by `pathKey()`, which lowercases on darwin/win32. The client looks the count up by the folder's display path, which keeps its case. Every lookup misses. A live macOS dashboard has 203 archived sessions, all under mixed-case paths, and no visible fold.

The filter-funnel popover also renders its two toggles inconsistently. Include archive is a hand-rolled lowercase `archive` chip with an icon. Show hidden is a `ToggleButton` labelled `Hidden` with no icon. Neither shows a selected mark.

## What Changes

- `sessions_snapshot` gains an optional `pathKeyPlatform` field: the platform the server folds archive keys with. The field is additive and wire keys are unchanged.
- The client keys all archive state with the server's `pathKey(…, pathKeyPlatform)`. This covers the fold's count lookup, the page cache, expanded state, invalidation and archive-search grouping. As a result, case, trailing-separator and pinned-spelling variants all match the server's bucket. Without the field (older server), the client falls back to today's behaviour.
- Both funnel toggles render through the same `ToggleButton`, each with an icon, in Title Case (`Archived`, `Hidden`), at full popover width, with a check mark when on. Test ids, persistence, the badge count and behaviour do not change. The Sessions/Folders scope toggles are unchanged.
- Mockup: mockups/filter-funnel-chips (in this change). Option A is the chosen design.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `archived-session-listing`: the snapshot carries the server's path-key platform. The folder fold, and archive-search grouping, match folders by the server's key on every platform. The Include-archive chip is restyled as an `Archived` toggle.
- `shared-protocol`: the `SessionsSnapshotMessage` shape lists `archivedCountByCwd` (already sent) and the new optional `pathKeyPlatform`.
- `session-listing`: the snapshot also replaces the client's archive key platform.
- `theme-system`: the pill-token guard no longer anchors on a dedicated `search-include-archive` element, because that chip now renders through the already-scanned `ToggleButton`.
- `session-filtering`: the Show hidden funnel toggle is labelled `Hidden` with an icon and a check mark, matching the Archived toggle.

## Impact

- `packages/shared/src/browser-protocol.ts`: optional `pathKeyPlatform` on `SessionsSnapshotMessage`.
- `packages/server/src/session/session-archive.ts` exposes its platform. `packages/server/src/pairing/browser-gateway.ts` sends it in the snapshot.
- `packages/client/src/hooks/useMessageHandler.ts`, `App.tsx` and `SessionList.tsx` gain the archive key function, the funnel popover markup and the `ToggleButton` icon/check slot. `i18n-en-source.json` changes the `includeArchive` label.
- Tests: the server gateway snapshot, SessionList fold and funnel unit tests, and `tests/e2e/archive-fold.spec.ts`.
- The protocol change is additive and optional. Old and new clients and servers interoperate, and an old server keeps today's behaviour.

## Discipline Skills

- `review-code`: non-trivial change across the server and client before commit.
- No security, performance, observability or irreversible-step triggers: no auth, no untrusted input, no new endpoint, no migration.
