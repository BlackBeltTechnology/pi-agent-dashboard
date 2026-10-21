/**
 * Automatic-setup routes + availability (design D3, D10). Mounted into the Gmail
 * scope by `routes.ts`, so they share its prefix, rate limit and network guard.
 * Starting a run additionally requires a genuinely local request. Responses carry
 * the secret-free run view only. See change: add-gmail-auto-setup.
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { AutoSetupState, SetupContinueRequest, SetupRunRequest } from "../../shared/auto-setup.js";
import { classifyProjectId, isEmail, normalizeEmail, normalizeProjectId } from "../../shared/setup.js";
import type { AccountStore } from "../accounts.js";
import type { DedicatedBrowserService } from "./browser-service.js";
import { isGenuinelyLocal } from "./local.js";
import type { SetupRunManager } from "./run.js";

export interface SetupRouteDeps {
  prefix: string;
  guard: unknown;
  store: AccountStore;
  manager: SetupRunManager;
  getService(): DedicatedBrowserService | undefined;
}

const PROJECT_ID_RULE = "projectId must be a Google Cloud project id: 6–30 chars, lower-case letters, digits and hyphens";
const EMAIL_RULE = "ownerEmail must be an email address of at most 254 characters";

function isLocal(request: FastifyRequest): boolean {
  return isGenuinelyLocal(request.headers, request.socket.remoteAddress);
}

/** `GET state` → `autoSetup` (design D10). */
export async function autoSetupState(request: FastifyRequest, deps: SetupRouteDeps): Promise<AutoSetupState> {
  const local = isLocal(request);
  const service = deps.getService();
  if (!service) return { available: false, reason: "service_missing", local };
  let status: Awaited<ReturnType<DedicatedBrowserService["status"]>>;
  try {
    status = await service.status();
  } catch {
    return { available: false, reason: "status_failed", local };
  }
  if (!status.enabled) return { available: false, reason: "disabled", local };
  if (!status.available) return { available: false, reason: status.reason ?? "unavailable", local };
  const client = await deps.store.getClient();
  if (client && (await deps.store.list()).length > 0) return { available: false, reason: "client_in_use", local };
  if (!local) return { available: false, reason: "remote_dashboard", local };
  const live = deps.manager.live;
  if (live) return { available: false, reason: "run_active", local, runId: live.id };
  return { available: true, local, ...(client ? { replacesClient: true } : {}) };
}

export function registerSetupRoutes(scope: FastifyInstance, deps: SetupRouteDeps): void {
  const guarded = { preHandler: deps.guard as never };
  const base = `${deps.prefix}/setup/run`;

  scope.post(base, guarded, async (request, reply) => {
    if (!isLocal(request)) return reply.code(403).send({ error: "remote_dashboard" });
    const body = (request.body ?? {}) as Partial<Record<keyof SetupRunRequest, unknown>>;
    if (body.mode !== "new" && body.mode !== "existing") {
      return reply.code(400).send({ error: "invalid_mode", message: 'mode must be "new" or "existing"' });
    }
    const ownerEmail = typeof body.ownerEmail === "string" ? normalizeEmail(body.ownerEmail) : "";
    if (!isEmail(ownerEmail)) return reply.code(400).send({ error: "invalid_owner_email", message: EMAIL_RULE });
    let projectId: string | undefined;
    if (body.projectId !== undefined && body.projectId !== null && body.projectId !== "") {
      if (typeof body.projectId !== "string") return reply.code(400).send({ error: "invalid_project_id", message: PROJECT_ID_RULE });
      projectId = normalizeProjectId(body.projectId);
      if (classifyProjectId(projectId) !== "ok") return reply.code(400).send({ error: "invalid_project_id", message: PROJECT_ID_RULE });
    }
    if (body.mode === "existing" && !projectId) {
      return reply.code(400).send({ error: "invalid_project_id", message: PROJECT_ID_RULE });
    }
    const state = await autoSetupState(request, deps);
    if (!state.available) {
      if (state.reason === "run_active") return reply.code(409).send({ error: "run_active" });
      return reply.code(409).send({ error: "unavailable", reason: state.reason });
    }
    const run = deps.manager.start({ mode: body.mode, projectId, ownerEmail });
    if (!run) return reply.code(409).send({ error: "run_active" });
    return { runId: run.id };
  });

  scope.get<{ Params: { id: string } }>(`${base}/:id`, guarded, async (request, reply) => {
    const run = deps.manager.get(request.params.id);
    if (!run) return reply.code(404).send({ error: "not_found" });
    return run.view();
  });

  scope.post<{ Params: { id: string } }>(`${base}/:id/continue`, guarded, async (request, reply) => {
    const run = deps.manager.get(request.params.id);
    if (!run) return reply.code(404).send({ error: "not_found" });
    const result = run.continue((request.body ?? {}) as SetupContinueRequest);
    if (!result.ok) return reply.code(result.status).send({ error: result.error });
    return run.view();
  });

  scope.post<{ Params: { id: string } }>(`${base}/:id/takeover`, guarded, async (request, reply) => {
    const run = deps.manager.get(request.params.id);
    if (!run) return reply.code(404).send({ error: "not_found" });
    const result = run.takeover();
    if (!result.ok) return reply.code(result.status).send({ error: result.error });
    return run.view();
  });

  scope.delete<{ Params: { id: string } }>(`${base}/:id`, guarded, async (request, reply) => {
    const run = deps.manager.get(request.params.id);
    if (!run) return reply.code(404).send({ error: "not_found" });
    await run.cancel();
    return run.view();
  });
}
