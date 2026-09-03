# DOX — packages/client/src/lib/session

Files in this directory. One row per source file. See change: fold-oversized-agents-directories.

| File | Purpose |
|------|---------|
| `retry-projection.ts` | Pure projection of per-session `retryState` into the card-side pair `{ retrySessionIds, retryAttemptMap }`. Exports `deriveRetryProjection(sessionStates)`, `RetryProjection`. Membership is `retryState` alone — NOT gated on `!lastError`, which excluded the common retry-while-errored case. See change: unify-retry-visibility. |
| `selectedSessionId.ts` | Pure derivation of selected session id from wouter route matches. → see `selectedSessionId.ts.AGENTS.md` |
| `selectViewedSessionId.ts` | Pure selector for currently-viewed session id from `/session/:id` route. → see `selectViewedSessionId.ts.AGENTS.md` |
| `session-card-time.ts` | Pure picker of session-card relative-time badge anchor timestamp. Exports `selectBadgeTimestamp(session)`. → see `session-card-time.ts.AGENTS.md` |
| `session-display-name.ts` | Pure derivation of session display name. Exports `getSessionDisplayName(session)` → name → firstMessage (truncated 50 chars) → cwd last segment → ID prefix (8 chars). |
| `session-filter-storage.ts` | localStorage persistence for session-list filter state. Exports `removeLegacyHiddenSessions`,… → see `session-filter-storage.ts.AGENTS.md` |
| `session-grouping.ts` | Pure session grouping/sorting/filtering utilities. Exports `DirectoryGroup`, `WorkspaceGroup`,… → see `session-grouping.ts.AGENTS.md` |
| `session-list-scroll.ts` | Pure helper producing stable scroll-fingerprint of selected session card's position-affecting state. → see `session-list-scroll.ts.AGENTS.md` |
| `session-origin-view.ts` | Pure view predicates over a session's ORIGIN and MOVE state: `isRemoteOrigin(session)` (`originDeviceId` present; ABSENT MEANS LOCAL, which every pre-existing session relies on) and `hasMovedAway(session)` (`movedTo` present). Consumed by `SessionCard.tsx` (moved badge + origin chip), `SessionHeader.tsx` and `MobileActionMenu.tsx` to gate resume/fork — a remote-origin session's files are on another host and the server refuses the resume with 409. See change: add-pi-gateway-transport-identity. |
| `session-status-visuals.ts` | Shared session-status visual primitives. Exports `statusColors`, `sourceIcons`, `sourceLabels`,… → see `session-status-visuals.ts.AGENTS.md` |
| `SessionAssetsContext.tsx` | Per-session image-asset registry context resolving `pi-asset:<hash>` srcs in `MarkdownContent` |
