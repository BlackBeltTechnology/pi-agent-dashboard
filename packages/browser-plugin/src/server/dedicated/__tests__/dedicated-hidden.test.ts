/**
 * Hidden server-owned targets, proxy-served discovery and auto-attach (tasks
 * 3.3; test-plan #F1 #F2 #F3 #F4 #F5). See change: add-dedicated-agent-browser.
 */
import { describe, expect, it } from "vitest";
import { viewerSocket } from "../../relay/__tests__/fake-socket.js";
import { HiddenTargets, openHiddenTab } from "../hidden-targets.js";
import { makeRig, type Rig } from "./dedicated-rig.js";
import { FakeChromePipe } from "./fake-chrome-pipe.js";

const AUTO = { autoAttach: true, waitForDebuggerOnStart: true, flatten: true };
const wire = (rig: Rig) => rig.client.socket.received.join("\n");
const attachedIds = (rig: Rig) => rig.client.events("Target.attachedToTarget").map((e) => (e.params as { targetInfo: { targetId: string } }).targetInfo.targetId);
const createdIds = (rig: Rig) => rig.client.events("Target.targetCreated").map((e) => (e.params as { targetInfo: { targetId: string } }).targetInfo.targetId);

/** Sign-in tab T1 opened by the server while the client is connected. */
async function withHiddenTab(rig: Rig): Promise<{ targetId: string; sessionId: string }> {
  const { targetId } = await rig.instance.openHiddenTab("https://accounts.google.com/");
  await rig.pipe.flush();
  return { targetId, sessionId: rig.pipe.sessionOf(targetId) as string };
}

describe("openHiddenTab", () => {
  it("creates a server-owned tab, audits open (query stripped) and stamps lastUsed", async () => {
    const rig = await makeRig();
    const touched = rig.pipe.touched;
    const { targetId } = await rig.instance.openHiddenTab("https://accounts.google.com/signin?hl=en#x");
    expect(rig.hidden.isOwned(targetId)).toBe(true);
    expect(rig.audit.list().filter((e) => e.kind === "open").map((e) => e.detail)).toEqual(["https://accounts.google.com/signin"]);
    expect(rig.pipe.touched).toBe(touched + 1);
    expect(rig.pipe.commands("Target.createTarget").at(-1)?.params).toEqual({ url: "https://accounts.google.com/signin?hl=en#x" });
  });

  it("refuses non-https and out-of-list URLs without touching the pipe", async () => {
    const rig = await makeRig({ global: ["github.com"] });
    const before = rig.pipe.written.length;
    for (const url of ["javascript:alert(1)", "chrome://settings", "http://github.com/", "https://example.com/"]) {
      await expect(rig.instance.openHiddenTab(url), url).rejects.toMatchObject({ code: "url-denied" });
    }
    expect(rig.pipe.written.length).toBe(before);
    expect(rig.audit.list().filter((e) => e.kind === "open")).toHaveLength(0);
  });

  it("the new tab is never announced to the client, even though Chrome's attach event precedes the createTarget reply", async () => {
    const rig = await makeRig();
    await rig.client.call("Target.setAutoAttach", AUTO);
    await rig.client.call("Target.setDiscoverTargets", { discover: true });
    rig.client.socket.received.length = 0;
    const { targetId, sessionId } = await withHiddenTab(rig);
    expect(wire(rig)).not.toContain(targetId);
    expect(wire(rig)).not.toContain(sessionId);
    // …and it was resumed, so the sign-in tab is usable
    expect(rig.pipe.resumed.has(sessionId)).toBe(true);
    expect(rig.pipe.waiting.has(sessionId)).toBe(false);
  });

  it("works without an instance (standalone) and a later instance hides the tab", async () => {
    const pipe = new FakeChromePipe();
    const hidden = new HiddenTargets();
    const { targetId } = await openHiddenTab(pipe, hidden, "https://accounts.google.com/");
    expect(hidden.pending).toBe(0);
    const rig = await makeRig({ pipe, hidden });
    await rig.client.call("Target.setAutoAttach", AUTO);
    await rig.client.call("Target.setDiscoverTargets", { discover: true });
    expect(wire(rig)).not.toContain(targetId);
    const targets = (await rig.client.call("Target.getTargets")).result as { targetInfos: Array<{ targetId: string }> };
    expect(targets.targetInfos.map((t) => t.targetId)).toEqual(["BLANK0"]);
  });

  it("a failed create ends the hold window", async () => {
    const pipe = new FakeChromePipe();
    pipe.respond = (cmd) => (cmd.method === "Target.createTarget" ? { error: { message: "boom" } } : undefined);
    const hidden = new HiddenTargets();
    await expect(openHiddenTab(pipe, hidden, "https://a.test/")).rejects.toThrow("boom");
    expect(hidden.pending).toBe(0);
  });

  it("bindChrome clears the registry when Chrome exits", async () => {
    const pipe = new FakeChromePipe();
    const hidden = new HiddenTargets();
    hidden.bindChrome(pipe);
    hidden.addOwned("X");
    pipe.exit();
    expect(hidden.isStickyHidden("X")).toBe(false);
  });
});

