/**
 * REST surface of the credential vault (`/api/vault/*`).
 *
 *   GET    /api/vault                                  accounts, bindings, grants (+state), confirmations, approvals, status
 *   POST   /api/vault/accounts                         { provider, label, value } → view (value never echoed)
 *   PUT    /api/vault/accounts/:id/value               { value } rotate
 *   DELETE /api/vault/accounts/:id                     revoke
 *   POST   /api/vault/bindings                         { name, defaultAccountId? }
 *   PUT    /api/vault/bindings/:name/default           { accountId | null }
 *   DELETE /api/vault/bindings/:name
 *   POST   /api/vault/grants                           { subject, bindingName, accountId? }
 *   DELETE /api/vault/grants                           { subject, bindingName }
 *   POST   /api/vault/confirmations                    { deviceId, dir, repoKey }
 *   DELETE /api/vault/confirmations                    { deviceId, dir, repoKey }
 *   PUT    /api/vault/plugin-approvals/:pluginId/:bindingName      approve
 *   DELETE /api/vault/plugin-approvals/:pluginId/:bindingName      revoke
 *   GET    /api/vault/import/candidates                existence only, opaque ids
 *   POST   /api/vault/import/propose                   { candidateId } | { content } → names only
 *   POST   /api/vault/import/confirm                   { proposalId, names }
 *   GET    /api/session/:id/vault-bindings             names + states only (session-read authority)
 *
 * EVERY management route (reads included) needs an `operate`-tier device
 * bearer, an authenticated operator session, or a locally trusted caller
 * (strict-mode aware): listings reveal which secrets exist and where they go.
 * This is stricter than `service-secrets`. The session binding-state read sits
 * behind the network guard only, like the rest of a session's own status.
 * No response ever carries a stored value.
 *
 * See change: add-credential-vault (D6).
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { LocalTrustContext } from "../auth/local-proof.js";
import { isLocallyTrusted } from "../auth/localhost-guard.js";
import type { NetworkGuard } from "../routes/route-deps.js";
import { createBinding, deleteBinding, listBindings, setBindingDefault } from "./vault-bindings.js";
import {
  confirmCheckout,
  createGrant,
  deleteGrant,
  listGrantStates,
  revokeAccount,
  revokeConfirmation,
  wellFormedConfirmations,
} from "./vault-grants.js";
import type { VaultImport } from "./vault-import.js";
import { approvePluginBinding, listPluginApprovals, revokePluginBinding } from "./vault-plugin-read.js";
import { accountView, VaultError, type VaultErrorCode, type VaultStore, wellFormedAccounts } from "./vault-store.js";

interface SessionBindingState {
  bindings: Array<{ name: string; state: string }>;
  lastContactAt?: number;
  outcome?: string;
  project?: { deviceId: string; dir: string; repoKey?: string };
}

export interface VaultRoutesDeps {
  store: VaultStore;
  importer: VaultImport;
  networkGuard: NetworkGuard;
  localTrust?: LocalTrustContext;
  /** Plugins that declare vault bindings (manifest `vaultBindings`), for the approvals list. */
  getPluginDeclarations?: () => Array<{ pluginId: string; displayName: string; declared: string[] }>;
  /** Names + states (+ last contact, project) for one session, or undefined when unknown. Never values. */
  getSessionBindingState: (sessionId: string) => SessionBindingState | undefined;
}

type Req = FastifyRequest & {
  params: Record<string, string>;
  body?: Record<string, unknown> | null;
};

const STATUS_FOR: Record<VaultErrorCode, number> = {
  value_too_short: 400,
  value_too_long: 400,
  invalid_field: 400,
  invalid_binding_name: 400,
  invalid_grant: 400,
  invalid_request: 400,
  not_found: 404,
  vault_corrupt: 409,
};

function canManageVault(request: FastifyRequest, localTrust?: LocalTrustContext): boolean {
  const via = (request as { authVia?: string }).authVia;
  if (via === "device") return (request as { principalTier?: string }).principalTier === "operate";
  if (via === "session" || via === "principal") return true;
  return isLocallyTrusted({ ip: request.ip, headers: request.headers as Record<string, unknown> }, localTrust);
}

