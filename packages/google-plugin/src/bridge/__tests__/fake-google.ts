/**
 * Reusable test kit for every product's bridge tools (see `bridge/__tests__/AGENTS.md`):
 *  - `createFakeGoogle()` — a fake Google REST `fetch`: routes by method + path, canned/sequenced replies,
 *    every request recorded (with the bearer token and parsed body).
 *  - `makeToolHost({ accounts })` — the REAL `google/lease` handler over an in-memory store behind a lane
 *    fake, the shared runtime, and the product tools wired to the fake Google. `host.run(name, params, ctx)`.
 *  - `uiCtx(answer)` / `NO_UI` — the host `ctx`: a recorded confirm dialog, or no interactive UI at all.
 * See change: add-google-connect.
 */
import { vi } from "vitest";
import { account, capturingLogger, LOCAL, memoryCredentials, REMOTE, TEST_ENDPOINTS } from "../../__tests__/fakes.js";
import { createLeaseHandler } from "../../server/lease.js";
import { acctKey, GoogleStore, summarize } from "../../server/store.js";
import { type Product, requiredScopes, type Selection } from "../../shared/products.js";
import { ACCOUNTS_TYPE, LEASE_TYPE } from "../../shared/protocol.js";
import { buildTools, createRuntime, type LaneRequest, type ProductTools, type RuntimeDeps, type ToolContext, type ToolDef, type ToolResult } from "../runtime.js";
import { PRODUCT_TOOLS } from "../tools/index.js";

// ───────────────────────────── fake Google REST ─────────────────────────────

export interface FakeReply {
  status?: number;
  /** Serialized as the JSON body. */
  json?: unknown;
  /** Raw body (overrides `json`). */
  text?: string;
  /** Binary body (overrides `text` / `json`). */
  bytes?: Uint8Array;
  headers?: Record<string, string>;
  /** `network` = connection reset (fetch rejects); `hang` = never answers until the request is aborted. */
  fail?: "network" | "hang" | "midstream";
}

export interface FakeRequest {
  method: string;
  /** Path below the API base (`/calendars/primary/events`) — no `/calendar/v3` prefix. */
  path: string;
  /** The whole pathname, prefix included. */
  fullPath: string;
  query: Record<string, string>;
  queryAll: Record<string, string[]>;
  /** The bearer token (`ACCESS-<sub>` for a host account). */
  token: string | undefined;
  headers: Record<string, string>;
  /** Parsed JSON body (undefined when none / not JSON). */
  body: unknown;
  rawBody: string | undefined;
  /** A non-string body (multipart upload, media) as bytes. */
  bodyBytes?: Buffer;
  /** `Date.now()` when received (fake timers aware). */
  at: number;
}

type FakeHandler = FakeReply | FakeReply[] | ((req: FakeRequest, n: number) => FakeReply);

export interface FakeGoogle {
  fetchImpl: typeof fetch;
  /** Every request seen, in order (matched or not). */
  calls: FakeRequest[];
  /** Route a request. `path` string = exact path below the API base, RegExp = tested on it. Later routes win. An array answers in order, the last entry repeating. */
  on(method: string, path: string | RegExp, handler: FakeHandler): FakeGoogle;
  /** Calls to a method (+ optional path). */
  to(method: string, path?: string | RegExp): FakeRequest[];
  /** Requests that can change state (anything but GET / HEAD). */
  writes(): FakeRequest[];
  /** Bearer tokens seen, deduplicated. */
  tokens(): string[];
}

const stripPrefix = (p: string) => p.replace(/^\/[^/]+\/v\d+/, "") || "/";

