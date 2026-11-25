# DOX — packages/agent-teams-plugin/src/client

Files in this directory. One row per source file. Eager = in the cold chunk (no `@mdi`); lazy = manifest `module`.

| File | Purpose |
|------|---------|
| `MailEntryCard.tsx` | PLACEHOLDER (lazy; 3 `custom-entry-renderer` claims, export `MailEntryCard`). Renders null. Second pass replaces with real card on `mail-parse.ts`. See change: add-agent-teams-ui. |
| `TeamBadge.tsx` | Eager `session-card-badge` claim `TeamBadge`. Decided mock B: `◆ Team │ Lead` / `◇ Team │ name`, neutral severity tokens, wouter `Link` to `teamViewPath(id)`, `stopPropagation` on click, aria-label "Open team view, <role>". Null when `teamRoleOf` null. See change: add-agent-teams-ui. |
| `TeamToolRenderers.tsx` | PLACEHOLDER (lazy; 11 `tool-renderer` claims, 4 exports from `FAMILY_COMPONENTS`). Render null. Second pass replaces. See change: add-agent-teams-ui. |
| `TeamView.tsx` | PLACEHOLDER (lazy; `shell-overlay-route`, export `TeamViewClaim`, also default). Renders null. Second pass replaces; mounts `TeamsFeeder`. See change: add-agent-teams-ui. |
| `announcements.ts` | `diffSnapshots(prev,next)` → events (member status, task completed, team closed; first snapshot = baseline). `createAnnouncer(emit)`: ≤ 1 merged summary per 4 s (leading + trailing). `announcementLines(summary)` → i18n keys + vars. Ids/names/statuses only, never text. See change: add-agent-teams-ui. |
| `index.tsx` | Eager entry. Exports exactly `catalog`, `TeamBadge`, `isTeamSession`. Never export/import a lazy claim component. See change: add-agent-teams-core, add-agent-teams-ui. |
| `mail-parse.ts` | `parseMailBody(body)` → `mail`/`truncated`/`unrecognised`, built on core `parseEnvelope` (no second grammar); first line at offset 0 only; CRLF after header ok; reserved/out-of-grammar sender ⇒ unrecognised; `«N earlier lines hidden»` ⇒ truncated. `parseNoticeItems(body)`: `• ` item, `│ ` continuation, other line = legacy item. See change: add-agent-teams-ui. |
| `routes.ts` | Eager. `TEAM_VIEW_ROUTE`, `TEAM_VIEW_PARENT_ROUTE`, `TEAMS_API`, `teamViewPath(id)` (encodeURIComponent). Manifest claim path equals `TEAM_VIEW_ROUTE`. See change: add-agent-teams-ui. |
| `status-map.ts` | Single D12 table: member/team/task status → `{glyph, textKey, pill}` (+ `sentenceKey` for members), `TASK_BLOCKED`, `URGENT_MARKER`, `UNKNOWN_STATUS`; `memberStatusEntry`/`teamStatusEntry`/`taskStatusEntry` never throw. Text keys live in the lazy view's table. See change: add-agent-teams-ui. |
| `team-refs.ts` | Eager. `teamRoleOf(session)`, `isTeamSession` predicate over top-level `agent-teams` / `agent-teams-lead` refs; non-empty string `teamId`; both ⇒ lead; `{teamId:null}` ⇒ none. See change: add-agent-teams-ui. |
| `teams-feeder.tsx` | `TeamsFeeder({sessionId, leadSessionId?, store?})` render-less. Watches session in store; pushes newest `agent-teams:changed` frame (`frameOf`); signals reconnect; ignores events reset. Core snapshot lacks lead session id → teammate view gets no frames (timer/reconnect/visibility only). See change: add-agent-teams-ui. |
| `teams-hooks.ts` | `useTeamEntry(teamId)`, `useSessionLookup(sessionId)` via `useSyncExternalStore`; stable refs, 304 path = no re-render. See change: add-agent-teams-ui. |
| `teams-store.ts` | Module store `teamsStore` / `createTeamsStore(opts)`. Cache by team id, session lookup, single-flight conditional refetch (500 ms debounce, 2 000 ms max-wait, 60 s safety timer fires at once, hidden tab = no polling), backoff 1/2/4 s then 30 s, `Retry-After` clamp [1 s,120 s] (`parseRetryAfter`), `stopMember`/`shutdownTeam` (15 s timeout, refetch, never retried). See change: add-agent-teams-ui. |
| `tool-families.ts` | `TOOL_FAMILIES` (11 `TeamOp` → 4 families) + `FAMILY_COMPONENTS`. Single source for manifest tool claims and the lazy renderer table. See change: add-agent-teams-ui. |
| `__tests__/` | → see `__tests__/AGENTS.md`. |
