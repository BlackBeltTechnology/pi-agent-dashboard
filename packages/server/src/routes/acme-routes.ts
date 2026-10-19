/**
 * ACME certificate-source routes (design D5):
 *   PUT    /api/tls/acme/:sourceId              upsert ONE acme entry in `tls.sources`
 *   DELETE /api/tls/acme/:sourceId              remove it
 *   PUT    /api/tls/acme/:sourceId/credentials  write the solver secrets into the vault
 *
 * Entry writes replace only their own entry on the same serialised chain as
 * `PUT /api/config`, so a stale tab or a concurrent save can never drop another
 * source. Both refuse (409) while `config.json` does not parse. The credentials
 * route is a vault management route (same guard, `operate` tier).
 *
 * See change: add-acme-dns01-certs (design D5, D7).
 */
import type { FastifyInstance } from "fastify";
import { readConfigState, writeConfigPartial } from "../config-api.js";
import { resolveSourceId, validateTlsSources } from "../tls/source-registry.js";
import { getLiveAcmeSource } from "../tls/sources/acme/acme-source.js";
import { AcmeCredentialsError } from "../tls/sources/acme/credentials.js";
import { normalizeAcmeEntry } from "../tls/sources/acme/entry.js";
import { acmeGc, configuredAcmeEntries } from "../tls/sources/acme/gc.js";
import { getAcmeRuntime } from "../tls/sources/acme/runtime.js";
import type { TlsListener } from "../tls/tls-listener.js";
import { VaultError } from "../vault/vault-store.js";
import type { NetworkGuard } from "./route-deps.js";
import { runOnConfigSaveChain } from "./system-routes.js";

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => !!v && typeof v === "object" && !Array.isArray(v);
const SOURCE_ID_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;

type AcmeListener = Pick<TlsListener, "manager" | "reconcile" | "trigger" | "refreshReadiness">;

export interface AcmeRoutesDeps {
  networkGuard: NetworkGuard;
  /** Vault management guard (`createVaultManageGuard`). */
  manageGuard: (request: import("fastify").FastifyRequest, reply: import("fastify").FastifyReply) => Promise<void>;
  listener: AcmeListener;
}

class RouteError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const solverKey = (e: Json): string | null => {
  const s = isObj(e.solver) ? e.solver : null;
  return s && s.type === "acme-dns" ? `${String(s.server)}|${String(s.subdomain)}` : null;
};

/** Read-modify-write of `tls.sources` on the config save chain. Returns nothing; throws `RouteError`. */
async function mutateSources(edit: (stored: Json[]) => Json[]): Promise<void> {
  await runOnConfigSaveChain(() => {
    const cfg = readConfigState();
    if (cfg.state === "corrupt") {
      throw new RouteError(409, "config.json is not valid JSON; fix or remove it before changing TLS sources");
    }
    const tls = cfg.raw && isObj(cfg.raw.tls) ? cfg.raw.tls : {};
    const stored = Array.isArray(tls.sources) ? (tls.sources.filter(isObj) as Json[]) : [];
    const next = edit(stored);
    const invalid = validateTlsSources(next);
    if (invalid) throw new RouteError(400, invalid);
    const written = writeConfigPartial({ tls: { sources: next } });
    if (!written.success) throw new RouteError(500, written.error ?? "could not write config");
  });
}

