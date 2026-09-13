/**
 * Browser REST routes (change: add-browser-relay, task 2.9; spec
 * `browser-plugin-settings`). Fastify `inject` — no port, no WS.
 *
 * Covers every status code/reason in the spec: 200 rows/connect/disconnect/
 * audit/enabled; 403 writes while disabled; 400 missing params; 404 unknown
 * instance; 409 not-installed/busy; 503 capability; 504 timeout. Also pins that
 * a configured token reaches NO response body.
 */
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuditRing } from "../audit.js";
import type { ProfileListResult } from "../profiles.js";
import type { BrowserProfileConfig, ConnectResult, RelayConfig, RelayLike } from "../relay/relay-manager.js";
import { type BrowserRoutesManager, registerBrowserRoutes } from "../routes.js";

class StubInstance implements RelayLike {
  constructor(
    readonly instanceId: string,
    readonly profileDirectory: string,
  ) {}
  tabList() {
    return [{ tabId: 5, title: "A", url: "https://a.test", state: "live" as const }];
  }
  statusState(): "connected" | "no-cdp-client" {
    return "connected";
  }
  subscribe() {
    return { ok: true };
  }
  unsubscribe() {}
  unsubscribeAll() {}
  input() {
    return Promise.resolve();
  }
  close() {}
}

class StubManager implements BrowserRoutesManager {
  enabled = true;
  connectResult: ConnectResult = { ok: true, cdpUrl: "ws://127.0.0.1:8000/ws/browser-cdp/x", instanceId: "inst-1" };
  connectCalls: string[] = [];
  disconnectResult = true;
  disconnectCalls: string[] = [];
  setEnabledCalls: boolean[] = [];
  readonly instancesList: StubInstance[] = [];
  /** The token lives here; it must never surface in a response. */
  readonly tokens: Record<string, string | undefined> = { Default: "super-secret-token" };

  async connect(profileDirectory: string): Promise<ConnectResult> {
    this.connectCalls.push(profileDirectory);
    return this.connectResult;
  }
  disconnect(instanceId: string): boolean {
    this.disconnectCalls.push(instanceId);
    return this.disconnectResult;
  }
  async setEnabled(enabled: boolean): Promise<void> {
    this.setEnabledCalls.push(enabled);
  }
  instances(profileDirectory?: string): RelayLike[] {
    return profileDirectory === undefined
      ? this.instancesList
      : this.instancesList.filter((i) => i.profileDirectory === profileDirectory);
  }
  profileConfig(profileDirectory: string): BrowserProfileConfig {
    return { token: this.tokens[profileDirectory] };
  }
}

interface Harness {
  app: FastifyInstance;
  manager: StubManager;
  audit: AuditRing;
  updateConfig: ReturnType<typeof vi.fn>;
  setProfiles(result: ProfileListResult): void;
}

async function harness(): Promise<Harness> {
  const manager = new StubManager();
  const audit = new AuditRing();
  const updateConfig = vi.fn(async (_partial: Partial<RelayConfig>) => {});
  let profiles: ProfileListResult = {
    profiles: [
      { profileDirectory: "Default", label: "Default", email: "me@x.test", installed: true },
      { profileDirectory: "Profile 1", label: "Work", installed: false },
    ],
  };
  const app = Fastify();
  registerBrowserRoutes(app, {
    manager,
    audit,
    canOpenChrome: () => true,
    listProfiles: async () => profiles,
    updateConfig,
    logger: { info: () => {}, warn: () => {}, error: () => {} },
  });
  await app.ready();
  return { app, manager, audit, updateConfig, setProfiles: (r) => (profiles = r) };
}

const json = <T>(res: { body: string }): T => JSON.parse(res.body) as T;

let h: Harness;
beforeEach(async () => {
  h = await harness();
});
afterEach(async () => {
  await h.app.close();
});

describe("GET /api/browser/status", () => {
  it("reports enabled + canOpenChrome", async () => {
    const res = await h.app.inject({ method: "GET", url: "/api/browser/status" });
    expect(res.statusCode).toBe(200);
    expect(json(res)).toEqual({ enabled: true, canOpenChrome: true });
  });
});

describe("GET /api/browser/profiles", () => {
  it("keys rows by profileDirectory with installed/hasToken and instances[].tabs[]", async () => {
    h.manager.instancesList.push(new StubInstance("inst-1", "Default"));
    const res = await h.app.inject({ method: "GET", url: "/api/browser/profiles" });
    expect(res.statusCode).toBe(200);
    const body = json<{ profiles: Record<string, unknown> }>(res);
    expect(Object.keys(body.profiles)).toEqual(["Default", "Profile 1"]);
    expect(body.profiles.Default).toMatchObject({
      profileDirectory: "Default",
      label: "Default",
      email: "me@x.test",
      installed: true,
      hasToken: true,
      instances: [{ instanceId: "inst-1", state: "connected", tabs: [{ tabId: 5, state: "live" }] }],
    });
    expect(body.profiles["Profile 1"]).toMatchObject({ installed: false, hasToken: false, instances: [] });
    // The configured token must not appear anywhere in the body.
    expect(res.body).not.toContain("super-secret-token");
  });

  it("narrows to one profileDirectory", async () => {
    const res = await h.app.inject({ method: "GET", url: "/api/browser/profiles?profileDirectory=Default" });
    expect(Object.keys(json<{ profiles: object }>(res).profiles)).toEqual(["Default"]);
  });

  it("carries the synthetic-Default warning", async () => {
    h.setProfiles({ profiles: [{ profileDirectory: "Default", label: "Default", installed: true }], warning: "/x/Local State" });
    const res = await h.app.inject({ method: "GET", url: "/api/browser/profiles" });
    expect(json<{ warning?: string }>(res).warning).toBe("/x/Local State");
  });
});

