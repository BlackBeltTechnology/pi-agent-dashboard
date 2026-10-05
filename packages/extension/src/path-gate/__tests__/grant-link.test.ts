import { describe, expect, it } from "vitest";
import { createGrantLink } from "../grant-link.js";

function make(opts: { local?: string | null; sent?: boolean } = {}) {
  const frames: any[] = [];
  const link = createGrantLink({
    send: (m) => { frames.push(m); return opts.sent ?? true; },
    sessionId: () => "S1",
    readLocalToken: () => (opts.local === undefined ? "tok" : opts.local),
    timeoutMs: 20,
    newId: () => "r1",
  });
  return { link, frames };
}

describe("grant link", () => {
  it("identity match / mismatch / missing local file (re-evaluated every frame)", () => {
    const { link } = make();
    expect(link.storeMatches()).toBe(false); // no identity frame yet
    link.handleIdentity({ grantStoreId: "tok" });
    expect(link.storeMatches()).toBe(true);
    link.handleIdentity({ grantStoreId: "other" });
    expect(link.storeMatches()).toBe(false);
    expect(make({ local: null }).link.storeMatches()).toBe(false);
    const m = make({ local: null });
    m.link.handleIdentity({ grantStoreId: "tok" });
    expect(m.link.storeMatches()).toBe(false);
  });

  it("request resolves on the matching result and sends the bound frame", async () => {
    const { link, frames } = make();
    const p = link.requestGrant({ promptId: "p2", path: "/w/o/a", subject: "/w/o" });
    expect(frames[0]).toEqual({ type: "path_grant_request", requestId: "r1", sessionId: "S1", promptId: "p2", path: "/w/o/a", subject: "/w/o" });
    link.handleResult({ requestId: "r1", ok: true, subject: "/w/o" });
    expect(await p).toEqual({ ok: true, subject: "/w/o" });
  });

  it("X8: refusal by another server is ok:false", async () => {
    const { link } = make();
    const p = link.requestGrant({ promptId: "p2", path: "/a", subject: "/" });
    link.handleResult({ requestId: "r1", ok: false, error: "no pending confirm" });
    expect(await p).toMatchObject({ ok: false, error: "no pending confirm" });
  });

  it("unsent, timed-out and reset requests are ok:false", async () => {
    expect(await make({ sent: false }).link.requestGrant({ promptId: "p", path: "/a", subject: "/" })).toMatchObject({ ok: false });
    expect(await make().link.requestGrant({ promptId: "p", path: "/a", subject: "/" })).toMatchObject({ ok: false, error: "timeout" });
    const { link } = make();
    const p = link.requestGrant({ promptId: "p", path: "/a", subject: "/" });
    link.reset();
    expect(await p).toMatchObject({ ok: false, error: "disconnected" });
  });
});
