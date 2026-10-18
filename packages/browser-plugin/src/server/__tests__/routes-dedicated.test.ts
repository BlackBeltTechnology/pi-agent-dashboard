/**
 * Dedicated agent browser over REST (change: add-dedicated-agent-browser, tasks
 * 4.1–4.3; test-plan #E1 #E3 #E17 #E22 #E23 #E24 #R1 #R8 #R10 #R13 #R17). Fastify
 * `inject` over the REAL `RelayManager` + `DedicatedChrome` (fake spawn), so the
 * status codes, the pipe traffic and the audit are the production ones.
 */
import fs from "node:fs";
import path from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { canOpenChrome, dedicatedAvailability } from "../capability.js";
import type { ProfileListResult } from "../profiles.js";
import type { RelayConfig } from "../relay/relay-manager.js";
import { registerBrowserRoutes } from "../routes.js";
import { answer, type DedicatedRig, type DedicatedRigOptions, flush, makeDedicatedRig, silent } from "./dedicated-manager-rig.js";

interface Harness {
  app: FastifyInstance;
  rig: DedicatedRig;
  config: RelayConfig;
  updates: Array<Partial<RelayConfig>>;
  setProfiles(r: ProfileListResult): void;
}

const apps: FastifyInstance[] = [];
const rigs: DedicatedRig[] = [];

const PROFILES: ProfileListResult = {
  profiles: [
    { profileDirectory: "Default", label: "Default", installed: true, passwordManagers: ["LastPass"] },
    { profileDirectory: "Profile 2", label: "Work", installed: true, passwordManagers: [] },
    { profileDirectory: "Profile 9", label: "Old", installed: false, passwordManagers: [] },
  ],
};

async function harness(
  opts: DedicatedRigOptions & { canOpen?: () => boolean; fastify?: { connectionTimeout?: number } } = {},
): Promise<Harness> {
  const rig = makeDedicatedRig(opts);
  rigs.push(rig);
  let profiles = PROFILES;
  const updates: Array<Partial<RelayConfig>> = [];
  const app = Fastify(opts.fastify ?? {});
  registerBrowserRoutes(app, {
    manager: rig.manager,
    audit: rig.audit,
    getConfig: () => rig.config,
    canOpenChrome: opts.canOpen ?? (() => true),
    listProfiles: async () => profiles,
    updateConfig: async (partial) => {
      updates.push(partial);
      Object.assign(rig.config, partial);
    },
    logger: silent,
  });
  await app.ready();
  apps.push(app);
  return { app, rig, config: rig.config, updates, setProfiles: (r) => (profiles = r) };
}

afterEach(async () => {
  vi.useRealTimers();
  for (const a of apps.splice(0)) await a.close();
  for (const r of rigs.splice(0)) r.cleanup();
});

const body = <T = Record<string, unknown>>(res: { body: string }): T => JSON.parse(res.body) as T;
const post = (h: Harness, url: string, payload?: unknown) =>
  h.app.inject({ method: "POST", url, ...(payload === undefined ? {} : { payload: payload as object }) });
const put = (h: Harness, url: string, payload: unknown) => h.app.inject({ method: "PUT", url, payload: payload as object });

describe("#E1 GET /status — dedicated availability", () => {
  const exists = (haveBinary: boolean, haveDataDir: boolean) => (p: string) =>
    (haveBinary && p.endsWith("Google Chrome.app/Contents/MacOS/Google Chrome")) || (haveDataDir && p.endsWith("Application Support/Google/Chrome"));
  const probes = (haveBinary: boolean, systemOpen: boolean, haveDataDir: boolean) => {
    const opts = { platform: "darwin" as const, env: { HOME: "/h" }, home: "/h", systemOpen: () => systemOpen, exists: exists(haveBinary, haveDataDir) };
    return { availabilityFn: () => dedicatedAvailability(opts), canOpen: () => canOpenChrome(opts) };
  };

  it("(binary y, system-open y, default data dir n) → available, canOpenChrome false", async () => {
    const h = await harness(probes(true, true, false));
    const s = body<{ canOpenChrome: boolean; dedicated: { available: boolean; reason?: string } }>(await h.app.inject({ method: "GET", url: "/api/browser/status" }));
    expect(s.canOpenChrome).toBe(false);
    expect(s.dedicated.available).toBe(true);
    expect(s.dedicated.reason).toBeUndefined();
  });

  it("(n, y, y) → unavailable no-chrome", async () => {
    const h = await harness(probes(false, true, true));
    const s = body<{ dedicated: { available: boolean; reason?: string } }>(await h.app.inject({ method: "GET", url: "/api/browser/status" }));
    expect(s.dedicated).toMatchObject({ available: false, reason: "no-chrome" });
  });

  it("(y, n, y) → unavailable no-display", async () => {
    const h = await harness(probes(true, false, true));
    const s = body<{ dedicated: { available: boolean; reason?: string } }>(await h.app.inject({ method: "GET", url: "/api/browser/status" }));
    expect(s.dedicated).toMatchObject({ available: false, reason: "no-display" });
  });
});

