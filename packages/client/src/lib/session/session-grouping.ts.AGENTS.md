# session-grouping.ts — index

Pure session grouping/sorting/filtering utilities. Exports `DirectoryGroup`, `WorkspaceGroup`, `sortSessionsByOrder`, `getUnifiedOrder`, `groupSessionsByDirectory`, `groupSessionsByDirectoryWithWorkspaces`, `filterSessions`, `filterByQuery`, `rankActiveFirst`; re-exports `inferPlatform`, `pathKey`, `resolveSessionGroupPath` from shared. Group-key precedence: pin > `gitWorktree.mainPath` > `cwd`; keyed by canonical `pathKey` to collapse cosmetic drift. See change: simplify-session-card-ordering, folder-workspaces.