describe("#F1 hidden tabs", () => {
  it("getTargets omits T1; getTargetInfo / attachToTarget / sendMessageToTarget answer CDP errors; nothing naming T1 reaches the client", async () => {
    const rig = await makeRig();
    const { targetId, sessionId } = await withHiddenTab(rig);
    const targets = (await rig.client.call("Target.getTargets")).result as { targetInfos: Array<{ targetId: string }> };
    expect(targets.targetInfos.map((t) => t.targetId)).toEqual(["BLANK0"]);

    const info = await rig.client.call("Target.getTargetInfo", { targetId });
    const attach = await rig.client.call("Target.attachToTarget", { targetId, flatten: true });
    const send = await rig.client.call("Target.sendMessageToTarget", { targetId, sessionId, message: "{}" });
    for (const reply of [info, attach, send]) expect(reply.error).toMatchObject({ code: expect.any(Number) });
    expect(wire(rig)).not.toContain(targetId);
    expect(wire(rig)).not.toContain(sessionId);
  });

  it("refuses every method naming the hidden target or session, never writing it to the pipe", async () => {
    const rig = await makeRig();
    const { targetId, sessionId } = await withHiddenTab(rig);
    const before = rig.pipe.written.length;
    const replies = [
      await rig.client.call("Target.activateTarget", { targetId }),
      await rig.client.call("Target.closeTarget", { targetId }),
      await rig.client.call("Browser.getWindowForTarget", { targetId }),
      await rig.client.call("Target.detachFromTarget", { sessionId }),
      await rig.client.call("Runtime.evaluate", { expression: "1" }, sessionId),
      await rig.client.call("Storage.getStorageKeyForFrame", { frameId: targetId }),
    ];
    for (const r of replies) expect(r.error, JSON.stringify(r)).toBeDefined();
    expect(rig.pipe.written.length).toBe(before);
    expect(rig.pipe.targets.has(targetId)).toBe(true);
    // probing a hidden tab is visible in the audit, without its id
    expect(rig.audit.list().some((e) => e.kind === "denied" && e.detail === "Target.closeTarget reason:hidden")).toBe(true);
    expect(JSON.stringify(rig.audit.list())).not.toContain(targetId);
  });

  it("the error for a hidden id is indistinguishable from a nonexistent one", async () => {
    const rig = await makeRig();
    const { targetId } = await withHiddenTab(rig);
    const hiddenReply = await rig.client.call("Target.attachToTarget", { targetId, flatten: true });
    const missing = await rig.client.call("Target.attachToTarget", { targetId: "NOPE", flatten: true });
    expect(hiddenReply.error).toEqual(missing.error);
  });

  it("a session the client was never given (tap, unannounced, made-up) is not addressable", async () => {
    const rig = await makeRig();
    const sid = rig.pipe.sessionOf("BLANK0") as string;
    expect((await rig.client.call("Runtime.evaluate", {}, sid)).error).toMatchObject({ code: -32001 }); // not announced yet
    expect((await rig.client.call("Runtime.evaluate", {}, "made-up")).error).toMatchObject({ code: -32001 });
  });

  it("the instance tab list excludes the hidden tab", async () => {
    const rig = await makeRig();
    const { targetId } = await withHiddenTab(rig);
    expect(rig.instance.tabList().map((t) => t.url)).toEqual(["about:blank"]);
    expect(rig.instance.tabIdForTarget(targetId)).toBeTypeOf("number");
  });
});

