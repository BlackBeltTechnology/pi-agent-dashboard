/**
 * Plugin → host REST access (design D8 / D4). Two transports behind one `InjectFn`:
 *  1. PREFERRED — the host service `host.localRequest` (`consume("host.localRequest")`): a real loopback HTTP
 *     request the SERVER makes with a per-request local credential proof, so it works under the shipped
 *     default `requireLocalProof: true` while every route guard still runs. The plugin never sees the token
 *     or the proof; the host enforces a fixed route allowlist. A service-level failure (`{ ok: false, code }`)
 *     rejects, exactly like a transport failure (callers map a rejection to their typed failure, no retry).
 *  2. FALLBACK (older host without the service) — `fastify.inject` as loopback with NO forwarded credential
 *     (the shape the mcp-server-plugin uses for a session caller, `dispatch.ts injectIdentity`): fixed
 *     `remoteAddress` 127.0.0.1 and a loopback `host` header, no `x-forwarded-*`, no `authorization`.
 *     A route that refuses such a caller (strict `requireLocalProof`) answers 401/403; callers must NOT retry it.
 * `createInject` takes the minimal fastify surface so tests (and slices) can hand in a fake.
 * See change: add-agent-teams-openspec.
 */

type InjectMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface InjectRequest {
  method: InjectMethod;
  /** Path + query, e.g. `/api/openspec/tasks?cwd=…`. */
  url: string;
  payload?: unknown;
}

/** `body` is the parsed JSON when the answer is JSON, else the raw text. */
export interface InjectResult {
  statusCode: number;
  body: unknown;
}

export type InjectFn = (req: InjectRequest) => Promise<InjectResult>;

/** The slice of `FastifyInstance` the helper needs. */
export interface FastifyInjectLike {
  inject(opts: { method: InjectMethod; url: string; payload?: object; headers: Record<string, string>; remoteAddress: string }): Promise<{ statusCode: number; body: string; json(): unknown }>;
}

export const INJECT_REMOTE_ADDRESS = "127.0.0.1";
export const INJECT_HOST = "127.0.0.1";

/** The `host.localRequest` host service contract (structural copy; the plugin does not import the server package). */
interface HostLocalRequestInput {
  method: "GET" | "POST";
  url: string;
  body?: unknown;
  timeoutMs?: number;
}
type HostLocalRequestResult = { ok: true; statusCode: number; body: unknown } | { ok: false; code: string };
export type HostLocalRequestFn = (input: HostLocalRequestInput) => Promise<HostLocalRequestResult>;

export const HOST_LOCAL_REQUEST_KEY = "host.localRequest";

/** `consume` as the runtime holds it (`ServerPluginContext.consume`). */
export type ConsumeLike = <T = unknown>(name: string) => T | undefined;

/** The `InjectFn` backed by `host.localRequest`; resolved per call so a late-registered service is picked up. */
function viaHostService(service: HostLocalRequestFn): InjectFn {
  return async ({ method, url, payload }) => {
    if (method !== "GET" && method !== "POST") throw new Error("local_request_path_not_allowed");
    const res = await service({ method, url, ...(payload !== undefined ? { body: payload } : {}) });
    if (!res.ok) throw new Error(`local_request_${res.code}`);
    return { statusCode: res.statusCode, body: res.body };
  };
}

/**
 * Used by `runtime.ts`: `createLoopbackInject(host.fastify, consume)`. Uses `host.localRequest` when the host
 * provides it, else falls back to the credential-less `fastify.inject` (rejects when neither exists).
 */
export function createLoopbackInject(fastify: FastifyInjectLike | undefined, consume?: ConsumeLike): InjectFn {
  const fallback = fastify ? createInject(fastify) : undefined;
  return (req) => {
    const service = consume?.<HostLocalRequestFn>(HOST_LOCAL_REQUEST_KEY);
    if (typeof service === "function") return viaHostService(service)(req);
    if (fallback) return fallback(req);
    return Promise.reject(new Error("inject_unavailable"));
  };
}

/** Bind an `InjectFn` to a fastify instance. Never throws for an HTTP error status; a transport failure rejects. */
export function createInject(fastify: FastifyInjectLike): InjectFn {
  return async ({ method, url, payload }) => {
    const res = await fastify.inject({
      method,
      url,
      ...(payload !== undefined ? { payload: payload as object } : {}),
      headers: { host: INJECT_HOST },
      remoteAddress: INJECT_REMOTE_ADDRESS,
    });
    let body: unknown = res.body;
    try {
      body = res.json();
    } catch {
      // non-JSON body stays text
    }
    return { statusCode: res.statusCode, body };
  };
}
