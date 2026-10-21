/**
 * In-memory fake of the `/api/live-server` HTTP contract for client tests (the
 * server implements it in parallel). change: improve-canvas-html-and-url-ux.
 */
import { vi } from "vitest";

interface FakeCall {
  method: string;
  url: string;
  body: Record<string, unknown> | null;
}

interface FakeEgressOrigin {
  origin: string;
  source: "markup" | "runtime";
  state: "blocked" | "allowed-once" | "allowed-project";
  shared?: boolean;
  ungrantable?: boolean;
}

export interface FakeServers {
  calls: FakeCall[];
  policy: { exposure: "local-only" | "exposed"; epoch: number; promptingEnabled: boolean };
  servers: Array<{ id: string; label: string; host: string; port: number; addedBy?: "user" | "preset" | "legacy" }>;
  egress: { origins: FakeEgressOrigin[]; scanIncomplete: boolean; rootAbsolute: boolean; runtimeChannel: boolean; promptingEnabled: boolean };
  /** Override the start-static answer (status + body); default 200. */
  staticRefusal: { status: number; body: unknown } | null;
  staticEntry: string;
  staticRoot: string;
  touchOk: boolean;
  /** Test hook: the server saw a different exposure than /policy told the client. */
  mintSeesExposed?: boolean;
  grantReply: { status: number; body: Record<string, unknown> };
  mints: () => FakeCall[];
  callsTo: (needle: string, method?: string) => FakeCall[];
  install: () => void;
  restore: () => void;
}

const TWO_HOURS = 2 * 60 * 60_000;

export function installFakeLiveServer(): FakeServers {
  const original = globalThis.fetch;
  let mintN = 0;
  const f: FakeServers = {
    calls: [],
    policy: { exposure: "local-only", epoch: 1, promptingEnabled: false },
    servers: [],
    egress: { origins: [], scanIncomplete: false, rootAbsolute: false, runtimeChannel: true, promptingEnabled: false },
    staticRefusal: null,
    staticEntry: "index.html",
    staticRoot: "/p/m/a",
    touchOk: true,
    mintSeesExposed: undefined as boolean | undefined,
    grantReply: { status: 200, body: { ok: true } },
    mints: () => f.calls.filter((c) => c.url.endsWith("/capability")),
    callsTo: (needle, method) => f.calls.filter((c) => c.url.includes(needle) && (!method || c.method === method)),
    install: () => {
      globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = (init?.method ?? "GET").toUpperCase();
        const body = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : null;
        f.calls.push({ method, url, body });
        const json = (status: number, payload: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => payload }) as unknown as Response;

        if (url.endsWith("/api/live-server/list")) return json(200, { success: true, data: { servers: f.servers } });
        if (url.endsWith("/api/live-server/policy")) return json(200, f.policy);
        if (url.endsWith("/api/live-server/start-static")) {
          if (f.staticRefusal) return json(f.staticRefusal.status, f.staticRefusal.body);
          return json(200, { ok: true, id: "stat1234", entry: f.staticEntry, root: f.staticRoot });
        }
        if (url.endsWith("/api/live-server/start")) {
          const port = Number(body?.port);
          const existing = f.servers.find((s) => s.port === port);
          const entry = existing ?? { id: `port${port}`, label: String(body?.label ?? `localhost:${port}`), host: String(body?.host), port, addedBy: (body?.addedBy as "user" | "preset") ?? "user" };
          return json(200, { success: true, data: { ...entry, path: `/live/${entry.id}/` } });
        }
        const id = /\/api\/live-server\/([^/]+)\//.exec(url)?.[1] ?? "x";
        if (url.endsWith("/capability")) {
          mintN += 1;
          const exposedBlocked = (f.mintSeesExposed ?? f.policy.exposure === "exposed") && body?.egress !== "open" && body?.runScripts !== true;
          const scripts = body?.scripts === true && !exposedBlocked;
          return json(200, {
            ok: true,
            success: true,
            path: `/live/${id}/~c/tok${mintN}_padpadpadpadpadpadpad/`,
            expiresAt: Date.now() + TWO_HOURS,
            tokenId: `tid${mintN}`,
            policy: { egress: body?.egress === "open" ? "open" : "restricted", scripts },
          });
        }
        if (url.endsWith("/touch")) return json(f.touchOk ? 200 : 404, { ok: f.touchOk });
        if (url.includes("/egress?token=")) return json(200, { ok: true, ...f.egress });
        if (url.endsWith("/allow-once")) {
          const o = f.egress.origins.find((x) => x.origin === body?.origin);
          if (o) o.state = "allowed-once";
          return json(200, { ok: true });
        }
        if (url.endsWith("/egress-grant-request")) return json(f.grantReply.status, f.grantReply.body);
        if (method === "DELETE") return json(200, { success: true });
        return json(404, { success: false, error: `unhandled ${method} ${url}` });
      }) as unknown as typeof fetch;
    },
    restore: () => {
      globalThis.fetch = original;
    },
  };
  f.install();
  return f;
}
