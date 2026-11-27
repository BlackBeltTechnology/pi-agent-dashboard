/**
 * `host.localRequest` — the plugin host service that lets an in-process plugin call a SMALL, fixed set of the
 * dashboard's own REST routes as an authenticated local client.
 *
 * Why it exists: `fastify.inject` from a plugin carries no credential, so under the shipped default
 * `requireLocalProof: true` every WRITE is refused `local_proof_required` (only observe-tier reads pass).
 * The proof is an endpoint-bound HMAC (shared `local-credential-proof.ts`) over the CONNECTION's own local
 * address + port, the method + request-target, a timestamp and a nonce — so it cannot be minted for an
 * `inject` call (no socket). This service therefore makes a REAL HTTP request to the server's own loopback
 * listener, carrying a per-request proof minted from the in-process local token exactly as `pi-dashboard api`
 * does (`cli.ts localCredentialHeaders`). The route then runs every normal guard (host gate, network guard,
 * credential verify + replay cache, route-tier gate): this is a real client, not a bypass.
 *
 * What a plugin never gets: the local token (only the service closure holds it; the minted proof is single-use
 * and bound to one method + target + endpoint), a caller-chosen host / header / credential (the request line
 * and headers are built here), or any path outside the allowlist.
 *
 * Allowlist decision — FIXED here, not registrant-configurable. Any plugin can `consume("host.localRequest")`
 * (the registry is not per-consumer), so a configurable list would let the first consumer widen what every
 * other plugin can reach with the host's credential. Adding a route means editing this file, in review, next
 * to the route-tier table. Entries are exact pathnames; only entries flagged `query` accept a query string.
 *
 * Errors are typed `{ ok: false, code }`; no message ever echoes the URL, a header or the proof, and nothing
 * here logs. The caller's HTTP status/body (including a 4xx guard refusal) is returned as `{ ok: true }`.
 *
 * See change: add-agent-teams-openspec (design D4/D8).
 */
import { httpProofHeaders, localDialHost } from "@blackbelt-technology/pi-dashboard-shared/local-credential-proof.js";

type LocalRequestMethod = "GET" | "POST";

interface LocalRequestInput {
  method: LocalRequestMethod;
  /** Relative `/api/…` path (+ query for the entries that allow one). */
  url: string;
  /** JSON-serialisable request body (POST only). */
  body?: unknown;
  /** Per-call timeout in ms; default {@link LOCAL_REQUEST_DEFAULT_TIMEOUT_MS}, clamped to {@link LOCAL_REQUEST_MAX_TIMEOUT_MS}. */
  timeoutMs?: number;
}

type LocalRequestErrorCode =
  | "invalid_request"
  | "path_not_allowed"
  | "body_too_large"
  | "response_too_large"
  | "timeout"
  | "unavailable"
  | "unreachable";

type LocalRequestResult =
  | { ok: true; statusCode: number; /** Parsed JSON when the answer is JSON, else the raw text. */ body: unknown }
  | { ok: false; code: LocalRequestErrorCode };

export type HostLocalRequest = (input: LocalRequestInput) => Promise<LocalRequestResult>;

/** The registry key. */
export const HOST_LOCAL_REQUEST_KEY = "host.localRequest";

export const LOCAL_REQUEST_MAX_BODY_BYTES = 256 * 1024;
export const LOCAL_REQUEST_MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const LOCAL_REQUEST_DEFAULT_TIMEOUT_MS = 60_000;
const LOCAL_REQUEST_MAX_TIMEOUT_MS = 300_000;

interface AllowEntry {
  method: LocalRequestMethod;
  path: string;
  query: boolean;
}

/** Exactly what the agent-teams OpenSpec profile calls. See the file header for why this is fixed. */
const LOCAL_REQUEST_ALLOWLIST: readonly AllowEntry[] = Object.freeze([
  { method: "POST", path: "/api/git/worktree", query: false },
  { method: "POST", path: "/api/git/worktree/init", query: false },
  { method: "POST", path: "/api/git/worktree/orphan-cleanup", query: false },
  { method: "GET", path: "/api/openspec/tasks", query: true },
  { method: "POST", path: "/api/openspec/tasks/toggle", query: false },
]);

export interface HostLocalRequestDeps {
  /** The in-process local token; read per call (rotation-safe). Never exposed to callers. */
  getToken: () => string | null | undefined;
  /** The server's bind host (`config.host`); mapped to the loopback literal the proof is bound to. */
  host: string | undefined;
  /** The bound listener port; `0` until `listen` resolved. */
  getPort: () => number;
  /** Test seam. */
  fetchImpl?: typeof fetch;
}

