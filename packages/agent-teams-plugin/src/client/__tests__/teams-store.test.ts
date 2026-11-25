// @vitest-environment jsdom
/**
 * Teams store (test-plan S31–S34, S39, S47, S54, S58, S75, S81, S107, S108):
 * single-flight conditional refetch, debounce with max-wait, safety timer,
 * backoff, `Retry-After`, hidden tab, restart convergence, control POST timeout.
 * Fake timers + a scripted `fetch`; no React.
 * See change: add-agent-teams-ui.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TeamUiSnapshot } from "../../shared/ui-protocol.js";
import { snapshotEtag } from "../../shared/ui-protocol.js";
import {
  BACKOFF_MS,
  CONTROL_TIMEOUT_MS,
  createTeamsStore,
  parseRetryAfter,
  type TeamsStore,
} from "../teams-store.js";
import { makeSnapshot } from "./fixtures.js";

interface Call {
  at: number;
  url: string;
  method: string;
  inm?: string;
}

/** A scripted server: current snapshot + a queue of one-shot overrides. */
function server() {
  const calls: Call[] = [];
  const state = { epoch: "E", rev: 41, status: "active" as const, hidden: false };
  const overrides: Array<(call: Call) => Response | Promise<Response> | Error> = [];
  const t0 = Date.now();
  const snapshot = (): TeamUiSnapshot => makeSnapshot({ epoch: state.epoch, rev: state.rev });
  const json = (body: unknown, status = 200, headers: Record<string, string> = {}): Response =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const headers = new Headers(init?.headers);
    const call: Call = { at: Date.now() - t0, url: String(input), method: init?.method ?? "GET", inm: headers.get("if-none-match") ?? undefined };
    calls.push(call);
    const next = overrides.shift();
    if (next) {
      const r = next(call);
      if (r instanceof Error) throw r;
      return r;
    }
    if (call.url.includes("/teams?sessionId=")) return json({ teams: [{ id: "t1" }], unavailable: [], persist_degraded: false });
    if (call.method === "POST") return json({ aborted: true });
    if (call.inm === snapshotEtag(state.epoch, state.rev)) return new Response(null, { status: 304 });
    return json(snapshot());
  });
  return {
    calls,
    state,
    fetchMock,
    overrides,
    snapshotGets: () => calls.filter((c) => c.method === "GET" && /\/teams\/t1$/.test(c.url)),
    json,
  };
}

let srv: ReturnType<typeof server>;
let store: TeamsStore;
let visible = true;
const advance = (ms: number) => vi.advanceTimersByTimeAsync(ms);
const setVisible = (v: boolean) => {
  visible = v;
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (v ? "visible" : "hidden") });
  document.dispatchEvent(new Event("visibilitychange"));
};

beforeEach(() => {
  vi.useFakeTimers();
  visible = true;
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (visible ? "visible" : "hidden") });
  srv = server();
  store = createTeamsStore({ fetch: srv.fetchMock as unknown as typeof fetch });
});
afterEach(() => {
  store.dispose();
  vi.useRealTimers();
});

/** Open a team view and let the first fetch land (cache = rev 41). */
async function open(): Promise<() => void> {
  const release = store.watchTeam("t1");
  await advance(0);
  expect(store.getTeam("t1")?.snapshot?.rev).toBe(41);
  srv.calls.length = 0;
  return release;
}

