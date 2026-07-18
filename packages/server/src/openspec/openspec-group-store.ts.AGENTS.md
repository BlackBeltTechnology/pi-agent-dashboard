# openspec-group-store.ts — index

OpenSpec group store. Persists groups + assignments + `changeOrder: Record<groupId, changeName[]>` in groups.json (groupId or `__ungrouped__` sentinel via `OPENSPEC_UNGROUPED_KEY`). `createOpenSpecGroupStore(opts)` returns store with CRUD + `setChangeOrder(cwd, groupId, order[])` mutator. Subscriber payload + broadcast carry `changeOrder`. See change: add-openspec-change-grouping. See change: redesign-openspec-board.
