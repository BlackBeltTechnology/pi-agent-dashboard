/**
 * L3 glue for the ACME DNS-01 specs (`acme-*.spec.ts`) against the opt-in
 * Pebble overlay `docker/compose.test.acme.yml`:
 *
 *   PI_E2E_SEED=1 TEST_EXTRA_COMPOSE=compose.test.acme.yml docker/test-up.sh -d --build
 *
 * Nothing in the overlay is host-published, so every probe of a test double
 * (challtestsrv, Pebble roots, the TLS handshake to `dash.test:8443`) runs as a
 * `node` script INSIDE the dashboard container (resolved by its published port),
 * which also gives it the overlay's network aliases and `NODE_EXTRA_CA_CERTS`.
 * Dashboard REST calls go through Playwright's `request` with the operator
 * session headers (the credentials route needs `operate`).
 *
 * See change: add-acme-dns01-certs (design D10, D11).
 */
import { execFileSync } from "node:child_process";
import type { APIRequestContext } from "@playwright/test";
import { resolveContainer } from "./container-proc.js";

// ── Fixed overlay values (source of truth: docker/compose.test.acme.yml header) ──
export const ZONE = "dash.test";
export const PEBBLE_DIRECTORY = "https://pebble.test:14000/dir";
export const CF_TOKEN = "pi-e2e-cloudflare-token-0123456789abcdef";
export const ACME_DNS = {
  server: "https://acme-dns.test:8443",
  user: "5f1e7b2a-3c4d-4e5f-8a9b-0c1d2e3f4a5b",
  key: "piE2eAcmeDnsTestKey0123456789abcdefABCD",
  subdomain: "d420c923-bbd7-4056-ab64-c3ca54c9b3cf",
  fulldomain: "d420c923-bbd7-4056-ab64-c3ca54c9b3cf.auth.dash.test",
} as const;
export const CHALLENGE_HOST = `_acme-challenge.${ZONE}`;
const TLS_PORT = 8443;
export const DOMAIN_URL = `https://${ZONE}:${TLS_PORT}`;

/** Run an ES-module `node` script inside the dashboard container; its last stdout line is parsed as JSON. */
function inDashboard<T = unknown>(script: string): T {
  const out = execFileSync("docker", ["exec", "-i", resolveContainer(), "node", "--input-type=module", "-"], {
    input: script,
    encoding: "utf8",
    timeout: 60_000,
  }).trim();
  const last = out.split("\n").filter(Boolean).pop() ?? "null";
  return JSON.parse(last) as T;
}

/** True when the acme overlay is layered in (the dashboard container resolves `pebble.test`). */
export function acmeOverlayPresent(): boolean {
  try {
    return inDashboard<boolean>(
      `import dns from "node:dns/promises"; try { await dns.lookup("pebble.test"); console.log("true"); } catch { console.log("false"); }`,
    );
  } catch {
    return false;
  }
}

/** POST to the challtestsrv management API (`/set-cname`, `/clear-cname`, `/clear-txt`, …). */
export function challtestsrv(path: string, body: Record<string, unknown>): void {
  const status = inDashboard<number>(
    `const r = await fetch("http://challtestsrv.test:8055${path}", { method: "POST", body: ${JSON.stringify(JSON.stringify(body))} }); console.log(r.status);`,
  );
  if (status !== 200) throw new Error(`challtestsrv ${path} -> ${status}`);
}

export const fqdn = (h: string): string => (h.endsWith(".") ? h : `${h}.`);

/** TXT values challtestsrv currently answers for `host` (asked over DNS, like Pebble does). */
export function txtRecords(host: string): string[] {
  return inDashboard<string[]>(`
    import dns from "node:dns/promises";
    const { address } = await dns.lookup("challtestsrv.test", { family: 4 });
    const r = new dns.Resolver(); r.setServers([address + ":8053"]);
    try { console.log(JSON.stringify((await r.resolveTxt(${JSON.stringify(host)})).map((c) => c.join("")))); }
    catch { console.log("[]"); }
  `);
}

/** The dashboard container's address on the overlay network (what `dash.test` resolves to). */
function containerAddress(): string {
  return inDashboard<string>(
    `import dns from "node:dns/promises"; console.log(JSON.stringify((await dns.lookup(${JSON.stringify(ZONE)}, { family: 4 })).address));`,
  );
}

export interface Handshake {
  authorized: boolean;
  authorizationError: string | null;
  serial: string | null;
  subject: string | null;
}

/**
 * TLS handshake to `dash.test:8443` from inside the container, trusting ONLY
 * Pebble's issuing root (`/roots/0`, random per Pebble start) — so `authorized`
 * proves the served chain ends at the Pebble root, not at any system/extra CA.
 */
export function handshake(): Handshake {
  return inDashboard<Handshake>(`
    import tls from "node:tls";
    const root = await (await fetch("https://pebble.test:15000/roots/0")).text();
    const out = await new Promise((resolve) => {
      const s = tls.connect({ host: ${JSON.stringify(ZONE)}, port: ${TLS_PORT}, servername: ${JSON.stringify(ZONE)}, ca: [root], rejectUnauthorized: false }, () => {
        const c = s.getPeerCertificate();
        resolve({ authorized: s.authorized, authorizationError: s.authorizationError ? String(s.authorizationError) : null, serial: c?.serialNumber ?? null, subject: c?.subject?.CN ?? null });
        s.end();
      });
      s.on("error", (e) => resolve({ authorized: false, authorizationError: String(e.code ?? e.message), serial: null, subject: null }));
      s.setTimeout(10000, () => { s.destroy(); resolve({ authorized: false, authorizationError: "timeout", serial: null, subject: null }); });
    });
    console.log(JSON.stringify(out));
  `);
}