describe("POST /api/browser/connect", () => {
  it("returns cdpUrl + instanceId on success", async () => {
    const res = await h.app.inject({ method: "POST", url: "/api/browser/connect", payload: { profileDirectory: "Default" } });
    expect(res.statusCode).toBe(200);
    expect(json(res)).toMatchObject({ cdpUrl: expect.stringContaining("/ws/browser-cdp/"), instanceId: "inst-1" });
    expect(h.manager.connectCalls).toEqual(["Default"]);
  });

  it("403 when the relay is disabled", async () => {
    h.manager.enabled = false;
    const res = await h.app.inject({ method: "POST", url: "/api/browser/connect", payload: { profileDirectory: "Default" } });
    expect(res.statusCode).toBe(403);
    expect(h.manager.connectCalls).toEqual([]);
  });

  it("400 when profileDirectory is missing", async () => {
    const res = await h.app.inject({ method: "POST", url: "/api/browser/connect", payload: {} });
    expect(res.statusCode).toBe(400);
  });

  it.each([
    [409, "not-installed"],
    [409, "busy"],
    [503, undefined],
    [504, undefined],
  ] as const)("propagates %s from the manager", async (status, reason) => {
    h.manager.connectResult = { ok: false, status, reason: reason as never } as ConnectResult;
    const res = await h.app.inject({ method: "POST", url: "/api/browser/connect", payload: { profileDirectory: "Default" } });
    expect(res.statusCode).toBe(status);
    if (reason) expect(json<{ reason?: string }>(res).reason).toBe(reason);
  });
});

describe("POST /api/browser/disconnect", () => {
  it("200 for a live instanceId", async () => {
    const res = await h.app.inject({ method: "POST", url: "/api/browser/disconnect?instanceId=inst-1" });
    expect(res.statusCode).toBe(200);
    expect(h.manager.disconnectCalls).toEqual(["inst-1"]);
  });

  it("400 when instanceId is missing", async () => {
    const res = await h.app.inject({ method: "POST", url: "/api/browser/disconnect" });
    expect(res.statusCode).toBe(400);
    expect(h.manager.disconnectCalls).toEqual([]);
  });

  it("404 for an unknown instanceId", async () => {
    h.manager.disconnectResult = false;
    const res = await h.app.inject({ method: "POST", url: "/api/browser/disconnect?instanceId=ghost" });
    expect(res.statusCode).toBe(404);
  });

  it("403 when the relay is disabled", async () => {
    h.manager.enabled = false;
    const res = await h.app.inject({ method: "POST", url: "/api/browser/disconnect?instanceId=inst-1" });
    expect(res.statusCode).toBe(403);
    expect(h.manager.disconnectCalls).toEqual([]);
  });
});

describe("GET /api/browser/audit", () => {
  it("returns newest-first and filters by profile", async () => {
    h.audit.append({ profileDirectory: "Default", instanceId: "i", kind: "denied", detail: "Network.getCookies" });
    h.audit.append({ profileDirectory: "Profile 1", instanceId: "j", kind: "navigate", detail: "https://x.test" });
    const all = json<{ entries: Array<{ detail: string }> }>(await h.app.inject({ method: "GET", url: "/api/browser/audit" }));
    expect(all.entries[0].detail).toBe("https://x.test");
    const filtered = json<{ entries: Array<{ detail: string }> }>(
      await h.app.inject({ method: "GET", url: "/api/browser/audit?profile=Default" }),
    );
    expect(filtered.entries.map((e) => e.detail)).toEqual(["Network.getCookies"]);
  });
});

describe("PUT /api/browser/enabled", () => {
  it("persists the flag and applies the kill switch", async () => {
    const res = await h.app.inject({ method: "PUT", url: "/api/browser/enabled", payload: { enabled: false } });
    expect(res.statusCode).toBe(200);
    expect(json(res)).toEqual({ enabled: false });
    expect(h.updateConfig).toHaveBeenCalledWith({ enabled: false });
    expect(h.manager.setEnabledCalls).toEqual([false]);
  });

  it("400 for a non-boolean", async () => {
    const res = await h.app.inject({ method: "PUT", url: "/api/browser/enabled", payload: { enabled: "yes" } });
    expect(res.statusCode).toBe(400);
    expect(h.updateConfig).not.toHaveBeenCalled();
    expect(h.manager.setEnabledCalls).toEqual([]);
  });
});