describe("#E3 GET /status — dedicated state", () => {
  it("not-created → stopped (dir present, Chrome stopped)", async () => {
    const h = await harness();
    const first = body<{ dedicated: { state: string; dataDir: string; downloadsDir: string; sizeBytes?: number } }>(
      await h.app.inject({ method: "GET", url: "/api/browser/status" }),
    );
    expect(first.dedicated.state).toBe("not-created");
    expect(first.dedicated.dataDir).toBe(h.rig.chrome.dataDir);
    expect(first.dedicated.downloadsDir).toBe(h.rig.chrome.downloadsDir);
    expect(first.dedicated.sizeBytes).toBeUndefined();
    fs.mkdirSync(h.rig.chrome.dataDir, { recursive: true });
    const second = body<{ dedicated: { state: string } }>(await h.app.inject({ method: "GET", url: "/api/browser/status" }));
    expect(second.dedicated.state).toBe("stopped");
  });

  it("running carries instanceId and holder {client}; lastUsed is epoch ms; size is cached", async () => {
    const h = await harness();
    const conn = body<{ instanceId: string }>(await post(h, "/api/browser/dedicated/connect", { client: "gmail-setup" }));
    const s = body<{ dedicated: { state: string; instanceId: string; holder: { client?: string; sessionId?: string }; sizeBytes?: number; lastUsed?: number } }>(
      await h.app.inject({ method: "GET", url: "/api/browser/status" }),
    );
    expect(s.dedicated).toMatchObject({ state: "running", instanceId: conn.instanceId, holder: { client: "gmail-setup" } });
    expect(typeof s.dedicated.sizeBytes).toBe("number");
    // a hidden sign-in tab stamps lastUsed
    const open = post(h, "/api/browser/dedicated/open", {});
    await vi.waitFor(() => expect(h.rig.children[0].methods()).toContain("Target.createTarget"));
    answer(h.rig.children[0], "Target.createTarget", { targetId: "T1" });
    expect((await open).statusCode).toBe(200);
    const after = body<{ dedicated: { lastUsed?: number } }>(await h.app.inject({ method: "GET", url: "/api/browser/status" }));
    expect(after.dedicated.lastUsed).toBeGreaterThan(1_600_000_000_000);
  });

  it("returns the effective Agent browsing settings (defaults filled in)", async () => {
    const h = await harness({ config: { enabled: true, idleDisconnectMinutes: 5, allowedDomains: ["a.test"] } });
    const s = body<{ settings: Record<string, unknown> }>(await h.app.inject({ method: "GET", url: "/api/browser/status" }));
    expect(s.settings).toEqual({
      defaultBrowser: "@dedicated",
      onUnavailable: "ask",
      idleDisconnectMinutes: 5,
      allowMultipleInstancesPerProfile: false,
      openLiveViewOnConnect: true,
      allowedDomains: ["a.test"],
    });
  });
});