describe("#F2 hidden tabs — opener chain and child targets", () => {
  it("popups of a hidden tab and its frames are never announced, and are resumed", async () => {
    const rig = await makeRig();
    const { targetId: t1, sessionId: s1 } = await withHiddenTab(rig);
    await rig.client.call("Target.setAutoAttach", AUTO);
    await rig.client.call("Target.setDiscoverTargets", { discover: true });
    rig.client.socket.received.length = 0;

    const popup = rig.pipe.addTarget({ url: "https://popup.test/", openerId: t1 }); // paused: waitForDebuggerOnStart
    const frameSession = rig.pipe.attachChild(s1, { targetId: "FRAME1" }, true);
    const frameTarget = rig.pipe.addTarget({ type: "iframe", url: "https://frame.test/", parentFrameId: t1 });
    await rig.pipe.flush();

    expect(wire(rig)).not.toContain(popup);
    expect(wire(rig)).not.toContain("FRAME1");
    expect(wire(rig)).not.toContain(frameTarget);
    expect(wire(rig)).not.toContain(frameSession);
    expect(rig.client.events("Target.attachedToTarget")).toHaveLength(0);
    expect(rig.client.events("Target.targetCreated")).toHaveLength(0);

    const resumedFor = rig.pipe.commands("Runtime.runIfWaitingForDebugger").map((c) => c.sessionId);
    expect(resumedFor).toContain(rig.pipe.sessionOf(popup));
    expect(resumedFor).toContain(frameSession);
    expect(resumedFor).toContain(rig.pipe.sessionOf(frameTarget));
    for (const sid of [rig.pipe.sessionOf(popup), frameSession]) expect(rig.pipe.waiting.has(sid as string)).toBe(false);

    // the popup stays hidden even if its opener is gone
    rig.pipe.closeTarget(t1);
    await rig.pipe.flush();
    expect(rig.instance.tabList().map((t) => t.url)).toEqual(["about:blank"]);
    const targets = (await rig.client.call("Target.getTargets")).result as { targetInfos: Array<{ targetId: string }> };
    expect(targets.targetInfos.map((t) => t.targetId)).toEqual(["BLANK0"]);
  });

  it("a popup of a VISIBLE tab is announced normally", async () => {
    const rig = await makeRig();
    await rig.client.call("Target.setAutoAttach", AUTO);
    const popup = rig.pipe.addTarget({ url: "https://popup.test/", openerId: "BLANK0" });
    await rig.pipe.flush();
    expect(attachedIds(rig)).toContain(popup);
  });

  it("child sessions of a visible page are forwarded and addressable; their events flow", async () => {
    const rig = await makeRig();
    await rig.client.call("Target.setAutoAttach", AUTO);
    await rig.pipe.flush();
    const sid = rig.pipe.sessionOf("BLANK0") as string;
    const child = rig.pipe.attachChild(sid, { targetId: "OOPIF1" });
    await rig.pipe.flush();
    const ev = rig.client.events("Target.attachedToTarget").find((e) => (e.params as { sessionId: string }).sessionId === child);
    expect(ev?.sessionId).toBe(sid);
    expect((await rig.client.call("Runtime.evaluate", {}, child)).error).toBeUndefined();
    rig.pipe.emitSession(child, "Page.frameNavigated", {});
    await rig.pipe.flush();
    expect(rig.client.events("Page.frameNavigated")[0].sessionId).toBe(child);
  });
});

