# verify-plugin-install-load.mjs — index

Dynamic install-load check: pack a plugin workspace, install it OUTSIDE the repository, and import its server entry under plain node+jiti with `JITI_TSCONFIG_PATHS` unset and no repository tsconfig reachable.

WHY DYNAMIC. `scripts/verify-published-imports.mjs` proves every shipped import is *declared*; it cannot prove the import *resolves* (`paths` / `resolve.alias` / the env flag all satisfy a static check while failing a consumer). This exercises the loader's own contract, `typeof mod.default === "function"`, where no alias layer exists.

WORKTREE, NOT REGISTRY. The plugin's first-party workspace dependencies (`dashboard-plugin-runtime`, `pi-dashboard-shared`) are packed from the working tree and forced in via `overrides`, so the verified graph is the change under test. The closure is TRANSITIVE (a plugin depending on `…-mcp-server-plugin`, which depends on `…-mcp-client-plugin`, needs an override for each), and it is PROVEN by reading npm's own `resolved` metadata (`npm ls --json --all`) — a registry install resolves to an https URL, a local one to `file:<tarball>`. A version-string equality check alone cannot tell the two apart when they share a version.

Registry resolution would test a stale published copy — and would fail spuriously on a release-prep PR whose versions are not yet published (the hazard `bundle-server.mjs` documents).

jiti is driven through its `createJiti` API, NOT the `--import jiti/register` ESM hook. Both are "plain node + jiti", but only the API reproduces what the server's loader sees: `loader.ts` is itself jiti-evaluated, so its `await import(plugin.serverEntryPath)` goes through jiti's CJS interop and yields the default export directly. The ESM hook wraps it (`mod.default.default`) — a harness artifact, not a product defect, and the interop gap the change's proposal said to surface rather than paper over. `tsconfigPaths: false` is jiti's default, stated explicitly.

Also imports `cdpRelay.js` for the browser plugin — the 4 specifiers the runtime chain never reaches.

SCOPE. Workspaces whose `pi-dashboard-plugin` manifest declares a `server` entry; `packages/demo-plugin` is `fixture: true` and client-only, so it is reported `skipped`, never failed. `--only <rel|name>` narrows to one workspace.

Exports `runInstallLoadCheck`, `verifyWorkspace`, `listAllWorkspaces`, `listPluginWorkspaces`, `selectInScope`, `firstPartyWorkspaceDeps`, `packWorkspace`, `resolveInstalled`, `resolveJitiLib`.

See change: fix-browser-plugin-vendor-specifier-resolution (D6).