describe("first use and lookup", () => {
  it("fetches immediately (t=0) with no debounce and sends no validator the first time", async () => {
    store.watchTeam("t1");
    expect(srv.fetchMock).toHaveBeenCalledTimes(1);
    expect(srv.calls[0]).toMatchObject({ at: 0, method: "GET", url: "/api/plugins/agent-teams/teams/t1", inm: undefined });
    await advance(0);
    expect(store.getTeam("t1")).toMatchObject({ phase: "ready", stale: false });
  });

  it("watchSession looks the session up (encoded) and then loads the resolved team", async () => {
    store.watchSession("S/1 x");
    expect(srv.calls[0]?.url).toBe("/api/plugins/agent-teams/teams?sessionId=S%2F1%20x");
    await advance(0);
    expect(store.getLookup("S/1 x")).toMatchObject({ phase: "resolved", teamId: "t1" });
    expect(srv.calls[1]?.url).toBe("/api/plugins/agent-teams/teams/t1");
    await advance(0);
    expect(store.getTeam("t1")?.snapshot?.rev).toBe(41);
  });

  it("an empty lookup resolves to `null` and fetches no team (no existence oracle, no not-found)", async () => {
    srv.overrides.push(() => srv.json({ teams: [], unavailable: [], persist_degraded: false }));
    store.watchSession("S9");
    await advance(0);
    expect(store.getLookup("S9")).toEqual({ sessionId: "S9", phase: "resolved", teamId: null });
    expect(srv.calls).toHaveLength(1);
    expect(store.getTeam("t1")).toBeUndefined();
  });

  it("notifies subscribers on change and keeps entry references stable otherwise", async () => {
    const listener = vi.fn();
    store.subscribe(listener);
    store.watchTeam("t1");
    await advance(0);
    expect(listener).toHaveBeenCalled();
    const ref = store.getTeam("t1");
    listener.mockClear();
    srv.state.rev = 41;
    store.ingestFrame("t1", { epoch: "E", rev: 41 });
    await advance(5000);
    expect(store.getTeam("t1")).toBe(ref);
    expect(listener).not.toHaveBeenCalled();
  });
});

describe("refetch trigger (S31)", () => {
  it.each([
    ["(E,40) older rev", { epoch: "E", rev: 40 }, 0],
    ["(E,41) same rev", { epoch: "E", rev: 41 }, 0],
    ["(E,42) newer rev", { epoch: "E", rev: 42 }, 1],
    ["(E2,1) new epoch with a LOWER rev", { epoch: "E2", rev: 1 }, 1],
  ])("frame %s → %i request(s)", async (_n, frame, expected) => {
    await open();
    store.ingestFrame("t1", frame);
    await advance(10_000);
    expect(srv.snapshotGets()).toHaveLength(expected);
  });

  it("the conditional request carries If-None-Match of the cached state and a 304 keeps the cache", async () => {
    await open();
    const ref = store.getTeam("t1");
    store.ingestFrame("t1", { epoch: "E", rev: 42 }); // server still at 41 → 304
    await advance(500);
    expect(srv.snapshotGets()[0]?.inm).toBe(snapshotEtag("E", 41));
    expect(store.getTeam("t1")).toBe(ref);
  });

  it("a frame for an unwatched team is ignored", async () => {
    store.ingestFrame("tx", { epoch: "E", rev: 1 });
    await advance(5000);
    expect(srv.calls).toHaveLength(0);
  });
});

describe("debounce and max-wait (S33)", () => {
  it("a single frame → GET at 500 ms, none at 499", async () => {
    await open();
    srv.state.rev = 42;
    store.ingestFrame("t1", { epoch: "E", rev: 42 });
    await advance(499);
    expect(srv.snapshotGets()).toHaveLength(0);
    await advance(1);
    expect(srv.snapshotGets()).toHaveLength(1);
    expect(store.getTeam("t1")?.snapshot?.rev).toBe(42);
  });

  it("a second frame at 400 ms restarts the debounce (GET at 900 ms)", async () => {
    await open();
    srv.state.rev = 43;
    store.ingestFrame("t1", { epoch: "E", rev: 42 });
    await advance(400);
    store.ingestFrame("t1", { epoch: "E", rev: 43 });
    await advance(499);
    expect(srv.snapshotGets()).toHaveLength(0);
    await advance(1);
    expect(srv.snapshotGets()).toHaveLength(1);
  });

  it("frames every 400 ms for 60 s cannot starve the refetch: a GET within 2 000 ms, then at most every 2 000 ms", async () => {
    await open();
    for (let t = 0; t < 60_000; t += 400) {
      srv.state.rev += 1;
      store.ingestFrame("t1", { epoch: "E", rev: srv.state.rev });
      await advance(400);
    }
    const gets = srv.snapshotGets().map((c) => c.at);
    expect(gets.length).toBeGreaterThanOrEqual(28);
    expect(gets[0] as number).toBeLessThanOrEqual(2000);
    for (let i = 1; i < gets.length; i++) {
      const gap = (gets[i] as number) - (gets[i - 1] as number);
      expect(gap).toBeGreaterThanOrEqual(2000 - 1);
      expect(gap).toBeLessThanOrEqual(2000 + 400);
    }
  });
});

