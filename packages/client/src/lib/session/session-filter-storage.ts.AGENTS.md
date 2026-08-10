# session-filter-storage.ts — index

localStorage persistence for session-list filter state. Exports `removeLegacyHiddenSessions`, `getActiveOnly`/`setActiveOnly` (default ON), `getCollapsedGroups`/`setCollapsedGroups`, `pruneStaleCollapsedGroups(knownCwds)`, `getTagAreaOpen`/`setTagAreaOpen` (sidebar tag-area master collapse; absent ⇒ collapsed). Keys: `dashboard:activeOnly`, `dashboard:collapsedGroups`, `sidebar.tagArea.open`; removes legacy `dashboard:hiddenSessions` (server-side hidden now source of truth). See change: sidebar-tag-collapse-and-delete.
