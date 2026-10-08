# DOX — packages/team-app/src/agent

One row per file. See change: add-team-plugin.

| File | Purpose |
|------|---------|
| `AgentView.tsx` | Conversation list pane + chat pane (two panes ≥ 1024 px), archived filter, limit state, not-found states; header chips list `effectiveSkills`; `skillBlock` hides new-conversation + shows the reason note, still opens existing conversations. See change: add-team-plugin. See change: add-team-skill-access. |
| `ChatPane.tsx` | Ensure → socket → `ChatView` + `CommandInput`; spawn/resume/ready/reconnecting/stale/archived/read-only/error states; rename / archive / restore / delete / restart / open-in-dashboard. `CommandInput` is a direct `.chat-pane` child (no wrapper) so its `max-h-[40%]` resolves against the pane, not a shrink-wrapped box. Skill block: `409 skill_not_allowed` or card `skillBlock` → reason-specific error banner (admin fix action, member note), disabled composer card; a ready session's transcript stays mounted read-only (`ChatBody readOnly`) so the history remains readable. Composer pre-check: controlled draft + `parseSkillCommand`; ungranted `/skill:` never sends, text kept, `invalid` on the field, `composer-error` lists `/skill:<effective>`. See change: add-team-plugin. See change: add-team-skill-access. Skill-blocked + no live session: fetches `api.history` and mounts the transcript read-only (404 → empty). See change: add-team-skill-access. |
| `chat-providers.tsx` | Provider stack `ChatView` needs (standalone only). See change: add-team-plugin. |
| `chat-session.ts` | `useTeamChat`: ticketed reconnecting socket → `useSessionState`; re-subscribes `lastSeq: 0` on every open. See change: add-team-plugin. |
