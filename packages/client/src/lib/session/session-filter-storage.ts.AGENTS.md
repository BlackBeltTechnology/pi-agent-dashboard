# session-filter-storage.ts — index

localStorage persistence for session-list filter state. Exports `removeLegacyHiddenSessions`, `getActiveOnly`/`setActiveOnly` (default ON), `getCollapsedGroups`/`setCollapsedGroups`, `pruneStaleCollapsedGroups(knownCwds)`. Keys: `dashboard:activeOnly`, `dashboard:collapsedGroups`; removes legacy `dashboard:hiddenSessions` (server-side hidden now source of truth).
