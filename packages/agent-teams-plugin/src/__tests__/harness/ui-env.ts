/**
 * UI-layer env: the full runtime of `createTeamsEnv` plus a real Fastify app with
 * the REST routes, the owner-rule `access`, the user actions and a scriptable
 * identity seam. A request names its caller with `x-principal`:
 * `local` (the break-glass operator), `<iss>|<sub>`, or absent (no principal).
 * Rate limits are widened by default so decision tables can POST freely; the
 * limiter test passes `rateLimits: undefined`-free defaults explicitly.
 * See change: add-agent-teams-ui.
 */
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { type AccessIdentity, createAccess, LOCAL_OPERATOR_ISSUER, ownerKeyOf, type TeamAccess } from "../../server/access.js";
import { createExtensionPoints } from "../../server/extension-points.js";
import { API_PREFIX, mountTeamsRoutes, type RouteDeps } from "../../server/routes.js";
import { createUiCounters, type UiCounters } from "../../server/ui-counters.js";
import { createUserActions, type UserActions } from "../../server/user-actions.js";
import type { Team } from "../../shared/types.js";
import { createTeamsEnv, type TeamsEnv, type TeamsEnvOptions } from "./teams-env.js";

export interface UiEnvOptions extends TeamsEnvOptions {
  /** Identity enforced (default false). Mutable afterwards through `env.identity.enforced`. */
  enforced?: boolean;
  epoch?: string;
  /** Core's hook timeout (ms) for the visibility hook. */
  visibilityTimeoutMs?: number;
  /** Replace the registered visibility hook (default: `access.canViewTeam`). */
  hook?: (team: Team, req: unknown) => boolean | Promise<boolean>;
  /** Replace the control predicate only (default: `access.canControlTeam`), to model a read-only role. */
  control?: (team: Team, req: unknown) => boolean;
  /** Extra `onRequest` hook (host tier gate simulation); registered before the routes. */
  onRequest?: (req: FastifyRequest, reply: import("fastify").FastifyReply) => Promise<void> | void;
  /** Override the write/read limiter (default: effectively unlimited; `null` = core's real constants). */
  rateLimits?: RouteDeps["rateLimits"] | null;
  /** Make `identity.principalOf` throw. */
  principalThrows?: boolean;
}

interface FakeIdentity extends AccessIdentity {
  enforced: boolean;
  principalThrows: boolean;
}

/** `x-principal` → principal (`local` = the reserved break-glass operator). */
function principalFromHeader(value: unknown): { iss: string; sub: string } | null {
  if (typeof value !== "string" || value === "") return null;
  if (value === "local") return { iss: LOCAL_OPERATOR_ISSUER, sub: "local-operator" };
  const at = value.indexOf("|");
  return at < 0 ? null : { iss: value.slice(0, at), sub: value.slice(at + 1) };
}

export interface UiEnv extends TeamsEnv {
  app: FastifyInstance;
  identity: FakeIdentity;
  access: TeamAccess;
  actions: UserActions;
  counters: UiCounters;
  epoch: string;
  /** Owner key of a principal, as `Team.owner` stores it. */
  ownerKey(p: { iss: string; sub: string }): string;
  get<T = unknown>(url: string, headers?: Record<string, string>): Promise<{ status: number; body: T; headers: Record<string, unknown>; raw: string }>;
  post<T = unknown>(url: string, headers?: Record<string, string>): Promise<{ status: number; body: T; headers: Record<string, unknown>; raw: string }>;
  close(): Promise<void>;
}

const UNLIMITED = { read: { perSecond: 100_000, burst: 100_000 }, write: { perSecond: 100_000, burst: 100_000 } };

export async function createUiEnv(over: UiEnvOptions = {}): Promise<UiEnv> {
  const { enforced = false, epoch = "E", visibilityTimeoutMs, hook, control, onRequest, rateLimits = UNLIMITED, principalThrows = false, ...envOpts } = over;
  const ext = envOpts.ext ?? createExtensionPoints();
  const e = createTeamsEnv({ ...envOpts, ext });
  const identity: FakeIdentity = {
    enforced,
    principalThrows,
    isEnforced: () => identity.enforced,
    principalOf(req) {
      if (identity.principalThrows) throw new Error("principal boom");
      return principalFromHeader((req as { headers?: Record<string, unknown> }).headers?.["x-principal"]);
    },
  };
  const baseAccess = createAccess(identity);
  const access = control ? { ...baseAccess, canControlTeam: control } : baseAccess;
  ext.setRouteVisibility(hook ?? ((team, req) => access.canViewTeam(team, req)));
  const counters = createUiCounters({ logger: e.fake.host.logger, clock: e.clock });
  const actions = createUserActions({ store: e.rt.store, ops: e.rt.ops, clock: e.clock });
  const app = Fastify();
  if (onRequest) app.addHook("onRequest", onRequest);
  await mountTeamsRoutes(app, {
    store: e.rt.store,
    telemetry: e.rt.telemetry,
    ext,
    logger: e.fake.host.logger,
    epoch,
    access,
    userActions: actions,
    counters,
    ...(rateLimits ? { rateLimits } : {}),
    ...(visibilityTimeoutMs !== undefined ? { visibilityTimeoutMs } : {}),
    principalOf: (req) => principalFromHeader((req as { headers?: Record<string, unknown> }).headers?.["x-principal"]),
  });
  await app.ready();
  const call = async (method: "GET" | "POST", url: string, headers: Record<string, string> = {}) => {
    const res = await app.inject({ method, url: url.startsWith("/api/") ? url : `${API_PREFIX}${url}`, headers });
    let body: unknown = res.body;
    try {
      body = res.body === "" ? undefined : JSON.parse(res.body);
    } catch {
      // non-JSON body stays a string
    }
    return { status: res.statusCode, body: body as never, headers: res.headers as Record<string, unknown>, raw: res.body };
  };
  return Object.assign(e, {
    app,
    identity,
    access,
    actions,
    counters,
    epoch,
    ownerKey: ownerKeyOf,
    get: (url: string, headers?: Record<string, string>) => call("GET", url, headers),
    post: (url: string, headers?: Record<string, string>) => call("POST", url, headers),
    async close() {
      actions.dispose();
      counters.dispose();
      await app.close();
    },
  }) as UiEnv;
}
