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
import type { OperatorHostInfo } from "../operator-hosts.js";
import type { ProfileListResult } from "../profiles.js";
import type { BrowserProfileConfig, ConnectResult, RelayConfig, RelayLike } from "../relay/relay-manager.js";
import { type BrowserRoutesManager, registerBrowserRoutes } from "../routes.js";

class StubInstance implements RelayLike {
  readonly instanceId: string;
  readonly profileDirectory: string;
  readonly host: string;

  constructor(
    instanceId: string,
    profileDirectory: string,
    host = "dashboard",
  ) {
    this.instanceId = instanceId;
    this.profileDirectory = profileDirectory;
    this.host = host;
  }
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
  connectHosts: Array<string | undefined> = [];
  disconnectResult = true;
  disconnectCalls: string[] = [];
  setEnabledCalls: boolean[] = [];
  readonly instancesList: StubInstance[] = [];
  /** The token lives here; it must never surface in a response. */
  readonly tokens: Record<string, string | undefined> = { Default: "super-secret-token" };

  readonly hostRows: OperatorHostInfo[] = [];
  readonly deletedPins: string[] = [];
  readonly hosts = {
    list: (): OperatorHostInfo[] => this.hostRows,
    deletePin: (hostId: string): boolean => {
      this.deletedPins.push(hostId);
      return true;
    },
  };

  async connect(profileDirectory: string, host?: string): Promise<ConnectResult> {
    this.connectCalls.push(profileDirectory);
    this.connectHosts.push(host);
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
  instancesOn(host: string, profileDirectory?: string): RelayLike[] {
    return this.instances(profileDirectory).filter((i) => (i.host ?? "dashboard") === host);
  }
  profileConfig(profileDirectory: string): BrowserProfileConfig {
    return { token: this.tokens[profileDirectory] };
  }
}

interface Harness {
  app: FastifyInstance;
  manager: StubManager;
  audit: AuditRing;
  config: RelayConfig;
  updateConfig: ReturnType<typeof vi.fn>;
  setProfiles(result: ProfileListResult): void;
}

async function harness(fastifyOpts: { connectionTimeout?: number } = {}): Promise<Harness> {
  const manager = new StubManager();
  const audit = new AuditRing();
  const config: RelayConfig = {
    enabled: true,
    browsers: { Default: { token: "old-default" }, "Profile 1": { token: "keep-me" } },
  };
  const updateConfig = vi.fn(async (_partial: Partial<RelayConfig>) => {});
  let profiles: ProfileListResult = {
    profiles: [
      { profileDirectory: "Default", label: "Default", email: "me@x.test", installed: true },
      { profileDirectory: "Profile 1", label: "Work", installed: false },
    ],
  };
  const app = Fastify(fastifyOpts);
  registerBrowserRoutes(app, {
    manager,
    audit,
    getConfig: () => config,
    canOpenChrome: () => true,
    listProfiles: async () => profiles,
    updateConfig,
    logger: { info: () => {}, warn: () => {}, error: () => {} },
  });
  await app.ready();
  return { app, manager, audit, config, updateConfig, setProfiles: (r) => (profiles = r) };
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
    expect(json(res)).toEqual({ enabled: true, canOpenChrome: true, operatorHosts: true });
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

  it("surfaces a live instance on an undiscovered profile (the Fake row)", async () => {
    h.manager.instancesList.push(new StubInstance("fake-1", "Fake"));
    const body = json<{ profiles: Record<string, { label: string; installed: boolean; instances: unknown[] }> }>(
      await h.app.inject({ method: "GET", url: "/api/browser/profiles" }),
    );
    expect(body.profiles.Fake).toMatchObject({ label: "Fake", installed: true });
    expect(body.profiles.Fake.instances).toHaveLength(1);
  });

  it("carries the synthetic-Default warning", async () => {
    h.setProfiles({ profiles: [{ profileDirectory: "Default", label: "Default", installed: true }], warning: "/x/Local State" });
    const res = await h.app.inject({ method: "GET", url: "/api/browser/profiles" });
    expect(json<{ warning?: string }>(res).warning).toBe("/x/Local State");
  });
});

