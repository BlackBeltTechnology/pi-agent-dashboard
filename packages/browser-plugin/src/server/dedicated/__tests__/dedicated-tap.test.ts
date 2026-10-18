/**
 * Numeric tab ids and the screencast-tap adapter over server-owned sessions (task
 * 3.4). See change: add-dedicated-agent-browser.
 */
import { describe, expect, it } from "vitest";
import { viewerSocket } from "../../relay/__tests__/fake-socket.js";
import { makeRig, type Rig } from "./dedicated-rig.js";

const AUTO = { autoAttach: true, waitForDebuggerOnStart: false, flatten: true };

async function visibleTab(rig: Rig, url = "https://a.test/"): Promise<{ targetId: string; tabId: number; clientSession: string }> {
  await rig.client.call("Target.setAutoAttach", AUTO);
  const targetId = rig.pipe.addTarget({ url });
  await rig.pipe.flush();
  return { targetId, tabId: rig.instance.tabIdForTarget(targetId) as number, clientSession: rig.pipe.sessionOf(targetId) as string };
}

const framesOf = (v: ReturnType<typeof viewerSocket>) => v.frames();

describe("numeric tab ids", () => {
  it("are minted from 1, stable per target, never reused, and drive tabList", async () => {
    const rig = await makeRig();
    const a = await visibleTab(rig, "https://a.test/");
    const b = rig.pipe.addTarget({ url: "https://b.test/" });
    await rig.pipe.flush();
    expect(rig.instance.tabIdForTarget("BLANK0")).toBe(1);
    expect(a.tabId).toBe(2);
    expect(rig.instance.tabIdForTarget(b)).toBe(3);
    rig.pipe.closeTarget(a.targetId);
    await rig.pipe.flush();
    const c = rig.pipe.addTarget({ url: "https://c.test/" });
    await rig.pipe.flush();
    expect(rig.instance.tabIdForTarget(c)).toBe(4);
    expect(rig.instance.tabList().map((t) => [t.tabId, t.url])).toEqual([
      [1, "about:blank"],
      [3, "https://b.test/"],
      [4, "https://c.test/"],
    ]);
  });

  it("tab views follow target info changes and report live state", async () => {
    const rig = await makeRig();
    rig.pipe.navigate("BLANK0", "https://x.test/");
    await rig.client.call("Target.setDiscoverTargets", { discover: true });
    await rig.pipe.flush();
    expect(rig.instance.tabList()[0]).toMatchObject({ tabId: 1, url: "https://x.test/", state: "live" });
  });

  it("status is rebroadcast when tabs appear, vanish or change", async () => {
    const rig = await makeRig();
    const before = rig.statusChanges();
    rig.pipe.addTarget({ url: "https://a.test/" });
    await rig.pipe.flush();
    expect(rig.statusChanges()).toBeGreaterThan(before);
  });
});

