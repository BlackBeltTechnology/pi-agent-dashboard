/**
 * `mintLiveCapability` rejects a preview origin equal to the dashboard's own origin OR the apiBase origin; the apiBase
 * is resolved with `new URL(apiBase, location.href).origin` first. A rejected mint is terminal ("preview response
 * rejected", `rejected: true`). See change: serve-live-previews-on-capability-origin (test-plan #E164, #E172, #E173).
 */
// @vitest-environment-options {"url":"http://localhost:8000"}
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setGlobalApiBase } from "../api-context.js";
import { mintLiveCapability } from "../live-server-api.js";

const API = "http://192.168.1.5:8000";
const SECRET = "S".repeat(30);
const PID = "P".repeat(22);
let respond: Record<string, unknown>;

const reply = (over: Record<string, unknown>): void => {
  respond = { ok: true, success: true, tier: 1, path: "/", expiresAt: Date.now() + 60_000, tokenId: "t", ...over };
};

beforeEach(() => {
  globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => respond }) as unknown as Response) as unknown as typeof fetch;
});
afterEach(() => {
  setGlobalApiBase("");
  vi.restoreAllMocks();
});

describe("T.E164 / #E164 apiBase origin check", () => {
  it("fixture sanity: location.origin is http://localhost:8000", () => {
    expect(window.location.origin).toBe("http://localhost:8000");
  });

  it("apiBase=http://192.168.1.5:8000: a mint origin equal to the apiBase origin is rejected", async () => {
    setGlobalApiBase(API);
    reply({ origin: API });
    expect(await mintLiveCapability("t")).toEqual({ ok: false, error: "preview response rejected", rejected: true });
  });

  it("apiBase=http://192.168.1.5:8000: a mint origin equal to location.origin is rejected too", async () => {
    setGlobalApiBase(API);
    reply({ origin: "http://localhost:8000" });
    expect(await mintLiveCapability("t")).toMatchObject({ ok: false, rejected: true });
  });

  it("apiBase carrying a path/slash still resolves to its origin before the comparison", async () => {
    for (const base of [`${API}/`, `${API}/dash`]) {
      setGlobalApiBase(base);
      reply({ origin: API });
      expect(await mintLiveCapability("t")).toMatchObject({ ok: false, rejected: true });
    }
  });

  it("apiBase origin written with a trailing dot / different case still collides", async () => {
    setGlobalApiBase("http://LOCALHOST.:9000");
    reply({ origin: "http://localhost:9000" });
    expect(await mintLiveCapability("t")).toMatchObject({ ok: false, rejected: true });
  });

  it('a relative apiBase ("") resolves to the page origin: that origin is rejected, another is accepted', async () => {
    setGlobalApiBase("");
    reply({ origin: "http://localhost:8000" });
    expect(await mintLiveCapability("t")).toMatchObject({ ok: false, rejected: true });
    reply({ origin: "http://LOCALHOST.:8000" });
    expect(await mintLiveCapability("t")).toMatchObject({ ok: false, rejected: true });
    reply({ origin: "http://x.localhost:8000" });
    expect(await mintLiveCapability("t")).toMatchObject({ ok: true, tier: 1, origin: "http://x.localhost:8000" });
  });

  it("a root-relative apiBase (`/dash`) resolves against location.href", async () => {
    setGlobalApiBase("/dash");
    reply({ origin: "http://localhost:8000" });
    expect(await mintLiveCapability("t")).toMatchObject({ ok: false, rejected: true });
  });

  it("a distinct origin is accepted when it is neither the page nor the apiBase", async () => {
    setGlobalApiBase(API);
    reply({ origin: "http://x.localhost:8000" });
    expect(await mintLiveCapability("t")).toMatchObject({ ok: true, origin: "http://x.localhost:8000" });
  });
});

describe("T.E172 / T.E173 rejection is the terminal 'preview response rejected' result", () => {
  const CASES: Array<[string, Record<string, unknown>]> = [
    ["tier 2 with a tier-5 path", { tier: 2, origin: "http://x.localhost:8001", path: `/preview/${PID}/` }],
    ["tier 5 with `/`", { tier: 5, path: "/" }],
    ["tier 6", { tier: 6 }],
    ['tier "5"', { tier: "5", path: `/preview/${PID}/` }],
    ['tier "legacy" with `/`', { tier: "legacy", path: "/" }],
    ["tier 5 carrying origin", { tier: 5, path: `/preview/${PID}/`, origin: "http://x.test" }],
    ["tier 5 carrying base", { tier: 5, path: `/preview/${PID}/`, base: `/preview/${PID}/` }],
    ["legacy carrying base", { tier: undefined, path: `/live/x/~c/${"T".repeat(22)}/`, base: `/preview/${PID}/` }],
    ["tier 1 with a non-pid base", { tier: 1, origin: "http://x.localhost:8001", path: "/", base: "/evil/" }],
    ["tier 3 with a short secret", { tier: 3, origin: "http://192.168.1.5:8100", path: `/?k=${"S".repeat(21)}` }],
  ];
  for (const [name, over] of CASES) {
    it(`${name} → { ok:false, rejected:true, error:"preview response rejected" }`, async () => {
      reply(over);
      expect(await mintLiveCapability("t")).toEqual({ ok: false, error: "preview response rejected", rejected: true });
    });
  }
  it("the control (a well-formed tier 3) is accepted", async () => {
    reply({ tier: 3, origin: "http://192.168.1.5:8100", path: `/?k=${SECRET}` });
    expect(await mintLiveCapability("t")).toMatchObject({ ok: true, tier: 3 });
  });
});
