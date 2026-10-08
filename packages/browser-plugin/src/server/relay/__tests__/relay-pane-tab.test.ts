/**
 * Relay fixes for the editor-pane browser tab (change: add-browser-editor-pane-tab):
 * discovery shim (#X3), connect-page refusal (#X4), unservable verb code (#X5),
 * viewer-facing redaction (#X6), ack-and-drop (#X7), emulation ownership +
 * resize (#E5 #E6 #X10), tab metadata sources (#X11, #P1).
 */
import { describe, expect, it, vi } from "vitest";
import { AuditRing } from "../../audit.js";
import { PLAYWRIGHT_EXTENSION_ID } from "../../connect.js";
import { RelayInstance } from "../relay-instance.js";
import { buildViewerInputCommands } from "../viewer-input.js";
import { FakeExtension, type FakeSocket, flush, socketPair, viewerSocket } from "./fake-socket.js";

const silentLogger = { info: () => {}, warn: () => {}, error: () => {} };
const CONNECT_URL = `chrome-extension://${PLAYWRIGHT_EXTENSION_ID}/connect.html?mcpRelayUrl=ws%3A%2F%2F127.0.0.1%3A8000%2Fws%2Fbrowser%2FSECRETGUID&token=SECRETTOKEN&client=x`;

type Tab = { id: number; title: string; url: string };

async function boot(tabs: Tab[] = [{ id: 7, title: "A", url: "https://a.test/" }], autoAttach = true) {
  const audit = new AuditRing();
  const closed: string[] = [];
  const onStatusChange = vi.fn();
  const onTabMetaChange = vi.fn();
  const instance = new RelayInstance({
    instanceId: "inst-1",
    profileDirectory: "Default",
    allowedDomains: [],
    audit,
    logger: silentLogger,
    onClosed: (r) => closed.push(r),
    onStatusChange,
    onTabMetaChange,
  });
  const [relayExt, extSide] = socketPair();
  instance.attachExtension(relayExt);
  const ext = new FakeExtension(extSide, tabs);
  const [relayCdp, cdpSide] = socketPair();
  instance.attachCdp(relayCdp);
  ext.initialize();
  await flush();
  await instance.waitForHandshake();
  if (autoAttach) {
    cdpSide.send(JSON.stringify({ id: 1, method: "Target.setAutoAttach", params: { autoAttach: true } }));
    await flush();
  }
  return { instance, audit, ext, cdpSide, closed, tabs, onStatusChange, onTabMetaChange };
}

const send = (s: FakeSocket, id: number, method: string, params: unknown = {}, sessionId?: string) =>
  s.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
const events = (s: FakeSocket, method: string) => s.receivedJson().filter((m) => m.method === method);
const response = (s: FakeSocket, id: number) => s.receivedJson().find((m) => m.id === id && m.method === undefined);

describe("#X3 Target.setDiscoverTargets shim", () => {
  it("answers {} with no attached tab and keeps the instance open", async () => {
    const h = await boot([{ id: 7, title: "A", url: "https://a.test/" }], false);
    send(h.cdpSide, 2, "Target.setDiscoverTargets", { discover: true });
    await flush();
    expect(response(h.cdpSide, 2)?.result).toEqual({});
    expect(response(h.cdpSide, 2)?.error).toBeUndefined();
    expect(h.instance.isClosed).toBe(false);
    expect(events(h.cdpSide, "Target.targetCreated")).toHaveLength(0);
  });

  it("enabling after auto-attach announces each attached tab exactly once", async () => {
    const h = await boot();
    send(h.cdpSide, 2, "Target.setDiscoverTargets", { discover: true });
    send(h.cdpSide, 3, "Target.setDiscoverTargets", { discover: true });
    await flush();
    const created = events(h.cdpSide, "Target.targetCreated");
    expect(created).toHaveLength(1);
    expect((created[0].params as { targetInfo: { targetId: string; url: string } }).targetInfo).toMatchObject({ targetId: "target-7", url: "https://a.test/" });
  });

  it("enabling BEFORE attach mirrors the attach as targetCreated (once); detach → targetDestroyed", async () => {
    const h = await boot([{ id: 7, title: "A", url: "https://a.test/" }, { id: 9, title: "B", url: "https://b.test/" }], false);
    send(h.cdpSide, 2, "Target.setDiscoverTargets", { discover: true });
    send(h.cdpSide, 3, "Target.setAutoAttach", { autoAttach: true });
    await flush();
    expect(events(h.cdpSide, "Target.targetCreated")).toHaveLength(2);
    h.ext.tabRemoved(7); // (the last tab closing would end the instance)
    await flush();
    expect(events(h.cdpSide, "Target.targetDestroyed")).toHaveLength(1);
  });

  it("discover:false stops announcements and clears the set", async () => {
    const h = await boot();
    send(h.cdpSide, 2, "Target.setDiscoverTargets", { discover: true });
    await flush();
    send(h.cdpSide, 3, "Target.setDiscoverTargets", { discover: false });
    await flush();
    const before = events(h.cdpSide, "Target.targetCreated").length;
    send(h.cdpSide, 4, "Target.createTarget", { url: "https://a.test/" });
    await flush();
    expect(events(h.cdpSide, "Target.targetCreated")).toHaveLength(before);
  });

  it("never announces child sessions", async () => {
    const h = await boot();
    send(h.cdpSide, 2, "Target.setDiscoverTargets", { discover: true });
    await flush();
    h.ext.emitChromeEvent(7, "Target.attachedToTarget", { sessionId: "child-1", targetInfo: { targetId: "w1", url: "https://a.test/w.js", type: "worker" } });
    await flush();
    expect(events(h.cdpSide, "Target.targetCreated")).toHaveLength(1);
  });
});

