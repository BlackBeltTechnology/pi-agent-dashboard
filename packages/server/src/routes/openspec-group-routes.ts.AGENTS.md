# openspec-group-routes.ts — index

REST routes for `/api/openspec/groups` CRUD + assignment. Adds PUT `/api/openspec/groups/change-order` (body `{groupId, order:string[]}`) → `store.setChangeOrder`. See change: add-openspec-change-grouping. See change: redesign-openspec-board.

`routeAdmission` dep (default = own known set). `admitGroupsCwd` → `createOpenSpecAdmission().admitUngatedCwd`: pinned / workspace folders / worktrees admitted; non-absolute, unknown or the global OpenSpec config dir (also via symlink) → 403 `cwd_unknown`; undecidable → 503. Missing cwd stays 400. See change: core-file-cwd-admission.