describe("safety timer and hidden tab (S32, S58)", () => {
  it("no request at 59 999 ms; ONE conditional request at 60 000 ms (304 keeps the cache)", async () => {
    await open();
    const ref = store.getTeam("t1");
    await advance(59_999);
    expect(srv.calls).toHaveLength(0);
    await advance(1);
    expect(srv.calls).toHaveLength(1);
    expect(srv.calls[0]?.inm).toBe(snapshotEtag("E", 41));
    expect(store.getTeam("t1")).toBe(ref);
  });

  it("a hidden tab makes 0 requests over 10 minutes, even with frames", async () => {
    await open();
    setVisible(false);
    store.ingestFrame("t1", { epoch: "E", rev: 99 });
    await advance(10 * 60_000);
    expect(srv.calls).toHaveLength(0);
  });

  it("hidden 3 h then visible: exactly one conditional request, timer re-armed once", async () => {
    await open();
    setVisible(false);
    await advance(3 * 60 * 60_000);
    expect(srv.calls).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
    setVisible(true);
    expect(vi.getTimerCount()).toBeGreaterThanOrEqual(1);
    await advance(500);
    expect(srv.snapshotGets()).toHaveLength(1);
    expect(srv.snapshotGets()[0]?.inm).toBe(snapshotEtag("E", 41));
    // the interval is the only timer left (re-armed exactly once)
    expect(vi.getTimerCount()).toBe(1);
    await advance(60_000);
    expect(srv.snapshotGets()).toHaveLength(2);
  });
});

describe("single flight (S39, S47)", () => {
  it("a frame arriving while GET #1 is in flight yields exactly ONE follow-up after it completes", async () => {
    await open();
    let release!: (r: Response) => void;
    const gate = new Promise<Response>((r) => (release = r));
    srv.overrides.push(() => gate);
    store.ingestFrame("t1", { epoch: "E", rev: 42 });
    await advance(500); // GET #1 starts and hangs
    expect(srv.snapshotGets()).toHaveLength(1);
    store.ingestFrame("t1", { epoch: "E", rev: 43 }); // arrives meanwhile
    await advance(5000);
    expect(srv.snapshotGets()).toHaveLength(1); // never concurrent
    srv.state.rev = 43;
    release(srv.json(makeSnapshot({ epoch: "E", rev: 42 })));
    await advance(500);
    expect(srv.snapshotGets()).toHaveLength(2); // exactly one follow-up, never dropped
    expect(store.getTeam("t1")?.snapshot?.rev).toBe(43);
    await advance(10_000);
    expect(srv.snapshotGets()).toHaveLength(2);
  });

  it("two mounted views of the same team share one request per frame and one cache", async () => {
    const a = await open();
    const b = store.watchTeam("t1");
    await advance(0);
    expect(srv.calls).toHaveLength(1); // the second view's own first use: one CONDITIONAL request (304)
    expect(srv.calls[0]?.inm).toBe(snapshotEtag("E", 41));
    srv.calls.length = 0;
    srv.state.rev = 42;
    store.ingestFrame("t1", { epoch: "E", rev: 42 });
    await advance(500);
    expect(srv.snapshotGets()).toHaveLength(1);
    a();
    b();
  });
});