describe("#X5 unservable browser-level command", () => {
  it("replies with code -32000 and stays open", async () => {
    const h = await boot([{ id: 7, title: "A", url: "https://a.test/" }], false);
    send(h.cdpSide, 2, "Browser.getWindowForTarget", {});
    await flush();
    expect((response(h.cdpSide, 2)?.error as { code?: number })?.code).toBe(-32000);
    expect(h.instance.isClosed).toBe(false);
  });
});

describe("#X7 ack-and-drop + #E11 audit kinds", () => {
  it("Browser.setDownloadBehavior → {} , not forwarded, audited `dropped`; cookies still `denied`", async () => {
    const h = await boot();
    const before = h.ext.cdpCommands.length;
    send(h.cdpSide, 2, "Browser.setDownloadBehavior", { behavior: "deny" });
    send(h.cdpSide, 3, "Network.getAllCookies", {});
    await flush();
    expect(response(h.cdpSide, 2)?.result).toEqual({});
    expect(response(h.cdpSide, 3)?.error).toBeDefined();
    expect(h.ext.cdpCommands.slice(before).map((c) => c.method)).not.toContain("Browser.setDownloadBehavior");
    const kinds = h.audit.list().map((e) => `${e.kind}:${e.detail}`);
    expect(kinds).toContain("dropped:Browser.setDownloadBehavior");
    expect(kinds).toContain("denied:Network.getAllCookies");
  });
});

describe("#X4 / #X6 connect page", () => {
  const tabs = (): Tab[] => [
    { id: 7, title: "A", url: "https://a.test/" },
    { id: 8, title: "Connect", url: CONNECT_URL },
    { id: 9, title: "Ext", url: "chrome-extension://otherext/page.html?x=1#frag" },
  ];

  it("omits the connect page from tabList and redacts other extension URLs", async () => {
    const h = await boot(tabs());
    const list = h.instance.tabList();
    expect(list.map((t) => t.tabId)).toEqual([7, 9]);
    expect(JSON.stringify(list)).not.toMatch(/SECRET|token=|mcpRelayUrl/);
    expect(list.find((t) => t.tabId === 9)?.url).toBe("chrome-extension://otherext/page.html");
  });

  it("an instance with only the connect page lists no tabs", async () => {
    const h = await boot([{ id: 8, title: "Connect", url: CONNECT_URL }]);
    expect(h.instance.tabList()).toEqual([]);
  });

  it("refuses viewer subscribe/input to it: no screencast, audited extension-page", async () => {
    const h = await boot(tabs());
    const before = h.ext.cdpCommands.length;
    const v = viewerSocket();
    expect(h.instance.subscribe(v, 8).ok).toBe(false);
    await h.instance.input(v, 8, { kind: "key", key: "a" });
    await flush();
    expect(h.ext.cdpCommands.slice(before).map((c) => c.method)).not.toContain("Page.startScreencast");
    const refused = h.audit.list().filter((e) => e.kind === "viewer-subscribe-refused");
    expect(refused.length).toBe(2);
    expect(refused.map((e) => e.detail).sort()).toEqual(["tab:8 reason:extension-page", "tab:8 reason:extension-page via:input"]);
    expect(JSON.stringify(h.audit.list())).not.toMatch(/SECRET/);
  });

  it("never announces/attaches the connect page on the CDP path and fails commands to its session", async () => {
    const h = await boot(tabs());
    const attached = events(h.cdpSide, "Target.attachedToTarget");
    expect(JSON.stringify(attached)).not.toMatch(/SECRET|connect\.html/);
    send(h.cdpSide, 2, "Target.setDiscoverTargets", { discover: true });
    await flush();
    expect(JSON.stringify(events(h.cdpSide, "Target.targetCreated"))).not.toMatch(/SECRET|connect\.html/);
    // pw-tab-2 is the connect page (second attached tab)
    send(h.cdpSide, 3, "Runtime.evaluate", { expression: "1" }, "pw-tab-2");
    await flush();
    expect((response(h.cdpSide, 3)?.error as { code?: number })?.code).toBe(-32000);
    expect(h.ext.cdpCommands.some((c) => c.method === "Runtime.evaluate")).toBe(false);
  });

  it("audit detail of a navigated extension URL is query-stripped", async () => {
    const h = await boot();
    h.audit.append({ profileDirectory: "Default", instanceId: "inst-1", kind: "navigate", detail: CONNECT_URL });
    expect(JSON.stringify(h.audit.list())).not.toMatch(/SECRET/);
  });
});

