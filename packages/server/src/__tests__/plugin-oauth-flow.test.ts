/**
 * Plugin OAuth flows through the shared `beginFlow()` + the existing
 * `/api/provider-auth/flow/:flowId` routes: credential pass-through to
 * `persist` (auth.json untouched), same-key supersede, distinct keys,
 * input never echoed/logged, early failure, start timeout, registry-failure
 * isolation, and no real browser under vitest.
 * See change: expose-plugin-credential-and-oauth-seams
 * (test-plan E13–E15, E17, X5–X8).
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Writable } from "node:stream";
import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { platformOpen } = vi.hoisted(() => ({ platformOpen: vi.fn() }));
vi.mock("@blackbelt-technology/pi-dashboard-shared/platform/commands.js", () => ({
  openBrowser: platformOpen,
}));
vi.mock("../model-proxy/registry-singleton.js", () => ({
  refreshModelRegistry: () => Promise.resolve(),
}));

import { beginFlow, pluginFlowProvider } from "../auth/begin-flow.js";
import type { LoginInteraction, OAuthCredential, OAuthLoginFlow } from "../auth/pi-oauth-types.js";
import { abortAllFlows, flowStoreSize, getFlow } from "../auth/provider-auth-adapter.js";
import { registerProviderAuthRoutes } from "../routes/provider-auth-routes.js";

const AUTH = path.join(os.homedir(), ".pi", "agent", "auth.json");

/** auth_url + manual_code; resolves `credential` when the answer is "ok". */
function manualFlow(credential: OAuthCredential): OAuthLoginFlow {
  return {
    name: "Fake",
    async login(ix: LoginInteraction) {
      ix.notify({ type: "auth_url", url: "https://example.test/authorize?state=s" });
      const answer = await ix.prompt({ type: "manual_code", message: "Paste the code" });
      if (answer !== "ok" && !answer.includes("code=")) throw new Error("bad code");
      return credential;
    },
  };
}

const cred = (extra: Record<string, unknown> = {}): OAuthCredential => ({
  type: "oauth", access: "a", refresh: "r", expires: 1, ...extra,
});

function pluginBegin(key: string, loginFlow: OAuthLoginFlow, persist = vi.fn(async (_c: OAuthCredential) => {})) {
  return {
    persist,
    result: beginFlow({
      provider: pluginFlowProvider("demo", key),
      loginFlow,
      preAnswers: [],
      writeCredential: async (_p, c) => { await persist(c); },
      notifyBridges: () => {},
    }),
  };
}

let logLines: string[] = [];
async function buildApp(oauthReady: Promise<void>) {
  logLines = [];
  const stream = new Writable({ write(chunk, _e, cb) { logLines.push(String(chunk)); cb(); } });
  const app = Fastify({ logger: { level: "trace", stream } });
  registerProviderAuthRoutes(app, {
    piGateway: { broadcast: vi.fn(), sendToSession: vi.fn(), getConnectedSessionIds: () => [] } as never,
    browserGateway: { broadcastToAll: vi.fn() } as never,
    oauthRegistry: [],
    oauthReady,
  });
  await app.ready();
  return app;
}

beforeEach(() => {
  abortAllFlows();
  platformOpen.mockClear();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  abortAllFlows();
});

