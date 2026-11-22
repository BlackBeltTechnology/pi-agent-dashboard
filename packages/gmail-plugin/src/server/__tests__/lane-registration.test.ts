/**
 * The two lane handlers return a live OAuth access token (`gmail/lease`) and the mailbox inventory
 * (`gmail/accounts`): both register hub-local-only, so the host refuses a remote-origin or
 * deprecated-admission session with `origin_denied`. See change: harden-bridge-session-claim (D3).
 */
import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { CLIENT, capturingLogger, memoryCredentials } from "../../__tests__/fakes.js";
import { CLIENT_KEY } from "../accounts.js";
import registerPlugin from "../index.js";

describe("gmail lane handlers are registered hub-local-only", () => {
  it("passes { hubLocalOnly: true } for gmail/lease and gmail/accounts", async () => {
    const app = Fastify();
    const register = vi.fn();
    await registerPlugin({
      credentials: memoryCredentials({ [CLIENT_KEY]: { ...CLIENT } }),
      logger: capturingLogger(),
      fastify: app,
      networkGuard: async () => {},
      consume: () => undefined,
      getPluginConfig: () => ({}),
      updatePluginConfig: async () => {},
      registerPiRequestHandler: register,
      oauth: undefined,
    } as never);
    await app.close();
    const byType = new Map(register.mock.calls.map((c) => [c[0] as string, c[2]]));
    expect([...byType.keys()].sort()).toEqual(["gmail/accounts", "gmail/lease"]);
    expect(byType.get("gmail/lease")).toEqual({ hubLocalOnly: true });
    expect(byType.get("gmail/accounts")).toEqual({ hubLocalOnly: true });
  });
});

describe("gmail lane handlers behave unchanged for a hub-local caller (BE97, BE100, BE104)", () => {
  const scopes = ["https://www.googleapis.com/auth/gmail.readonly"];
  const rec = (sub: string, over: Record<string, unknown> = {}) => ({
    sub, email: `${sub}@canary.example`, alias: `alias-${sub}`, tier: "readonly", scopes,
    refresh: "REFRESH-SECRET", access: "ACCESS-live", expires: Date.now() + 3_600_000, status: "ok", addedAt: 1, ...over,
  });

  async function handlers(records: Record<string, ReturnType<typeof rec>>) {
    const app = Fastify();
    const map = new Map<string, (payload: unknown, meta: unknown) => Promise<unknown>>();
    await registerPlugin({
      credentials: memoryCredentials({ [CLIENT_KEY]: { ...CLIENT }, ...Object.fromEntries(Object.entries(records).map(([k, v]) => [`acct:${k}`, v])) }),
      logger: capturingLogger(), fastify: app, networkGuard: async () => {}, consume: () => undefined,
      getPluginConfig: () => ({}), updatePluginConfig: async () => {}, oauth: undefined,
      registerPiRequestHandler: (type: string, h: (p: unknown, m: unknown) => Promise<unknown>) => map.set(type, h),
    } as never);
    await app.close();
    return map;
  }

  it("BE97: a lease within the level returns the access token and never any refresh field", async () => {
    const h = await handlers({ s1: rec("s1") });
    const reply = await h.get("gmail/lease")!({ account: "alias-s1", op: "read" }, { sessionId: "S" });
    expect(reply).toMatchObject({ accessToken: "ACCESS-live", email: "s1@canary.example", tier: "readonly" });
    expect(JSON.stringify(reply)).not.toMatch(/refresh/i);
  });

  it("BE100: accounts lists every account with alias, email, level and status, and no token", async () => {
    const h = await handlers({ s1: rec("s1"), s2: rec("s2", { tier: "draft" }) });
    const list = (await h.get("gmail/accounts")!({}, { sessionId: "S" })) as Array<Record<string, unknown>>;
    expect(list).toHaveLength(2);
    for (const a of list) expect(a).toMatchObject({ alias: expect.stringMatching(/^alias-/), email: expect.stringContaining("@canary.example") });
    expect(JSON.stringify(list)).not.toMatch(/REFRESH|ACCESS/);
  });

  it("BE104: a lease above the level and an unknown account keep their own error codes (not origin_denied)", async () => {
    const h = await handlers({ s1: rec("s1") });
    await expect(h.get("gmail/lease")!({ account: "alias-s1", op: "send" }, { sessionId: "S" })).rejects.toThrow(/^tier_denied/);
    await expect(h.get("gmail/lease")!({ account: "nobody", op: "read" }, { sessionId: "S" })).rejects.not.toThrow(/^origin_denied/);
  });
});