describe("#E5 / #E6 resize mapping (BVA)", () => {
  const cmd = (w: unknown, hgt: unknown) => buildViewerInputCommands({ kind: "resize", width: w, height: hgt }, undefined);
  it.each([
    [319, 239, 320, 240],
    [320, 240, 320, 240],
    [3840, 2160, 3840, 2160],
    [3841, 2161, 3840, 2160],
    [800.6, 600.4, 801, 600],
  ])("%s×%s → %s×%s", (w, hgt, ew, eh) => {
    const r = cmd(w, hgt);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.commands).toEqual([{ method: "Emulation.setDeviceMetricsOverride", params: { width: ew, height: eh, deviceScaleFactor: 0, mobile: false } }]);
  });
  it.each([["800", 600], [800, undefined], [Number.NaN, 5], [Infinity, 5]])("refuses non-numeric %j/%j", (w, hgt) => {
    expect(cmd(w, hgt).ok).toBe(false);
  });
});

describe("#X10 emulation ownership", () => {
  it("viewer resize applies; refused while the agent holds an override; allowed after clear; status flag follows", async () => {
    const h = await boot();
    const v = viewerSocket();
    expect(h.instance.subscribe(v, 7).ok).toBe(true);
    await flush();
    const methods = () => h.ext.cdpCommands.map((c) => c.method);

    await h.instance.input(v, 7, { kind: "resize", width: 800, height: 600 });
    expect(methods().filter((m) => m === "Emulation.setDeviceMetricsOverride")).toHaveLength(1);

    send(h.cdpSide, 5, "Emulation.setDeviceMetricsOverride", { width: 1, height: 1, deviceScaleFactor: 1, mobile: false }, "pw-tab-1");
    await flush();
    expect(h.instance.tabList()[0].agentEmulation).toBe(true);
    const n = methods().filter((m) => m === "Emulation.setDeviceMetricsOverride").length;
    await h.instance.input(v, 7, { kind: "resize", width: 900, height: 700 });
    expect(methods().filter((m) => m === "Emulation.setDeviceMetricsOverride")).toHaveLength(n);
    expect(h.audit.list().some((e) => e.detail === "resize reason:agent-emulation-active")).toBe(true);

    send(h.cdpSide, 6, "Emulation.clearDeviceMetricsOverride", {}, "pw-tab-1");
    await flush();
    expect(h.instance.tabList()[0].agentEmulation).toBeUndefined();
    await h.instance.input(v, 7, { kind: "resize", width: 900, height: 700 });
    expect(methods().filter((m) => m === "Emulation.setDeviceMetricsOverride")).toHaveLength(n + 1);
  });

  it("clears the relay override on last unsubscribe and (best effort) on instance close", async () => {
    const h = await boot();
    const v1 = viewerSocket();
    const v2 = viewerSocket();
    h.instance.subscribe(v1, 7);
    h.instance.subscribe(v2, 7);
    await h.instance.input(v1, 7, { kind: "resize", width: 800, height: 600 });
    const clears = () => h.ext.cdpCommands.filter((c) => c.method === "Emulation.clearDeviceMetricsOverride").length;
    h.instance.unsubscribe(v1, 7);
    await flush();
    expect(clears()).toBe(0); // another viewer remains
    h.instance.unsubscribe(v2, 7);
    await flush();
    expect(clears()).toBe(1);

    h.instance.subscribe(v1, 7);
    await h.instance.input(v1, 7, { kind: "resize", width: 800, height: 600 });
    h.instance.close("test");
    await flush();
    expect(clears()).toBe(2);
  });

  it("no clear is sent when the viewer never resized", async () => {
    const h = await boot();
    const v = viewerSocket();
    h.instance.subscribe(v, 7);
    h.instance.unsubscribe(v, 7);
    await flush();
    expect(h.ext.cdpCommands.some((c) => c.method === "Emulation.clearDeviceMetricsOverride")).toBe(false);
  });
});