describe("failed refresh (S34, S107)", () => {
  const fail500 = () => new Response("nope", { status: 500 });

  it("delays are 1 s, 2 s, 4 s, then 30 s ×3; success resets; the snapshot stays and is flagged stale", async () => {
    await open();
    const ref = store.getTeam("t1")?.snapshot;
    srv.state.rev = 42;
    for (let i = 0; i < 6; i++) srv.overrides.push(fail500);
    store.ingestFrame("t1", { epoch: "E", rev: 42 });
    await advance(500); // failure #1 at t=500
    const times = srv.snapshotGets().map((c) => c.at);
    expect(times).toEqual([500]);
    expect(store.getTeam("t1")).toMatchObject({ phase: "ready", stale: true, error: { kind: "http", status: 500 } });
    expect(store.getTeam("t1")?.snapshot).toBe(ref);
    await advance(1000 + 2000 + 4000 + 30_000 * 3);
    const gaps = srv.snapshotGets().map((c, i, a) => (i === 0 ? 0 : c.at - (a[i - 1] as Call).at)).slice(1);
    expect(gaps).toEqual([...BACKOFF_MS, 30_000, 30_000]); // 6 failures, then the 7th attempt succeeds
    expect(store.getTeam("t1")).toMatchObject({ phase: "ready", stale: false });
    expect(store.getTeam("t1")?.error).toBeUndefined();
    expect(store.getTeam("t1")?.snapshot?.rev).toBe(42);
    const n = srv.snapshotGets().length;
    srv.state.rev = 43;
    srv.overrides.push(fail500);
    store.ingestFrame("t1", { epoch: "E", rev: 43 });
    await advance(500);
    const failAt = (srv.snapshotGets()[n] as Call).at;
    await advance(1000); // back to the FIRST delay (1 s)
    expect((srv.snapshotGets()[n + 1] as Call).at - failAt).toBe(1000);
  });

  it("a frame arriving mid-backoff never shortens the wait", async () => {
    await open();
    srv.state.rev = 42;
    srv.overrides.push(fail500, fail500);
    store.ingestFrame("t1", { epoch: "E", rev: 42 });
    await advance(500); // fail #1 at 500; retry at 1500
    store.ingestFrame("t1", { epoch: "E", rev: 43 });
    store.ingestFrame("t1", { epoch: "E", rev: 44 });
    await advance(999);
    expect(srv.snapshotGets()).toHaveLength(1);
    await advance(1); // 1500: retry #1 (fails #2 → next wait 2 s → 3500)
    expect(srv.snapshotGets()).toHaveLength(2);
    store.ingestFrame("t1", { epoch: "E", rev: 45 });
    await advance(1999);
    expect(srv.snapshotGets()).toHaveLength(2);
    await advance(1);
    expect(srv.snapshotGets()).toHaveLength(3);
  });

  it.each([
    ["network error", () => new TypeError("failed to fetch")],
    ["500", () => new Response("x", { status: 500 })],
    ["invalid JSON", () => new Response("{not json", { status: 200 })],
    ["HTML body", () => new Response("<html>oops</html>", { status: 200, headers: { "content-type": "text/html" } })],
    ["JSON of the wrong shape", () => new Response(JSON.stringify({ hello: 1 }), { status: 200 })],
  ])("%s keeps the cached snapshot, flags it stale and never replaces it; Retry works", async (_n, make) => {
    await open();
    const ref = store.getTeam("t1")?.snapshot;
    srv.overrides.push(make);
    store.ingestFrame("t1", { epoch: "E", rev: 42 });
    srv.state.rev = 42;
    await advance(500);
    expect(store.getTeam("t1")?.snapshot).toBe(ref);
    expect(store.getTeam("t1")?.stale).toBe(true);
    store.retryTeam("t1"); // user Retry bypasses the backoff
    await advance(0);
    expect(store.getTeam("t1")).toMatchObject({ stale: false });
    expect(store.getTeam("t1")?.snapshot?.rev).toBe(42);
  });

  it("a first load that fails with no cache is an `error` entry (not a blank), then recovers", async () => {
    srv.overrides.push(() => new Response("x", { status: 503 }));
    store.watchTeam("t1");
    await advance(0);
    expect(store.getTeam("t1")).toMatchObject({ phase: "error" });
    expect(store.getTeam("t1")?.snapshot).toBeUndefined();
    await advance(1000);
    expect(store.getTeam("t1")).toMatchObject({ phase: "ready" });
  });

  it("never more than one request in flight per team", async () => {
    let inflight = 0;
    let maxInflight = 0;
    const base = srv.fetchMock.getMockImplementation() as (i: RequestInfo | URL, n?: RequestInit) => Promise<Response>;
    srv.fetchMock.mockImplementation(async (i, n) => {
      inflight += 1;
      maxInflight = Math.max(maxInflight, inflight);
      await new Promise((r) => setTimeout(r, 300));
      try {
        return await base(i, n);
      } finally {
        inflight -= 1;
      }
    });
    store.watchTeam("t1");
    for (let i = 0; i < 50; i++) {
      srv.state.rev += 1;
      store.ingestFrame("t1", { epoch: "E", rev: srv.state.rev });
      store.signalReconnect();
      await advance(100);
    }
    await advance(10_000);
    expect(maxInflight).toBe(1);
  });
});