async function afterWrite(listener: AcmeListener): Promise<void> {
  try {
    await listener.reconcile();
  } catch (err) {
    console.warn(`[tls] reconcile after acme write failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  await acmeGc();
}

export function registerAcmeRoutes(fastify: FastifyInstance, deps: AcmeRoutesDeps): void {
  const { networkGuard, manageGuard, listener } = deps;

  const fail = (reply: import("fastify").FastifyReply, err: unknown) => {
    if (err instanceof RouteError) return reply.code(err.status).send({ success: false, error: err.message });
    console.warn(`[tls/acme] route error: ${(err as Error)?.name ?? "error"}`);
    return reply.code(500).send({ success: false, error: "internal error (see server.log)" });
  };

  fastify.put<{ Params: { sourceId: string }; Body: unknown }>(
    "/api/tls/acme/:sourceId",
    { preHandler: networkGuard },
    async (request, reply) => {
      const { sourceId } = request.params;
      const body = request.body;
      if (!isObj(body)) return reply.code(400).send({ success: false, error: "body must be an acme source entry" });
      if (body.id !== sourceId) {
        return reply.code(400).send({ success: false, error: `body id must equal the path id "${sourceId}"` });
      }
      if (body.type !== undefined && body.type !== "acme") {
        return reply.code(400).send({ success: false, error: 'type must be "acme"' });
      }
      const entry = normalizeAcmeEntry({ ...body, type: "acme" });
      try {
        await mutateSources((stored) => {
          const key = solverKey(entry);
          if (key) {
            const clash = stored.find((e) => e.type === "acme" && e.id !== sourceId && solverKey(normalizeAcmeEntry(e)) === key);
            if (clash) {
              throw new RouteError(400, `acme source "${String(clash.id)}" already uses this acme-dns registration (server + subdomain)`);
            }
          }
          const without = stored.filter((e) => !(e.type === "acme" && resolveSourceId(e as never) === sourceId));
          const index = stored.findIndex((e) => e.type === "acme" && resolveSourceId(e as never) === sourceId);
          // Keep the entry's position; append a new one.
          if (index === -1) return [...without, entry];
          const out = [...stored];
          out[index] = entry;
          return out;
        });
      } catch (err) {
        return fail(reply, err);
      }
      await afterWrite(listener);
      return { success: true };
    },
  );

  fastify.delete<{ Params: { sourceId: string } }>(
    "/api/tls/acme/:sourceId",
    { preHandler: networkGuard },
    async (request, reply) => {
      const { sourceId } = request.params;
      try {
        await mutateSources((stored) => {
          const next = stored.filter((e) => !(e.type === "acme" && resolveSourceId(e as never) === sourceId));
          if (next.length === stored.length) throw new RouteError(404, `Unknown acme source "${sourceId}"`);
          return next;
        });
      } catch (err) {
        return fail(reply, err);
      }
      await afterWrite(listener);
      return { success: true };
    },
  );

  fastify.put<{ Params: { sourceId: string }; Body: unknown }>(
    "/api/tls/acme/:sourceId/credentials",
    { preHandler: [networkGuard, manageGuard] },
    async (request, reply) => {
      const { sourceId } = request.params;
      // 404 before ANY vault access: the id must be well-formed AND name a configured acme source.
      const cfg = getAcmeRuntime().readConfigState();
      const entry = SOURCE_ID_RE.test(sourceId)
        ? configuredAcmeEntries(cfg.raw).find((e) => e.id === sourceId)
        : undefined;
      const solver = entry && isObj(entry.solver) ? entry.solver : null;
      if (!entry || !solver || (solver.type !== "cloudflare" && solver.type !== "acme-dns")) {
        return reply.code(404).send({ success: false, error: `Unknown acme source "${sourceId}"` });
      }
      if (!isObj(request.body)) return reply.code(400).send({ success: false, error: "body must be an object" });
      const wasUnmet = listener.manager
        .status()
        .gates.some((g) => g.sourceId === sourceId && g.id === "credentials" && !g.ok);
      try {
        await getAcmeRuntime().credentials.save(sourceId, solver.type, request.body);
      } catch (err) {
        if (err instanceof AcmeCredentialsError) return reply.code(400).send({ success: false, error: err.message });
        if (err instanceof VaultError) {
          return reply.code(err.code === "vault_corrupt" ? 409 : 400).send({ success: false, error: err.code });
        }
        return fail(reply, err);
      }
      getLiveAcmeSource(sourceId)?.invalidateReadiness();
      try {
        await listener.refreshReadiness(sourceId);
      } catch (err) {
        console.warn(`[tls/acme] readiness refresh failed source=${sourceId}: ${(err as Error)?.name ?? "error"}`);
      }
      // New credentials unblock a gated source at once; replacing working ones never bypasses a retry wait.
      if (wasUnmet) {
        setImmediate(() => {
          listener.trigger(sourceId).catch((err: unknown) => {
            console.warn(`[tls/acme] trigger failed source=${sourceId}: ${err instanceof Error ? err.message : String(err)}`);
          });
        });
      }
      return { success: true };
    },
  );
}
