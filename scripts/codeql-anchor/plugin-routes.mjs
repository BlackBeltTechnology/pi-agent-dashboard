/**
 * CodeQL analysis anchor — NEVER imported, NEVER executed.
 *
 * Plugin route modules take `fastify: FastifyInstance` through a type-only
 * import and production loads plugins dynamically, so the only resolvable
 * `Fastify()` → registrar call path lived in test files, which
 * `.github/codeql/codeql-config.yml` ignores (`**\/__tests__/**`, kept on
 * purpose). This file gives each allowlisted registrar a real `Fastify()` so
 * both analyses (CI and `scripts/codeql-local.mjs`) treat its handlers as HTTP
 * sources.
 *
 * Allowlist = registrars whose module showed ≥1 hidden production result in a
 * run with the test ignores lifted. Pinned by
 * `packages/shared/src/__tests__/codeql-anchor-contract.test.ts`: top level
 * holds only imports and this exported function; no `listen(`.
 *
 * See change: fix-codeql-baseline-coverage.
 */
import Fastify from "fastify";
import { mountAutomationRoutes } from "../../packages/automation-plugin/src/server/routes.ts";
import { registerBlackholeRoutes } from "../../packages/blackhole-plugin/src/server/index.ts";
import { registerGoalRoutes } from "../../packages/goal-plugin/src/server/routes.ts";
import { mountRolesRoutes } from "../../packages/roles-plugin/src/server/roles-routes.ts";
import { mountTeamRoutes } from "../../packages/team-plugin/src/server/routes.ts";

export async function codeqlPluginRoutesAnchor() {
  const fastify = Fastify();
  mountAutomationRoutes(fastify, {});
  await mountTeamRoutes(fastify, {});
  registerGoalRoutes(fastify, {});
  registerBlackholeRoutes(fastify, { logger: console, env: process.env });
  mountRolesRoutes(fastify, {});
}
