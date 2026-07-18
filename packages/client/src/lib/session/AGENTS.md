# DOX — packages/client/src/lib/session

Files in this directory. One row per source file. See change: fold-oversized-agents-directories.

| File | Purpose |
|------|---------|
| `selectedSessionId.ts` | Pure derivation of selected session id from wouter route matches. → see `selectedSessionId.ts.AGENTS.md` |
| `selectViewedSessionId.ts` | Pure selector for currently-viewed session id from `/session/:id` route. → see `selectViewedSessionId.ts.AGENTS.md` |
| `session-card-time.ts` | Pure picker of session-card relative-time badge anchor timestamp. Exports `selectBadgeTimestamp(session)`. → see `session-card-time.ts.AGENTS.md` |
| `session-display-name.ts` | Pure derivation of session display name. Exports `getSessionDisplayName(session)` → name → firstMessage (truncated 50 chars) → cwd last segment → ID prefix (8 chars). |
| `session-filter-storage.ts` | localStorage persistence for session-list filter state. Exports `removeLegacyHiddenSessions`,… → see `session-filter-storage.ts.AGENTS.md` |
| `session-grouping.ts` | Pure session grouping/sorting/filtering utilities. Exports `DirectoryGroup`, `WorkspaceGroup`,… → see `session-grouping.ts.AGENTS.md` |
| `session-list-scroll.ts` | Pure helper producing stable scroll-fingerprint of selected session card's position-affecting state. → see `session-list-scroll.ts.AGENTS.md` |
| `session-status-visuals.ts` | Shared session-status visual primitives. Exports `statusColors`, `sourceIcons`, `sourceLabels`,… → see `session-status-visuals.ts.AGENTS.md` |
| `SessionAssetsContext.tsx` | Per-session image-asset registry context resolving `pi-asset:<hash>` srcs in `MarkdownContent` |
