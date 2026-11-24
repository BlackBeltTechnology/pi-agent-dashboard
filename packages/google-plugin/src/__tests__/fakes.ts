/**
 * Test fakes: in-memory `PluginCredentials` (with the host's key limit), a fake Google token/revoke
 * endpoint (`fetch`-shaped), unsigned id_token minting, a capturing logger, and `makeHarness` — the
 * store + client registry + connect service wired to a fake `ctx.oauth.startFlow` whose flows the test
 * drives to completion (`runFlow`). See change: add-google-connect.
 */
import type {
  PluginCredentialRecord,
  PluginCredentials,
  PluginLoginInteraction,
  PluginOAuthStartOptions,
} from "@blackbelt-technology/dashboard-plugin-runtime/server";
import { vi } from "vitest";
import type { ClientDeps } from "../server/clients.js";
import { ConnectService } from "../server/connect.js";
import { PendingFlows } from "../server/pending-flows.js";
import { GoogleStore } from "../server/store.js";
import type { BuiltInClients, Switches } from "../shared/default-clients.js";
import type { GoogleEndpoints } from "../shared/endpoints.js";
import { SCOPE } from "../shared/products.js";

export const TEST_ENDPOINTS: GoogleEndpoints = {
  issuer: "http://127.0.0.1:9",
  authorize: "http://127.0.0.1:9/o/oauth2/v2/auth",
  token: "http://127.0.0.1:9/token",
  revoke: "http://127.0.0.1:9/revoke",
  overridden: true,
};

export const LOCAL = { clientId: "local-id.apps.googleusercontent.com", clientSecret: "SECRET-local" };
export const REMOTE = { clientId: "remote-id.apps.googleusercontent.com", clientSecret: "SECRET-remote" };
export const OWN_BB = { clientId: "bb-id.apps.googleusercontent.com", clientSecret: "SECRET-bb" };
export const OWN_SEMMI = { clientId: "semmi-id.apps.googleusercontent.com", clientSecret: "SECRET-semmi" };

export function memoryCredentials(
  initial: Record<string, PluginCredentialRecord> = {},
  maxKeys = 256,
): PluginCredentials & { data: Map<string, PluginCredentialRecord> } {
  const data = new Map<string, PluginCredentialRecord>(Object.entries(structuredClone(initial)));
  const clone = <T>(v: T): T => (v === undefined ? v : structuredClone(v));
  const full = (k: string) => {
    if (!data.has(k) && data.size >= maxKeys) {
      throw Object.assign(new Error("Plugin namespace exceeds keys"), { code: "too_many_keys" });
    }
  };
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
      full(k);
      data.set(k, clone(r));
    },
    async remove(k) {
      data.delete(k);
    },
    async update(k, fn) {
      const next = fn(clone(data.get(k)));
      if (next === undefined) data.delete(k);
      else {
        full(k);
        data.set(k, clone(next));
      }
      return clone(next);
    },
  };
}

const b64u = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");

/** Unsigned-but-well-formed id_token (signature is not checked). */
function idToken(claims: Record<string, unknown>): string {
  return `${b64u({ alg: "RS256", typ: "JWT", kid: "k" })}.${b64u(claims)}.c2ln`;
}

function validClaims(over: Record<string, unknown> = {}): Record<string, unknown> {
  const now = Math.floor(Date.now() / 1000);
  return {
    iss: TEST_ENDPOINTS.issuer,
    aud: LOCAL.clientId,
    sub: "s1",
    email: "a@x.com",
    email_verified: true,
    iat: now,
    exp: now + 3600,
    ...over,
  };
}

export interface FakeTokenOptions {
  code?: () => Record<string, unknown> | { status: number; body: Record<string, unknown> } | Promise<Record<string, unknown> | { status: number; body: Record<string, unknown> }>;
  /** Receives the request body (`refresh_token`, `client_id` …) so a test can answer per account. */
  refresh?: (body: URLSearchParams) => Record<string, unknown> | { status: number; body: Record<string, unknown> } | Promise<unknown>;
  revoke?: () => number | Promise<number>;
}

interface TokenCall {
  grant: string | null;
  body: URLSearchParams;
  signal: AbortSignal | null | undefined;
}

/** A pending answer that rejects like `fetch` when the request's signal aborts (a hung token endpoint). */
function abortable<T>(p: T | Promise<T>, signal: AbortSignal | null | undefined): Promise<T> | T {
  if (!signal) return p;
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new DOMException("aborted", "AbortError"));
    if (signal.aborted) return abort();
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve(p).then(resolve, reject);
  });
}