describe("#X11 / #P1 tab metadata", () => {
  const nav = (h: Awaited<ReturnType<typeof boot>>, url: string, title: string) => {
    const t = h.tabs.find((x) => x.id === 7)!;
    t.url = url;
    t.title = title;
  };

  it("Page.navigate through the CDP client updates url/title and signals a coalesced change", async () => {
    const h = await boot();
    nav(h, "https://b.test/next", "B");
    send(h.cdpSide, 2, "Page.navigate", { url: "https://b.test/next" }, "pw-tab-1");
    await flush(8);
    expect(h.instance.tabList()[0]).toMatchObject({ url: "https://b.test/next", title: "B" });
    expect(h.onTabMetaChange).toHaveBeenCalled();
  });

  it("a link-click navigation (event only, no CDP command) updates status", async () => {
    const h = await boot();
    nav(h, "https://c.test/", "C");
    h.ext.emitChromeEvent(7, "Page.frameNavigated", { frame: { id: "f", url: "https://c.test/" } });
    await flush(8);
    expect(h.instance.tabList()[0]).toMatchObject({ url: "https://c.test/", title: "C" });
  });

  it("B1: a viewer subscribe refreshes title/url even when no navigation event ever arrived", async () => {
    const h = await boot();
    nav(h, "https://stale-fixed.test/", "Fresh"); // changed with NO Page.* events and NO CDP command
    expect(h.instance.tabList()[0].url).toBe("https://a.test/");
    expect(h.instance.subscribe(viewerSocket(), 7).ok).toBe(true);
    await flush(8);
    expect(h.instance.tabList()[0]).toMatchObject({ url: "https://stale-fixed.test/", title: "Fresh" });
    expect(h.onTabMetaChange).toHaveBeenCalled();
  });

  it("a refused (connect-page) subscribe does not refresh anything", async () => {
    const h = await boot([{ id: 8, title: "Connect", url: CONNECT_URL }]);
    const before = h.ext.cdpCommands.filter((c) => c.method === "Target.getTargetInfo").length;
    h.instance.subscribe(viewerSocket(), 8);
    await flush(4);
    expect(h.ext.cdpCommands.filter((c) => c.method === "Target.getTargetInfo").length).toBe(before);
  });

  it("sub-frame navigations do not trigger a refresh", async () => {
    const h = await boot();
    const before = h.ext.cdpCommands.filter((c) => c.method === "Target.getTargetInfo").length;
    h.ext.emitChromeEvent(7, "Page.frameNavigated", { frame: { id: "g", parentId: "f", url: "https://ad.test/" } });
    await flush(8);
    expect(h.ext.cdpCommands.filter((c) => c.method === "Target.getTargetInfo").length).toBe(before);
  });

  it("refreshes on viewer subscribe path (navigation then load event) and a burst collapses", async () => {
    const h = await boot();
    nav(h, "https://d.test/", "D");
    const before = h.ext.cdpCommands.filter((c) => c.method === "Target.getTargetInfo").length;
    for (let i = 0; i < 20; i++) h.ext.emitChromeEvent(7, "Page.frameNavigated", { frame: { id: "f", url: "https://d.test/" } });
    await flush(12);
    const calls = h.ext.cdpCommands.filter((c) => c.method === "Target.getTargetInfo").length - before;
    expect(calls).toBeLessThanOrEqual(2); // one in flight + at most one re-run
    expect(h.onTabMetaChange).toHaveBeenCalledTimes(1); // only the real change signals
  });

  it("a removed tab leaves no overlay entry and no ghost tab", async () => {
    const h = await boot([
      { id: 7, title: "A", url: "https://a.test/" },
      { id: 9, title: "B", url: "https://b.test/" },
    ]);
    h.ext.emitChromeEvent(9, "Page.loadEventFired", {});
    await flush(8);
    h.ext.tabRemoved(9);
    await flush();
    expect(h.instance.tabList().map((t) => t.tabId)).toEqual([7]);
  });
});