describe("#F3 discovery and auto-attach", () => {
  it("attaches V once, announces it once, resumes it only after the client's runIfWaitingForDebugger", async () => {
    const rig = await makeRig();
    await rig.client.call("Target.setAutoAttach", AUTO);
    const { targetId: v } = (await rig.client.call("Target.createTarget", { url: "about:blank" })).result as { targetId: string };
    await rig.pipe.flush();
    const sid = rig.pipe.sessionOf(v) as string;
    await rig.client.call("Target.setDiscoverTargets", { discover: true });
    await rig.pipe.flush();

    expect(attachedIds(rig).filter((id) => id === v)).toHaveLength(1);
    expect(createdIds(rig).filter((id) => id === v)).toHaveLength(1);
    const ev = rig.client.events("Target.attachedToTarget").find((e) => (e.params as { targetInfo: { targetId: string } }).targetInfo.targetId === v);
    expect((ev?.params as { waitingForDebugger: boolean } | undefined)?.waitingForDebugger).toBe(true);
    // not resumed by the proxy
    expect(rig.pipe.waiting.has(sid)).toBe(true);
    expect(rig.pipe.commands("Runtime.runIfWaitingForDebugger").filter((c) => c.sessionId === sid)).toHaveLength(0);

    await rig.client.call("Runtime.runIfWaitingForDebugger", {}, sid);
    expect(rig.pipe.waiting.has(sid)).toBe(false);
    expect(rig.pipe.commands("Runtime.runIfWaitingForDebugger").filter((c) => c.sessionId === sid)).toHaveLength(1);
  });

  it("honours waitForDebuggerOnStart:false: announced as not waiting and resumed by the proxy", async () => {
    const rig = await makeRig();
    await rig.client.call("Target.setAutoAttach", { ...AUTO, waitForDebuggerOnStart: false });
    const v = rig.pipe.addTarget({ url: "https://a.test/" });
    await rig.pipe.flush();
    const ev = rig.client.events("Target.attachedToTarget").find((e) => (e.params as { targetInfo: { targetId: string } }).targetInfo.targetId === v);
    expect((ev?.params as { waitingForDebugger: boolean } | undefined)?.waitingForDebugger).toBe(false);
    expect(rig.pipe.resumed.has(rig.pipe.sessionOf(v) as string)).toBe(true);
  });

  it("never leaves a target paused when the client did not enable auto-attach", async () => {
    const rig = await makeRig();
    const v = rig.pipe.addTarget({ url: "https://a.test/" });
    await rig.pipe.flush();
    expect(rig.pipe.waiting.size).toBe(0);
    expect(rig.pipe.resumed.has(rig.pipe.sessionOf(v) as string)).toBe(true);
    expect(rig.client.events("Target.attachedToTarget")).toHaveLength(0);
  });

  it("auto-attach announces existing visible targets once, before the reply; repeating it does not re-announce", async () => {
    const rig = await makeRig();
    const id = rig.client.send("Target.setAutoAttach", AUTO);
    await rig.pipe.flush();
    const all = rig.client.all();
    const attachAt = all.findIndex((m) => m.method === "Target.attachedToTarget");
    const replyAt = all.findIndex((m) => m.id === id);
    expect(attachAt).toBeGreaterThanOrEqual(0);
    expect(attachAt).toBeLessThan(replyAt);
    await rig.client.call("Target.setAutoAttach", AUTO);
    expect(attachedIds(rig)).toEqual(["BLANK0"]);
  });

  it("discovery announces each visible target once, then targetDestroyed once, and stops on discover:false", async () => {
    const rig = await makeRig();
    await rig.client.call("Target.setDiscoverTargets", { discover: true });
    await rig.client.call("Target.setDiscoverTargets", { discover: true });
    const v = rig.pipe.addTarget({ url: "https://a.test/" });
    await rig.pipe.flush();
    expect(createdIds(rig).sort()).toEqual(["BLANK0", v].sort());
    rig.pipe.closeTarget(v);
    await rig.pipe.flush();
    expect(rig.client.events("Target.targetDestroyed").map((e) => (e.params as { targetId: string }).targetId)).toEqual([v]);

    await rig.client.call("Target.setDiscoverTargets", { discover: false });
    rig.client.socket.received.length = 0;
    rig.pipe.addTarget({ url: "https://b.test/" });
    await rig.pipe.flush();
    expect(rig.client.events()).toHaveLength(0);
  });

  it("forwards targetInfoChanged for a visible announced target", async () => {
    const rig = await makeRig();
    await rig.client.call("Target.setDiscoverTargets", { discover: true });
    rig.pipe.navigate("BLANK0", "https://b.test/");
    await rig.pipe.flush();
    const ev = rig.client.events("Target.targetInfoChanged")[0];
    expect((ev.params as { targetInfo: { url: string } }).targetInfo.url).toBe("https://b.test/");
  });

  it("explicit attachToTarget announces then replies with the session; idempotent; detach lets the client re-attach", async () => {
    const rig = await makeRig();
    const sid = rig.pipe.sessionOf("BLANK0") as string;
    const first = await rig.client.call("Target.attachToTarget", { targetId: "BLANK0", flatten: true });
    expect(first.result).toEqual({ sessionId: sid });
    expect(attachedIds(rig)).toEqual(["BLANK0"]);
    const again = await rig.client.call("Target.attachToTarget", { targetId: "BLANK0", flatten: true });
    expect(again.result).toEqual({ sessionId: sid });
    expect(attachedIds(rig)).toEqual(["BLANK0"]);
    expect((await rig.client.call("Runtime.evaluate", {}, sid)).error).toBeUndefined();

    await rig.client.call("Target.detachFromTarget", { sessionId: sid });
    expect(rig.client.events("Target.detachedFromTarget")).toHaveLength(1);
    expect((await rig.client.call("Runtime.evaluate", {}, sid)).error).toMatchObject({ code: -32001 });
    // the server's own session is untouched
    expect(rig.pipe.commands("Target.detachFromTarget")).toHaveLength(0);
    await rig.client.call("Target.attachToTarget", { targetId: "BLANK0", flatten: true });
    expect(attachedIds(rig)).toEqual(["BLANK0", "BLANK0"]);
  });

  it("attachToTarget without flatten:true is refused", async () => {
    const rig = await makeRig();
    expect((await rig.client.call("Target.attachToTarget", { targetId: "BLANK0" })).error).toBeDefined();
  });

  it("session-level Target.setAutoAttach is forwarded to Chrome (child attach belongs to the client)", async () => {
    const rig = await makeRig();
    await rig.client.call("Target.setAutoAttach", AUTO);
    await rig.pipe.flush();
    const sid = rig.pipe.sessionOf("BLANK0") as string;
    const before = rig.pipe.commands("Target.setAutoAttach").length;
    await rig.client.call("Target.setAutoAttach", AUTO, sid);
    expect(rig.pipe.commands("Target.setAutoAttach")).toHaveLength(before + 1);
    expect(rig.pipe.commands("Target.setAutoAttach").at(-1)?.sessionId).toBe(sid);
  });

  it("targetDestroyed removes the tab and drops its sessions", async () => {
    const rig = await makeRig();
    await rig.client.call("Target.setAutoAttach", AUTO);
    const v = rig.pipe.addTarget({ url: "https://a.test/" });
    await rig.pipe.flush();
    expect(rig.instance.tabList().map((t) => t.url)).toContain("https://a.test/");
    rig.pipe.closeTarget(v);
    await rig.pipe.flush();
    expect(rig.instance.tabList().map((t) => t.url)).toEqual(["about:blank"]);
    expect(rig.client.events("Target.detachedFromTarget")).toHaveLength(1);
  });
});