describe("Retry-After (S108)", () => {
  const rate = (value?: string) => () => new Response("slow down", { status: 429, headers: value === undefined ? {} : { "retry-after": value } });

  async function waitAfter429(value?: string): Promise<number> {
    await open();
    srv.state.rev = 42;
    srv.overrides.push(rate(value));
    store.ingestFrame("t1", { epoch: "E", rev: 42 });
    await advance(500);
    const first = (srv.snapshotGets()[0] as Call).at;
    expect(store.getTeam("t1")?.stale).toBe(true); // stale snapshot stays visible meanwhile
    expect(store.getTeam("t1")?.snapshot).toBeDefined();
    for (let waited = 0; waited < 200_000; waited += 100) {
      await advance(100);
      if (srv.snapshotGets().length > 1) return (srv.snapshotGets()[1] as Call).at - first;
    }
    throw new Error("no retry within 200 s");
  }

  it.each([
    ["2", 2000],
    ["0", 1000],
    ["-1", 1000],
    ["abc", 1000],
    [undefined, 1000],
    ["86400", 120_000],
    ["1", 1000],
    ["120", 120_000],
    ["121", 120_000],
  ])("Retry-After %s → waits %i ms (invalid/0/absent → the normal first backoff of 1 s)", async (value, expectedMs) => {
    expect(await waitAfter429(value)).toBe(expectedMs);
  });

  it("an HTTP-date is accepted and clamped to [1 s, 120 s]", async () => {
    const inSeconds = (s: number) => new Date(Date.now() + s * 1000).toUTCString();
    // the 429 lands 500 ms after the date was computed and toUTCString drops milliseconds
    const wait = await waitAfter429(inSeconds(30));
    expect(wait).toBeGreaterThanOrEqual(28_000);
    expect(wait).toBeLessThanOrEqual(30_000);
  });

  it("an HTTP-date far in the future is clamped to 120 s; one in the past uses the normal backoff", async () => {
    expect(await waitAfter429(new Date(Date.now() + 86_400_000).toUTCString())).toBe(120_000);
  });

  it("an HTTP-date in the past falls back to the normal first backoff (1 s)", async () => {
    expect(await waitAfter429(new Date(Date.now() - 60_000).toUTCString())).toBe(1000);
  });

  it("a frame arriving during the Retry-After wait does not bypass it", async () => {
    await open();
    srv.state.rev = 42;
    srv.overrides.push(rate("10"));
    store.ingestFrame("t1", { epoch: "E", rev: 42 });
    await advance(500);
    store.ingestFrame("t1", { epoch: "E", rev: 43 });
    store.signalReconnect();
    await advance(9_999);
    expect(srv.snapshotGets()).toHaveLength(1);
    await advance(1);
    expect(srv.snapshotGets()).toHaveLength(2);
  });

  it("user Retry cannot bypass an active 429 wait", async () => {
    await open();
    srv.state.rev = 42;
    srv.overrides.push(rate("10"));
    store.ingestFrame("t1", { epoch: "E", rev: 42 });
    await advance(500);
    store.retryTeam("t1");
    await advance(9_000);
    expect(srv.snapshotGets()).toHaveLength(1);
  });

  it("parseRetryAfter unit rows", () => {
    const now = Date.parse("2026-01-01T00:00:00Z");
    expect(parseRetryAfter("5", now)).toBe(5000);
    expect(parseRetryAfter(" 5 ", now)).toBe(5000);
    expect(parseRetryAfter("", now)).toBeUndefined();
    expect(parseRetryAfter(null, now)).toBeUndefined();
    expect(parseRetryAfter("1.5", now)).toBeUndefined();
    expect(parseRetryAfter("Thu, 01 Jan 2026 00:00:30 GMT", now)).toBe(30_000);
    expect(parseRetryAfter("Wed, 31 Dec 2025 23:59:00 GMT", now)).toBeUndefined();
    expect(parseRetryAfter("99999999999999999999", now)).toBe(120_000);
  });
});

