/**
 * Test fakes: in-memory `PluginCredentials`, a fake Google token/revoke
 * endpoint (`fetch`-shaped), id_token minting, and a capturing logger.
 * See change: add-gmail-plugin.
 */
import type {
  PluginCredentialRecord,
  PluginCredentials,
} from "@blackbelt-technology/dashboard-plugin-runtime/server";
import type { GoogleEndpoints } from "../shared/endpoints.js";

export const TEST_ENDPOINTS: GoogleEndpoints = {
  issuer: "http://127.0.0.1:9",
  authorize: "http://127.0.0.1:9/o/oauth2/v2/auth",
  token: "http://127.0.0.1:9/token",
  revoke: "http://127.0.0.1:9/revoke",
  gmail: "http://127.0.0.1:9/gmail/v1",
  overridden: true,
};

export const CLIENT = { clientId: "cid.apps.googleusercontent.com", clientSecret: "SECRET-client-xyz" };

export function memoryCredentials(initial: Record<string, PluginCredentialRecord> = {}): PluginCredentials & {
  data: Map<string, PluginCredentialRecord>;
} {
  const data = new Map<string, PluginCredentialRecord>(Object.entries(structuredClone(initial)));
  const clone = <T>(v: T): T => (v === undefined ? v : structuredClone(v));
  return {
    data,
    async get(k) {
      return clone(data.get(k));
    },
    async list() {
      return [...data.keys()];
    },
    async snapshot() {
      return clone(Object.fromEntries(data));
    },
    async set(k, r) {
      data.set(k, clone(r));
    },
    async remove(k) {
      data.delete(k);
    },
    async update(k, fn) {
      const next = fn(clone(data.get(k)));
      if (next === undefined) data.delete(k);
      else data.set(k, clone(next));
      return clone(next);
    },
  };
}

const b64u = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");

/** Unsigned-but-well-formed id_token (signature not checked per design D3). */
export function idToken(claims: Record<string, unknown>): string {
  return `${b64u({ alg: "RS256", typ: "JWT", kid: "k" })}.${b64u(claims)}.c2ln`;
}

export function validClaims(over: Record<string, unknown> = {}): Record<string, unknown> {
  const now = Math.floor(Date.now() / 1000);
  return {
    iss: TEST_ENDPOINTS.issuer,
    aud: CLIENT.clientId,
    sub: "s1",
    email: "a@x.com",
    email_verified: true,
    iat: now,
    exp: now + 3600,
    ...over,
  };
}

export interface FakeTokenOptions {
  /** Response for authorization_code grants. */
  code?: () => Record<string, unknown> | { status: number; body: Record<string, unknown> };
  /** Response for refresh_token grants. */
  refresh?: () => Record<string, unknown> | { status: number; body: Record<string, unknown> } | Promise<unknown>;
  revoke?: () => number | Promise<number>;
}

interface TokenCall {
  grant: string | null;
  body: URLSearchParams;
}

/** fetch-shaped fake for the token + revoke endpoints; records calls. */
export function fakeGoogleFetch(opts: FakeTokenOptions) {
  const calls: TokenCall[] = [];
  const revokes: string[] = [];
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const revoke = async (body: URLSearchParams) => {
    revokes.push(body.get("token") ?? "");
    return new Response("", { status: opts.revoke ? await opts.revoke() : 200 });
  };
  const token = async (body: URLSearchParams) => {
    const grant = body.get("grant_type");
    calls.push({ grant, body });
    const handler = grant === "refresh_token" ? opts.refresh : opts.code;
    const out = (await handler?.()) as Record<string, unknown> | undefined;
    if (out && typeof out.status === "number" && out.body) return json(out.status, out.body);
    return json(200, out ?? {});
  };
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    const body = new URLSearchParams(init?.body instanceof URLSearchParams ? init.body.toString() : String(init?.body ?? ""));
    if (url === TEST_ENDPOINTS.revoke) return revoke(body);
    if (url === TEST_ENDPOINTS.token) return token(body);
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
  return { fetchImpl, calls, revokes };
}

export function capturingLogger() {
  const lines: string[] = [];
  return {
    lines,
    info: (m: string) => lines.push(m),
    warn: (m: string) => lines.push(m),
    error: (m: string) => lines.push(m),
  };
}
