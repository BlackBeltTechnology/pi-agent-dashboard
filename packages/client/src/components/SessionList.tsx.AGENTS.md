# SessionList.tsx — index

Main sidebar session list. DnD-ordered (`@dnd-kit`) pinned/unpinned + workspace tiers, folder grouping, active-first ranking, show-hidden toggle, session/workspace filters, ended-collapse, urgency sort, drag-to-resume, spawn/worktree dialogs, OpenSpec sections, terminal/editor affordances. Exports `SessionList`, re-exports `DirectoryGroup`, `filterSessions`, `groupSessionsByDirectory`.
 `renderGroup` folder panel container (`rounded-[14px]` div) gains neutral panel bevel `shadow-[inset_0_1px_0_var(--elevation-rim),0_2px_4px_var(--shadow-card)]` matching workspace/card recipe. See change: add-panel-elevation-system.

Accepts `noticeSessionIds?: Set<string>`; passes `hasNotice={noticeSessionIds?.has(session.id)}` to SessionCard alongside hasError/isRetrying. See change: fix-gemini-subagent-silent-tool-schema-failure.
