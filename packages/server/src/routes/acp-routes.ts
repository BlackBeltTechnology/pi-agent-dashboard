/**
 * `GET /api/acp/agents` — the spawn picker's agent list.
 *
 * Browsers receive configured ACP agents ONLY as `{ id, name }`: never the
 * command, args or env (credentials). Empty when none are configured, which is
 * what keeps every spawn control rendering exactly as before.
 *
 * See change: add-acp-session-driver (D16).
 */
import type { ApiResponse } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import type { FastifyInstance } from "fastify";
import { acpAgentsForClient } from "../spawn-process/acp-spawn.js";

export function registerAcpRoutes(fastify: FastifyInstance): void {
  fastify.get("/api/acp/agents", async () => ({ success: true, data: acpAgentsForClient() }) satisfies ApiResponse<Array<{ id: string; name: string }>>);
}
