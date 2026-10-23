/**
 * `browser.dedicated` service over a real `RelayManager` + `DedicatedChrome` (fake spawn)
 * (change: add-gmail-auto-setup, task 1.1 / 1.3; test-plan #E12 #E13).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDedicatedService } from "../dedicated-service.js";
import { answer, type DedicatedRig, type DedicatedRigOptions, flush, makeDedicatedRig } from "./dedicated-manager-rig.js";

const rigs: DedicatedRig[] = [];
function setup(opts: DedicatedRigOptions = {}) {
  const r = makeDedicatedRig(opts);
  rigs.push(r);
  return { r, service: createDedicatedService(r.manager) };
}
afterEach(() => {
  for (const r of rigs.splice(0)) r.cleanup();
});

const GUID_URL = /^ws:\/\/127\.0\.0\.1:8123\/ws\/browser-cdp\/[0-9a-f]{32}\?ticket=[A-Za-z0-9_-]{43}$/;
const SIGN_IN = "https://accounts.google.com/x?y";

describe("#E12 connect decision table", () => {
  it("(loaded, kill switch on, free) → {cdpUrl, instanceId} and the holder is gmail-setup", async () => {
    const { r, service } = setup();
    const res = await service.connect({ client: "gmail-setup" });
    if (!res.ok) throw new Error(`connect failed: ${JSON.stringify(res)}`);
    expect(res.cdpUrl).toMatch(GUID_URL);
    expect(res.instanceId).toMatch(/^inst-[0-9a-f]+$/);
    expect(await service.status()).toMatchObject({
      enabled: true,
      available: true,
      downloadsDir: r.chrome.downloadsDir,
      instanceId: res.instanceId,
      holder: { client: "gmail-setup" },
    });
  });

  it("(on, busy) → {409, busy, holder, instanceId}", async () => {
    const { r, service } = setup();
    const agent = await r.manager.connectDedicated({ holder: { sessionId: "sess-1" } });
    if (!agent.ok) throw new Error("agent connect failed");
    expect(await service.connect({ client: "gmail-setup" })).toEqual({
      ok: false,
      status: 409,
      reason: "busy",
      holder: "sess-1",
      instanceId: agent.instanceId,
    });
  });

  it("(kill switch off) → {403, disabled} and nothing is launched", async () => {
    const { r, service } = setup({ config: { enabled: false } });
    expect(await service.connect({ client: "gmail-setup" })).toMatchObject({ ok: false, status: 403, reason: "disabled" });
    expect(r.spawn).not.toHaveBeenCalled();
    expect(await service.status()).toMatchObject({ enabled: false });
    expect(await service.open({ url: SIGN_IN })).toMatchObject({ ok: false, status: 403, reason: "disabled" });
    expect(await service.focus("T1")).toMatchObject({ ok: false, status: 403, reason: "disabled" });
    expect(r.spawn).not.toHaveBeenCalled();
  });

  it("(plugin stopped) → {503, unloaded} from every method; the live instance is not touched by them", async () => {
    const { r, service } = setup();
    const res = await service.connect({ client: "gmail-setup" });
    if (!res.ok) throw new Error("connect failed");
    service.unload();
    const unloaded = { ok: false, status: 503, reason: "unloaded" };
    expect(await service.connect({ client: "gmail-setup" })).toEqual(unloaded);
    expect(await service.open({ url: SIGN_IN })).toEqual(unloaded);
    expect(await service.focus("T1")).toEqual(unloaded);
    expect(await service.tabOrigin("T1")).toBeNull();
    expect(await service.status()).toMatchObject({ enabled: false, available: false, reason: "unloaded" });
    await service.disconnect(res.instanceId);
    expect(r.manager.find(res.instanceId)).toBeDefined(); // an unloaded service no longer closes anything
  });

  it("disconnect closes the instance like POST /api/browser/disconnect; Chrome keeps running", async () => {
    const { r, service } = setup();
    const res = await service.connect({ client: "gmail-setup" });
    if (!res.ok) throw new Error("connect failed");
    await service.disconnect(res.instanceId);
    expect(r.manager.find(res.instanceId)).toBeUndefined();
    expect(r.chrome.state()).toBe("running");
  });

  it("forwards takeover / private / ephemeral to the manager", async () => {
    const { r, service } = setup({ behavior: { autoContexts: true } });
    const spy = vi.spyOn(r.manager, "connectDedicated");
    await service.connect({ client: "gmail-setup", takeover: true, private: true, ephemeral: true });
    expect(spy).toHaveBeenCalledWith({ client: "gmail-setup", takeover: true, private: true, ephemeral: true });
    expect(r.children[0].methods()).toContain("Target.createBrowserContext");
  });
});

describe("#E13 open / focus / tabOrigin of a server-owned tab", () => {
  async function openTab() {
    const { r, service } = setup();
    const conn = await service.connect({ client: "gmail-setup" });
    if (!conn.ok) throw new Error("connect failed");
    const child = r.children[0];
    const opened = service.open({ url: SIGN_IN });
    await vi.waitFor(() => expect(child.methods()).toContain("Target.createTarget"));
    answer(child, "Target.createTarget", { targetId: "T-signin" });
    const tab = await opened;
    if (!tab.ok) throw new Error(`open failed: ${JSON.stringify(tab)}`);
    return { r, service, child, tabId: tab.tabId, conn };
  }
  const lastCommand = (child: { written: Array<{ id?: number; method?: string }> }, method: string) =>
    [...child.written].reverse().find((m) => m.method === method);

  it("tabOrigin is the origin only (no path, query); null once the tab is closed", async () => {
    const { service, child, tabId } = await openTab();
    expect(tabId).toBe("T-signin");

    const origin = service.tabOrigin(tabId);
    await vi.waitFor(() => expect(child.methods()).toContain("Target.getTargetInfo"));
    answer(child, "Target.getTargetInfo", { targetInfo: { targetId: tabId, type: "page", url: SIGN_IN } });
    expect(await origin).toBe("https://accounts.google.com");

    // the tab navigates: the CURRENT origin is reported
    const moved = service.tabOrigin(tabId);
    await vi.waitFor(() => expect(child.written.filter((m) => m.method === "Target.getTargetInfo")).toHaveLength(2));
    answer(child, "Target.getTargetInfo", { targetInfo: { targetId: tabId, type: "page", url: "https://console.cloud.google.com/apis?x=1#h" } });
    expect(await moved).toBe("https://console.cloud.google.com");

    // closed: Chrome answers an error for the target
    const gone = service.tabOrigin(tabId);
    await vi.waitFor(() => expect(child.written.filter((m) => m.method === "Target.getTargetInfo")).toHaveLength(3));
    const cmd = lastCommand(child, "Target.getTargetInfo");
    child.emitFrame({ id: cmd?.id, error: { code: -32602, message: "No target with given id found" } });
    expect(await gone).toBeNull();
  });

  it("tabOrigin is null (without asking Chrome) for a tab that was destroyed while an instance watches, and for a foreign tab id", async () => {
    const { r, service, child, tabId, conn } = await openTab();
    r.dial(conn.cdpUrl);
    await flush();
    child.emitFrame({ method: "Target.targetDestroyed", params: { targetId: tabId } });
    await flush();
    const before = child.written.length;
    expect(await service.tabOrigin(tabId)).toBeNull();
    expect(await service.tabOrigin("T-agent-tab")).toBeNull();
    expect(child.written).toHaveLength(before);
  });

  it("tabOrigin is null for about:blank (opaque origin) and when Chrome is not running", async () => {
    const { service, child, tabId, r } = await openTab();
    const blank = service.tabOrigin(tabId);
    await vi.waitFor(() => expect(child.methods()).toContain("Target.getTargetInfo"));
    answer(child, "Target.getTargetInfo", { targetInfo: { targetId: tabId, type: "page", url: "about:blank" } });
    expect(await blank).toBeNull();
    await r.manager.stopDedicated();
    expect(await service.tabOrigin(tabId)).toBeNull();
  });

  it("focus activates a server-owned tab and refuses any other id", async () => {
    const { service, child, tabId } = await openTab();
    const focused = service.focus(tabId);
    await vi.waitFor(() => expect(child.methods()).toContain("Target.activateTarget"));
    expect(child.written.find((m) => m.method === "Target.activateTarget")?.params).toEqual({ targetId: tabId });
    answer(child, "Target.activateTarget", {});
    expect(await focused).toEqual({ ok: true });

    const before = child.written.length;
    expect(await service.focus("T-agent-tab")).toEqual({ ok: false, status: 404, reason: "unknown-tab" });
    expect(child.written).toHaveLength(before);
  });

  it("open refuses a non-https url or a host outside the allowed domains (400 url-denied)", async () => {
    const { r, service } = setup({ config: { enabled: true, browsers: {}, allowedDomains: ["accounts.google.com"] } });
    expect(await service.open({ url: "http://accounts.google.com/" })).toMatchObject({ ok: false, status: 400, reason: "url-denied" });
    expect(await service.open({ url: "https://evil.test/" })).toMatchObject({ ok: false, status: 400, reason: "url-denied" });
    expect(r.spawn).not.toHaveBeenCalled();
  });

  it("open({instanceId}) of an unknown instance is a refusal value, not a throw", async () => {
    const { service } = setup();
    expect(await service.open({ url: SIGN_IN, instanceId: "inst-nope" })).toEqual({ ok: false, status: 409, reason: "unknown-instance" });
  });
});