describe("plugin flow via beginFlow", () => {
  it("E13: the login result reaches persist untouched; auth.json is not written", async () => {
    const before = fs.existsSync(AUTH) ? fs.readFileSync(AUTH) : null;
    const credential = cred({ sub: "s1", email: "e", grantedScopes: ["x"] });
    const { persist, result } = pluginBegin("k", manualFlow(credential));
    const res = await result;
    if (!res.ok) throw new Error(res.message);
    expect(res.flow.provider).toBe("plugin:demo:k");
    res.flow.resolveInput!("ok");
    await res.flow.settled;
    expect(getFlow(res.flow.id)?.status).toBe("complete");
    expect(persist).toHaveBeenCalledTimes(1);
    expect(persist.mock.calls[0][0]).toEqual(credential);
    expect(fs.existsSync(AUTH) ? fs.readFileSync(AUTH) : null).toEqual(before);
  });

  it("E14: a second start with the same key supersedes the first", async () => {
    const first = await pluginBegin("k", manualFlow(cred())).result;
    const second = await pluginBegin("k", manualFlow(cred())).result;
    if (!first.ok || !second.ok) throw new Error("start failed");
    expect(getFlow(first.flow.id)).toMatchObject({ status: "error", error: "Cancelled" });
    expect(getFlow(second.flow.id)?.status).toBe("pending");
  });

  it("E15: distinct keys coexist", async () => {
    const a = await pluginBegin("k1", manualFlow(cred())).result;
    const b = await pluginBegin("k2", manualFlow(cred())).result;
    if (!a.ok || !b.ok) throw new Error("start failed");
    expect(getFlow(a.flow.id)?.status).toBe("pending");
    expect(getFlow(b.flow.id)?.status).toBe("pending");
  });

  it("X5: a login that throws before any step fails login_failed and leaves no record", async () => {
    const size = flowStoreSize();
    const res = await pluginBegin("k", {
      name: "Boom",
      login: () => { throw new Error("boom"); },
    }).result;
    expect(res).toMatchObject({ ok: false, code: "login_failed", message: "boom" });
    expect(flowStoreSize()).toBe(size);
  });

  it("X6: a login that never emits fails start_timeout at 15 s", async () => {
    vi.useFakeTimers();
    const size = flowStoreSize();
    const { result } = pluginBegin("k", { name: "Silent", login: () => new Promise(() => {}) });
    await vi.advanceTimersByTimeAsync(15_000);
    await expect(result).resolves.toMatchObject({ ok: false, code: "start_timeout" });
    expect(flowStoreSize()).toBe(size);
  });

  it("X8: the first auth URL never opens a real browser under vitest", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await pluginBegin("k", manualFlow(cred())).result;
    expect(res.ok).toBe(true);
    expect(platformOpen).not.toHaveBeenCalled();
    expect(warn.mock.calls.some((c) => String(c[0]).includes("suppressed under vitest"))).toBe(true);
  });
});

describe("flow routes serve plugin flows", () => {
  it("X7: status / input / cancel work while the provider registry has failed", async () => {
    const failed = Promise.reject(new Error("registry build failed"));
    failed.catch(() => {});
    const app = await buildApp(failed);
    try {
      const a = await pluginBegin("k1", manualFlow(cred())).result;
      const b = await pluginBegin("k2", manualFlow(cred())).result;
      if (!a.ok || !b.ok) throw new Error("start failed");

      const status = await app.inject({ method: "GET", url: `/api/provider-auth/flow/${a.flow.id}` });
      expect(status.statusCode).toBe(200);
      expect(JSON.parse(status.payload)).toMatchObject({ status: "pending", provider: "plugin:demo:k1" });

      const input = await app.inject({
        method: "POST", url: `/api/provider-auth/flow/${a.flow.id}/input`, payload: { value: "ok" },
      });
      expect(input.statusCode).toBe(202);
      await a.flow.settled;
      expect(getFlow(a.flow.id)?.status).toBe("complete");

      const cancel = await app.inject({ method: "DELETE", url: `/api/provider-auth/flow/${b.flow.id}` });
      expect(cancel.statusCode).toBe(204);
      await b.flow.settled;
      expect(getFlow(b.flow.id)).toMatchObject({ status: "error", error: "Cancelled" });
    } finally {
      await app.close();
    }
  });

  it("E17: submitted input is never echoed by status nor logged", async () => {
    const logs: string[] = [];
    for (const m of ["log", "info", "warn", "error", "debug"] as const) {
      vi.spyOn(console, m).mockImplementation((...args) => { logs.push(args.map(String).join(" ")); });
    }
    const app = await buildApp(Promise.resolve());
    try {
      const res = await pluginBegin("k", manualFlow(cred())).result;
      if (!res.ok) throw new Error("start failed");
      const secret = "http://127.0.0.1/?code=SECRET&state=x";
      const input = await app.inject({
        method: "POST", url: `/api/provider-auth/flow/${res.flow.id}/input`, payload: { value: secret },
      });
      expect(input.statusCode).toBe(202);
      expect(input.payload).not.toContain("SECRET");
      await res.flow.settled;
      const status = await app.inject({ method: "GET", url: `/api/provider-auth/flow/${res.flow.id}` });
      expect(status.payload).not.toContain("SECRET");
      expect(logLines.join("\n")).not.toContain("SECRET");
      expect(logs.join("\n")).not.toContain("SECRET");
    } finally {
      await app.close();
    }
  });
});