describe("restart convergence (S54)", () => {
  it("a reconnect after a server restart refetches exactly once, never blanks the cache, then converges", async () => {
    await open();
    const seen: Array<string | undefined> = [];
    store.subscribe(() => seen.push(store.getTeam("t1")?.snapshot?.members[0]?.status));
    srv.state.epoch = "E2"; // restart: new epoch, rev restarts lower
    srv.state.rev = 3;
    store.signalReconnect();
    store.signalReconnect(); // flapping socket
    await advance(500);
    expect(srv.snapshotGets()).toHaveLength(1);
    expect(store.getTeam("t1")?.snapshot).toMatchObject({ epoch: "E2", rev: 3 });
    expect(seen.every((s) => s !== undefined)).toBe(true);
    // a frame of the NEW epoch with a lower rev than the old cache still triggers one refetch
    srv.state.rev = 4;
    store.ingestFrame("t1", { epoch: "E2", rev: 4 });
    await advance(500);
    expect(store.getTeam("t1")?.snapshot?.rev).toBe(4);
  });

  it("replaying old frames: every rev ≤ the cache is ignored; a 7 200-frame burst yields ONE GET; old-epoch frames cannot loop", async () => {
    await open();
    srv.state.rev = 7200;
    for (let r = 1; r <= 41; r++) store.ingestFrame("t1", { epoch: "E", rev: r }); // known state
    await advance(10_000);
    expect(srv.snapshotGets()).toHaveLength(0);
    for (let r = 42; r <= 7200; r++) store.ingestFrame("t1", { epoch: "E", rev: r });
    await advance(10_000);
    expect(srv.snapshotGets()).toHaveLength(1);
    expect(store.getTeam("t1")?.snapshot?.rev).toBe(7200);
    store.ingestFrame("t1", { epoch: "E0-old", rev: 9 }); // a replayed frame of a dead epoch: one conditional refetch, no loop
    await advance(30_000);
    expect(srv.snapshotGets()).toHaveLength(2);
  });
});