/** Operator hosts on the REST surface (change: add-operator-browser-relay, tasks 7.5 / 2.28 / #E28 #E30). */
describe("operator hosts over REST", () => {
  const HOST = `host-${"a".repeat(32)}`;
  const hostRow = (): OperatorHostInfo => ({
    hostId: HOST,
    label: "mac-home",
    platform: "darwin",
    online: true,
    canOpenChrome: true,
    profiles: [
      { profileDirectory: "Default", label: "Me", email: "me@x.test", installed: true },
      { profileDirectory: "Profile 9", label: "Other", installed: false },
    ],
  });

  it("no hosts: profiles.operatorHosts is [] and status says operatorHosts:true", async () => {
    const body = json<{ operatorHosts: unknown[] }>(await h.app.inject({ method: "GET", url: "/api/browser/profiles" }));
    expect(body.operatorHosts).toEqual([]);
  });

  it("one host: listed with per-profile instances and NO hasToken/zeroDialog keys", async () => {
    h.manager.hostRows.push(hostRow());
    h.manager.instancesList.push(new StubInstance("inst-op", "Default", HOST));
    const res = await h.app.inject({ method: "GET", url: "/api/browser/profiles" });
    const body = json<{
      profiles: Record<string, { instances: Array<{ instanceId: string }> }>;
      operatorHosts: Array<{ hostId: string; online: boolean; profiles: Array<Record<string, unknown>> }>;
    }>(res);
    expect(body.operatorHosts).toHaveLength(1);
    const host = body.operatorHosts[0];
    expect(host).toMatchObject({ hostId: HOST, label: "mac-home", platform: "darwin", online: true, canOpenChrome: true });
    expect(host.profiles[0]).toMatchObject({ profileDirectory: "Default", email: "me@x.test", installed: true });
    expect((host.profiles[0].instances as Array<{ instanceId: string }>).map((i) => i.instanceId)).toEqual(["inst-op"]);
    expect(host.profiles[1].instances).toEqual([]);
    for (const row of host.profiles) {
      expect(row).not.toHaveProperty("hasToken");
      expect(row).not.toHaveProperty("zeroDialog");
    }
    // The operator's instance is NOT a dashboard-host instance.
    expect(body.profiles.Default.instances).toEqual([]);
    expect(res.body).not.toContain("super-secret-token");
  });

  it("an operator-only profile never becomes a synthetic dashboard row", async () => {
    h.manager.hostRows.push(hostRow());
    h.manager.instancesList.push(new StubInstance("inst-op", "OperatorOnly", HOST));
    const body = json<{ profiles: Record<string, unknown> }>(await h.app.inject({ method: "GET", url: "/api/browser/profiles" }));
    expect(Object.keys(body.profiles)).toEqual(["Default", "Profile 1"]);
  });

  it("?profileDirectory narrows the operator rows too", async () => {
    h.manager.hostRows.push(hostRow());
    const body = json<{ operatorHosts: Array<{ profiles: unknown[] }> }>(
      await h.app.inject({ method: "GET", url: "/api/browser/profiles?profileDirectory=Default" }),
    );
    expect(body.operatorHosts[0].profiles).toHaveLength(1);
  });

  it("connect forwards `host` to the manager; omitted stays undefined", async () => {
    await h.app.inject({ method: "POST", url: "/api/browser/connect", payload: { profileDirectory: "Default", host: HOST } });
    await h.app.inject({ method: "POST", url: "/api/browser/connect", payload: { profileDirectory: "Default" } });
    expect(h.manager.connectHosts).toEqual([HOST, undefined]);
  });

  it("connect outlives the server's idle connectionTimeout (operator consent can take up to 60 s)", async () => {
    await h.app.close();
    h = await harness({ connectionTimeout: 150 });
    const connect = h.manager.connect.bind(h.manager);
    h.manager.connect = async (p: string, host?: string) => {
      await new Promise((r) => setTimeout(r, 600));
      return connect(p, host);
    };
    await h.app.listen({ port: 0, host: "127.0.0.1" });
    const { port } = h.app.server.address() as { port: number };
    const res = await fetch(`http://127.0.0.1:${port}/api/browser/connect`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ profileDirectory: "Default", host: HOST }),
    });
    expect(res.status).toBe(200);
  });

  it("connect rejects a non-string / empty / oversized host with 400", async () => {
    for (const host of [5, "", "h".repeat(129), {}]) {
      const res = await h.app.inject({ method: "POST", url: "/api/browser/connect", payload: { profileDirectory: "Default", host } });
      expect(res.statusCode).toBe(400);
    }
    expect(h.manager.connectCalls).toEqual([]);
  });

  it("an operator connect failure keeps its reason and status in the body", async () => {
    h.manager.connectResult = { ok: false, status: 404, reason: "unknown-host" };
    const res = await h.app.inject({ method: "POST", url: "/api/browser/connect", payload: { profileDirectory: "Default", host: HOST } });
    expect(res.statusCode).toBe(404);
    expect(json<{ reason: string }>(res).reason).toBe("unknown-host");
  });

  it("DELETE /operator-hosts/:hostId resets the pin (200) and rejects a malformed id (400)", async () => {
    const ok = await h.app.inject({ method: "DELETE", url: `/api/browser/operator-hosts/${HOST}` });
    expect(ok.statusCode).toBe(200);
    expect(h.manager.deletedPins).toEqual([HOST]);
    const bad = await h.app.inject({ method: "DELETE", url: "/api/browser/operator-hosts/not-a-host" });
    expect(bad.statusCode).toBe(400);
    expect(h.manager.deletedPins).toEqual([HOST]);
  });

  it("DELETE still works while the relay is disabled (it only forgets a public key)", async () => {
    h.manager.enabled = false;
    const res = await h.app.inject({ method: "DELETE", url: `/api/browser/operator-hosts/${HOST}` });
    expect(res.statusCode).toBe(200);
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

describe("PUT /api/browser/profile", () => {
  it("merges server-side, preserving every other profile's writeOnly token", async () => {
    const res = await h.app.inject({
      method: "PUT",
      url: "/api/browser/profile",
      payload: { profileDirectory: "Default", token: "new-token" },
    });
    expect(res.statusCode).toBe(200);
    expect(json(res)).toEqual({ profileDirectory: "Default", hasToken: true });
    const sent = h.updateConfig.mock.calls.at(-1)?.[0] as { browsers: Record<string, { token?: string }> };
    expect(sent.browsers.Default.token).toBe("new-token");
    // The client never receives other profiles' tokens — they must survive.
    expect(sent.browsers["Profile 1"].token).toBe("keep-me");
  });

  it("clears a token with an empty string", async () => {
    const res = await h.app.inject({
      method: "PUT",
      url: "/api/browser/profile",
      payload: { profileDirectory: "Default", token: "" },
    });
    expect(res.statusCode).toBe(200);
    expect(json<{ hasToken: boolean }>(res).hasToken).toBe(false);
    const sent = h.updateConfig.mock.calls.at(-1)?.[0] as { browsers: Record<string, { token?: string }> };
    expect(sent.browsers.Default.token).toBeUndefined();
  });

  it("writes zeroDialog + allowedDomains", async () => {
    const res = await h.app.inject({
      method: "PUT",
      url: "/api/browser/profile",
      payload: { profileDirectory: "Default", zeroDialog: true, allowedDomains: ["github.com", 7] },
    });
    expect(res.statusCode).toBe(200);
    const sent = h.updateConfig.mock.calls.at(-1)?.[0] as {
      browsers: Record<string, { zeroDialog?: boolean; allowedDomains?: string[] }>;
    };
    expect(sent.browsers.Default.zeroDialog).toBe(true);
    expect(sent.browsers.Default.allowedDomains).toEqual(["github.com"]);
  });

  it.each([
    ["missing profileDirectory", {}],
    ["non-string token", { profileDirectory: "Default", token: 7 }],
    ["non-boolean zeroDialog", { profileDirectory: "Default", zeroDialog: "yes" }],
    ["non-array allowedDomains", { profileDirectory: "Default", allowedDomains: "github.com" }],
  ])("400 for %s", async (_label, payload) => {
    const res = await h.app.inject({ method: "PUT", url: "/api/browser/profile", payload });
    expect(res.statusCode).toBe(400);
    expect(h.updateConfig).not.toHaveBeenCalled();
  });
});

// Real-socket connect timeout behaviour (change: fix-browser-relay-pane-input, test-plan #X1–#X5).
// 150 ms stands in for the production 10 s `connectionTimeout`.
describe("POST /api/browser/connect over a real socket (#X1–#X5)", () => {
  const SLOW_MS = 450;
  let port = 0;
  let socket: { timeout?: number } | undefined;
  let setTimeoutCalls: number[] = [];
  let timeoutDuring: number | undefined;

  async function start(): Promise<void> {
    await h.app.close();
    h = await harness({ connectionTimeout: 150 });
    socket = undefined;
    timeoutDuring = undefined;
    setTimeoutCalls = [];
    h.app.server.on("request", (req) => {
      socket = req.socket;
      const orig = req.socket.setTimeout.bind(req.socket);
      req.socket.setTimeout = ((ms: number, ...rest: unknown[]) => {
        setTimeoutCalls.push(ms);
        return (orig as (...a: unknown[]) => unknown)(ms, ...rest);
      }) as typeof req.socket.setTimeout;
    });
    await h.app.listen({ port: 0, host: "127.0.0.1" });
    port = (h.app.server.address() as { port: number }).port;
  }
  /** Stub `connect`: records the socket timeout while pending, resolves after SLOW_MS. */
  function slow(result: ConnectResult): void {
    h.manager.connect = async (p: string) => {
      h.manager.connectCalls.push(p);
      timeoutDuring = socket?.timeout;
      await new Promise((r) => setTimeout(r, SLOW_MS));
      return result;
    };
  }
  const post = (body: unknown, signal?: AbortSignal) =>
    fetch(`http://127.0.0.1:${port}/api/browser/connect`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });

  it("#X1 a handshake slower than the idle timeout still delivers cdpUrl + instanceId", async () => {
    await start();
    slow({ ok: true, cdpUrl: "ws://127.0.0.1:1/ws/browser-cdp/late", instanceId: "inst-late" });
    const res = await post({ profileDirectory: "Default" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ cdpUrl: "ws://127.0.0.1:1/ws/browser-cdp/late", instanceId: "inst-late" });
  });

  it("#X2 a slow 504 is still delivered", async () => {
    await start();
    slow({ ok: false, status: 504 } as ConnectResult);
    const res = await post({ profileDirectory: "Default" });
    expect(res.status).toBe(504);
  });

  it("#X3 the socket timeout is 0 during the await and restored after the response", async () => {
    await start();
    slow({ ok: true, cdpUrl: "ws://127.0.0.1:1/x", instanceId: "i" });
    const res = await post({ profileDirectory: "Default" });
    await res.arrayBuffer();
    expect(timeoutDuring).toBe(0);
    await vi.waitFor(() => expect(socket?.timeout).toBe(150));
  });

  it("#X4 validation failures leave the socket timeout untouched", async () => {
    await start();
    h.manager.enabled = false;
    expect((await post({ profileDirectory: "Default" })).status).toBe(403);
    h.manager.enabled = true;
    expect((await post({})).status).toBe(400);
    expect(setTimeoutCalls).not.toContain(0);
  });

  it("#X5 a client abort mid-handshake neither re-runs connect nor wedges the server", async () => {
    await start();
    slow({ ok: true, cdpUrl: "ws://127.0.0.1:1/x", instanceId: "i" });
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      const ac = new AbortController();
      const pending = post({ profileDirectory: "Default" }, ac.signal).catch((e: unknown) => e);
      setTimeout(() => ac.abort(), 200);
      expect(await pending).toBeInstanceOf(Error);
      await new Promise((r) => setTimeout(r, SLOW_MS + 100)); // let the stub settle
      expect(h.manager.connectCalls).toEqual(["Default"]);
      const status = await fetch(`http://127.0.0.1:${port}/api/browser/status`);
      expect(status.status).toBe(200);
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", unhandled);
    }
  });
});
