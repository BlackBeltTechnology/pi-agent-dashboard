/**
 * Scriptable fake of the tiered `/api/live-server` mint/touch contract for client tests: every mint/touch
 * answer is chosen per call, mint concurrency is tracked, and document visibility can be driven.
 * See change: serve-live-previews-on-capability-origin (test-plan group 10 / D7).
 */
import { vi } from "vitest";

interface FakeCall {
  method: string;
  url: string;
  body: Record<string, unknown> | null;
}

/** One scripted answer. `throws` = network error, `never` = the request never settles, `text` = body is not JSON. */
export interface Reply {
  status?: number;
  body?: unknown;
  throws?: boolean;
  never?: boolean;
  text?: boolean;
  delayMs?: number;
}

export interface TierFake {
  calls: FakeCall[];
  mints: () => FakeCall[];
  touches: () => FakeCall[];
  policyReads: () => FakeCall[];
  /** `(n, body)` → the answer to the n-th (1-based) mint. */
  onMint: (n: number, body: Record<string, unknown> | null) => Reply;
  /** `(n)` → the answer to the n-th (1-based) touch. */
  onTouch: (n: number) => Reply;
  /** Egress report served to `GET /:id/egress`. */
  egress: { rootAbsolute: boolean };
  maxMintsInFlight: () => number;
  mintsInFlight: () => number;
  restore: () => void;
}

export const DASH_ORIGIN = () => window.location.origin;
export const ORIGIN_A = "http://k7q4zm2x5c6h3v4d5fjqwyabn7.localhost:8000";
export const ORIGIN_B = "http://m3w9xz2x5c6h3v4d5fjqwyabn7.localhost:8000";
export const TWELVE_HOURS = 12 * 60 * 60_000;
export const MIN = 60_000;
export const PID = "A".repeat(22);
export const TIER5_PATH = `/preview/${PID}/`;
export const legacyPath = (id: string, n: number) => `/live/${id}/~c/tok_${n}_padpadpadpadpadpadpad/`;

/** A tier-1..4 `/` answer (tier 3 uses `/?k=`). */
export const originReply = (origin: string, expiresAt: number, extra: Record<string, unknown> = {}): Reply => ({
  body: { success: true, tier: 1, origin, path: "/", expiresAt, tokenId: "tidO", ...extra },
});
export const legacyReply = (id: string, n: number, expiresAt: number, extra: Record<string, unknown> = {}): Reply => ({
  body: { success: true, path: legacyPath(id, n), expiresAt, tokenId: `tidL${n}`, ...extra },
});
const tier5Reply = (expiresAt: number, extra: Record<string, unknown> = {}): Reply => ({
  body: { success: true, tier: 5, path: TIER5_PATH, expiresAt, tokenId: "tid5", ...extra },
});

const settle = (reply: Reply, make: () => Response): Promise<Response> => {
  if (reply.never) return new Promise<Response>(() => {});
  const run = () => {
    if (reply.throws) throw new TypeError("network down");
    return make();
  };
  if (!reply.delayMs) return Promise.resolve().then(run);
  return new Promise<Response>((resolve, reject) => {
    setTimeout(() => {
      try {
        resolve(run());
      } catch (e) {
        reject(e);
      }
    }, reply.delayMs);
  });
};

const response = (reply: Reply, fallbackBody: unknown): Response => {
  const status = reply.status ?? 200;
  return {
    ok: status >= 200 && status < 300,
    status,
    json: reply.text ? async () => Promise.reject(new SyntaxError("Unexpected token <")) : async () => reply.body ?? fallbackBody,
  } as unknown as Response;
};

/** The routes whose answer is fixed (list / policy / start / egress). `null` = scripted route or unhandled. */
function fixedRoute(url: string, method: string, rootAbsolute: boolean): { status: number; payload: unknown } | null {
  const ok = (payload: unknown) => ({ status: 200, payload });
  if (url.endsWith("/api/live-server/list")) return ok({ success: true, data: { servers: [] } });
  if (url.endsWith("/api/live-server/policy")) return ok({ exposure: "local-only", epoch: 1, promptingEnabled: false });
  if (url.endsWith("/api/live-server/start-static")) return ok({ ok: true, id: "stat1234", entry: "index.html", root: "/p/m/a" });
  if (url.endsWith("/api/live-server/start")) {
    return ok({ success: true, data: { id: "abc12345", label: "vite", host: "127.0.0.1", port: 5173, path: "/live/abc12345/" } });
  }
  if (url.includes("/egress?token=")) {
    return ok({ ok: true, origins: [], scanIncomplete: false, rootAbsolute, runtimeChannel: true, promptingEnabled: false });
  }
  if (url.endsWith("/capability") || url.endsWith("/touch")) return null;
  return { status: 404, payload: { success: false, error: `unhandled ${method} ${url}` } };
}

export function installTierFake(): TierFake {
  const original = globalThis.fetch;
  let mintN = 0;
  let touchN = 0;
  let inFlight = 0;
  let maxInFlight = 0;
  const f: TierFake = {
    calls: [],
    mints: () => f.calls.filter((c) => c.url.endsWith("/capability")),
    touches: () => f.calls.filter((c) => c.url.endsWith("/touch")),
    policyReads: () => f.calls.filter((c) => c.url.endsWith("/api/live-server/policy")),
    onMint: (n) => legacyReply("abc12345", n, Date.now() + TWELVE_HOURS),
    onTouch: () => ({ status: 200, body: { ok: true } }),
    egress: { rootAbsolute: false },
    maxMintsInFlight: () => maxInFlight,
    mintsInFlight: () => inFlight,
    restore: () => {
      globalThis.fetch = original;
    },
  };
  globalThis.fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : null;
    f.calls.push({ method, url, body });
    const fixed = fixedRoute(url, method, f.egress.rootAbsolute);
    if (fixed) return Promise.resolve(response({ status: fixed.status }, fixed.payload));
    if (url.endsWith("/capability")) {
      mintN += 1;
      const reply = f.onMint(mintN, body);
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      return settle(reply, () => response(reply, {})).finally(() => {
        inFlight -= 1;
      });
    }
    if (url.endsWith("/touch")) {
      touchN += 1;
      const reply = f.onTouch(touchN);
      return settle(reply, () => response(reply, { ok: (reply.status ?? 200) < 300 }));
    }
    return Promise.resolve(response({ status: 404 }, { success: false, error: `unhandled ${method} ${url}` }));
  }) as unknown as typeof fetch;
  return f;
}

/** Drive `document.visibilityState` (jsdom's is read-only) and notify listeners. */
export function installVisibility() {
  let state: DocumentVisibilityState = "visible";
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
  return {
    set(next: DocumentVisibilityState) {
      state = next;
      document.dispatchEvent(new Event("visibilitychange"));
    },
    restore() {
      // removes the own-property shim so jsdom's prototype getter shows through
      delete (document as unknown as { visibilityState?: unknown }).visibilityState;
    },
  };
}