describe("#R1 POST /dedicated/connect", () => {
  it("403 while disabled", async () => {
    const h = await harness({ config: { enabled: false } });
    const res = await post(h, "/api/browser/dedicated/connect", {});
    expect(res.statusCode).toBe(403);
    expect(h.rig.spawn).not.toHaveBeenCalled();
  });

  it("503 with the reason when unavailable", async () => {
    const h = await harness({ available: { available: false, reason: "no-display" } });
    const res = await post(h, "/api/browser/dedicated/connect", {});
    expect(res.statusCode).toBe(503);
    expect(body(res)).toMatchObject({ reason: "no-display" });
  });

  it("200 {cdpUrl, instanceId} with no body at all; then 409 {busy, instanceId, holder} for a second connect", async () => {
    const h = await harness();
    const first = await post(h, "/api/browser/dedicated/connect");
    expect(first.statusCode).toBe(200);
    const ok = body<{ cdpUrl: string; instanceId: string }>(first);
    expect(ok.cdpUrl).toMatch(/^ws:\/\/127\.0\.0\.1:8123\/ws\/browser-cdp\/[0-9a-f]{32}$/);
    const second = await post(h, "/api/browser/dedicated/connect", { client: "late" });
    expect(second.statusCode).toBe(409);
    expect(body(second)).toMatchObject({ reason: "busy", instanceId: ok.instanceId });
  });

  it("holder of the 409 is the first caller's client label", async () => {
    const h = await harness();
    await post(h, "/api/browser/dedicated/connect", { client: "gmail-setup" });
    const second = await post(h, "/api/browser/dedicated/connect", {});
    expect(body(second)).toMatchObject({ reason: "busy", holder: "gmail-setup" });
  });

  it.each([[42], [""], ["x".repeat(65)]])("400 for an invalid client label %j", async (client) => {
    const h = await harness();
    const res = await post(h, "/api/browser/dedicated/connect", { client });
    expect(res.statusCode).toBe(400);
    expect(h.rig.spawn).not.toHaveBeenCalled();
  });

  it("owned-by-other-server surfaces as 409 with its reason", async () => {
    const h = await harness({ createDir: true, chrome: { isProcessAlive: (p) => p === 31337, processStartedAt: () => 1_700_000_000_100 }, list: (dir) => [{ pid: 500, args: `/c/chrome --user-data-dir=${dir} --remote-debugging-pipe` }, { pid: 31337, args: "node server" }] });
    fs.writeFileSync(path.join(h.rig.chrome.dataDir, ".dashboard-owner.json"), JSON.stringify({ serverPid: 31337, serverStartedAt: 1_700_000_000_000, serverCmd: "node server" }));
    const res = await post(h, "/api/browser/dedicated/connect", {});
    expect(res.statusCode).toBe(409);
    expect(body(res)).toMatchObject({ reason: "owned-by-other-server" });
  });
});

