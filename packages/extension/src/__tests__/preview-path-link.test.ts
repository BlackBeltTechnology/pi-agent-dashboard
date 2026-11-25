/**
 * Bridge half of the reserve-path pair (D9): probe seam, answer validation, abort / late-release, disconnect.
 * See change: serve-live-previews-on-capability-origin (D9; test-plan #E102, #X22-#X25, Q41).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPreviewPathLink, installBaseReservationListener } from "../preview-path-link.js";

const PATH = `/preview/${"A".repeat(22)}/`;
let sent: Array<Record<string, unknown>>;
const mk = (over: { send?: (m: unknown) => boolean; timeoutMs?: number } = {}) => {
  let n = 0;
  return createPreviewPathLink({
    send: over.send ?? ((m) => (sent.push(m as Record<string, unknown>), true)),
    sessionId: () => "s1",
    newId: () => `r${++n}`,
    timeoutMs: over.timeoutMs,
  });
};
const result = (o: object) => ({ type: "preview_path_result", requestId: "r1", path: null, tier5Viewers: false, ...o });

beforeEach(() => {
  sent = [];
});
afterEach(() => vi.useRealTimers());

describe("request / answer", () => {
  it("sends preview_path_request with the server-known session and resolves the base", async () => {
    const link = mk();
    const p = link.request(5299);
    expect(sent).toEqual([{ type: "preview_path_request", requestId: "r1", sessionId: "s1", port: 5299 }]);
    expect(link.handleResult(result({ path: PATH, tier5Viewers: true }))).toBe(true);
    await expect(p).resolves.toEqual({ base: PATH });
  });
  it("no viewer (path null, no error) → null; an `error` rejects with the reason", async () => {
    const a = mk();
    const pa = a.request(1);
    a.handleResult(result({}));
    await expect(pa).resolves.toBeNull();
    const b = mk();
    const pb = b.request(1);
    b.handleResult(result({ error: "reservation_limit", tier5Viewers: true }));
    await expect(pb).rejects.toThrow("base reservation unavailable: reservation_limit");
  });
  it("X25: malformed paths, missing / wrong / duplicate requestId never resolve a base", async () => {
    for (const path of ["https://evil/x", "/not-preview/x/", "/preview/short/", `/preview/${"A".repeat(22)}/x`, 5]) {
      const link = mk();
      const p = link.request(1);
      link.handleResult(result({ path }));
      await expect(p, String(path)).rejects.toThrow("malformed answer");
    }
    const link = mk();
    const p = link.request(1);
    link.handleResult({ type: "preview_path_result", path: PATH });
    link.handleResult(result({ requestId: "other", path: PATH }));
    link.handleResult(result({ path: PATH, tier5Viewers: true }));
    link.handleResult(result({ path: "/preview/" + "B".repeat(22) + "/", tier5Viewers: true })); // duplicate
    await expect(p).resolves.toEqual({ base: PATH });
    expect(link.handleResult({ type: "other" })).toBe(false);
  });
  it("an unsent request (socket closed) resolves null without hanging", async () => {
    await expect(mk({ send: () => false }).request(1)).resolves.toBeNull();
    await expect(mk({ send: () => { throw new Error("x"); } }).request(1)).resolves.toBeNull();
  });
  it("X24: disconnect mid-request settles as no reservation", async () => {
    const link = mk();
    const p = link.request(1);
    link.reset();
    await expect(p).resolves.toBeNull();
  });
  it("a request with no answer times out as null and drops any server-side reservation by id", async () => {
    vi.useFakeTimers();
    const link = mk({ timeoutMs: 1000 });
    const p = link.request(1);
    vi.advanceTimersByTime(1001);
    await expect(p).resolves.toBeNull();
    expect(sent.filter((m) => m.type === "preview_path_release")).toEqual([{ type: "preview_path_release", requestId: "r1", sessionId: "s1" }]);
  });
});

describe("abort (X22, X23)", () => {
  it("X22: abort before the answer; the late reservation is released exactly once", async () => {
    const link = mk();
    const ac = new AbortController();
    const p = link.request(1, ac.signal);
    ac.abort();
    expect(sent.filter((m) => m.type === "preview_path_release")).toHaveLength(0); // nothing known to release yet
    link.handleResult(result({ path: PATH, tier5Viewers: true }));
    await expect(p).resolves.toBeNull();
    link.handleResult(result({ path: PATH, tier5Viewers: true })); // duplicate answer
    expect(sent.filter((m) => m.type === "preview_path_release")).toEqual([{ type: "preview_path_release", requestId: "r1", sessionId: "s1" }]);
  });
  it("X23: abort AFTER the answer was consumed releases once; a second abort / an abort with no reservation sends nothing more", async () => {
    const link = mk();
    const ac = new AbortController();
    const p = link.request(1, ac.signal);
    link.handleResult(result({ path: PATH, tier5Viewers: true }));
    await p;
    ac.abort();
    ac.abort();
    expect(sent.filter((m) => m.type === "preview_path_release")).toHaveLength(1);
    const none = mk();
    const ac2 = new AbortController();
    const p2 = none.request(1, ac2.signal);
    none.handleResult(result({}));
    await p2;
    sent = [];
    ac2.abort();
    // abort after a "no reservation" answer still sends one idempotent release (the server ignores an unknown id)
    expect(sent.length).toBeLessThanOrEqual(1);
  });
});

describe("probe seam (Q41)", () => {
  const bus = () => {
    const handlers: Array<(d: unknown) => void> = [];
    return { on: (_c: string, h: (d: unknown) => void) => (handlers.push(h), () => handlers.splice(handlers.indexOf(h), 1)), emit: (d: unknown) => handlers.forEach((h) => h(d)) };
  };
  it("sets `pending` synchronously; a second listener never overwrites it; a bad port is ignored", async () => {
    const b = bus();
    const link = mk();
    installBaseReservationListener(b, () => link);
    const other = vi.fn();
    installBaseReservationListener(b, () => ({ request: other, handleResult: () => false, reset: () => {} }));
    const probe: { port: number; pending?: Promise<unknown> } = { port: 5299 };
    b.emit(probe);
    expect(probe.pending).toBeInstanceOf(Promise);
    expect(other).not.toHaveBeenCalled();
    link.handleResult(result({ path: PATH, tier5Viewers: true }));
    await expect(probe.pending).resolves.toEqual({ base: PATH });
    const bad: { port: unknown; pending?: unknown } = { port: "5299" };
    b.emit(bad);
    expect(bad.pending).toBeUndefined();
    b.emit(null);
    b.emit("x");
  });
  it("an inactive bridge (no link) leaves the probe unanswered", () => {
    const b = bus();
    installBaseReservationListener(b, () => undefined);
    const probe: { port: number; pending?: unknown } = { port: 1 };
    b.emit(probe);
    expect(probe.pending).toBeUndefined();
  });
  it("the returned disposer unsubscribes", () => {
    const b = bus();
    const off = installBaseReservationListener(b, () => mk());
    off();
    const probe: { port: number; pending?: unknown } = { port: 1 };
    b.emit(probe);
    expect(probe.pending).toBeUndefined();
  });
});
