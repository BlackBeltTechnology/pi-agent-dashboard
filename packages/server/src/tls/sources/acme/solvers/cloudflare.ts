import { challengeOwner, type Dns01Solver, type SolverCheck, type SolverDeps } from "../types.js";

/**
 * Cloudflare DNS-01 solver: TXT records via the Cloudflare API (design D2). `cleanup` works from a ref alone
 * (`<zoneId>/<recordId>`), so the source can delete a record whose `publish` resolved after an abort.
 * Errors are plain `Error`s with messages passed through `deps.redact` (design D6, D7).
 * See change: add-acme-dns01-certs.
 */

const FETCH_TIMEOUT_MS = 30_000;
const TXT_TTL = 60;

interface CfBody {
  success?: boolean;
  errors?: Array<{ code?: number; message?: string }>;
  result?: unknown;
}

interface CfResponse {
  status: number;
  body: CfBody;
}

const isAuthFailure = (status: number): boolean => status === 401 || status === 403;

/** Candidate zone names for `domain`: every suffix with at least two labels, longest first. */
function zoneCandidates(domain: string): string[] {
  const labels = domain.replace(/^\*\./, "").toLowerCase().replace(/\.$/, "").split(".");
  const out: string[] = [];
  for (let i = 0; i <= labels.length - 2; i++) out.push(labels.slice(i).join("."));
  return out;
}

export function createCloudflareSolver(config: { zoneId?: string }, deps: SolverDeps): Dns01Solver {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const base = deps.cloudflareApiBase.replace(/\/+$/, "");

  const fail = (message: string): Error => new Error(deps.redact(message));

  async function request(method: string, path: string, body?: unknown): Promise<CfResponse> {
    const token = await deps.readSecret("cloudflareToken");
    if (!token) throw fail("Cloudflare token is not configured");
    let res: Response;
    try {
      res = await fetchImpl(`${base}${path}`, {
        method,
        headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
    } catch (err) {
      throw fail(`Cloudflare ${method} ${path.split("?")[0]} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    let parsed: CfBody = {};
    try {
      parsed = (await res.json()) as CfBody;
    } catch {
      // non-JSON body: status alone drives handling
    }
    return { status: res.status, body: parsed };
  }

  const describe = (method: string, path: string, r: CfResponse): Error => {
    const detail = r.body.errors?.map((e) => e.message).filter(Boolean).join("; ");
    return fail(`Cloudflare ${method} ${path.split("?")[0]} failed: HTTP ${r.status}${detail ? ` (${detail})` : ""}`);
  };

  /** Looks up the zone id for `domain`; `null` = no zone matches. Auth failures are returned to the caller. */
  async function lookupZone(domain: string): Promise<{ zoneId: string | null; authFailure?: CfResponse }> {
    for (const candidate of zoneCandidates(domain)) {
      const path = `/zones?name=${encodeURIComponent(candidate)}`;
      const r = await request("GET", path);
      if (isAuthFailure(r.status)) return { zoneId: null, authFailure: r };
      if (r.status < 200 || r.status >= 300) throw describe("GET", path, r);
      const match = (Array.isArray(r.body.result) ? (r.body.result as Array<{ id?: string; name?: string }>) : []).find((z) => z.id && z.name?.toLowerCase() === candidate);
      if (match?.id) return { zoneId: match.id };
    }
    return { zoneId: null };
  }

  async function verifyToken(): Promise<SolverCheck> {
    const path = "/user/tokens/verify";
    const r = await request("GET", path);
    if (isAuthFailure(r.status)) return { ok: false, gate: "credentials", hint: "Cloudflare rejected the API token (invalid, expired or revoked)" };
    if (r.status < 200 || r.status >= 300) throw describe("GET", path, r);
    const status = (r.body.result as { status?: string } | undefined)?.status;
    if (status && status !== "active") return { ok: false, gate: "credentials", hint: `Cloudflare API token is ${status}` };
    return { ok: true };
  }

  /** Token readiness without a stored token is a gate, not an error. */
  async function guardedVerify(): Promise<SolverCheck> {
    if (!(await deps.readSecret("cloudflareToken"))) return { ok: false, gate: "credentials", hint: "Cloudflare API token is not saved" };
    return verifyToken();
  }

  return {
    type: "cloudflare",

    async publish(domain, value) {
      const owner = challengeOwner(domain);
      let zoneId = config.zoneId ?? null;
      if (!zoneId) {
        const found = await lookupZone(domain);
        if (found.authFailure) {
          deps.onCredentialFailure?.();
          throw describe("GET", "/zones", found.authFailure);
        }
        zoneId = found.zoneId;
        if (!zoneId) throw fail(`no Cloudflare zone found for ${owner}`);
      }
      const path = `/zones/${zoneId}/dns_records`;
      const r = await request("POST", path, { type: "TXT", name: owner, content: value, ttl: TXT_TTL });
      if (isAuthFailure(r.status)) {
        deps.onCredentialFailure?.();
        throw describe("POST", path, r);
      }
      const recordId = (r.body.result as { id?: string } | undefined)?.id;
      if (r.status < 200 || r.status >= 300 || !recordId) throw describe("POST", path, r);
      return { ref: `${zoneId}/${recordId}` };
    },

    async cleanup({ ref }) {
      const [zoneId, recordId, ...rest] = ref.split("/");
      if (!zoneId || !recordId || rest.length > 0) throw fail("invalid Cloudflare record ref");
      const path = `/zones/${encodeURIComponent(zoneId)}/dns_records/${encodeURIComponent(recordId)}`;
      const r = await request("DELETE", path);
      if (r.status === 404 || (r.status >= 200 && r.status < 300)) return;
      throw describe("DELETE", path, r);
    },

    async check(domain) {
      const verified = await guardedVerify();
      if (!verified.ok || config.zoneId) return verified;
      const found = await lookupZone(domain);
      if (found.authFailure) return { ok: false, gate: "credentials", hint: "Cloudflare token cannot read zones (needs Zone → Zone → Read, or set a zone id)" };
      if (!found.zoneId) return { ok: false, gate: "dns-zone", hint: `No Cloudflare zone found for ${domain.replace(/^\*\./, "")}; the token must have access to its zone` };
      return { ok: true };
    },

    checkCredentials: guardedVerify,

    async acquireOrderLock() {
      return { release() {} };
    },
  };
}