export function createFakeGoogle(): FakeGoogle {
  const calls: FakeRequest[] = [];
  const routes: Array<{ method: string; path: string | RegExp; handler: FakeHandler; n: number }> = [];
  const matches = (path: string | RegExp, p: string) => (typeof path === "string" ? path === p : path.test(p));

  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries((init?.headers ?? {}) as Record<string, string>)) headers[k.toLowerCase()] = v;
    const rawBody = typeof init?.body === "string" ? init.body : undefined;
    let body: unknown;
    try {
      body = rawBody === undefined ? undefined : JSON.parse(rawBody);
    } catch {
      body = undefined;
    }
    const queryAll: Record<string, string[]> = {};
    for (const [k, v] of url.searchParams) (queryAll[k] ??= []).push(v);
    const req: FakeRequest = {
      method: (init?.method ?? "GET").toUpperCase(),
      path: stripPrefix(url.pathname),
      fullPath: url.pathname,
      query: Object.fromEntries(url.searchParams),
      queryAll,
      token: /^Bearer (.+)$/.exec(headers.authorization ?? "")?.[1],
      headers,
      body,
      rawBody,
      ...(init?.body instanceof Uint8Array ? { bodyBytes: Buffer.from(init.body) } : {}),
      at: Date.now(),
    };
    calls.push(req);
    const route = [...routes].reverse().find((r) => r.method === req.method && matches(r.path, req.path));
    let reply: FakeReply = { status: 404, json: { error: { code: 404, message: "no fake route", status: "NOT_FOUND" } } };
    if (route) {
      const n = route.n++;
      const h = route.handler;
      reply = typeof h === "function" ? h(req, n) : Array.isArray(h) ? (h[Math.min(n, h.length - 1)] as FakeReply) : h;
    }
    if (reply.fail === "network") throw new TypeError("fetch failed");
    if (reply.fail === "hang") {
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      });
    }
    const status = reply.status ?? 200;
    const text = reply.text ?? (reply.json === undefined ? "" : JSON.stringify(reply.json));
    if (reply.fail === "midstream") {
      // The status line and the first bytes arrive, then the connection drops.
      const first = Buffer.from(reply.bytes ?? text).subarray(0, 4);
      const body = new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(first);
          c.error(new TypeError("terminated"));
        },
      });
      return new Response(body, { status, headers: reply.headers });
    }
    return new Response(status === 204 || status === 205 ? null : (reply.bytes ? new Uint8Array(reply.bytes) : text), { status, headers: reply.headers });
  }) as typeof fetch;

  const api: FakeGoogle = {
    fetchImpl,
    calls,
    on(method, path, handler) {
      routes.push({ method: method.toUpperCase(), path, handler, n: 0 });
      return api;
    },
    to: (method, path) => calls.filter((c) => c.method === method.toUpperCase() && (path === undefined || matches(path, c.path))),
    writes: () => calls.filter((c) => c.method !== "GET" && c.method !== "HEAD"),
    tokens: () => [...new Set(calls.map((c) => c.token).filter((t): t is string => !!t))],
  };
  return api;
}

/** A Google error body in the modern shape (`error.details[]` ErrorInfo). */
export function googleError(status: number, reason: string, metadata?: Record<string, string>, message = "boom"): FakeReply {
  return {
    status,
    json: {
      error: {
        code: status,
        message,
        status: "PERMISSION_DENIED",
        details: [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason, ...(metadata ? { metadata } : {}) }],
      },
    },
  };
}

// ───────────────────────────── fake host ─────────────────────────────

export interface HostAccount {
  sub: string;
  email: string;
  alias?: string;
  /** `{ calendar: "write" }` or `{ gmail: { level: "send", options: { filters: true } } }`. Default: none on. */
  products?: Partial<Record<Product, string | { level: string; options?: Record<string, boolean> }>>;
  status?: "ok" | "reauth_required";
}

export interface HostOptions {
  accounts?: HostAccount[];
  google?: FakeGoogle;
  /** Product tool modules under test; default = the registered `PRODUCT_TOOLS`. */
  products?: readonly ProductTools[];
  runtime?: Pick<RuntimeDeps, "sleep" | "random" | "timeoutMs" | "confirmTimeoutMs">;
}