/** fetch-shaped fake for the token + revoke endpoints; records calls. */
export function fakeGoogleFetch(opts: FakeTokenOptions) {
  const calls: TokenCall[] = [];
  const revokes: string[] = [];
  /** Every URL requested through this fetch, answered or not (the outbound-HTTP recorder, test-plan B14). */
  const urls: string[] = [];
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const revoke = async (body: URLSearchParams) => {
    revokes.push(body.get("token") ?? "");
    return new Response("", { status: opts.revoke ? await opts.revoke() : 200 });
  };
  const token = async (body: URLSearchParams, signal: AbortSignal | null | undefined) => {
    const grant = body.get("grant_type");
    calls.push({ grant, body, signal });
    const handler = grant === "refresh_token" ? opts.refresh : opts.code;
    const out = (await abortable((handler as ((b: URLSearchParams) => unknown) | undefined)?.(body), signal)) as Record<string, unknown> | undefined;
    if (out && typeof out.status === "number" && out.body) return json(out.status as number, out.body);
    return json(200, out ?? {});
  };
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    urls.push(url);
    const body = new URLSearchParams(init?.body instanceof URLSearchParams ? init.body.toString() : String(init?.body ?? ""));
    if (url === TEST_ENDPOINTS.revoke) return revoke(body);
    if (url === TEST_ENDPOINTS.token) return token(body, init?.signal);
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
  return { fetchImpl, calls, revokes, urls };
}

export function capturingLogger() {
  const lines: string[] = [];
  const warns: string[] = [];
  return {
    lines,
    warns,
    info: (m: string) => lines.push(m),
    warn: (m: string) => {
      warns.push(m);
      lines.push(m);
    },
    error: (m: string) => lines.push(m),
  };
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  promise.catch(() => {});
  return { promise, resolve, reject };
}

export interface HarnessOptions {
  builtIn?: BuiltInClients;
  switches?: Partial<Switches>;
  initial?: Record<string, PluginCredentialRecord>;
  maxKeys?: number;
  base?: string | undefined;
  /** Sign-in the fake Google returns. */
  google?: {
    sub?: string;
    email?: string;
    scope?: string[];
    refresh?: string | null;
    extra?: Record<string, unknown>;
    revokeStatus?: number;
    /** Merged over the id_token claims (`undefined` removes a claim): `email_verified`, `nonce`, `sub` … */
    claims?: Record<string, unknown>;
    /** Replaces the code-exchange answer (status/body, or a delayed one); a throw is a dropped connection. */
    token?: () => Record<string, unknown> | { status: number; body: Record<string, unknown> } | Promise<Record<string, unknown> | { status: number; body: Record<string, unknown> }>;
  };
}

/** Hand the authorization code to the flow the way its path would: pasted URL, loopback, or HTTP callback. */
function deliverCode(d: {
  how: "auto" | "paste" | undefined;
  /** What the user pastes instead of the well-formed redirect (paste path only). */
  text?: string | ((state: string) => string);
  state: string;
  redirect: string;
  paste: { resolve: (v: string) => void };
  loopback: undefined | { code: { resolve: (v: { code: string }) => void } };
  connect: ConnectService;
}): void {
  if (d.how === "paste") {
    d.paste.resolve(typeof d.text === "function" ? d.text(d.state) : (d.text ?? `${d.redirect}?code=CODE&state=${encodeURIComponent(d.state)}`));
    return;
  }
  if (d.redirect.startsWith("http://127.0.0.1:5555")) {
    d.loopback?.code.resolve({ code: "CODE" });
    return;
  }
  const r = d.connect.deliver(d.state, { code: "CODE" });
  if (!r.ok) throw new Error(`deliver refused: ${r.error}`);
}