function sendError(reply: FastifyReply, err: unknown): FastifyReply {
  if (err instanceof VaultError) {
    return reply.code(STATUS_FOR[err.code] ?? 400).send({ success: false, error: err.code, message: err.message });
  }
  // Unexpected errors can carry paths or content: log the name only, return a generic body.
  console.warn(`[vault] route error: ${(err as Error)?.name ?? "error"}`);
  return reply.code(500).send({ success: false, error: "internal", message: "internal error (see server.log)" });
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");

export function registerVaultRoutes(fastify: FastifyInstance, deps: VaultRoutesDeps): void {
  const { store, importer, networkGuard } = deps;
  const manageGuard = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!canManageVault(request, deps.localTrust)) {
      await reply.code(403).send({ success: false, error: "operate_required", message: "the vault needs an operate-tier credential or a locally trusted caller" });
    }
  };
  const manage = { preHandler: [networkGuard, manageGuard] };

  const wrap =
    (fn: (req: Req) => Promise<unknown> | unknown) =>
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        return { success: true, data: await fn(request as unknown as Req) };
      } catch (err) {
        return sendError(reply, err);
      }
    };

  fastify.get("/api/vault", manage, wrap(() => {
    const { status, doc } = store.readDocument();
    return {
      status,
      accounts: wellFormedAccounts(doc).map(accountView),
      bindings: listBindings(doc),
      grants: listGrantStates(doc),
      confirmations: wellFormedConfirmations(doc),
      pluginApprovals: listPluginApprovals(doc),
      plugins: deps.getPluginDeclarations?.() ?? [],
    };
  }));

  fastify.post("/api/vault/accounts", manage, wrap((req) => {
    const b = req.body ?? {};
    return store.addAccount({ provider: str(b.provider), label: str(b.label), value: b.value as string });
  }));
  fastify.put("/api/vault/accounts/:id/value", manage, wrap(async (req) => {
    await store.rotateAccount(req.params.id, req.body?.value as string);
    return { rotated: true };
  }));
  fastify.delete("/api/vault/accounts/:id", manage, wrap((req) => revokeAccount(store, req.params.id)));

  fastify.post("/api/vault/bindings", manage, wrap((req) => {
    const b = req.body ?? {};
    return createBinding(store, { name: str(b.name), defaultAccountId: typeof b.defaultAccountId === "string" ? b.defaultAccountId : undefined });
  }));
  fastify.put("/api/vault/bindings/:name/default", manage, wrap(async (req) => {
    const id = req.body?.accountId;
    await setBindingDefault(store, req.params.name, typeof id === "string" ? id : undefined);
    return { updated: true };
  }));
  fastify.delete("/api/vault/bindings/:name", manage, wrap(async (req) => {
    await deleteBinding(store, req.params.name);
    return { deleted: true };
  }));

  fastify.post("/api/vault/grants", manage, wrap(async (req) => {
    const b = req.body ?? {};
    await createGrant(store, { subject: str(b.subject), bindingName: str(b.bindingName), accountId: typeof b.accountId === "string" ? b.accountId : undefined });
    return { granted: true };
  }));
  fastify.delete("/api/vault/grants", manage, wrap(async (req) => {
    const b = req.body ?? {};
    await deleteGrant(store, { subject: str(b.subject), bindingName: str(b.bindingName) });
    return { deleted: true };
  }));

  fastify.post("/api/vault/confirmations", manage, wrap(async (req) => {
    const b = req.body ?? {};
    await confirmCheckout(store, { deviceId: str(b.deviceId), dir: str(b.dir), repoKey: str(b.repoKey) });
    return { confirmed: true };
  }));
  fastify.delete("/api/vault/confirmations", manage, wrap(async (req) => {
    const b = req.body ?? {};
    await revokeConfirmation(store, { deviceId: str(b.deviceId), dir: str(b.dir), repoKey: str(b.repoKey) });
    return { revoked: true };
  }));

  fastify.put("/api/vault/plugin-approvals/:pluginId/:bindingName", manage, wrap(async (req) => {
    await approvePluginBinding(store, req.params.pluginId, req.params.bindingName);
    return { approved: true };
  }));
  fastify.delete("/api/vault/plugin-approvals/:pluginId/:bindingName", manage, wrap(async (req) => {
    await revokePluginBinding(store, req.params.pluginId, req.params.bindingName);
    return { revoked: true };
  }));

  fastify.get("/api/vault/import/candidates", manage, wrap(() => importer.listCandidates()));
  fastify.post("/api/vault/import/propose", manage, wrap((req) => {
    const b = req.body ?? {};
    const keys = Object.keys(b);
    // Exactly one of an opaque candidate id or uploaded content. Anything else
    // (a `source` / `path` field in particular) is rejected without reading.
    if (keys.length === 1 && keys[0] === "candidateId" && typeof b.candidateId === "string") return importer.proposeFromCandidate(b.candidateId);
    if (keys.length === 1 && keys[0] === "content" && typeof b.content === "string") return importer.proposeFromUpload(b.content);
    throw new VaultError("invalid_request", "Send { candidateId } or { content }; file paths are not accepted");
  }));
  fastify.post("/api/vault/import/confirm", manage, wrap(async (req) => {
    const b = req.body ?? {};
    return { created: await importer.confirm(str(b.proposalId), Array.isArray(b.names) ? (b.names as string[]) : []) };
  }));

  fastify.get("/api/session/:id/vault-bindings", { preHandler: networkGuard }, async (request, reply) => {
    const states = deps.getSessionBindingState((request as unknown as Req).params.id);
    if (!states) return reply.code(404).send({ success: false, error: "session-unknown" });
    return { success: true, data: states };
  });
}