describe("refetch bound (S75) and many views (S81)", () => {
  it("one open view, the team mutating every 10 ms for 60 s: ≤ 60 snapshot requests, none overlapping, the rest 304", async () => {
    let inflight = 0;
    let overlap = false;
    const base = srv.fetchMock.getMockImplementation() as (i: RequestInfo | URL, n?: RequestInit) => Promise<Response>;
    srv.fetchMock.mockImplementation(async (i, n) => {
      inflight += 1;
      overlap ||= inflight > 1;
      await new Promise((r) => setTimeout(r, 5));
      try {
        return await base(i, n);
      } finally {
        inflight -= 1;
      }
    });
    store.watchTeam("t1");
    await advance(10);
    srv.calls.length = 0;
    for (let t = 0; t < 60_000; t += 10) {
      srv.state.rev += 1;
      store.ingestFrame("t1", { epoch: "E", rev: srv.state.rev });
      await advance(10);
    }
    expect(srv.calls.length).toBeLessThanOrEqual(60);
    expect(overlap).toBe(false);
  });

  /** 10 views (tabs) of one principal sharing one token bucket; returns what the limiter saw. */
  async function tenTabs(capacity: number, perSecond: number) {
    let tokens = capacity;
    let lastRefill = Date.now();
    let served = 0;
    let limited = 0;
    let hammered = 0; // requests that reached the limiter while their store was waiting out a Retry-After
    const waitUntil = new Map<number, number>();
    const limiter = (id: number) => async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const now = Date.now();
      tokens = Math.min(capacity, tokens + ((now - lastRefill) / 1000) * perSecond);
      lastRefill = now;
      if (now < (waitUntil.get(id) ?? 0)) hammered += 1;
      if (tokens < 1) {
        limited += 1;
        waitUntil.set(id, now + 2000);
        return new Response("{}", { status: 429, headers: { "retry-after": "2" } });
      }
      tokens -= 1;
      served += 1;
      return srv.fetchMock(input, init);
    };
    const stores = Array.from({ length: 10 }, (_, i) => createTeamsStore({ fetch: limiter(i) as unknown as typeof fetch }));
    const releases = stores.map((s) => s.watchTeam("t1"));
    await advance(0);
    for (let t = 0; t < 60_000; t += 100) {
      srv.state.rev += 1;
      for (const s of stores) s.ingestFrame("t1", { epoch: "E", rev: srv.state.rev });
      await advance(100);
    }
    const converged = stores.every((s) => s.getTeam("t1")?.snapshot !== undefined);
    for (const r of releases) r();
    for (const s of stores) s.dispose();
    return { served, limited, hammered, converged };
  }

  it("10 open views of one principal stay under core's read limit (8 req/s, burst 16): no 429 at all", async () => {
    const r = await tenTabs(16, 8);
    expect(r).toMatchObject({ limited: 0, hammered: 0, converged: true });
    expect(r.served).toBeGreaterThan(0);
  });

  it("against a much tighter limiter, 429s are honoured (Retry-After) and nothing throws", async () => {
    const r = await tenTabs(3, 1);
    expect(r.limited).toBeGreaterThan(0);
    expect(r.hammered).toBe(0);
    expect(r.served).toBeGreaterThan(0);
  });
});

describe("404 handling", () => {
  it("a previously resolved team that now answers 404 → not_found, cache dropped", async () => {
    await open();
    srv.overrides.push(() => srv.json({ error: "not_found" }, 404));
    store.ingestFrame("t1", { epoch: "E", rev: 42 });
    await advance(500);
    expect(store.getTeam("t1")).toMatchObject({ phase: "not_found" });
    expect(store.getTeam("t1")?.snapshot).toBeUndefined();
  });

  it("a team that never resolved and answers 404 is `absent` (the view shows no-team, not not-found)", async () => {
    srv.overrides.push(() => srv.json({ error: "not_found" }, 404));
    store.watchTeam("t1");
    await advance(0);
    expect(store.getTeam("t1")).toMatchObject({ phase: "absent" });
  });
});