describe("screencast tap over server-owned sessions", () => {
  it("subscribe attaches a dedicated session, starts the screencast on it, and frames reach the viewer — not the client", async () => {
    const rig = await makeRig();
    const { tabId, targetId, clientSession } = await visibleTab(rig);
    const viewer = viewerSocket();
    expect(rig.instance.subscribe(viewer, tabId)).toEqual({ ok: true });
    await rig.pipe.flush();

    const attach = rig.pipe.commands("Target.attachToTarget").at(-1);
    expect(attach?.params).toEqual({ targetId, flatten: true });
    const tapSession = rig.pipe.commands("Page.startScreencast").at(-1)?.sessionId as string;
    expect(tapSession).toBeDefined();
    expect(tapSession).not.toBe(clientSession);
    expect(rig.pipe.sessionTarget.get(tapSession)).toBe(targetId);
    expect(rig.pipe.screencasting.has(tapSession)).toBe(true);

    rig.client.socket.received.length = 0;
    rig.pipe.emitSession(tapSession, "Page.screencastFrame", { data: "JPEGDATA", sessionId: 7, metadata: { deviceWidth: 1280, deviceHeight: 800, timestamp: 1 } });
    await rig.pipe.flush();

    const frames = framesOf(viewer);
    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({ type: "browser_relay_frame", instanceId: "inst-ded", tabId, jpegBase64: "JPEGDATA" });
    // acked on the tap session, never delivered to the agent
    expect(rig.pipe.commands("Page.screencastFrameAck").at(-1)).toMatchObject({ sessionId: tapSession, params: { sessionId: 7 } });
    expect(rig.client.all()).toHaveLength(0);
    expect(rig.audit.list().some((e) => e.kind === "viewer-subscribe" && e.detail === `tab:${tabId}`)).toBe(true);
  });

  it("attaches once per tab: a second viewer and a re-subscribe reuse the session", async () => {
    const rig = await makeRig();
    const { tabId } = await visibleTab(rig);
    rig.instance.subscribe(viewerSocket(), tabId);
    rig.instance.subscribe(viewerSocket(), tabId);
    await rig.pipe.flush();
    expect(rig.pipe.commands("Target.attachToTarget")).toHaveLength(1);
    expect(rig.pipe.commands("Page.startScreencast")).toHaveLength(1);
  });

  it("tap sessions are not addressable by the client and their events never reach it", async () => {
    const rig = await makeRig();
    const { tabId } = await visibleTab(rig);
    rig.instance.subscribe(viewerSocket(), tabId);
    await rig.pipe.flush();
    const tapSession = rig.pipe.commands("Page.startScreencast").at(-1)?.sessionId as string;
    expect((await rig.client.call("Runtime.evaluate", {}, tapSession)).error).toMatchObject({ code: -32001 });
    expect((await rig.client.call("Target.detachFromTarget", { sessionId: tapSession })).error).toBeDefined();
    rig.client.socket.received.length = 0;
    rig.pipe.emitSession(tapSession, "Page.loadEventFired", {});
    await rig.pipe.flush();
    expect(rig.client.all()).toHaveLength(0);
    // the tap's own attach is not announced to the client
    expect(rig.client.events("Target.attachedToTarget").map((e) => (e.params as { sessionId: string }).sessionId)).not.toContain(tapSession);
  });

  it("unsubscribe stops the screencast on the tap session", async () => {
    const rig = await makeRig();
    const { tabId } = await visibleTab(rig);
    const viewer = viewerSocket();
    rig.instance.subscribe(viewer, tabId);
    await rig.pipe.flush();
    const tapSession = rig.pipe.commands("Page.startScreencast").at(-1)?.sessionId as string;
    rig.instance.unsubscribe(viewer, tabId);
    await rig.pipe.flush();
    expect(rig.pipe.commands("Page.stopScreencast").at(-1)?.sessionId).toBe(tapSession);
    expect(rig.pipe.screencasting.has(tapSession)).toBe(false);
  });

  it("a client-run screencast wins: subscribe is refused and audited", async () => {
    const rig = await makeRig();
    const { tabId, clientSession } = await visibleTab(rig);
    await rig.client.call("Page.startScreencast", {}, clientSession);
    expect(rig.instance.subscribe(viewerSocket(), tabId)).toEqual({ ok: false, state: "client-screencast-active" });
    expect(rig.audit.list().some((e) => e.kind === "viewer-subscribe-refused" && e.detail === `tab:${tabId} reason:client-screencast-active`)).toBe(true);
    expect(rig.instance.tabList().find((t) => t.tabId === tabId)?.state).toBe("client-screencast-active");
    await rig.client.call("Page.stopScreencast", {}, clientSession);
    expect(rig.instance.subscribe(viewerSocket(), tabId).ok).toBe(true);
  });

  it("an agent device-metrics override is reported and blocks viewer resize", async () => {
    const rig = await makeRig();
    const { tabId, clientSession } = await visibleTab(rig);
    await rig.client.call("Emulation.setDeviceMetricsOverride", { width: 800, height: 600, deviceScaleFactor: 1, mobile: false }, clientSession);
    expect(rig.instance.tabList().find((t) => t.tabId === tabId)?.agentEmulation).toBe(true);
    await rig.client.call("Emulation.clearDeviceMetricsOverride", {}, clientSession);
    expect(rig.instance.tabList().find((t) => t.tabId === tabId)?.agentEmulation).toBeUndefined();
  });

  it("viewer input is dispatched on the tap session, audited, and counts as activity", async () => {
    let t = 10;
    const rig = await makeRig({ deps: { now: () => t } });
    const { tabId } = await visibleTab(rig);
    const viewer = viewerSocket();
    rig.instance.subscribe(viewer, tabId);
    await rig.pipe.flush();
    const tapSession = rig.pipe.commands("Page.startScreencast").at(-1)?.sessionId as string;
    t = 5000;
    const touched = rig.pipe.touched;
    await rig.instance.input(viewer, tabId, { kind: "bringToFront" });
    expect(rig.pipe.commands("Page.bringToFront").at(-1)?.sessionId).toBe(tapSession);
    expect(rig.audit.list().some((e) => e.kind === "viewer-input" && e.detail === "bringToFront")).toBe(true);
    expect(rig.instance.lastActivity).toBe(5000);
    expect(rig.pipe.touched).toBe(touched); // lastUsed is for agent commands only
  });

  it("closing the instance stops screencasts and detaches the tap sessions", async () => {
    const rig = await makeRig();
    const { tabId } = await visibleTab(rig);
    rig.instance.subscribe(viewerSocket(), tabId);
    await rig.pipe.flush();
    const tapSession = rig.pipe.commands("Page.startScreencast").at(-1)?.sessionId as string;
    rig.instance.close("done");
    expect(rig.pipe.commands("Page.stopScreencast").at(-1)?.sessionId).toBe(tapSession);
    expect(rig.pipe.commands("Target.detachFromTarget").some((c) => c.params?.sessionId === tapSession)).toBe(true);
  });

  it("a subscribe on a target Chrome has no session for is refused (no-session)", async () => {
    const rig = await makeRig();
    // a target Chrome reports but the server never attached to
    rig.pipe.emit({ method: "Target.targetCreated", params: { targetInfo: { targetId: "LONE", type: "page", title: "", url: "https://lone.test/", attached: false } } });
    await rig.pipe.flush();
    const tabId = rig.instance.tabIdForTarget("LONE") as number;
    expect(rig.instance.subscribe(viewerSocket(), tabId).ok).toBe(false);
    expect(rig.instance.tabList().find((t) => t.tabId === tabId)).toMatchObject({ state: "detached", reason: "no-session" });
  });
});
