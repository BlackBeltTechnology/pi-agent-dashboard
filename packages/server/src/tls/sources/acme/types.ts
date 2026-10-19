/**
 * Shared contracts of the ACME (DNS-01) certificate source modules.
 * See change: add-acme-dns01-certs (design D2, D3, D5, D6, D9).
 */

/** One DNS-01 solver instance (bound to one acme source). */
export interface Dns01Solver {
  readonly type: "cloudflare" | "acme-dns";
  /** `domain` may be `*.x` → owner `_acme-challenge.x`. `ref` is opaque, handed back to `cleanup`. */
  publish(domain: string, value: string): Promise<{ ref: string }>;
  /** Idempotent (Cloudflare 404 = success; acme-dns = no-op). */
  cleanup(ref: { ref: string }): Promise<void>;
  /** Per-domain readiness. `gate` names which gate id the failure maps to (default `dns-cname` / `dns-zone`). */
  check(domain: string): Promise<SolverCheck>;
  /**
   * Source-wide credential validity (D2/D7). cloudflare: token verify. acme-dns: ONE placeholder `/update`,
   * only when the registration lock is free (try-acquire, never wait); lock busy → `{ ok: true, skipped: true }`
   * meaning "keep the last result". 401/403 → `{ ok: false, hint }`. Network/5xx → throws (caller keeps last result).
   */
  checkCredentials(): Promise<SolverCheck & { skipped?: boolean }>;
  /**
   * Serialization of whole attempts (D2). cloudflare: resolves immediately with a no-op release.
   * acme-dns: module-level lock keyed by `(server, subdomain)`; waits at most `maxWaitMs`, then rejects
   * `Error("acme-dns registration busy")` with no CA/DNS call. `release()` is idempotent.
   */
  acquireOrderLock(opts: { maxWaitMs: number }): Promise<{ release(): void }>;
}

export interface SolverCheck {
  ok: boolean;
  hint?: string;
  /** Gate id to report when `!ok` (acme-dns: `dns-cname`; cloudflare unknown zone: `dns-zone`; bad token: `credentials`). */
  gate?: "dns-cname" | "dns-zone" | "credentials";
}

/** Injected into solvers and the DNS helpers; every outbound call is bounded (30 s fetch, 3 s DNS). */
export interface SolverDeps {
  sourceId: string;
  /** Reads a `tls-solver` vault secret (`null` = absent). Throws when the vault is unavailable. */
  readSecret(label: string): Promise<string | null>;
  /** Redacts the source's current secrets + auth headers from a message (design D6). */
  redact(message: string): string;
  /** Cloudflare API base (default `https://api.cloudflare.com/client/v4`; E2E override resolved by the caller). */
  cloudflareApiBase: string;
  fetchImpl?: typeof fetch;
  /** Called by the solver when a publish gets a 401/403 so the source can flip the `credentials` gate. */
  onCredentialFailure?(): void;
  /** DNS discovery/propagation helpers (injectable in tests). */
  dns: DnsApi;
  now?: () => number;
}

/** Authoritative-DNS access used for the CNAME check (acme-dns) and propagation waits (both). */
export interface DnsApi {
  /** Zone apex + authoritative servers (host names + resolved addresses) for the zone containing `name`. */
  discoverZone(name: string): Promise<{ zone: string; servers: Array<{ host: string; addresses: string[] }> }>;
  /** CNAME target of `owner` queried at each authoritative server directly. */
  resolveCnameAtAuthoritative(owner: string): Promise<{ targets: string[]; perServer: Array<{ server: string; target: string | null; error?: string }> }>;
  /** Wait until every authoritative server (or both DoH resolvers in fallback mode) returns TXT `value` at `owner`. */
  waitForTxt(owner: string, value: string, opts: { timeoutMs?: number; intervalMs?: number; signal?: AbortSignal }): Promise<{ mode: "authoritative" | "doh-fallback" }>;
}

/** `_acme-challenge.<domain minus a leading "*.">`. */
export function challengeOwner(domain: string): string {
  return `_acme-challenge.${domain.replace(/^\*\./, "")}`;
}

/** Vault labels per solver type (namespace `tls:<sourceId>`). */
export const SOLVER_LABELS = {
  cloudflare: { provider: "cloudflare", labels: ["cloudflareToken"] },
  "acme-dns": { provider: "acme-dns", labels: ["acmeDnsUser", "acmeDnsKey"] },
} as const;
