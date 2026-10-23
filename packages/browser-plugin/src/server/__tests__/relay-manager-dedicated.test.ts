/**
 * `RelayManager.connectDedicated` + dedicated lifecycle at MANAGER level (change:
 * add-dedicated-agent-browser, task 3.5; test-plan #R1 #R2 #R3 #R4 #R5 #R6 #R7
 * #R8 #R9 #R10 #R11 #R13 and the manager half of #R17). A real `DedicatedChrome`
 * over a fake spawn runs under a real `RelayManager`; Chrome's replies are
 * scripted through `FakeChromeChild`.
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FakeChromeChild } from "../dedicated/__tests__/fake-chrome.js";
import type { ProcessInfo } from "../dedicated/process-identity.js";
import { viewerSocket } from "../relay/__tests__/fake-socket.js";
import { BrowserRelayStatus } from "../status.js";
import { answer, BINARY, type DedicatedRig, type DedicatedRigOptions, flush, makeDedicatedRig, silent } from "./dedicated-manager-rig.js";

const rigs: DedicatedRig[] = [];
function rig(opts: DedicatedRigOptions = {}): DedicatedRig {
  const r = makeDedicatedRig(opts);
  rigs.push(r);
  return r;
}
afterEach(() => {
  vi.useRealTimers();
  for (const r of rigs.splice(0)) r.cleanup();
});

const GUID_URL = /^ws:\/\/127\.0\.0\.1:8123\/ws\/browser-cdp\/[0-9a-f]{32}\?ticket=[A-Za-z0-9_-]{43}$/;

async function connected(r: DedicatedRig, opts: Parameters<DedicatedRig["manager"]["connectDedicated"]>[0] = {}) {
  const res = await r.manager.connectDedicated(opts);
  if (!res.ok) throw new Error(`connect failed: ${JSON.stringify(res)}`);
  return res;
}

describe("#R1 dedicated connect decision table", () => {
  it("(n,·,·) plugin disabled → 403 disabled, nothing spawned", async () => {
    const r = rig({ config: { enabled: false } });
    expect(await r.manager.connectDedicated()).toMatchObject({ ok: false, status: 403, reason: "disabled" });
    expect(r.spawn).not.toHaveBeenCalled();
  });

  it.each(["no-chrome", "no-display"] as const)("(y,n,·) unavailable (%s) → 503 with the reason", async (reason) => {
    const r = rig({ available: { available: false, reason } });
    expect(await r.manager.connectDedicated()).toMatchObject({ ok: false, status: 503, reason });
    expect(r.spawn).not.toHaveBeenCalled();
  });

  it("(y,y,n) free → 200 {cdpUrl, instanceId}, registered under @dedicated, Chrome running", async () => {
    const r = rig();
    const res = await connected(r, { client: "gmail-setup" });
    expect(res.cdpUrl).toMatch(GUID_URL);
    expect(res.instanceId).toMatch(/^inst-[0-9a-f]+$/);
    expect(r.manager.find(res.instanceId)?.profileDirectory).toBe("@dedicated");
    expect(r.manager.instancesOn("dashboard", "@dedicated")).toHaveLength(1);
    expect(r.chrome.state()).toBe("running");
    expect(r.manager.resolve(new URL(res.cdpUrl).pathname.split("/").pop() as string)).toMatchObject({ dedicated: true, operator: false });
  });

  it("(y,y,y) live instance → 409 {busy, instanceId, holder} (REST client label)", async () => {
    const r = rig();
    const first = await connected(r, { client: "gmail-setup" });
    const second = await r.manager.connectDedicated({ client: "other" });
    expect(second).toEqual({ ok: false, status: 409, reason: "busy", instanceId: first.instanceId, holder: "gmail-setup" });
  });

  it("a browser_connect holder is reported by sessionId", async () => {
    const r = rig();
    const first = await r.manager.connectDedicated({ holder: { sessionId: "sess-1" } });
    if (!first.ok) throw new Error("connect failed");
    expect(r.manager.dedicatedPolicyStatus()).toMatchObject({ available: true, instanceId: first.instanceId, holder: "sess-1" });
    expect(await r.manager.connectDedicated()).toMatchObject({ status: 409, holder: "sess-1" });
  });

  it("the cdpUrl guid attaches a CDP client to the DedicatedInstance (and is never an extension guid)", async () => {
    const r = rig();
    const res = await connected(r);
    const client = r.dial(res.cdpUrl);
    await flush();
    expect(r.manager.find(res.instanceId)?.statusState()).toBe("connected");
    expect(client.closed).toEqual([]);
  });
});

describe("#R2 busy ignores allowMultipleInstancesPerProfile", () => {
  it("a second connect is 409 busy even when the flag is true", async () => {
    const r = rig({ config: { enabled: true, allowMultipleInstancesPerProfile: true } });
    await connected(r);
    expect(await r.manager.connectDedicated()).toMatchObject({ ok: false, status: 409, reason: "busy" });
    expect(r.spawn).toHaveBeenCalledTimes(1);
  });
});

describe("#R3 concurrent first connects", () => {
  it("connect + open fired together while Chrome is starting share ONE spawn", async () => {
    const r = rig({ behavior: { versionDelayMs: 200 } });
    const connect = r.manager.connectDedicated();
    const open = r.manager.openDedicated("https://accounts.google.com/");
    await vi.waitFor(() => expect(r.children[0]?.methods()).toContain("Target.createTarget"), { timeout: 3000 });
    answer(r.children[0], "Target.createTarget", { targetId: "T-signin" });
    const [c, o] = await Promise.all([connect, open]);
    expect(c.ok).toBe(true);
    expect(o).toEqual({ ok: true, targetId: "T-signin" });
    expect(r.spawn).toHaveBeenCalledTimes(1);
    expect(r.hidden.isStickyHidden("T-signin")).toBe(true);
  });

  it("two simultaneous connects: one wins, the other is 409 busy; still one spawn", async () => {
    const r = rig({ behavior: { versionDelayMs: 50 } });
    const [a, b] = await Promise.all([r.manager.connectDedicated(), r.manager.connectDedicated()]);
    expect([a.ok, b.ok].sort()).toEqual([false, true]);
    const loser = a.ok ? b : a;
    expect(loser).toMatchObject({ ok: false, status: 409, reason: "busy" });
    expect(r.spawn).toHaveBeenCalledTimes(1);
  });
});

describe("#R4 launch failure", () => {
  const FOREIGN = (dir: string): ProcessInfo => ({ pid: 999, args: `${BINARY} --user-data-dir=${dir}` });

  it("(a) exits before replying after a hand-off to a running foreign instance → 503 profile-in-use", async () => {
    let spawned = false;
    const r = rig({ list: (dir) => (spawned ? [FOREIGN(dir)] : []) });
    r.spawn.mockImplementation(() => {
      spawned = true;
      const c = new FakeChromeChild(7100, { silent: true });
      queueMicrotask(() => c.exit(0));
      r.children.push(c);
      return c;
    });
    expect(await r.manager.connectDedicated()).toMatchObject({ ok: false, status: 503, reason: "profile-in-use" });
    expect(r.manager.instancesOn("dashboard", "@dedicated")).toHaveLength(0);
  });

  it("(b) exits with code 1 → 503 launch-failed; a following connect launches again and succeeds", async () => {
    const r = rig();
    r.spawn.mockImplementationOnce(() => {
      const c = new FakeChromeChild(7200, { silent: true });
      queueMicrotask(() => c.exit(1));
      r.children.push(c);
      return c;
    });
    expect(await r.manager.connectDedicated()).toMatchObject({ ok: false, status: 503, reason: "launch-failed" });
    expect(r.manager.instancesOn("dashboard", "@dedicated")).toHaveLength(0);
    expect((await r.manager.connectDedicated()).ok).toBe(true);
    expect(r.spawn).toHaveBeenCalledTimes(2);
  });

  it("(c) never replies → 503 launch-failed at 15 s with a group kill; nothing registered", async () => {
    vi.useFakeTimers();
    const r = rig({ behavior: { silent: true } });
    const p = r.manager.connectDedicated();
    await vi.advanceTimersByTimeAsync(14_999);
    expect(r.killProcessGroup).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(await p).toMatchObject({ ok: false, status: 503, reason: "launch-failed" });
    expect(r.killProcessGroup).toHaveBeenCalledWith(7000);
    expect(r.manager.instancesOn("dashboard", "@dedicated")).toHaveLength(0);
  });
});

describe("#R5 ownership at manager level (darwin + win32 listings)", () => {
  const OWNER_STARTED = 1_700_000_000_000;
  const OWNER_CMD = "node /srv/pi-dashboard/server.js --port 8000";
  const dedicatedLine = (dir: string, platform: "darwin" | "win32", pid = 500): ProcessInfo =>
    platform === "win32"
      ? { pid, args: `"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --user-data-dir="${dir}" --remote-debugging-pipe --disable-sync about:blank` }
      : { pid, args: `${BINARY} --user-data-dir=${dir} --remote-debugging-pipe --disable-sync --no-first-run about:blank` };
  const foreignLine = (dir: string, platform: "darwin" | "win32"): ProcessInfo =>
    platform === "win32" ? { pid: 600, args: `"C:\\chrome.exe" --user-data-dir="${dir}"` } : { pid: 600, args: `${BINARY} --profile-directory=Default --user-data-dir=${dir}` };

  describe.each(["darwin", "win32"] as const)("%s", (platform) => {
    function owned(over: Partial<DedicatedRigOptions> & { ownerAlive?: boolean }): DedicatedRig {
      const r = rig({
        createDir: true,
        chrome: {
          platform,
          isProcessAlive: (pid) => pid === 31337 && over.ownerAlive === true,
          processStartedAt: () => (platform === "win32" ? null : OWNER_STARTED + 100),
        },
        ...over,
      });
      fs.writeFileSync(
        path.join(r.chrome.dataDir, ".dashboard-owner.json"),
        JSON.stringify({ serverPid: 31337, serverStartedAt: platform === "win32" ? null : OWNER_STARTED, serverCmd: OWNER_CMD }),
      );
      return r;
    }

    it("(y,y,n) other server alive → 409 owned-by-other-server, no kill, no spawn", async () => {
      const r = owned({
        ownerAlive: true,
        list: (dir) => [dedicatedLine(dir, platform), { pid: 31337, args: OWNER_CMD }],
      });
      expect(await r.manager.connectDedicated()).toMatchObject({ ok: false, status: 409, reason: "owned-by-other-server" });
      expect(r.killProcessGroup).not.toHaveBeenCalled();
      expect(r.spawn).not.toHaveBeenCalled();
    });

    it("(y,n,n) owner dead → kill by identity, then launch, connect 200", async () => {
      const killed: number[] = [];
      const r = owned({ ownerAlive: false, list: (dir) => [dedicatedLine(dir, platform)].filter((p) => !killed.includes(p.pid)) });
      r.killProcessGroup.mockImplementation(async (pid: number) => {
        killed.push(pid);
        return { ok: true, forced: false };
      });
      expect((await r.manager.connectDedicated()).ok).toBe(true);
      expect(killed).toEqual([500]);
      expect(r.spawn).toHaveBeenCalledTimes(1);
    });

    it("(n,·,y) foreign Chrome without the pipe flag → 503 profile-in-use, no kill", async () => {
      const r = owned({ list: (dir) => [foreignLine(dir, platform)] });
      expect(await r.manager.connectDedicated()).toMatchObject({ ok: false, status: 503, reason: "profile-in-use" });
      expect(r.killProcessGroup).not.toHaveBeenCalled();
    });

    it("(n,·,n) nothing on the directory → launch", async () => {
      const r = owned({ list: () => [] });
      expect((await r.manager.connectDedicated()).ok).toBe(true);
    });
  });

  it("#R6 a pid reused by an unrelated process is never killed", async () => {
    let call = 0;
    const r = rig({
      createDir: true,
      list: (dir) => (++call === 1 ? [dedicatedLine(dir, "darwin", 500)] : [{ pid: 500, args: "/usr/bin/vim notes.txt" }]),
    });
    expect((await r.manager.connectDedicated()).ok).toBe(true);
    expect(r.killProcessGroup).not.toHaveBeenCalled();
  });
});

describe("#R7 kill switch during launch", () => {
  it("connect waiting on a 200 ms launch + setEnabled(false) → 403, nothing registered, Chrome closed", async () => {
    const r = rig({ behavior: { versionDelayMs: 200 } });
    const connect = r.manager.connectDedicated();
    await vi.waitFor(() => expect(r.spawn).toHaveBeenCalled());
    r.config.enabled = false; // the config write precedes setEnabled (see PUT /enabled)
    await r.manager.setEnabled(false);
    expect(await connect).toMatchObject({ ok: false, status: 403, reason: "disabled" });
    expect(r.manager.instancesOn("dashboard", "@dedicated")).toHaveLength(0);
    expect(r.chrome.state()).not.toBe("running");
    expect(r.chrome.state()).not.toBe("starting");
  });

  it("a launch that completes, with the switch completing right after, still ends 403 with Chrome closed", async () => {
    const r = rig();
    const real = r.chrome.ensureRunning.bind(r.chrome);
    r.chrome.ensureRunning = async () => {
      await real();
      r.config.enabled = false;
      await r.manager.setEnabled(false); // completes between the launch and the connect's epoch check
    };
    expect(await r.manager.connectDedicated()).toMatchObject({ ok: false, status: 403, reason: "disabled" });
    expect(r.manager.instancesOn("dashboard", "@dedicated")).toHaveLength(0);
    expect(r.chrome.state()).toBe("stopped");
  });
});

describe("#R8 kill switch with a client", () => {
  it("closes the client socket and Chrome (Browser.close, then group kill) before setEnabled resolves", async () => {
    vi.useFakeTimers();
    const r = rig({ behavior: { ignoreClose: true } });
    const res = await connected(r);
    const client = r.dial(res.cdpUrl);
    await vi.advanceTimersByTimeAsync(0);
    r.config.enabled = false;
    let done = false;
    const p = r.manager.setEnabled(false).then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(client.closed.length).toBeGreaterThan(0); // client socket closed
    expect(r.children[0].methods()).toContain("Browser.close");
    expect(done).toBe(false); // Chrome ignored Browser.close: still inside the 5 s grace
    expect(r.killProcessGroup).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5000);
    await p;
    expect(r.killProcessGroup).toHaveBeenCalledWith(7000);
    expect(done).toBe(true);
    expect(r.manager.instancesOn("dashboard", "@dedicated")).toHaveLength(0);
  });
});

describe("#R9 unexpected Chrome exit", () => {
  it("closes the client socket, audits detach closed:chrome-exited, state stopped, owner record removed, next connect spawns again", async () => {
    const r = rig();
    const res = await connected(r);
    const client = r.dial(res.cdpUrl);
    await flush();
    expect(fs.existsSync(path.join(r.chrome.dataDir, ".dashboard-owner.json"))).toBe(true);
    r.children[0].exit(137, "SIGKILL"); // user quit / crash
    await flush();
    expect(client.closed.length).toBeGreaterThan(0);
    expect(r.audit.list().some((e) => e.kind === "detach" && e.detail === "closed:chrome-exited" && e.profileDirectory === "@dedicated")).toBe(true);
    expect(r.chrome.state()).toBe("stopped");
    expect(fs.existsSync(path.join(r.chrome.dataDir, ".dashboard-owner.json"))).toBe(false);
    expect(r.manager.instancesOn("dashboard", "@dedicated")).toHaveLength(0);
    expect((await r.manager.connectDedicated()).ok).toBe(true);
    expect(r.spawn).toHaveBeenCalledTimes(2);
  });
});

describe("#R10 graceful shutdown (dedicated/stop)", () => {
  it("Chrome ignores Browser.close → killProcessGroup at 5 s, not before", async () => {
    vi.useFakeTimers();
    const r = rig({ behavior: { ignoreClose: true } });
    await connected(r);
    const stop = r.manager.stopDedicated();
    await vi.advanceTimersByTimeAsync(4999);
    expect(r.children[0].methods()).toContain("Browser.close");
    expect(r.killProcessGroup).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await stop;
    expect(r.killProcessGroup).toHaveBeenCalledWith(7000);
    expect(r.chrome.state()).toBe("stopped");
    expect(r.manager.instancesOn("dashboard", "@dedicated")).toHaveLength(0);
  });
});

describe("#R11 client lifecycle", () => {
  it("(a) no client within 30 s → detach no-cdp-client, instance gone, Chrome keeps running", async () => {
    vi.useFakeTimers();
    const r = rig();
    const res = await connected(r);
    await vi.advanceTimersByTimeAsync(29_999);
    expect(r.manager.find(res.instanceId)).toBeDefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(r.manager.find(res.instanceId)).toBeUndefined();
    expect(r.audit.list().filter((e) => e.kind === "detach").map((e) => e.detail)).toEqual(["no-cdp-client"]);
    expect(r.chrome.state()).toBe("running");
  });

  it("an attached client cancels the no-client outcome", async () => {
    vi.useFakeTimers();
    const r = rig();
    const res = await connected(r);
    r.dial(res.cdpUrl);
    await vi.advanceTimersByTimeAsync(31_000);
    expect(r.manager.find(res.instanceId)).toBeDefined();
    expect(r.audit.list().filter((e) => e.kind === "detach")).toEqual([]);
  });

  it("(b) client creates 2 tabs then closes → Target.closeTarget for both, instance gone, Chrome running, next connect 200", async () => {
    const r = rig();
    const res = await connected(r);
    const client = r.dial(res.cdpUrl);
    await flush();
    const child = r.children[0];
    for (const [n, targetId] of [[1, "T-a"], [2, "T-b"]] as const) {
      client.send(JSON.stringify({ id: n, method: "Target.createTarget", params: { url: "about:blank" } }));
      await flush();
      answer(child, "Target.createTarget", { targetId });
      await flush();
    }
    client.close(1000, "done");
    await flush();
    const closed = child.written.filter((m) => m.method === "Target.closeTarget").map((m) => m.params?.targetId);
    expect(closed.sort()).toEqual(["T-a", "T-b"]);
    expect(r.manager.find(res.instanceId)).toBeUndefined();
    expect(r.chrome.state()).toBe("running");
    expect((await r.manager.connectDedicated()).ok).toBe(true);
    expect(r.spawn).toHaveBeenCalledTimes(1);
  });
});

describe("#R13 reset", () => {
  it("409 and the directory unchanged while Chrome runs; 200 and removed once stopped (state not-created)", async () => {
    const r = rig();
    await connected(r);
    const marker = path.join(r.chrome.dataDir, "Default", "marker");
    fs.mkdirSync(path.dirname(marker), { recursive: true });
    fs.writeFileSync(marker, "x");
    expect(await r.manager.resetDedicated()).toMatchObject({ ok: false, status: 409, reason: "not-stopped" });
    expect(fs.existsSync(marker)).toBe(true);
    await r.manager.stopDedicated();
    expect(r.chrome.state()).toBe("stopped");
    expect(await r.manager.resetDedicated()).toEqual({ ok: true });
    expect(fs.existsSync(r.chrome.dataDir)).toBe(false);
    expect(r.chrome.state()).toBe("not-created");
  });
});

describe("#R17 disconnect (manager half)", () => {
  it("disconnect(instanceId) closes the dedicated instance and leaves Chrome running", async () => {
    const r = rig();
    const res = await connected(r);
    expect(r.manager.disconnect(res.instanceId)).toBe(true);
    expect(r.manager.find(res.instanceId)).toBeUndefined();
    expect(r.chrome.state()).toBe("running");
    expect(r.closedInstances).toContain(res.instanceId);
  });
});

describe("dedicated/open", () => {
  it("opens a hidden tab with ONE open audit row and stamps lastUsed (no live instance)", async () => {
    const r = rig();
    const p = r.manager.openDedicated("https://accounts.google.com/x?authuser=1");
    await vi.waitFor(() => expect(r.children[0]?.methods()).toContain("Target.createTarget"));
    answer(r.children[0], "Target.createTarget", { targetId: "T1" });
    expect(await p).toEqual({ ok: true, targetId: "T1" });
    const opens = r.audit.list().filter((e) => e.kind === "open");
    expect(opens).toHaveLength(1);
    expect(opens[0]).toMatchObject({ profileDirectory: "@dedicated", detail: "https://accounts.google.com/x" }); // query stripped by the ring
    expect(r.chrome.lastUsed).toBeDefined();
  });

  it("with a live instance the open goes through it and is still audited exactly once", async () => {
    const r = rig();
    await connected(r);
    const p = r.manager.openDedicated("https://accounts.google.com/");
    await vi.waitFor(() => expect(r.children[0]?.methods()).toContain("Target.createTarget"));
    answer(r.children[0], "Target.createTarget", { targetId: "T2" });
    expect(await p).toMatchObject({ ok: true, targetId: "T2" });
    expect(r.audit.list().filter((e) => e.kind === "open")).toHaveLength(1);
  });

  it.each(["http://a.test/", "javascript:alert(1)", "chrome://settings", "not a url"])("refuses %s with 400 and writes nothing to the pipe", async (url) => {
    const r = rig();
    expect(await r.manager.openDedicated(url)).toMatchObject({ ok: false, status: 400, reason: "url-denied" });
    expect(r.spawn).not.toHaveBeenCalled();
  });

  it("honours the global allowed domains", async () => {
    const r = rig({ config: { enabled: true, allowedDomains: ["google.com"] } });
    expect(await r.manager.openDedicated("https://evil.test/")).toMatchObject({ ok: false, status: 400 });
    expect(r.spawn).not.toHaveBeenCalled();
  });

  it("is 403 while disabled and 503 while unavailable", async () => {
    expect(await rig({ config: { enabled: false } }).manager.openDedicated("https://accounts.google.com/")).toMatchObject({ status: 403 });
    expect(await rig({ available: { available: false, reason: "no-display" } }).manager.openDedicated("https://accounts.google.com/")).toMatchObject({ status: 503, reason: "no-display" });
  });
});

describe("dedicatedStatus", () => {
  it("reports not-created → stopped → running with holder and instanceId", async () => {
    const r = rig();
    expect(await r.manager.dedicatedStatus()).toMatchObject({ available: true, state: "not-created", dataDir: r.chrome.dataDir, downloadsDir: r.chrome.downloadsDir });
    const res = await connected(r, { client: "gmail-setup" });
    const s = await r.manager.dedicatedStatus();
    expect(s).toMatchObject({ state: "running", instanceId: res.instanceId, holder: { client: "gmail-setup" } });
    await r.manager.stopDedicated();
    const stopped = await r.manager.dedicatedStatus();
    expect(stopped?.state).toBe("stopped");
    expect(stopped?.instanceId).toBeUndefined();
  });
});

describe("browser_relay_status", () => {
  it("lists the live dedicated instance as @dedicated with its visible tabs only (a hidden sign-in tab is excluded)", async () => {
    const r = rig();
    const res = await connected(r);
    const client = r.dial(res.cdpUrl);
    await flush();
    const child = r.children[0];
    const open = r.manager.openDedicated("https://accounts.google.com/");
    await vi.waitFor(() => expect(child.methods()).toContain("Target.createTarget"));
    const page = (targetId: string, url: string) => ({
      method: "Target.targetCreated",
      params: { targetInfo: { targetId, type: "page", title: "", url, attached: false, canAccessOpener: false } },
    });
    child.emitFrame(page("T-hidden", "https://accounts.google.com/")); // announced BEFORE the create reply, like Chrome
    answer(child, "Target.createTarget", { targetId: "T-hidden" });
    await open;
    child.emitFrame(page("T-visible", "https://example.com/"));
    await flush();
    const status = new BrowserRelayStatus({ manager: r.manager, audit: r.audit, broadcast: () => {}, logger: silent });
    const inst = status.message().instances.find((i) => i.profileDirectory === "@dedicated");
    expect(inst).toMatchObject({ instanceId: res.instanceId, host: "dashboard", state: "connected" });
    expect(inst?.tabs.map((t) => t.url)).toEqual(["https://example.com/"]);
    status.dispose();
    expect(client.closed).toEqual([]);
  });
});

describe("live view hook", () => {
  it("an agent-created tab reaches onAgentTabCreated; a hidden sign-in tab never does", async () => {
    const seen: Array<[string, number]> = [];
    const r = rig({ onAgentTabCreated: (id, tab) => seen.push([id, tab]) });
    const res = await connected(r);
    const client = r.dial(res.cdpUrl);
    await flush();
    const child = r.children[0];
    // hidden sign-in tab
    const open = r.manager.openDedicated("https://accounts.google.com/");
    await vi.waitFor(() => expect(child.methods()).toContain("Target.createTarget"));
    answer(child, "Target.createTarget", { targetId: "T-hidden" });
    await open;
    expect(seen).toEqual([]);
    // agent tab: Chrome announces the target, then answers createTarget
    client.send(JSON.stringify({ id: 1, method: "Target.createTarget", params: { url: "about:blank" } }));
    await flush();
    child.emitFrame({
      method: "Target.targetCreated",
      params: { targetInfo: { targetId: "T-agent", type: "page", title: "", url: "about:blank", attached: false, canAccessOpener: false } },
    });
    await flush();
    answer(child, "Target.createTarget", { targetId: "T-agent" });
    await flush();
    expect(seen).toEqual([[res.instanceId, 1]]);
  });
});

describe("#R14 atomic takeover (change: add-gmail-auto-setup)", () => {
  it("an agent reconnect fired by the holder's close gets busy: the consumer holds the profile", async () => {
    let agentId = "";
    let reconnect: ReturnType<DedicatedRig["manager"]["connectDedicated"]> | undefined;
    let liveInWindow: unknown = "unset";
    const r = rig({
      onInstanceClosed: (id) => {
        if (id !== agentId) return;
        liveInWindow = r.manager.liveDedicated(); // the window between the holder's close and the new registration
        reconnect = r.manager.connectDedicated({ holder: { sessionId: "agent-1" } });
      },
    });
    const agent = await r.manager.connectDedicated({ holder: { sessionId: "agent-1" } });
    if (!agent.ok) throw new Error("agent connect failed");
    agentId = agent.instanceId;
    const agentClient = r.dial(agent.cdpUrl);
    await flush();

    const consumer = await r.manager.connectDedicated({ client: "gmail-setup", takeover: true });
    if (!consumer.ok) throw new Error(`takeover failed: ${JSON.stringify(consumer)}`);

    expect(reconnect).toBeDefined(); // the holder's close really fired the agent's reconnect
    expect(liveInWindow).toBeUndefined(); // ...while the slot looked free
    expect(await reconnect).toEqual({ ok: false, status: 409, reason: "busy", instanceId: consumer.instanceId, holder: "gmail-setup" });
    expect(r.manager.liveDedicated()?.instanceId).toBe(consumer.instanceId);
    expect(r.manager.instancesOn("dashboard", "@dedicated")).toHaveLength(1);
    expect(r.manager.find(agent.instanceId)).toBeUndefined();
    expect(agentClient.closed[0]?.reason).toBe("takeover"); // the evicted agent's socket was closed
    expect(r.audit.list().some((e) => e.kind === "detach" && e.detail === "takeover" && e.instanceId === agent.instanceId)).toBe(true);
    expect(await r.manager.dedicatedStatus()).toMatchObject({ instanceId: consumer.instanceId, holder: { client: "gmail-setup" } });
  });

  it("takeover on a free profile just connects; without takeover a busy profile is untouched", async () => {
    const r = rig();
    const first = await r.manager.connectDedicated({ client: "gmail-setup", takeover: true });
    expect(first.ok).toBe(true);
    const refused = await r.manager.connectDedicated({ holder: { sessionId: "agent-1" } });
    expect(refused).toMatchObject({ ok: false, status: 409, reason: "busy", holder: "gmail-setup" });
    expect(first.ok && r.manager.find(first.instanceId)).toBeTruthy();
  });
});

describe("private + ephemeral connect options (change: add-gmail-auto-setup)", () => {
  const tab = (targetId: string, url: string, browserContextId: string) => ({
    method: "Target.targetCreated",
    params: { targetInfo: { targetId, type: "page", title: "", url, attached: false, canAccessOpener: false, browserContextId } },
  });

  it("#R15 a private instance's tab is absent from browser_relay_status; viewer subscribe is refused and audited", async () => {
    const r = rig();
    const res = await connected(r, { client: "gmail-setup" });
    // the default (not private) instance would list this tab: prove it via a control instance first
    r.dial(res.cdpUrl);
    await flush();
    r.children[0].emitFrame(tab("T-control", "https://example.com/", "ctx-default"));
    await flush();
    const status = new BrowserRelayStatus({ manager: r.manager, audit: r.audit, broadcast: () => {}, logger: silent });
    expect(status.message().instances[0].tabs.map((t) => t.url)).toContain("https://example.com/");
    r.manager.disconnect(res.instanceId);

    const priv = await r.manager.connectDedicated({ client: "gmail-setup", private: true });
    if (!priv.ok) throw new Error("private connect failed");
    r.dial(priv.cdpUrl);
    await flush();
    r.children[0].emitFrame(tab("T-private", "https://accounts.google.com/", "ctx-default"));
    await flush();
    const inst = status.message().instances.find((i) => i.instanceId === priv.instanceId);
    expect(inst).toMatchObject({ profileDirectory: "@dedicated", state: "connected", tabs: [] });

    const handlers = new Map<string, (msg: unknown, ws: unknown) => void>();
    status.registerHandlers({ registerBrowserHandler: (type: string, h: (msg: unknown, ws: unknown) => void) => handlers.set(type, h) } as never);
    const viewer = viewerSocket();
    handlers.get("browser_relay_subscribe")?.({ instanceId: priv.instanceId, tabId: 1 }, viewer);
    const refused = r.audit.list().filter((e) => e.kind === "viewer-subscribe-refused");
    expect(refused).toHaveLength(1);
    expect(refused[0]).toMatchObject({ instanceId: priv.instanceId, profileDirectory: "@dedicated" });
    expect(r.children[0].methods()).not.toContain("Page.startScreencast");
    status.dispose();
  });

  it("an ephemeral connect creates a server-side context with the downloads dir, and disposes it when the instance closes", async () => {
    const r = rig({ behavior: { autoContexts: true } });
    const res = await connected(r, { client: "gmail-setup", ephemeral: true });
    const child = r.children[0];
    const created = child.written.filter((m) => m.method === "Target.createBrowserContext");
    expect(created).toHaveLength(1);
    expect(child.written.find((m) => m.method === "Browser.setDownloadBehavior" && m.params?.browserContextId === "ctx-1")?.params).toEqual({
      behavior: "allow",
      downloadPath: r.chrome.downloadsDir,
      browserContextId: "ctx-1",
    });
    // a client createTarget through the minted cdpUrl is pinned into that context
    const client = r.dial(res.cdpUrl);
    await flush();
    client.send(JSON.stringify({ id: 1, method: "Target.createTarget", params: { url: "https://a.test/" } }));
    await flush();
    expect(child.written.filter((m) => m.method === "Target.createTarget").at(-1)?.params?.browserContextId).toBe("ctx-1");

    expect(child.written.some((m) => m.method === "Target.disposeBrowserContext")).toBe(false);
    r.manager.disconnect(res.instanceId);
    expect(child.written.filter((m) => m.method === "Target.disposeBrowserContext").map((m) => m.params)).toEqual([{ browserContextId: "ctx-1" }]);
  });

  it("a busy refusal creates no context", async () => {
    const r = rig({ behavior: { autoContexts: true } });
    await connected(r, { client: "first" });
    expect(await r.manager.connectDedicated({ client: "second", ephemeral: true })).toMatchObject({ ok: false, reason: "busy" });
    expect(r.children[0].methods()).not.toContain("Target.createBrowserContext");
  });

  it("open({instanceId}) opens the hidden tab in that instance's context; an unknown instance is refused without launching", async () => {
    const cold = rig();
    expect(await cold.manager.openDedicated("https://accounts.google.com/", "inst-nope")).toMatchObject({ ok: false, status: 409, reason: "unknown-instance" });
    expect(cold.spawn).not.toHaveBeenCalled();

    const r = rig({ behavior: { autoContexts: true } });
    const res = await connected(r, { client: "gmail-setup", ephemeral: true });
    expect(await r.manager.openDedicated("https://accounts.google.com/", "inst-nope")).toMatchObject({ ok: false, reason: "unknown-instance" });
    const child = r.children[0];
    const open = r.manager.openDedicated("https://accounts.google.com/", res.instanceId);
    await vi.waitFor(() => expect(child.methods()).toContain("Target.createTarget"));
    expect(child.written.find((m) => m.method === "Target.createTarget")?.params).toEqual({ url: "https://accounts.google.com/", browserContextId: "ctx-1" });
    answer(child, "Target.createTarget", { targetId: "T-eph" });
    expect(await open).toEqual({ ok: true, targetId: "T-eph" });
  });
});
