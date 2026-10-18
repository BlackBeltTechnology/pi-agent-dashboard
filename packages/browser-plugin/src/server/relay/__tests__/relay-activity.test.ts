/**
 * `RelayInstance` activity clock + agent-tab hook (change: add-dedicated-agent-browser,
 * D7/D8): `lastActivity` is stamped by client-originated CDP commands and viewer
 * input only (never by events/responses), and `onAgentTabCreated` fires with the tab
 * id when the CLIENT's `Target.createTarget` succeeds — not for tabs the extension
 * announces on its own.
 */
import { describe, expect, it } from "vitest";
import { AuditRing } from "../../audit.js";
import { RelayInstance } from "../relay-instance.js";
import { FakeExtension, flush, socketPair, viewerSocket } from "./fake-socket.js";

const silentLogger = { info: () => {}, warn: () => {}, error: () => {} };

async function boot(onAgentTabCreated?: (tabId: number) => void) {
  const instance = new RelayInstance({
    instanceId: "inst-1",
    profileDirectory: "Default",
    allowedDomains: [],
    audit: new AuditRing(),
    logger: silentLogger,
    onClosed: () => {},
    onStatusChange: () => {},
    onAgentTabCreated,
  });
  const [relayExt, extSide] = socketPair();
  instance.attachExtension(relayExt);
  const ext = new FakeExtension(extSide, [{ id: 7, title: "A", url: "https://a.test/" }]);
  const [relayCdp, cdpSide] = socketPair();
  instance.attachCdp(relayCdp);
  ext.initialize();
  await flush();
  await instance.waitForHandshake();
  cdpSide.send(JSON.stringify({ id: 1, method: "Target.setAutoAttach", params: { autoAttach: true } }));
  await flush();
  return { instance, ext, cdpSide };
}

describe("lastActivity (idle sweep input)", () => {
  it("is stamped by a client CDP command but not by an extension event", async () => {
    const { instance, ext, cdpSide } = await boot();
    const t0 = instance.lastActivity;
    await new Promise((r) => setTimeout(r, 15));
    ext.emitChromeEvent(7, "Page.frameNavigated", { frame: { id: "f", url: "https://a.test/x" } });
    await flush();
    expect(instance.lastActivity).toBe(t0); // events are not activity
    cdpSide.send(JSON.stringify({ id: 2, method: "Browser.getVersion", params: {} }));
    await flush();
    expect(instance.lastActivity).toBeGreaterThan(t0);
  });

  it("is stamped by viewer input", async () => {
    const { instance } = await boot();
    const before = instance.lastActivity;
    await new Promise((r) => setTimeout(r, 15));
    const viewer = viewerSocket();
    await instance.input(viewer, 7, { type: "browser_relay_input", instanceId: "inst-1", tabId: 7, kind: "mouse", event: { type: "mouseMoved", x: 1, y: 1 } });
    expect(instance.lastActivity).toBeGreaterThan(before);
  });
});

describe("onAgentTabCreated", () => {
  it("does not fire for tabs the extension announced itself (the connect flow / user tabs)", async () => {
    const seen: number[] = [];
    await boot((tabId) => seen.push(tabId));
    expect(seen).toEqual([]);
  });

  it("fires with the tab id when the client's Target.createTarget succeeds", async () => {
    const seen: number[] = [];
    const { cdpSide } = await boot((tabId) => seen.push(tabId));
    cdpSide.send(JSON.stringify({ id: 9, method: "Target.createTarget", params: { url: "https://a.test/" } }));
    await flush(8);
    const reply = cdpSide.receivedJson().find((m) => m.id === 9);
    expect(reply?.error).toBeUndefined();
    expect(seen).toEqual([7]);
  });

  it("a throwing hook never breaks the command", async () => {
    const { cdpSide } = await boot(() => {
      throw new Error("boom");
    });
    cdpSide.send(JSON.stringify({ id: 9, method: "Target.createTarget", params: { url: "https://a.test/" } }));
    await flush(8);
    expect(cdpSide.receivedJson().find((m) => m.id === 9)?.result).toBeDefined();
  });
});