/** Split a caller url into its path and query, or `null` when it is not a plain relative `/api/` target. */
function parseTarget(url: unknown): { path: string; query: string } | null {
  if (typeof url !== "string" || url.length === 0 || url.length > 2048) return null;
  // Whole-string screen: control chars, backslash, fragment, and any percent-escape outside the query.
  if (/[\u0000-\u0020\u007f\\#]/.test(url)) return null;
  const q = url.indexOf("?");
  const path = q === -1 ? url : url.slice(0, q);
  const query = q === -1 ? "" : url.slice(q);
  if (!path.startsWith("/api/") || path.includes("%") || path.includes("//") || path.split("/").some((s) => s === "." || s === "..")) return null;
  return { path, query };
}

function allowed(method: unknown, target: { path: string; query: string }): boolean {
  return LOCAL_REQUEST_ALLOWLIST.some((e) => e.method === method && e.path === target.path && (e.query || target.query === ""));
}

async function readCapped(res: Response, cap: number): Promise<string | null> {
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > cap) return null;
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > cap) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** Serialise the optional JSON body (POST only, size-capped); a string, `undefined` (no body) or a refusal code. */
function encodeBody(input: LocalRequestInput): { payload: string | undefined } | { code: LocalRequestErrorCode } {
  if (input.body === undefined) return { payload: undefined };
  if (input.method !== "POST") return { code: "invalid_request" };
  let payload: string | undefined;
  try {
    payload = JSON.stringify(input.body);
  } catch {
    return { code: "invalid_request" };
  }
  if (payload === undefined) return { code: "invalid_request" };
  if (Buffer.byteLength(payload, "utf8") > LOCAL_REQUEST_MAX_BODY_BYTES) return { code: "body_too_large" };
  return { payload };
}

const clampTimeout = (ms: unknown): number => {
  const requested = typeof ms === "number" && Number.isFinite(ms) ? ms : LOCAL_REQUEST_DEFAULT_TIMEOUT_MS;
  return Math.min(Math.max(Math.trunc(requested), 1), LOCAL_REQUEST_MAX_TIMEOUT_MS);
};

/** Parsed JSON when the text is JSON, else the raw text. */
function parseJsonOrText(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

interface Exchange {
  url: string;
  method: LocalRequestMethod;
  payload: string | undefined;
  proof: Record<string, string>;
  timeoutMs: number;
}

/** ONE real HTTP round trip: no redirect follow, bounded time and response size, typed failure. */
async function exchange(fetchFn: typeof fetch, x: Exchange): Promise<LocalRequestResult> {
  const signal = AbortSignal.timeout(x.timeoutMs);
  try {
    const res = await fetchFn(x.url, {
      method: x.method,
      // A redirect must never carry the proof's request to another endpoint.
      redirect: "manual",
      headers: { ...(x.payload !== undefined ? { "content-type": "application/json" } : {}), ...x.proof },
      ...(x.payload !== undefined ? { body: x.payload } : {}),
      signal,
    });
    const text = await readCapped(res, LOCAL_REQUEST_MAX_RESPONSE_BYTES);
    if (text === null) return { ok: false, code: "response_too_large" };
    return { ok: true, statusCode: res.status, body: parseJsonOrText(text) };
  } catch {
    return { ok: false, code: signal.aborted ? "timeout" : "unreachable" };
  }
}

export function createHostLocalRequest(deps: HostLocalRequestDeps): HostLocalRequest {
  const fetchFn = deps.fetchImpl ?? fetch;
  return async (input) => {
    const target = parseTarget(input?.url);
    if (!target) return { ok: false, code: "invalid_request" };
    if (!allowed(input.method, target)) return { ok: false, code: "path_not_allowed" };
    const encoded = encodeBody(input);
    if ("code" in encoded) return { ok: false, code: encoded.code };
    const { payload } = encoded;

    const port = deps.getPort();
    const token = deps.getToken();
    if (!token || !Number.isInteger(port) || port <= 0) return { ok: false, code: "unavailable" };
    const url = `http://${localDialHost(deps.host)}:${port}${target.path}${target.query}`;
    let proof: Record<string, string>;
    try {
      proof = httpProofHeaders(token, url, input.method);
    } catch {
      return { ok: false, code: "unavailable" };
    }

    return exchange(fetchFn, { url, method: input.method, payload, proof, timeoutMs: clampTimeout(input.timeoutMs) });
  };
}