// A cold Chrome start outlasts the server's 10 s connectionTimeout; 150 ms stands in for it
// (same shape as routes.test.ts #X1–#X3, fix-browser-relay-pane-input D2).
describe("connect and open over a real socket outlive the idle connectionTimeout", () => {
  async function listen(h: Harness): Promise<number> {
    await h.app.listen({ port: 0, host: "127.0.0.1" });
    return (h.app.server.address() as { port: number }).port;
  }

  it("a 450 ms cold start still answers dedicated/connect 200 and the socket timeout is restored", async () => {
    const h = await harness({ behavior: { versionDelayMs: 450 }, fastify: { connectionTimeout: 150 } });
    let socket: { timeout?: number } | undefined;
    const timeouts: number[] = [];
    h.app.server.prependListener("request", (req) => {
      socket = req.socket;
      const orig = req.socket.setTimeout.bind(req.socket);
      req.socket.setTimeout = ((ms: number, ...rest: unknown[]) => {
        timeouts.push(ms);
        return (orig as (...a: unknown[]) => unknown)(ms, ...rest);
      }) as typeof req.socket.setTimeout;
    });
    const port = await listen(h);
    const res = await fetch(`http://127.0.0.1:${port}/api/browser/dedicated/connect`, { method: "POST" });
    expect(res.status).toBe(200);
    await res.arrayBuffer();
    expect(timeouts).toContain(0);
    await vi.waitFor(() => expect(socket?.timeout).toBe(150));
  });

  it("a 450 ms cold start still answers dedicated/open 200", async () => {
    const h = await harness({ behavior: { versionDelayMs: 450 }, fastify: { connectionTimeout: 150 } });
    const port = await listen(h);
    const timer = setInterval(() => {
      const child = h.rig.children[0];
      if (child?.methods().includes("Target.createTarget") && !child.written.some((m) => (m as { answered?: boolean }).answered)) {
        const cmd = child.written.find((m) => m.method === "Target.createTarget");
        if (cmd?.id !== undefined) {
          (cmd as { answered?: boolean }).answered = true;
          child.reply(cmd.id, { targetId: "T1" });
        }
      }
    }, 20);
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/browser/dedicated/open`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      expect(res.status).toBe(200);
    } finally {
      clearInterval(timer);
    }
  });
});

describe("#R17 POST /disconnect closes the dedicated instance", () => {
  it("instance gone, Chrome keeps running", async () => {
    const h = await harness();
    const { instanceId } = body<{ instanceId: string }>(await post(h, "/api/browser/dedicated/connect", {}));
    const res = await post(h, `/api/browser/disconnect?instanceId=${instanceId}`);
    expect(res.statusCode).toBe(200);
    expect(h.rig.manager.find(instanceId)).toBeUndefined();
    expect(h.rig.chrome.state()).toBe("running");
    expect((await post(h, "/api/browser/dedicated/connect", {})).statusCode).toBe(200);
    expect(h.rig.spawn).toHaveBeenCalledTimes(1);
  });
});

describe("#R8 PUT /enabled {false} with a dedicated client", () => {
  it("closes the client socket and stops Chrome before the response", async () => {
    const h = await harness();
    const { cdpUrl } = body<{ cdpUrl: string }>(await post(h, "/api/browser/dedicated/connect", {}));
    const client = h.rig.dial(cdpUrl);
    await flush();
    const res = await put(h, "/api/browser/enabled", { enabled: false });
    expect(res.statusCode).toBe(200);
    expect(client.closed.length).toBeGreaterThan(0);
    expect(h.rig.children[0].methods()).toContain("Browser.close");
    expect(h.rig.chrome.state()).toBe("stopped");
    expect(h.rig.manager.instancesOn("dashboard", "@dedicated")).toHaveLength(0);
  });
});

describe("#R10 POST /dedicated/stop", () => {
  it("stops the instance and Chrome (Browser.close first)", async () => {
    const h = await harness();
    await post(h, "/api/browser/dedicated/connect", {});
    const res = await post(h, "/api/browser/dedicated/stop");
    expect(res.statusCode).toBe(200);
    expect(h.rig.children[0].methods()).toContain("Browser.close");
    expect(h.rig.chrome.state()).toBe("stopped");
  });

  it("403 while disabled", async () => {
    const h = await harness({ config: { enabled: false } });
    expect((await post(h, "/api/browser/dedicated/stop")).statusCode).toBe(403);
  });
});

describe("#R13 POST /dedicated/reset", () => {
  it("409 while running (dir unchanged); 200 once stopped (dir removed, state not-created)", async () => {
    const h = await harness();
    await post(h, "/api/browser/dedicated/connect", {});
    const marker = path.join(h.rig.chrome.dataDir, "marker");
    fs.writeFileSync(marker, "x");
    const refused = await post(h, "/api/browser/dedicated/reset");
    expect(refused.statusCode).toBe(409);
    expect(fs.existsSync(marker)).toBe(true);
    await post(h, "/api/browser/dedicated/stop");
    const ok = await post(h, "/api/browser/dedicated/reset");
    expect(ok.statusCode).toBe(200);
    expect(fs.existsSync(h.rig.chrome.dataDir)).toBe(false);
    const s = body<{ dedicated: { state: string } }>(await h.app.inject({ method: "GET", url: "/api/browser/status" }));
    expect(s.dedicated.state).toBe("not-created");
  });
});

describe("#E24 POST /dedicated/open URL policy", () => {
  async function open(h: Harness, payload: unknown) {
    const p = post(h, "/api/browser/dedicated/open", payload);
    return p;
  }

  it("omitted url opens the default https://accounts.google.com/", async () => {
    const h = await harness();
    const p = open(h, {});
    await vi.waitFor(() => expect(h.rig.children[0]?.methods()).toContain("Target.createTarget"));
    const create = h.rig.children[0].written.find((m) => m.method === "Target.createTarget");
    expect(create?.params?.url).toBe("https://accounts.google.com/");
    answer(h.rig.children[0], "Target.createTarget", { targetId: "T1" });
    expect((await p).statusCode).toBe(200);
  });

  it("https://accounts.google.com/x opens (one audit row, query/fragment stripped)", async () => {
    const h = await harness();
    const p = open(h, { url: "https://accounts.google.com/x?authuser=1#f" });
    await vi.waitFor(() => expect(h.rig.children[0]?.methods()).toContain("Target.createTarget"));
    answer(h.rig.children[0], "Target.createTarget", { targetId: "T1" });
    expect((await p).statusCode).toBe(200);
    expect(h.rig.audit.list().filter((e) => e.kind === "open").map((e) => e.detail)).toEqual(["https://accounts.google.com/x"]);
  });

  it.each(["http://a.test", "javascript:alert(1)", "chrome://settings"])("%s → 400 and nothing is launched or written to the pipe", async (url) => {
    const h = await harness();
    const res = await open(h, { url });
    expect(res.statusCode).toBe(400);
    expect(h.rig.spawn).not.toHaveBeenCalled();
    expect(h.rig.audit.list().filter((e) => e.kind === "open")).toEqual([]);
  });

  it("https://evil.test with global allowed domains [google.com] → 400, no Target.createTarget", async () => {
    const h = await harness({ config: { enabled: true, allowedDomains: ["google.com"] } });
    // Chrome is already running so a createTarget WOULD show on the pipe
    await h.rig.manager.connectDedicated();
    const res = await open(h, { url: "https://evil.test" });
    expect(res.statusCode).toBe(400);
    expect(h.rig.children[0].methods()).not.toContain("Target.createTarget");
  });

  it("a non-string url is 400", async () => {
    const h = await harness();
    expect((await open(h, { url: 5 })).statusCode).toBe(400);
  });

  it("403 while disabled", async () => {
    const h = await harness({ config: { enabled: false } });
    expect((await open(h, {})).statusCode).toBe(403);
  });
});

describe("#E17 GET /profiles", () => {
  it("drops the @dedicated instance's key and carries passwordManagers", async () => {
    const h = await harness();
    await post(h, "/api/browser/dedicated/connect", {});
    expect(h.rig.manager.instancesOn("dashboard", "@dedicated")).toHaveLength(1);
    const res = body<{ profiles: Record<string, { passwordManagers: string[] }> }>(await h.app.inject({ method: "GET", url: "/api/browser/profiles" }));
    expect(Object.keys(res.profiles)).toEqual(["Default", "Profile 2", "Profile 9"]);
    expect(res.profiles["@dedicated"]).toBeUndefined();
    expect(res.profiles.Default.passwordManagers).toEqual(["LastPass"]);
    expect(res.profiles["Profile 2"].passwordManagers).toEqual([]);
  });

  it("two discovered profiles + a live @dedicated → exactly two rows", async () => {
    const h = await harness();
    h.setProfiles({ profiles: PROFILES.profiles.slice(0, 2) });
    await post(h, "/api/browser/dedicated/connect", {});
    const res = body<{ profiles: Record<string, unknown> }>(await h.app.inject({ method: "GET", url: "/api/browser/profiles" }));
    expect(Object.keys(res.profiles)).toHaveLength(2);
  });
});

describe("#E22 PUT /settings validation", () => {
  it.each([0, 5, 30, 120])("idleDisconnectMinutes %d → 200 and stored", async (n) => {
    const h = await harness();
    const res = await put(h, "/api/browser/settings", { idleDisconnectMinutes: n });
    expect(res.statusCode).toBe(200);
    expect(h.config.idleDisconnectMinutes).toBe(n);
    expect(body<{ settings: { idleDisconnectMinutes: number } }>(res).settings.idleDisconnectMinutes).toBe(n);
  });

  it.each([
    ["-5", { idleDisconnectMinutes: -5 }],
    ["31", { idleDisconnectMinutes: 31 }],
    ["a string", { idleDisconnectMinutes: "30" }],
    ["unknown key", { foo: 1 }],
    ["unknown key next to a valid one", { idleDisconnectMinutes: 5, foo: 1 }],
    ["bad enum", { onUnavailable: "later" }],
    ["uninstalled defaultBrowser", { defaultBrowser: "Profile 99" }],
    ["unlisted-but-known uninstalled profile", { defaultBrowser: "Profile 9" }],
    ["@-prefixed unknown target", { defaultBrowser: "@mystery" }],
    ["uninstalled realProfile", { realProfile: "Profile 9" }],
    ["@dedicated as realProfile", { realProfile: "@dedicated" }],
    ["non-boolean flag", { openLiveViewOnConnect: "yes" }],
    ["non-array domains", { allowedDomains: "a.test" }],
    ["non-string domain", { allowedDomains: ["a.test", 3] }],
  ])("%s → 400 with the stored settings unchanged", async (_label, payload) => {
    const h = await harness({ config: { enabled: true, idleDisconnectMinutes: 30, onUnavailable: "ask", defaultBrowser: "@dedicated" } });
    const before = JSON.stringify(h.config);
    const res = await put(h, "/api/browser/settings", payload);
    expect(res.statusCode).toBe(400);
    expect(JSON.stringify(h.config)).toBe(before);
    expect(h.updates).toEqual([]);
  });

  it("a partial body with a mix of valid and invalid fields stores NONE of them", async () => {
    const h = await harness();
    const res = await put(h, "/api/browser/settings", { onUnavailable: "next", idleDisconnectMinutes: 31 });
    expect(res.statusCode).toBe(400);
    expect(h.updates).toEqual([]);
    expect(h.config.onUnavailable).toBeUndefined();
  });

  it("accepts the Chrome-profile pick {defaultBrowser:P, realProfile:P} and the built-in targets", async () => {
    const h = await harness();
    expect((await put(h, "/api/browser/settings", { defaultBrowser: "Profile 2", realProfile: "Profile 2" })).statusCode).toBe(200);
    expect(h.config).toMatchObject({ defaultBrowser: "Profile 2", realProfile: "Profile 2" });
    expect((await put(h, "/api/browser/settings", { defaultBrowser: "@headless" })).statusCode).toBe(200);
    expect((await put(h, "/api/browser/settings", { defaultBrowser: "@dedicated" })).statusCode).toBe(200);
    expect(h.config.realProfile).toBe("Profile 2"); // kept when the default goes back to dedicated
  });

  it("stores the other keys through the same config write (booleans, enum, trimmed domains)", async () => {
    const h = await harness();
    const res = await put(h, "/api/browser/settings", {
      allowMultipleInstancesPerProfile: true,
      openLiveViewOnConnect: false,
      onUnavailable: "stop",
      allowedDomains: [" github.com ", ".google.com"],
    });
    expect(res.statusCode).toBe(200);
    expect(h.config).toMatchObject({
      allowMultipleInstancesPerProfile: true,
      openLiveViewOnConnect: false,
      onUnavailable: "stop",
      allowedDomains: ["github.com", ".google.com"],
    });
    // a global domain list immediately constrains `dedicated/open`
    const denied = await post(h, "/api/browser/dedicated/open", { url: "https://evil.test/" });
    expect(denied.statusCode).toBe(400);
  });

  it("an empty body is a no-op 200; 403 while disabled", async () => {
    const h = await harness();
    expect((await put(h, "/api/browser/settings", {})).statusCode).toBe(200);
    expect(h.updates).toEqual([]);
    const off = await harness({ config: { enabled: false } });
    expect((await put(off, "/api/browser/settings", { onUnavailable: "next" })).statusCode).toBe(403);
    expect(off.updates).toEqual([]);
  });
});

describe("#E23 PUT /profile refuses @-prefixed keys", () => {
  it("@dedicated → 400, config unchanged", async () => {
    const h = await harness({ config: { enabled: true, browsers: { Default: { token: "t" } } } });
    const before = JSON.stringify(h.config);
    const res = await put(h, "/api/browser/profile", { profileDirectory: "@dedicated", allowedDomains: ["a.test"] });
    expect(res.statusCode).toBe(400);
    expect(JSON.stringify(h.config)).toBe(before);
    expect(h.updates).toEqual([]);
  });

  it("an ordinary profile still writes", async () => {
    const h = await harness();
    expect((await put(h, "/api/browser/profile", { profileDirectory: "Default", zeroDialog: true })).statusCode).toBe(200);
  });
});