describe("#F4 WebUI targets are hidden and re-checked on URL change", () => {
  it("V becomes hidden when it navigates to chrome://: commands fail, it leaves the tab list, the client forgets it", async () => {
    const rig = await makeRig();
    await rig.client.call("Target.setAutoAttach", AUTO);
    await rig.client.call("Target.setDiscoverTargets", { discover: true });
    const v = rig.pipe.addTarget({ url: "https://a.test/" });
    await rig.pipe.flush();
    await rig.client.call("Runtime.runIfWaitingForDebugger", {}, rig.pipe.sessionOf(v));
    expect(rig.instance.tabList().map((t) => t.url)).toContain("https://a.test/");

    rig.client.socket.received.length = 0;
    rig.pipe.navigate(v, "chrome://password-manager");
    await rig.pipe.flush();

    const sid = rig.pipe.sessionOf(v) as string;
    expect((await rig.client.call("Runtime.evaluate", {}, sid)).error).toMatchObject({ code: -32001 });
    expect((await rig.client.call("Target.getTargetInfo", { targetId: v })).error).toBeDefined();
    expect(rig.instance.tabList().map((t) => t.url)).toEqual(["about:blank"]);
    expect(rig.client.events("Target.detachedFromTarget")).toHaveLength(1);
    expect(rig.client.events("Target.targetDestroyed")).toHaveLength(1);
    expect(wire(rig)).not.toContain("password-manager");
  });

  it("a chrome:// tab the user opens while a client is connected is never seen and keeps responding", async () => {
    const rig = await makeRig();
    await rig.client.call("Target.setAutoAttach", AUTO);
    await rig.client.call("Target.setDiscoverTargets", { discover: true });
    rig.client.socket.received.length = 0;
    const ui = rig.pipe.addTarget({ url: "chrome://password-manager" });
    await rig.pipe.flush();
    expect(wire(rig)).not.toContain(ui);
    expect(wire(rig)).not.toContain("password-manager");
    expect(rig.pipe.waiting.size).toBe(0); // resumed: not left paused
    const targets = (await rig.client.call("Target.getTargets")).result as { targetInfos: Array<{ targetId: string }> };
    expect(targets.targetInfos.map((t) => t.targetId)).toEqual(["BLANK0"]);
  });

  it("each of chrome-untrusted:, devtools:, chrome-extension: is hidden", async () => {
    const rig = await makeRig();
    await rig.client.call("Target.setAutoAttach", AUTO);
    for (const url of ["chrome-untrusted://x/", "devtools://devtools/bundled/inspector.html", "chrome-extension://abc/page.html"]) {
      const t = rig.pipe.addTarget({ url });
      await rig.pipe.flush();
      expect(wire(rig), url).not.toContain(t);
    }
  });

  it("a WebUI tab that navigates to https becomes visible and is announced", async () => {
    const rig = await makeRig();
    await rig.client.call("Target.setAutoAttach", AUTO);
    await rig.client.call("Target.setDiscoverTargets", { discover: true });
    const ui = rig.pipe.addTarget({ url: "chrome://newtab/" });
    await rig.pipe.flush();
    expect(wire(rig)).not.toContain(ui);
    rig.pipe.navigate(ui, "https://example.com/");
    await rig.pipe.flush();
    expect(attachedIds(rig)).toContain(ui);
    expect(createdIds(rig)).toContain(ui);
  });
});

