/**
 * createLoopbackCallback: match, stray/mismatch keep waiting, forged error,
 * loopback bind, timeout/abort + idempotent close.
 * See change: expose-plugin-credential-and-oauth-seams (test-plan E19–E22, X12).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createLoopbackCallback, type LoopbackCallback } from "../server/loopback-callback.js";

const open: LoopbackCallback[] = [];
async function make(opts?: Parameters<typeof createLoopbackCallback>[0]) {
  const cb = await createLoopbackCallback(opts);
  open.push(cb);
  return cb;
}
const get = (cb: LoopbackCallback, pathAndQuery: string) =>
  fetch(new URL(pathAndQuery, cb.redirectUri).toString());
const settled = <T>(p: Promise<T>) =>
  p.then((v) => ({ v }), (e: unknown) => ({ e })) as Promise<{ v?: T; e?: unknown }>;

afterEach(() => {
  vi.useRealTimers();
  for (const cb of open.splice(0)) cb.close();
});

describe("createLoopbackCallback", () => {
  it("E19: a state-matched callback resolves with the code and closes the port", async () => {
    const cb = await make();
    expect(cb.redirectUri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/);
    const res = await get(cb, `/callback?state=${cb.state}&code=abc`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    await expect(cb.waitForCode()).resolves.toEqual({ code: "abc" });
    await new Promise((r) => setTimeout(r, 20));
    expect(cb.server.listening).toBe(false);
  });

  it("E20: stray path and mismatched state keep waiting; only the match resolves", async () => {
    const cb = await make();
    const pending = settled(cb.waitForCode());
    expect((await get(cb, "/favicon.ico")).status).toBe(404);
    expect((await get(cb, "/callback?state=short&code=x1")).status).toBe(400);
    const wrong = "A".repeat(cb.state.length);
    expect((await get(cb, `/callback?state=${wrong}&code=x2`)).status).toBe(400);
    expect((await get(cb, `/callback?state=${cb.state}&code=final`)).status).toBe(200);
    expect(await pending).toEqual({ v: { code: "final" } });
  });

  it("E21: error= without state is ignored; with state it rejects", async () => {
    const cb = await make();
    const pending = settled(cb.waitForCode());
    expect((await get(cb, "/callback?error=access_denied")).status).toBe(400);
    expect(cb.server.listening).toBe(true);
    await get(cb, `/callback?error=access_denied&state=${cb.state}`);
    const out = await pending;
    expect(out.e).toMatchObject({ code: "access_denied" });
  });

  it("E22: binds the loopback interface only", async () => {
    const cb = await make();
    const addr = cb.server.address();
    expect(typeof addr === "object" && addr?.address).toBe("127.0.0.1");
  });

  it("X12: times out after 5 min, and close() twice is safe", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const cb = await make();
    const pending = settled(cb.waitForCode());
    vi.advanceTimersByTime(300_000);
    expect((await pending).e).toMatchObject({ code: "timeout" });
    expect(cb.server.listening).toBe(false);
    expect(() => { cb.close(); cb.close(); }).not.toThrow();
  });

  it("X12: abort rejects and closes", async () => {
    const ac = new AbortController();
    const cb = await make({ signal: ac.signal });
    const pending = settled(cb.waitForCode());
    ac.abort();
    expect((await pending).e).toMatchObject({ code: "aborted" });
    expect(cb.server.listening).toBe(false);
  });
});