function selectionOf(a: HostAccount): Selection {
  const sel: Selection = {};
  for (const [p, v] of Object.entries(a.products ?? {})) {
    sel[p as Product] = typeof v === "string" ? { level: v } : { level: v.level, ...(v.options ? { options: v.options } : {}) };
  }
  return sel;
}

export function makeToolHost(opts: HostOptions = {}) {
  const google = opts.google ?? createFakeGoogle();
  const initial = Object.fromEntries(
    (opts.accounts ?? []).map((a, i) => {
      const sel = selectionOf(a);
      const rec = account(a.sub, a.email, { ...(a.alias ? { alias: a.alias } : {}), products: sel as Record<string, unknown>, scopes: requiredScopes(sel), ...(a.status ? { status: a.status } : {}) });
      return [acctKey(a.sub), { ...rec, addedAt: i + 1 }];
    }),
  );
  const creds = memoryCredentials(initial as never);
  const store = new GoogleStore(creds);
  const lease = createLeaseHandler({
    store,
    clients: { store, builtIn: { local: LOCAL, remote: REMOTE }, switches: () => ({ defaultClients: true, remoteReturn: true }) },
    endpoints: TEST_ENDPOINTS,
    logger: capturingLogger(),
  });
  /** Every lane request, in order: `{ type, payload }`. */
  const lanes: Array<{ type: string; payload: unknown }> = [];
  const request: LaneRequest = async (_plugin, type, payload) => {
    lanes.push({ type, payload });
    try {
      if (type === LEASE_TYPE) return { ok: true, result: await lease(payload) };
      if (type === ACCOUNTS_TYPE) return { ok: true, result: (await store.list()).map(summarize) };
      return { ok: false, error: "no_handler" };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  };
  const runtime = createRuntime({ request, endpoints: TEST_ENDPOINTS, fetchImpl: google.fetchImpl, sleep: async () => undefined, random: () => 0, ...opts.runtime });
  const built = buildTools(runtime, opts.products ?? PRODUCT_TOOLS);
  const tool = (name: string): ToolDef => {
    const t = built.tools.find((x) => x.name === name);
    if (!t) throw new Error(`no such tool ${name}`);
    return t;
  };
  return {
    google,
    store,
    lanes,
    ...built,
    tool,
    /** `host.run("gcal_events", { account: "work", … }, uiCtx(true).ctx)`. Rejects with the tool's `GoogleToolError`. */
    run: (name: string, params: Record<string, unknown>, ctx?: ToolContext): Promise<ToolResult> => tool(name).execute("id", params, undefined, undefined, ctx),
    /** The bearer token a host account's lease hands out. */
    tokenOf: (sub: string) => `ACCESS-${sub}`,
    /** Disconnect an account (e.g. while a confirm dialog is open). */
    disconnect: (sub: string) => creds.remove(acctKey(sub)),
    leaseCalls: () => lanes.filter((l) => l.type === LEASE_TYPE),
  };
}

/** `ctx` with an interactive UI whose confirm answers `answer`; `confirm` records `(title, message)`. */
export function uiCtx(answer: boolean | "throw" | "never" | (() => Promise<boolean>)) {
  const confirm = vi.fn(async (_title: string, _message: string, _opts?: unknown): Promise<boolean> => {
    if (answer === "throw") throw new Error("dismissed");
    if (answer === "never") return new Promise<boolean>(() => undefined);
    return typeof answer === "function" ? answer() : answer;
  });
  return { ctx: { hasUI: true, ui: { confirm }, cwd: process.cwd() } as ToolContext, confirm };
}

/** The host without an interactive UI (headless / print mode). */
export const NO_UI: ToolContext = { hasUI: false, cwd: process.cwd() };

/** The text of a tool result. */
export const textOf = (r: ToolResult): string => r.content.map((c) => c.text).join("\n");
/** The JSON of a read tool result. */
export const jsonOf = <T = Record<string, unknown>>(r: ToolResult): T => JSON.parse(textOf(r)) as T;