describe("lifecycle", () => {
  it("releasing the last watcher leaves 0 timers and 0 listeners; the cache survives", async () => {
    const add = vi.spyOn(document, "addEventListener");
    const remove = vi.spyOn(document, "removeEventListener");
    const release = await open();
    expect(vi.getTimerCount()).toBe(1); // the 60 s safety interval
    expect(add.mock.calls.filter((c) => c[0] === "visibilitychange")).toHaveLength(1);
    release();
    expect(vi.getTimerCount()).toBe(0);
    expect(remove.mock.calls.filter((c) => c[0] === "visibilitychange")).toHaveLength(1);
    await advance(5 * 60_000);
    expect(srv.calls).toHaveLength(0);
    expect(store.getTeam("t1")?.snapshot).toBeDefined();
    release(); // idempotent
    add.mockRestore();
    remove.mockRestore();
  });
});

describe("control POSTs (task 7.4)", () => {
  it("stop: POST to the encoded member URL; ok → refetch is scheduled", async () => {
    await open();
    srv.state.rev = 42;
    const result = await store.stopMember("t1", "bob/x");
    expect(result).toEqual({ kind: "ok", status: 200 });
    expect(srv.calls[0]).toMatchObject({ method: "POST", url: "/api/plugins/agent-teams/teams/t1/members/bob%2Fx/stop" });
    await advance(500);
    expect(srv.snapshotGets()).toHaveLength(1);
  });

  it("shutdown 202 is ok", async () => {
    await open();
    srv.overrides.push(() => srv.json({ closing: true }, 202));
    expect(await store.shutdownTeam("t1")).toEqual({ kind: "ok", status: 202 });
    expect(srv.calls[0]).toMatchObject({ method: "POST", url: "/api/plugins/agent-teams/teams/t1/shutdown" });
  });

  it.each([
    [409, "not_busy"],
    [409, "not_connected"],
    [409, "team_closed"],
    [404, "not_found"],
  ])("%i %s → rejected with the code, and the snapshot is refreshed", async (status, code) => {
    await open();
    srv.state.rev = 42;
    srv.overrides.push(() => srv.json({ error: code }, status));
    expect(await store.stopMember("t1", "bob")).toEqual({ kind: "rejected", status, code });
    await advance(500);
    expect(srv.snapshotGets()).toHaveLength(1);
  });

  it("403 (host tier gate) → rejected, no refetch, no retry loop", async () => {
    await open();
    srv.overrides.push(() => srv.json({ error: "forbidden" }, 403));
    expect(await store.stopMember("t1", "bob")).toMatchObject({ kind: "rejected", status: 403 });
    await advance(60_000 - 1);
    expect(srv.calls.filter((c) => c.method === "POST")).toHaveLength(1);
    expect(srv.snapshotGets()).toHaveLength(0);
  });

  it("no answer for 30 s → at 15 s: timeout, the truth is refetched, the POST is never retried", async () => {
    await open();
    srv.overrides.push(() => new Promise<Response>(() => undefined)); // never answers
    let result: unknown;
    void store.stopMember("t1", "bob").then((r) => (result = r));
    await advance(CONTROL_TIMEOUT_MS - 1);
    expect(result).toBeUndefined();
    await advance(1);
    expect(result).toEqual({ kind: "timeout" });
    await advance(30_000);
    expect(srv.calls.filter((c) => c.method === "POST")).toHaveLength(1);
    expect(srv.snapshotGets().length).toBeGreaterThanOrEqual(1);
  });

  it("a second click while the POST is pending shares it (no second POST)", async () => {
    await open();
    let release!: (r: Response) => void;
    srv.overrides.push(() => new Promise<Response>((r) => (release = r)));
    const a = store.stopMember("t1", "bob");
    const b = store.stopMember("t1", "bob");
    release(srv.json({ aborted: true }));
    expect(await a).toEqual(await b);
    expect(srv.calls.filter((c) => c.method === "POST")).toHaveLength(1);
  });

  it("a connection reset after the POST was sent → unconfirmed + a refetch (never assumes success or failure)", async () => {
    await open();
    srv.overrides.push(() => new TypeError("connection reset"));
    expect(await store.stopMember("t1", "bob")).toEqual({ kind: "unconfirmed" });
    await advance(0);
    expect(srv.snapshotGets()).toHaveLength(1);
  });
});
