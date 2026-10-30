/**
 * The bridge's side of the live trust query: how it asks, and which bridges are
 * "remote".
 *
 * One authenticated one-shot `POST /api/pi-trust/query` (the gateway WebSocket is
 * not open at the first `project_trust`). Credential, by bridge kind:
 *   - local: a freshly minted, endpoint-bound `X-Pi-Local-Proof` (never the raw token);
 *   - remote: `Authorization: Bearer <PI_DASHBOARD_TOKEN>`, the same paired-device
 *     bearer a remote bridge already uses to mint its gateway ticket.
 * Redirects are never followed. The caller owns the deadline: it passes an
 * `AbortSignal` that also covers the response body.
 *
 * Pure transport — it maps nothing to trust. `project-trust.ts` maps the outcome.
 *
 * See change: mirror-dashboard-trust-live-remote (D1, D2), fix-remote-bridge-ticket-origin (D2, D4).
 */
import { loadConfig } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import { httpProofHeaders, localDialHost } from "@blackbelt-technology/pi-dashboard-shared/local-credential-proof.js";
import { isLoopbackEndpoint } from "@blackbelt-technology/pi-dashboard-shared/loopback-host.js";
import { PI_TRUST_QUERY_PATH } from "@blackbelt-technology/pi-dashboard-shared/pi-trust-live-query.js";
import { readDeviceToken } from "./bridge-ticket-client.js";
import { checkTlsCall } from "./bridge-tls-checks.js";
import { readLocalToken } from "./local-token-header.js";
import { resolveDashboardHttpOrigin } from "./dashboard-http-origin.js";

/** What the transport saw. Mapping to reason codes is the decision's job. */
export type LiveQueryResult =
  | { kind: "response"; status: number; body: unknown }
  /** No TCP connection (refused, DNS, reset, …). */
  | { kind: "unreachable" }
  /** Anything else that went wrong before a usable response (redirect, protocol error). */
  | { kind: "error" };

export type LiveQueryFn = (req: { cwdKey: string; remote: boolean; signal: AbortSignal }) => Promise<LiveQueryResult>;

/**
 * A remote bridge: its resolved dashboard endpoint is not loopback (`localhost`
 * counts as loopback) and a paired-device token is present — the same predicate
 * under which `prepareRemoteUpgrade` mints a gateway ticket.
 */
export function isRemoteBridge(endpoint: string, env: NodeJS.ProcessEnv = process.env): boolean {
  return !isLoopbackEndpoint(endpoint) && readDeviceToken(env) !== undefined;
}

export interface HttpLiveQueryDeps {
  /** The bridge's resolved dashboard (gateway) endpoint, read per call (it can be re-targeted). */
  endpoint: () => string;
  /** HTTP port of a discovered local instance (rendezvous), when known. */
  httpPort?: () => number | undefined;
  fetchImpl?: typeof fetch;
  env?: NodeJS.ProcessEnv;
}

const CONNECTION_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ENOTFOUND",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_SOCKET",
]);

function failureKind(err: unknown): "unreachable" | "error" {
  const cause = (err as { cause?: { code?: unknown; message?: unknown } } | null)?.cause;
  const code = typeof cause?.code === "string" ? cause.code : undefined;
  if (code && CONNECTION_CODES.has(code)) return "unreachable";
  // An AggregateError (Happy Eyeballs, several addresses) carries the codes one level down.
  const nested = (cause as { errors?: unknown[] } | undefined)?.errors;
  if (Array.isArray(nested) && nested.some((e) => CONNECTION_CODES.has((e as { code?: string })?.code ?? ""))) return "unreachable";
  return "error";
}

type Prepared = { url: string; headers: Record<string, string> } | { early: LiveQueryResult };

/** URL + credential for this bridge kind, or an answer that needs no round trip. */
function prepareRequest(deps: HttpLiveQueryDeps, remote: boolean, loggedCauses: Set<string>): Prepared {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (remote) {
    const endpoint = deps.endpoint();
    const origin = resolveDashboardHttpOrigin(endpoint, deps.env ?? process.env);
    if (!origin.ok) {
      // Fails silently otherwise: say why, once per distinct cause.
      if (!loggedCauses.has(origin.cause)) {
        loggedCauses.add(origin.cause);
        console.error(`[dashboard] live trust query ${origin.cause}: ${origin.reason}`);
      }
      return { early: { kind: "error" } };
    }
    const token = readDeviceToken(deps.env);
    if (!token) return { early: { kind: "error" } };
    // `tls-only-token` / `tls-verify-disabled`: no bearer leaves, once per cause.
    // See change: prove-vault-bridge-tls (D7, D9).
    const refusal = checkTlsCall({ origin: origin.origin, token, env: deps.env ?? process.env });
    if (refusal) {
      if (!loggedCauses.has(refusal.cause)) {
        loggedCauses.add(refusal.cause);
        console.error(`[dashboard] live trust query ${refusal.cause}: ${refusal.reason}`);
      }
      return { early: { kind: "error" } };
    }
    headers.authorization = `Bearer ${token}`;
    return { url: `${origin.origin}${PI_TRUST_QUERY_PATH}`, headers };
  }
  const cfg = loadConfig();
  const url = `http://${localDialHost(cfg.bindHost)}:${deps.httpPort?.() ?? cfg.port}${PI_TRUST_QUERY_PATH}`;
  const token = readLocalToken();
  // No local token ⇒ nothing to prove with; the server would refuse. Say so without a round trip.
  if (!token) return { early: { kind: "response", status: 401, body: undefined } };
  Object.assign(headers, httpProofHeaders(token, url, "POST"));
  return { url, headers };
}

/** The real transport. Never throws. */
export function createHttpLiveQuery(deps: HttpLiveQueryDeps): LiveQueryFn {
  const doFetch = deps.fetchImpl ?? fetch;
  const loggedCauses = new Set<string>();
  return async ({ cwdKey, remote, signal }) => {
    try {
      const prepared = prepareRequest(deps, remote, loggedCauses);
      if ("early" in prepared) return prepared.early;
      const res = await doFetch(prepared.url, {
        method: "POST",
        headers: prepared.headers,
        body: JSON.stringify({ cwd: cwdKey }),
        redirect: "error",
        signal,
      });
      let body: unknown;
      try {
        body = res.status === 200 ? await res.json() : undefined;
      } catch {
        body = undefined;
      }
      return { kind: "response", status: res.status, body };
    } catch (err) {
      if (signal.aborted) return { kind: "error" };
      return { kind: failureKind(err) };
    }
  };
}
