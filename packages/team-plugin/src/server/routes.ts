/**
 * REST surface (D9) under `/api/plugins/team`, in an encapsulated scope with
 * the shared rate limiter. See change: add-team-plugin.
 */
import rateLimit from "@fastify/rate-limit";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Access } from "./access.js";
import type { ConversationService } from "./conversations.js";
import { isTargetId } from "./paths.js";
import type { PersonaService } from "./personas-service.js";
import type { ProjectRegistry } from "./projects.js";
import type { UsersStore } from "./users.js";
import { type Caller, TeamError, WORKSPACE_TARGET } from "./types.js";

const API_PREFIX = "/api/plugins/team";

export interface RouteDeps {
  access: Access;
  personas: PersonaService;
  projects: ProjectRegistry;
  conversations: ConversationService;
  users: UsersStore;
  /** Admin skill catalog names (personas pick names only). */
  skills: () => string[];
  logger: { warn(msg: string): void; error(msg: string): void };
}

export async function mountTeamRoutes(fastify: FastifyInstance, d: RouteDeps): Promise<void> {
  await fastify.register(async (scope) => {
    await scope.register(rateLimit, {
      global: true,
      max: 100_000,
      timeWindow: "1 minute",
      allowList: ["127.0.0.1", "::1"],
    });

    // Encapsulated: never replaces the dashboard's own error handler.
    scope.setErrorHandler((err: unknown, _req, reply) => {
      if (err instanceof TeamError) {
        const body: Record<string, unknown> = { error: err.code };
        if (err.details && typeof err.details === "object") Object.assign(body, err.details);
        return reply.code(err.status).send(body);
      }
      const e = err as { statusCode?: number; code?: string };
      if (typeof e.statusCode === "number" && e.statusCode >= 400 && e.statusCode < 500) {
        return reply.code(e.statusCode).send({ error: "bad_request" });
      }
      d.logger.error(`team.route_error ${err instanceof Error ? err.message : String(err)}`);
      return reply.code(500).send({ error: "internal_error" });
    });

    const caller = (req: FastifyRequest): Caller => {
      const c = d.access.callerOf(req);
      if (!c) throw new TeamError(401, "unauthorized");
      return c;
    };
    /** `?project=` — syntax always; existence/allowance only where `mustExist` (agents list, create). */
    const target = (req: FastifyRequest, c: Caller, mustExist = false): string => {
      const t = (req.query as { project?: unknown })?.project;
      if (typeof t !== "string" || !isTargetId(t)) throw new TeamError(400, "invalid_target");
      if (mustExist && t !== WORKSPACE_TARGET) {
        const p = d.projects.get(t);
        if (!p || !d.projects.canUse(p, c, d.access.mode())) throw new TeamError(404, "project_not_found");
      }
      return t;
    };
    const P = (path: string) => `${API_PREFIX}${path}`;
    const wrap =
      (fn: (req: FastifyRequest, reply: FastifyReply, c: Caller) => unknown) =>
      async (req: FastifyRequest, reply: FastifyReply) =>
        fn(req, reply, caller(req));

    // ── identity ────────────────────────────────────────────────────────────
    scope.get(
      P("/me"),
      wrap((_req, _reply, c) => {
        if (d.access.mode() === "multi") d.users.record(c);
        return { uk: c.uk, iss: c.iss, sub: c.sub, admin: c.admin, mode: d.access.mode(), maxConversations: d.conversations.limit(), skills: d.skills() };
      }),
    );

    // ── projects ────────────────────────────────────────────────────────────
    scope.get(
      P("/projects"),
      wrap((_req, _reply, c) => ({
        projects: d.projects.usableBy(c, d.access.mode()).map((p) => ({
          id: p.id,
          name: p.name,
          contextFiles: p.contextFiles,
          available: p.available,
          source: p.source,
          ...(c.admin ? { path: p.path, users: p.users } : {}),
        })),
      })),
    );

    scope.post(
      P("/projects/match"),
      wrap((req, _reply, c) => {
        const cwds = (req.body as { cwds?: unknown } | undefined)?.cwds;
        if (!Array.isArray(cwds) || cwds.length < 1 || cwds.length > 200 || !cwds.every((x) => typeof x === "string")) {
          throw new TeamError(400, "invalid_cwds");
        }
        const mode = d.access.mode();
        return {
          results: (cwds as string[]).map((cwd) => {
            const p = d.projects.resolveFolder(c, mode, cwd);
            const counts = p ? d.conversations.folderCounts(c, p.id) : null;
            return {
              cwd,
              project: p ? { id: p.id, name: p.name, available: p.available, source: p.source, agents: counts?.agents ?? 0, active: counts?.active ?? 0 } : null,
              enableable: d.projects.enableable(c, cwd),
              manageable: !!p && p.source === "folder" && c.admin,
            };
          }),
        };
      }),
    );

    scope.post(
      P("/projects"),
      wrap((req, reply, c) => {
        const r = d.projects.enable(c, (req.body ?? {}) as Record<string, unknown>);
        return reply.code(201).send(r);
      }),
    );
    scope.patch(
      P("/projects/:id"),
      wrap((req, _reply, c) => {
        d.projects.patch(c, (req.params as { id: string }).id, (req.body ?? {}) as Record<string, unknown>);
        return { ok: true };
      }),
    );
    scope.delete(
      P("/projects/:id"),
      wrap((req, _reply, c) => {
        d.projects.disable(c, (req.params as { id: string }).id);
        return { ok: true };
      }),
    );
    scope.get(
      P("/users"),
      wrap((_req, _reply, c) => {
        if (d.access.mode() === "single") throw new TeamError(404, "not_found");
        if (!c.admin) throw new TeamError(403, "admin_required");
        return { users: d.users.list() };
      }),
    );

    // ── personas ────────────────────────────────────────────────────────────
    scope.get(P("/personas"), wrap((_req, _reply, c) => ({ personas: d.personas.list(c) })));
    scope.post(
      P("/personas"),
      wrap((req, reply, c) => reply.code(201).send(d.personas.create(c, req.body))),
    );
    scope.put(
      P("/personas/:key"),
      wrap((req, _reply, c) => d.personas.update(c, (req.params as { key: string }).key, req.body)),
    );
    scope.delete(
      P("/personas/:key"),
      wrap((req, _reply, c) => {
        d.personas.remove(c, (req.params as { key: string }).key);
        return { ok: true };
      }),
    );
    scope.post(
      P("/personas/:key/fork"),
      wrap((req, reply, c) => reply.code(201).send(d.personas.fork(c, (req.params as { key: string }).key, req.body))),
    );

    // ── agents + conversations ──────────────────────────────────────────────
    scope.get(
      P("/agents"),
      wrap((req, _reply, c) => ({ agents: d.conversations.agents(c, target(req, c, true)) })),
    );
    scope.get(
      P("/agents/:key/conversations"),
      wrap((req, _reply, c) => {
        const t = target(req, c);
        const archived = (req.query as { archived?: string }).archived === "true";
        return { conversations: d.conversations.listConversations(c, (req.params as { key: string }).key, t, archived) };
      }),
    );
    scope.post(
      P("/agents/:key/conversations"),
      wrap(async (req, reply, c) => {
        const t = target(req, c, true);
        return reply.code(201).send(await d.conversations.createConversation(c, (req.params as { key: string }).key, t));
      }),
    );
    scope.post(
      P("/agents/:key/conversations/:c/session"),
      wrap(async (req, _reply, c) => {
        const t = target(req, c);
        const p = req.params as { key: string; c: string };
        return d.conversations.ensureConversation(c, p.key, t, p.c);
      }),
    );
    scope.patch(
      P("/agents/:key/conversations/:c"),
      wrap(async (req, _reply, c) => {
        const t = target(req, c);
        const p = req.params as { key: string; c: string };
        return d.conversations.patchConversation(c, p.key, t, p.c, (req.body ?? {}) as Record<string, unknown>);
      }),
    );
    scope.post(
      P("/agents/:key/conversations/:c/restart"),
      wrap(async (req, _reply, c) => {
        const t = target(req, c);
        const p = req.params as { key: string; c: string };
        await d.conversations.restartConversation(c, p.key, t, p.c);
        return { ok: true };
      }),
    );
    scope.delete(
      P("/agents/:key/conversations/:c"),
      wrap(async (req, _reply, c) => {
        const t = target(req, c);
        const p = req.params as { key: string; c: string };
        await d.conversations.deleteConversation(c, p.key, t, p.c);
        return { ok: true };
      }),
    );
  });
}