describe("#F5 hidden tabs — viewer", () => {
  it("a viewer subscribe for a hidden tab's numeric id is refused and audited", async () => {
    const rig = await makeRig();
    const { targetId } = await withHiddenTab(rig);
    const tabId = rig.instance.tabIdForTarget(targetId) as number;
    const viewer = viewerSocket();
    expect(rig.instance.subscribe(viewer, tabId)).toEqual({ ok: false, state: "detached" });
    expect(rig.audit.list().filter((e) => e.kind === "viewer-subscribe-refused").map((e) => e.detail)).toEqual([`tab:${tabId} reason:hidden`]);
    expect(rig.audit.list().some((e) => e.kind === "viewer-subscribe")).toBe(false);
    expect(rig.pipe.commands("Page.startScreencast")).toHaveLength(0);
    expect(rig.pipe.commands("Target.attachToTarget")).toHaveLength(0);
  });

  it("viewer input on a hidden tab is refused and audited; an unknown tab id is refused by the tap", async () => {
    const rig = await makeRig();
    const { targetId } = await withHiddenTab(rig);
    const tabId = rig.instance.tabIdForTarget(targetId) as number;
    await rig.instance.input(viewerSocket(), tabId, { kind: "bringToFront" });
    expect(rig.audit.list().some((e) => e.kind === "viewer-subscribe-refused" && e.detail === `tab:${tabId} reason:hidden via:input`)).toBe(true);
    expect(rig.pipe.commands("Page.bringToFront")).toHaveLength(0);
    const viewer = viewerSocket();
    expect(rig.instance.subscribe(viewer, 9999).ok).toBe(false);
    expect(rig.audit.list().some((e) => e.kind === "viewer-subscribe-refused" && e.detail === "tab:9999 reason:no-session")).toBe(true);
  });

  it("a tab that turns into a WebUI page cannot be subscribed any more", async () => {
    const rig = await makeRig();
    await rig.client.call("Target.setDiscoverTargets", { discover: true });
    const v = rig.pipe.addTarget({ url: "https://a.test/" });
    await rig.pipe.flush();
    const tabId = rig.instance.tabIdForTarget(v) as number;
    rig.pipe.navigate(v, "chrome://settings");
    await rig.pipe.flush();
    expect(rig.instance.subscribe(viewerSocket(), tabId).ok).toBe(false);
  });
});