// ── Dashboard REST ──

type Headers = () => Record<string, string>;

async function call<T = unknown>(
  request: APIRequestContext,
  headers: Headers,
  method: "get" | "put" | "post" | "delete",
  url: string,
  data?: unknown,
): Promise<{ status: number; body: { success?: boolean; data?: T; error?: string } & Record<string, unknown> }> {
  const res = await request[method](url, { headers: headers(), ...(data === undefined ? {} : { data }) });
  return { status: res.status(), body: await res.json().catch(() => ({})) };
}

export interface TlsCert {
  name: string;
  sourceId: string;
  held: boolean;
  notAfter?: number;
  advertise: boolean;
  stage: string;
  lastError?: string;
}
export interface TlsHealth {
  enabled: boolean;
  bound: boolean;
  host?: string;
  port?: number;
  gates?: Array<{ id: string; ok: boolean; name?: string; sourceId?: string; hint?: string }>;
  sources?: Array<{ id: string; type: string; details?: Record<string, string | boolean> }>;
  certs?: TlsCert[];
}

export class AcmeApi {
  private readonly request: APIRequestContext;
  private readonly headers: Headers;

  constructor(request: APIRequestContext, headers: Headers) {
    this.request = request;
    this.headers = headers;
  }

  async tls(): Promise<TlsHealth> {
    return ((await call(this.request, this.headers, "get", "/api/health")).body.tls ?? { enabled: false, bound: false }) as TlsHealth;
  }

  async cert(sourceId: string, name = ZONE): Promise<TlsCert | undefined> {
    return (await this.tls()).certs?.find((c) => c.sourceId === sourceId && c.name === name);
  }

  /** Stored `tls` block (`GET /api/config`). */
  async storedTls(): Promise<Record<string, unknown>> {
    const r = await call<{ tls?: Record<string, unknown> }>(this.request, this.headers, "get", "/api/config");
    return r.body.data?.tls ?? {};
  }

  async putTls(patch: Record<string, unknown>): Promise<void> {
    const r = await call(this.request, this.headers, "put", "/api/config", { tls: patch });
    if (r.status !== 200 || r.body.success === false) throw new Error(`PUT /api/config tls -> ${r.status} ${r.body.error ?? ""}`);
  }

  async putSource(entry: Record<string, unknown>): Promise<void> {
    const r = await call(this.request, this.headers, "put", `/api/tls/acme/${entry.id}`, entry);
    if (r.status !== 200 || r.body.success !== true) throw new Error(`PUT acme ${entry.id} -> ${r.status} ${r.body.error ?? ""}`);
  }

  async putCredentials(id: string, body: Record<string, string>): Promise<void> {
    const r = await call(this.request, this.headers, "put", `/api/tls/acme/${id}/credentials`, body);
    if (r.status !== 200 || r.body.success !== true) throw new Error(`PUT credentials ${id} -> ${r.status} ${r.body.error ?? ""}`);
  }

  /** Tolerates an already-removed source (404). */
  async deleteSource(id: string): Promise<void> {
    const r = await call(this.request, this.headers, "delete", `/api/tls/acme/${id}`);
    if (r.status !== 200 && r.status !== 404) throw new Error(`DELETE acme ${id} -> ${r.status} ${r.body.error ?? ""}`);
  }

  async issue(sourceId: string, name?: string): Promise<void> {
    const r = await call(this.request, this.headers, "post", "/api/tls/issue", name ? { sourceId, name } : { sourceId });
    if (r.status >= 300 || r.body.success === false) throw new Error(`POST /api/tls/issue -> ${r.status} ${r.body.error ?? ""}`);
  }

  async endpoints(): Promise<Array<{ kind: string; url: string; tls: boolean }>> {
    return ((await call<{ endpoints: Array<{ kind: string; url: string; tls: boolean }> }>(this.request, this.headers, "get", "/api/tunnel/endpoints")).body.data?.endpoints ?? []);
  }

  async pairingUrls(): Promise<string[]> {
    const r = await call<{ urls: string[] }>(this.request, this.headers, "get", "/api/pair/payload");
    if (r.body.success !== true) throw new Error(`GET /api/pair/payload -> ${r.status} ${r.body.error ?? ""}`);
    return r.body.data?.urls ?? [];
  }

  /**
   * Turn the TLS listener on, bound to the container's overlay address (D10: the
   * default 127.0.0.1 is loopback and emits no endpoint). Returns the prior
   * `enabled`/`host` so `restoreListener` can put them back.
   */
  async enableListener(): Promise<{ enabled: boolean; host?: string }> {
    const prev = await this.storedTls();
    await this.putTls({ enabled: true, host: containerAddress(), port: TLS_PORT });
    return { enabled: prev.enabled === true, host: typeof prev.host === "string" ? prev.host : undefined };
  }

  async restoreListener(prev: { enabled: boolean; host?: string }): Promise<void> {
    await this.putTls({ enabled: prev.enabled, host: prev.host ?? "127.0.0.1" });
  }
}

/** A Pebble/Cloudflare-shim acme entry for `dash.test`. */
export function cloudflareEntry(id: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: "acme",
    id,
    domains: [ZONE],
    email: "e2e@dash.test",
    agreeTos: true,
    directory: PEBBLE_DIRECTORY,
    solver: { type: "cloudflare" },
    ...extra,
  };
}
