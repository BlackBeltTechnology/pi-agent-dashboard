// Public surface of the git scope (change: add-kb-git-forge-scope).

export type { GitScopeDeps } from "./deps.js";
export type { ForgeAdapter, ForgeItem, ForgePage } from "./forge/types.js";
export type { GitKind, GitResult, GitScopeOptions } from "./scope.js";
export { createGitScope, GitScope } from "./scope.js";
