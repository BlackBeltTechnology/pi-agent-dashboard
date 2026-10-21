/**
 * `DedicatedInstance` `private` + `ephemeral` options over a `FakeChromePipe` (change:
 * add-gmail-auto-setup, tasks 1.2 / 1.3; test-plan #R15 #R16).
 */
import { describe, expect, it } from "vitest";
import { viewerSocket } from "../../relay/__tests__/fake-socket.js";
import { makeRig } from "./dedicated-rig.js";

const CTX = "ctx-eph";

const auditKinds = (rig: { audit: { list(): Array<{ kind: string; detail: string }> } }, kind: string) =>
  rig.audit.list().filter((e) => e.kind === kind);

describe("#R15 private instance", () => {
  it("lists no tab, refuses viewer subscribe and input, audits viewer-subscribe-refused", async () => {
    const control = await makeRig();
    expect(control.instance.tabList().map((t) => t.url)).toEqual(["about:blank"]); // the same tab IS listed when not private

    const rig = await makeRig({ deps: { private: true } });
    expect(rig.pipe.sessionOf("BLANK0")).toBeDefined(); // the tab exists and is attached
    expect(rig.instance.tabList()).toEqual([]);

    const viewer = viewerSocket();
    expect(rig.instance.subscribe(viewer, 1)).toMatchObject({ ok: false });
    await rig.instance.input(viewer, 1, { kind: "key", key: "a" });
    const refused = auditKinds(rig, "viewer-subscribe-refused");
    expect(refused.map((e) => e.detail)).toEqual(["tab:1 reason:private via:input", "tab:1 reason:private"]); // newest first
    expect(rig.pipe.commands("Page.startScreencast")).toHaveLength(0); // no tap session was started for the viewer
  });

  it("still serves the agent client normally", async () => {
    const rig = await makeRig({ deps: { private: true } });
    const reply = await rig.client.call("Browser.getVersion");
    expect(reply.error).toBeUndefined();
  });
});

describe("#R16 ephemeral instance", () => {
  async function ephemeralRig() {
    const rig = await makeRig({ deps: { ephemeralContextId: CTX } });
    rig.pipe.addTarget({ targetId: "DEF1", url: "https://default.test/", browserContextId: "ctx-default" });
    rig.pipe.addTarget({ targetId: "OTH1", url: "https://other.test/", browserContextId: "ctx-other" });
    rig.pipe.addTarget({ targetId: "EPH1", url: "https://eph.test/", browserContextId: CTX });
    await rig.pipe.flush();
    return rig;
  }

  it("Target.createTarget is forced into the instance's context, whatever the client asked for", async () => {
    const rig = await ephemeralRig();
    await rig.client.call("Target.createTarget", { url: "https://a.test/" });
    await rig.client.call("Target.createTarget", { url: "https://b.test/", browserContextId: "ctx-other" });
    const sent = rig.pipe.commands("Target.createTarget").map((c) => c.params?.browserContextId);
    expect(sent).toEqual([CTX, CTX]);
  });

  it("Target.getTargets and discovery list only that context; foreign targets are resumed, never attachable", async () => {
    const rig = await ephemeralRig();
    await rig.client.call("Target.setDiscoverTargets", { discover: true });
    await rig.client.call("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
    await rig.pipe.flush();
    await rig.client.call("Target.createTarget", { url: "https://a.test/" });
    await rig.pipe.flush();

    const reply = await rig.client.call("Target.getTargets");
    const infos = (reply.result as { targetInfos: Array<{ targetId: string; browserContextId: string }> }).targetInfos;
    expect(infos.length).toBeGreaterThanOrEqual(2); // EPH1 + the created tab
    expect(infos.every((t) => t.browserContextId === CTX)).toBe(true);
    expect(infos.map((t) => t.targetId)).toContain("EPH1");

    const announced = rig.client.events("Target.targetCreated").map((e) => (e.params as { targetInfo: { targetId: string } }).targetInfo.targetId);
    expect(announced).toContain("EPH1");
    expect(announced).not.toContain("DEF1");
    expect(announced).not.toContain("OTH1");
    expect(announced).not.toContain("BLANK0");
    const attached = rig.client.events("Target.attachedToTarget").map((e) => (e.params as { targetInfo: { targetId: string } }).targetInfo.targetId);
    expect(attached).not.toContain("DEF1");

    // the foreign pages were not left paused by the server's waitForDebuggerOnStart auto-attach
    expect(rig.pipe.waiting.has(rig.pipe.sessionOf("DEF1") as string)).toBe(false);
    // and the client cannot reach them by id
    const attach = await rig.client.call("Target.attachToTarget", { targetId: "DEF1", flatten: true });
    expect(attach.error).toBeDefined();
    const close = await rig.client.call("Target.closeTarget", { targetId: "OTH1" });
    expect(close.error).toBeDefined();
    expect(rig.pipe.targets.has("OTH1")).toBe(true);
  });

  it("the client's own Target.createBrowserContext / disposeBrowserContext are refused and audited, never forwarded", async () => {
    const rig = await ephemeralRig();
    const create = await rig.client.call("Target.createBrowserContext", {});
    const dispose = await rig.client.call("Target.disposeBrowserContext", { browserContextId: CTX });
    expect((create.error as { message: string }).message).toContain("Target.createBrowserContext");
    expect((dispose.error as { message: string }).message).toContain("Target.disposeBrowserContext");
    expect(rig.pipe.commands("Target.createBrowserContext")).toHaveLength(0);
    expect(rig.pipe.commands("Target.disposeBrowserContext")).toHaveLength(0);
    expect(auditKinds(rig, "denied").map((e) => e.detail)).toEqual(["Target.disposeBrowserContext", "Target.createBrowserContext"]); // newest first
  });

  it("control: a non-ephemeral instance still forwards the client's createBrowserContext", async () => {
    const rig = await makeRig();
    const create = await rig.client.call("Target.createBrowserContext", {});
    expect(create.error).toBeUndefined();
    expect(rig.pipe.commands("Target.createBrowserContext")).toHaveLength(1);
  });

  it("the context is disposed when the instance closes", async () => {
    const rig = await ephemeralRig();
    expect(rig.pipe.commands("Target.disposeBrowserContext")).toHaveLength(0);
    rig.instance.close("disconnect");
    expect(rig.pipe.commands("Target.disposeBrowserContext").map((c) => c.params)).toEqual([{ browserContextId: CTX }]);
  });

  it("a Chrome exit does not write to the dead pipe (Chrome drops the context itself)", async () => {
    const rig = await ephemeralRig();
    rig.pipe.exit({ expected: false });
    expect(rig.closed).toEqual(["chrome-exited"]);
    expect(rig.pipe.commands("Target.disposeBrowserContext")).toHaveLength(0);
  });

  it("openHiddenTab opens in the instance's context (and in the default one for a non-ephemeral instance)", async () => {
    const rig = await ephemeralRig();
    await rig.instance.openHiddenTab("https://accounts.google.com/");
    expect(rig.pipe.commands("Target.createTarget").at(-1)?.params).toEqual({ url: "https://accounts.google.com/", browserContextId: CTX });

    const plain = await makeRig();
    await plain.instance.openHiddenTab("https://accounts.google.com/");
    expect(plain.pipe.commands("Target.createTarget").at(-1)?.params).toEqual({ url: "https://accounts.google.com/" });
  });
});
