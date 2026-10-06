# DOX — packages/team-app/src/agent

One row per file. See change: add-team-plugin.

| File | Purpose |
|------|---------|
| `AgentView.tsx` | Conversation list pane + chat pane (two panes ≥ 1024 px), archived filter, limit state, not-found states. See change: add-team-plugin. |
| `ChatPane.tsx` | Ensure → socket → `ChatView` + `CommandInput`; spawn/resume/ready/reconnecting/stale/archived/read-only/error states; rename / archive / restore / delete / restart / open-in-dashboard. See change: add-team-plugin. |
| `chat-providers.tsx` | Provider stack `ChatView` needs (standalone only). See change: add-team-plugin. |
| `chat-session.ts` | `useTeamChat`: ticketed reconnecting socket → `useSessionState`; re-subscribes `lastSeq: 0` on every open. See change: add-team-plugin. |