/** Everything a connect/consent test needs. */
export function makeHarness(opts: HarnessOptions = {}) {
  const creds = memoryCredentials(opts.initial, opts.maxKeys);
  const store = new GoogleStore(creds);
  const logger = capturingLogger();
  const sw: Switches = { defaultClients: true, remoteReturn: true, ...opts.switches };
  const builtIn: BuiltInClients = opts.builtIn ?? { local: LOCAL, remote: REMOTE };
  const clients: ClientDeps = { store, builtIn, switches: () => sw };
  const pending = new PendingFlows();
  const started: PluginOAuthStartOptions[] = [];
  const oauth = {
    startFlow: vi.fn(async (o: PluginOAuthStartOptions) => {
      started.push(o);
      return { flowId: `flow-${started.length}` };
    }),
  };
  // The token endpoint answers with an id_token whose nonce/aud the test's `runFlow` fills in.
  let nonce = "";
  let aud = "";
  const g: NonNullable<HarnessOptions["google"]> = { ...(opts.google ?? {}) };
  const google = fakeGoogleFetch({
    code: () => g.token?.() ?? ({
      access_token: "ACCESS-new",
      ...(g.refresh === null ? {} : { refresh_token: g.refresh ?? "REFRESH-new" }),
      expires_in: 3600,
      token_type: "Bearer",
      scope: (g.scope ?? []).join(" "),
      id_token: idToken(
        Object.fromEntries(
          Object.entries(validClaims({ aud, nonce, sub: g.sub ?? "s1", email: g.email ?? "a@x.com", ...g.claims })).filter(([, v]) => v !== undefined),
        ),
      ),
      ...(g.extra ?? {}),
    }),
    refresh: () => ({ access_token: "ACCESS-refreshed", expires_in: 3600, token_type: "Bearer" }),
    revoke: () => g.revokeStatus ?? 200,
  });
  const connect = new ConnectService({
    store,
    clients,
    endpoints: TEST_ENDPOINTS,
    oauth,
    logger,
    pending,
    dashboardBase: () => ("base" in opts ? opts.base : "https://dash.example.com"),
    fetchImpl: google.fetchImpl,
    newId: (() => {
      let n = 0;
      return () => `uuid${++n}`;
    })(),
    createCallback: (async () => {
      const code = deferred<{ code: string }>();
      harness.loopback = { code, close: vi.fn<() => void>() };
      return {
        redirectUri: "http://127.0.0.1:5555/",
        state: "L".repeat(43),
        waitForCode: () => code.promise,
        close: () => harness.loopback?.close(),
        server: {} as never,
      };
    }) as never,
  });

  const harness = {
    creds,
    store,
    logger,
    sw,
    clients,
    pending,
    started,
    oauth,
    google,
    /** The sign-in the fake Google returns — mutate between flows. */
    reply: g,
    connect,
    /** Authorization URL of the most recent `runFlow` (kept when the sign-in then fails). */
    lastAuthUrl: undefined as undefined | URL,
    loopback: undefined as undefined | { code: ReturnType<typeof deferred<{ code: string }>>; close: () => void },
    /**
     * Drive started flow `i` to completion: run `login`, deliver a code the way its path does, then `persist`.
     * `deliver` overrides how the code arrives (`"paste"` | `"callback"` | `"auto"`).
     */
    async runFlow(i = started.length - 1, o: { deliver?: "auto" | "paste"; abortAfterMs?: number; pasteText?: string | ((state: string) => string) } = {}) {
      const s = started[i] as PluginOAuthStartOptions;
      const events: Array<{ type: string; url?: string }> = [];
      const paste = deferred<string>();
      const ac = new AbortController();
      const ix: PluginLoginInteraction = {
        signal: ac.signal,
        prompt: vi.fn(async (p) => {
          p.signal?.addEventListener("abort", () => paste.reject(new Error("aborted")));
          return paste.promise;
        }),
        notify: (e) => events.push(e as never),
      };
      const login = s.loginFlow.login(ix);
      login.catch(() => {});
      for (const deadline = Date.now() + 10_000; Date.now() < deadline && !events.some((e) => e.type === "auth_url"); ) await new Promise((r) => setTimeout(r, 1));
      const url = new URL(events.find((e) => e.type === "auth_url")?.url as string);
      nonce = url.searchParams.get("nonce") ?? "";
      aud = url.searchParams.get("client_id") ?? "";
      const state = url.searchParams.get("state") as string;
      const redirect = url.searchParams.get("redirect_uri") as string;
      harness.lastAuthUrl = url;
      deliverCode({ how: o.deliver, text: o.pasteText, state, redirect, paste, loopback: harness.loopback, connect });
      if (o.abortAfterMs !== undefined) setTimeout(() => ac.abort(), o.abortAfterMs);
      const cred = await login;
      await s.persist(cred);
      return { url, cred };
    },
  };
  return harness;
}

/** A stored account record (the shape `GoogleStore` writes). */
export function account(
  sub: string,
  email: string,
  over: { client?: string; clientId?: string; scopes?: string[]; products?: Record<string, unknown>; status?: string; alias?: string; access?: string; expires?: number } = {},
): PluginCredentialRecord {
  return {
    sub,
    email,
    ...(over.alias ? { alias: over.alias } : {}),
    addedAt: 1,
    client: over.client ?? "builtin",
    grant: {
      clientId: over.clientId ?? LOCAL.clientId,
      refresh: `REFRESH-${sub}`,
      access: over.access ?? `ACCESS-${sub}`,
      expires: over.expires ?? Date.now() + 3_600_000,
      scopes: over.scopes ?? [SCOPE.gmailReadonly],
      status: over.status ?? "ok",
      grantedAt: 1,
    },
    products: (over.products ?? { gmail: { level: "readonly" } }) as unknown as PluginCredentialRecord,
  } as PluginCredentialRecord;
}

export function ownClient(id: string, label: string, c = OWN_BB, over: Record<string, unknown> = {}): PluginCredentialRecord {
  return { id, label, type: "installed", ...c, domains: [], addedAt: 1, ...over } as PluginCredentialRecord;
}
