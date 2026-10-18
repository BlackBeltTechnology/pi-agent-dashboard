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
 *   GET    /api/vault/projects                         { open, recent } projects to grant to (names of nothing secret)
 *   GET    /api/session/:id/vault-bindings             names + states only (session-read authority);
 *                                                      + `ungranted` for callers who may manage the vault
 *
 * EVERY management route (reads included) needs an `operate`-tier device
 * bearer, a login session at `operate`, an identity principal the host policy
 * lets manage the vault, or a locally trusted caller (strict-mode aware):
 * listings reveal which secrets exist and where they go. This is stricter than
 * `service-secrets`. The session binding-state read sits behind the network guard
 * only, like the rest of a session's own status. No response ever carries a stored value.
 *
 * See change: add-credential-vault (D6); retro-ux-credential-vault (D2, D4, D11).
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { LocalTrustContext } from "../auth/local-proof.js";
import { hasOperateAuthority, sendOperateRequired } from "../auth/operate-required.js";
import type { HostPolicy } from "../identity/host-access.js";
import { HostActions, hostResource } from "../identity/host-resources.js";
import { isLocalOperator, sessionPrincipalOf } from "../identity/session-access.js";
import type { NetworkGuard } from "../routes/route-deps.js";
import { createBinding, deleteBinding, listBindings, setBindingDefault } from "./vault-bindings.js";
import type { ProjectView } from "./vault-delivery-hub.js";
import {
  confirmCheckout,
  createGrant,
  deleteGrant,
  listGrantStates,
  revokeAccount,
  revokeConfirmation,
  ungrantedBindings,
  wellFormedConfirmations,
} from "./vault-grants.js";
import type { VaultImport } from "./vault-import.js";
import { approvePluginBinding, listPluginApprovals, revokePluginBinding } from "./vault-plugin-read.js";
import type { VaultProjects } from "./vault-projects.js";
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
  /** The identity host policy, asked whether a non-operator principal may manage the vault. Absent → principals are refused. */
  hostPolicy?: HostPolicy;
  /** Projects of the sessions connected now (delivery hub). */
  listOpenProjects: () => ProjectView[];
  /** Remembered projects (`vault-projects.json`). */
  projects: Pick<VaultProjects, "list">;
  /** Live: is a usable login method configured? Drives the `sign-in` remedy of a refusal. */
  loginAvailable: () => boolean;
  /** Offer the `request-access` remedy to a credential-less caller that passes the knock gates. */
  requestAccessAvailable?: (request: FastifyRequest) => boolean;
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

function sendError(reply: FastifyReply, err: unknown): FastifyReply {
  if (err instanceof VaultError) {
    return reply.code(STATUS_FOR[err.code] ?? 400).send({ success: false, error: err.code, message: err.message });
  }
  // Unexpected errors can carry paths or content: log the name only, return a generic body.
  console.warn(`[vault] route error: ${(err as Error)?.name ?? "error"}`);
  return reply.code(500).send({ success: false, error: "internal", message: "internal error (see server.log)" });
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");

/**
 * May this request manage the vault? Every caller kind needs `operate`, whatever
 * its network position: a device bearer or login session at `operate`, an identity
 * principal the host policy authorises (operator principals always pass), or a
 * locally trusted caller. See change: retro-ux-credential-vault (D11).
 */
async function canManageVault(request: FastifyRequest, deps: VaultRoutesDeps): Promise<boolean> {
  const marked = request as FastifyRequest & { authVia?: string; principalTier?: string };
  if (marked.authVia === "session") return marked.principalTier === "operate";
  if (marked.authVia === "principal") {
    const principal = sessionPrincipalOf(request);
    if (isLocalOperator(principal)) return true;
    if (!principal || !deps.hostPolicy) return false;
    return deps.hostPolicy.authorize({
      principal: principal as Parameters<HostPolicy["authorize"]>[0]["principal"],
      action: HostActions.vaultManage,
      resource: hostResource.vault(),
    });
  }
  return hasOperateAuthority(request, deps.localTrust);
}

const projectKey = (deviceId: string | undefined, dir: string): string => `${deviceId ?? ""}\u0000${dir}`;

export function registerVaultRoutes(fastify: FastifyInstance, deps: VaultRoutesDeps): void {
  const { store, importer, networkGuard } = deps;
  const manageGuard = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!(await canManageVault(request, deps))) {
      await sendOperateRequired(request, reply, { route: "vault", loginAvailable: deps.loginAvailable, requestAccessAvailable: deps.requestAccessAvailable });
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

  fastify.get("/api/vault/projects", manage, wrap(() => {
    const open = deps.listOpenProjects();
    const openKeys = new Set(open.filter((p) => p.deviceId !== undefined).map((p) => projectKey(p.deviceId, p.dir)));
    const recent: ProjectView[] = deps.projects
      .list()
      .filter((e) => !openKeys.has(projectKey(e.deviceId, e.dir)))
      .sort((a, b) => b.lastSeenAt - a.lastSeenAt)
      .map((e) => ({
        kind: e.repoKey ? "repo" : "dir",
        deviceId: e.deviceId,
        dir: e.dir,
        ...(e.repoKey ? { repoKey: e.repoKey } : {}),
        lastSeenAt: e.lastSeenAt,
      }));
    return { open, recent };
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
    // `ungranted` names bindings, so it follows the manage predicate, not session-read authority.
    if (!(await canManageVault(request, deps))) return { success: true, data: states };
    const { status, doc } = store.readDocument();
    const ungranted = states.project && status.state !== "corrupt" ? ungrantedBindings(doc, states.project) : [];
    return { success: true, data: { ...states, ungranted } };
  });
}
