# codeql-anchor/plugin-routes.mjs — index

CodeQL analysis anchor, never imported/executed/published: exported `codeqlPluginRoutesAnchor()` gives real `Fastify()` to 5 plugin registrars hidden by `paths-ignore` (`mountAutomationRoutes`, `mountTeamRoutes`, `registerGoalRoutes`, `registerBlackholeRoutes`, `mountRolesRoutes`). Top level = imports + exported fn only; no `listen(`. Pinned by `packages/shared/src/__tests__/codeql-anchor-contract.test.ts`. See change: fix-codeql-baseline-coverage.
