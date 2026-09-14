/**
 * RelayInstance (change: add-browser-relay) — the relay-core contract:
 * handshake gating, socket exclusivity, the deny-list, the screencast tap,
 * viewer input, DevTools detach, and every close path.
 *
 * Scenarios: 3.2/3.3 + E9, E11-E14, E23-E27, X2-X7.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuditRing } from "../../audit.js";
import { RelayInstance } from "../relay-instance.js";
import { FakeExtension, type FakeSocket, flush, socketPair, viewerSocket } from "./fake-socket.js";

const silentLogger = { info: () => {}, warn: () => {}, error: () => {} };

interface Harness {
  instance: RelayInstance;
  audit: AuditRing;
  ext: FakeExtension;
  extSide: FakeSocket;
  cdpSide: FakeSocket;
  closed: string[];
}

/** Boot an instance with a connected extension (handshake done) + CDP client. */
async function boot(opts: { allowedDomains?: string[]; tabs?: Array<{ id: number; title: string; url: string }>; cdpTimeoutMs?: number } = {}): Promise<Harness> {
  const audit = new AuditRing();
  const closed: string[] = [];
  const instance = new RelayInstance({
    instanceId: "inst-1",
    profileDirectory: "Default",
    allowedDomains: opts.allowedDomains ?? [],
    audit,
    logger: silentLogger,
    onClosed: (r) => closed.push(r),
    onStatusChange: () => {},
    cdpAttachTimeoutMs: opts.cdpTimeoutMs ?? 30_000,
  });
  const [relayExt, extSide] = socketPair();
  instance.attachExtension(relayExt);
  const ext = new FakeExtension(extSide, opts.tabs ?? [{ id: 7, title: "Tab A", url: "https://a.test/" }]);

  const [relayCdp, cdpSide] = socketPair();
  instance.attachCdp(relayCdp);
  ext.initialize();
  await flush();
  await instance.waitForHandshake();
  // Auto-attach is what makes the model assign relay session ids per tab.
  cdpSide.send(JSON.stringify({ id: 1, method: "Target.setAutoAttach", params: { autoAttach: true } }));
  await flush();
  return { instance, audit, ext, extSide, cdpSide, closed };
}

/** Frames the CDP client RECEIVED (the relay writes into its socket). */
function cdpResponses(socket: FakeSocket): Array<Record<string, unknown>> {
  return socket.receivedJson().filter((m) => m.id !== undefined && m.method === undefined);
}

/** The CDP error the client received for `id` — fails loudly when absent. */
function cdpError(socket: FakeSocket, id: number): { code?: number; message?: string } {
  const response = cdpResponses(socket).find((m) => m.id === id);
  if (!response) throw new Error(`no CDP response for id ${id}`);
  const error = response.error as { code?: number; message?: string } | undefined;
  if (!error) throw new Error(`CDP response ${id} carries no error`);
  return error;
}

describe("handshake + attach", () => {
  it("answers Target.setAutoAttach with one attached target per tab (spec)", async () => {
    const { cdpSide, instance } = await boot({ tabs: [
      { id: 7, title: "A", url: "https://a.test/" },
      { id: 9, title: "B", url: "https://b.test/" },
    ] });
    const attached = cdpSide.receivedJson().filter((m) => m.method === "Target.attachedToTarget");
    expect(attached).toHaveLength(2);
    expect(instance.tabList().map((t) => t.tabId)).toEqual([7, 9]);
  });

  it("pins the Chrome tabId → relay session mapping (the vendored-internal read)", async () => {
    const { instance } = await boot();
    expect(instance.sessionIdForTab(7)).toBe("pw-tab-1");
    expect(instance.sessionIdForTab(999)).toBeUndefined();
  });

  it("holds CDP traffic until the handshake, then answers it (X2)", async () => {
    const audit = new AuditRing();
    const instance = new RelayInstance({
      instanceId: "i",
      profileDirectory: "Default",
      allowedDomains: [],
      audit,
      logger: silentLogger,
      onClosed: () => {},
      onStatusChange: () => {},
    });
    const [relayExt, extSide] = socketPair();
    instance.attachExtension(relayExt);
    const ext = new FakeExtension(extSide, [{ id: 7, title: "A", url: "https://a.test/" }]);
    const [relayCdp, cdpSide] = socketPair();
    instance.attachCdp(relayCdp);

    cdpSide.send(JSON.stringify({ id: 5, method: "Browser.getVersion", params: {} }));
    await flush();
    // Not answered yet — the extension has not initialised.
    expect(cdpResponses(cdpSide)).toHaveLength(0);

    ext.initialize();
    await flush();
    const answered = cdpResponses(cdpSide);
    expect(answered).toHaveLength(1);
    expect(answered[0].id).toBe(5);
    expect((answered[0].result as { product: string }).product).toBe("Chrome/Extension-Bridge");
  });

  it("closes the CDP socket with `Extension not connected` when the extension never dials (X2)", async () => {
    const instance = new RelayInstance({
      instanceId: "i",
      profileDirectory: "Default",
      allowedDomains: [],
      audit: new AuditRing(),
      logger: silentLogger,
      onClosed: () => {},
      onStatusChange: () => {},
      cdpAttachTimeoutMs: 15,
    });
    const [relayCdp, cdpSide] = socketPair();
    instance.attachCdp(relayCdp);
    await new Promise((r) => setTimeout(r, 40));
    expect(cdpSide.closed[0]).toEqual({ code: 1000, reason: "Extension not connected" });
  });

  it("closes the instance + audits detach/no-cdp-client when no CDP client attaches (X3)", async () => {
    const audit = new AuditRing();
    const instance = new RelayInstance({
      instanceId: "i",
      profileDirectory: "Default",
      allowedDomains: [],
      audit,
      logger: silentLogger,
      onClosed: () => {},
      onStatusChange: () => {},
      cdpAttachTimeoutMs: 15,
    });
    const [relayExt, extSide] = socketPair();
    instance.attachExtension(relayExt);
    new FakeExtension(extSide).initialize();
    await flush();
    await new Promise((r) => setTimeout(r, 40));
    expect(instance.isClosed).toBe(true);
    expect(audit.list().some((e) => e.kind === "detach" && e.detail === "no-cdp-client")).toBe(true);
  });

  it("refuses a second extension socket on a claimed guid (E9)", async () => {
    const { instance } = await boot();
    const [second] = socketPair();
    instance.attachExtension(second);
    expect(second.closed[0]).toEqual({
      code: 1000,
      reason: "Another extension connection already established",
    });
  });

  it("refuses a second CDP client with the upstream reason (E11)", async () => {
    const { instance } = await boot();
    const [second] = socketPair();
    instance.attachCdp(second);
    expect(second.closed[0]).toEqual({
      code: 1000,
      reason: "Another CDP client already connected",
    });
  });
});

describe("deny-list on the CDP path", () => {
  it("answers -32000, does not forward, and audits a cookie read (E12)", async () => {
    const { ext, cdpSide, instance, audit } = await boot();
    const before = ext.cdpCommands.length;
    cdpSide.send(JSON.stringify({ id: 42, method: "Network.getAllCookies", params: {} }));
    await flush();

    expect(cdpError(cdpSide, 42)).toEqual({
      code: -32000,
      message: "Denied by dashboard relay policy: Network.getAllCookies",
    });
    expect(ext.cdpCommands.length).toBe(before);
    expect(audit.list().some((e) => e.kind === "denied" && e.detail === "Network.getAllCookies")).toBe(true);
    expect(instance.isClosed).toBe(false);
  });

  it("denies file:// navigation but forwards an https URL verbatim (E13)", async () => {
    const { ext, cdpSide } = await boot();
    // ids 101/102: `boot()` already used id 1 for Target.setAutoAttach.
    cdpSide.send(JSON.stringify({ id: 101, method: "Page.navigate", params: { url: "file:///etc/passwd" } }));
    cdpSide.send(JSON.stringify({ id: 102, method: "Page.navigate", params: { url: "https://ok.test/x" } }));
    await flush();

    expect(cdpError(cdpSide, 101).code).toBe(-32000);
    expect(cdpResponses(cdpSide).find((m) => m.id === 102)?.error).toBeUndefined();
    const forwarded = ext.cdpCommands.filter((c) => c.method === "Page.navigate");
    expect(forwarded).toHaveLength(1);
    expect(forwarded[0].params).toEqual({ url: "https://ok.test/x" });
  });

  it("enforces allowedDomains with leading-dot subdomain matching (E14)", async () => {
    const { cdpSide, ext } = await boot({ allowedDomains: [".github.com"] });
    cdpSide.send(JSON.stringify({ id: 1, method: "Page.navigate", params: { url: "https://api.github.com/x" } }));
    cdpSide.send(JSON.stringify({ id: 2, method: "Page.navigate", params: { url: "https://github.com.evil.io" } }));
    await flush();

    expect(cdpResponses(cdpSide).find((m) => m.id === 1)?.error).toBeUndefined();
    expect(cdpError(cdpSide, 2).code).toBe(-32000);
    expect(ext.cdpCommands.filter((c) => c.method === "Page.navigate")).toHaveLength(1);
  });

  it("forwards ordinary automation unchanged", async () => {
    const { cdpSide, ext } = await boot();
    cdpSide.send(JSON.stringify({ id: 7, method: "Runtime.evaluate", params: { expression: "1+1" } }));
    await flush();
    expect(ext.cdpCommands.some((c) => c.method === "Runtime.evaluate")).toBe(true);
    expect(cdpResponses(cdpSide).find((m) => m.id === 7)?.error).toBeUndefined();
  });
});

describe("screencast tap", () => {
  it("sends frames only to subscribed sockets — never the CDP client (3.2/E26)", async () => {
    const { instance, ext, cdpSide } = await boot();
    const viewerA = viewerSocket();
    const viewerB = viewerSocket();
    expect(instance.subscribe(viewerA, 7).ok).toBe(true);
    await flush();

    expect(ext.cdpCommands.some((c) => c.method === "Page.startScreencast")).toBe(true);
    ext.emitFrame(7, { data: "FRAME1" });
    await flush();

    expect(viewerA.frames()).toHaveLength(1);
    expect((viewerA.frames()[0] as { jpegBase64: string }).jpegBase64).toBe("FRAME1");
    // The unsubscribed socket and the CDP client see nothing.
    expect(viewerB.frames()).toHaveLength(0);
    expect(cdpSide.receivedJson().some((m) => m.method === "Page.screencastFrame")).toBe(false);
  });

  it("filters per session across two tabs — subscriber gets only the tapped tab (7.26)", async () => {
    const { instance, ext, cdpSide } = await boot({
      tabs: [
        { id: 7, title: "A", url: "https://a.test/" },
        { id: 9, title: "B", url: "https://b.test/" },
      ],
    });
    const viewer = viewerSocket();
    expect(instance.subscribe(viewer, 7).ok).toBe(true);
    await flush();

    // Frames for BOTH tabs arrive. Tab 7 is tapped; tab 9 is the client's.
    ext.emitFrame(9, { data: "B-FRAME" });
    ext.emitFrame(7, { data: "A-FRAME" });
    await flush();

    expect(viewer.frames().map((f) => (f as { jpegBase64: string }).jpegBase64)).toEqual(["A-FRAME"]);
    const clientFrames = cdpSide
      .receivedJson()
      .filter((m) => m.method === "Page.screencastFrame")
      .map((m) => (m.params as { data?: string })?.data);
    expect(clientFrames).toEqual(["B-FRAME"]);

    // Client startScreencast: denied on the tapped session, forwarded on the other.
    const sessionA = instance.sessionIdForTab(7);
    const sessionB = instance.sessionIdForTab(9);
    expect(sessionA).toBeDefined();
    expect(sessionB).toBeDefined();
    cdpSide.send(JSON.stringify({ id: 21, method: "Page.startScreencast", sessionId: sessionA, params: {} }));
    await flush();
    expect(cdpError(cdpSide, 21).message).toContain("Denied");

    cdpSide.send(JSON.stringify({ id: 22, method: "Page.startScreencast", sessionId: sessionB, params: {} }));
    await flush();
    // Not tapped → the client's own screencast is NOT denied (the vendored
    // model may answer it in-process, so the observable is "no error").
    expect(instance.tapState.handlesSession(sessionB as string)).toBe(false);
    expect(cdpResponses(cdpSide).find((m) => m.id === 22)?.error).toBeUndefined();
  });

  it("acks every frame immediately (the extension throttles on acks)", async () => {
    const { instance, ext } = await boot();
    instance.subscribe(viewerSocket(), 7);
    await flush();
    ext.emitFrame(7);
    await flush();
    expect(ext.cdpCommands.some((c) => c.method === "Page.screencastFrameAck")).toBe(true);
  });

  it("stops the screencast when the last viewer leaves (spec)", async () => {
    const { instance, ext } = await boot();
    const viewer = viewerSocket();
    instance.subscribe(viewer, 7);
    await flush();
    instance.unsubscribe(viewer, 7);
    await flush();
    expect(ext.cdpCommands.some((c) => c.method === "Page.stopScreencast")).toBe(true);
  });

  it("denies the CDP client's own startScreencast while a tap owns the session (E26)", async () => {
    const { instance, cdpSide } = await boot();
    instance.subscribe(viewerSocket(), 7);
    await flush();
    const sessionId = instance.sessionIdForTab(7);
    cdpSide.send(JSON.stringify({ id: 9, method: "Page.startScreencast", sessionId, params: {} }));
    await flush();
    expect(cdpError(cdpSide, 9).code).toBe(-32000);
  });

  it("refuses a subscribe when the CDP client already owns the screencast (E27)", async () => {
    const { instance, cdpSide } = await boot();
    const sessionId = instance.sessionIdForTab(7);
    cdpSide.send(JSON.stringify({ id: 3, method: "Page.startScreencast", sessionId, params: {} }));
    await flush();
    expect(instance.subscribe(viewerSocket(), 7)).toEqual({
      ok: false,
      state: "client-screencast-active",
    });
  });

  it("skips frames for a viewer over the backpressure threshold only (P2/E37)", async () => {
    const { instance, ext } = await boot();
    const slow = viewerSocket();
    slow.bufferedAmount = 600 * 1024;
    const fast = viewerSocket();
    instance.subscribe(slow, 7);
    instance.subscribe(fast, 7);
    await flush();

    ext.emitFrame(7);
    ext.emitFrame(7);
    await flush();
    expect(slow.frames()).toHaveLength(0);
    expect(fast.frames()).toHaveLength(2);
    expect(instance.tapState.skippedFor(7, slow)).toBe(2);
  });
});

describe("viewer input", () => {
  it("scales normalized mouse coordinates by the last frame geometry (E23)", async () => {
    const { instance, ext } = await boot();
    const viewer = viewerSocket();
    instance.subscribe(viewer, 7);
    await flush();
    ext.emitFrame(7, { deviceWidth: 1280, deviceHeight: 800 });
    await flush();

    await instance.input(viewer, 7, { kind: "mouse", x: 0.5, y: 0.5, action: "down" });
    await flush();
    const dispatched = ext.cdpCommands.filter((c) => c.method === "Input.dispatchMouseEvent");
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0].params).toMatchObject({ x: 640, y: 400, type: "mousePressed" });
  });

  it("drops out-of-range coordinates and audits the refusal (E23)", async () => {
    const { instance, ext, audit } = await boot();
    const viewer = viewerSocket();
    instance.subscribe(viewer, 7);
    await flush();
    ext.emitFrame(7, { deviceWidth: 1280, deviceHeight: 800 });
    await flush();

    await instance.input(viewer, 7, { kind: "mouse", x: 1.2, y: 0 });
    await flush();
    expect(ext.cdpCommands.some((c) => c.method === "Input.dispatchMouseEvent")).toBe(false);
    expect(audit.list().some((e) => e.kind === "denied" && e.detail === "mouse")).toBe(true);
  });

  it("never reaches Runtime.* for an unknown kind (E24)", async () => {
    const { instance, ext, audit } = await boot();
    const viewer = viewerSocket();
    instance.subscribe(viewer, 7);
    await flush();
    await instance.input(viewer, 7, { kind: "evaluate", expression: "fetch('/secrets')" });
    await flush();
    expect(ext.cdpCommands.some((c) => c.method.startsWith("Runtime."))).toBe(false);
    expect(audit.list().some((e) => e.kind === "denied" && e.detail === "evaluate")).toBe(true);
  });

  it("maps bringToFront to Page.bringToFront even before any frame exists (X8)", async () => {
    const { instance, ext } = await boot();
    const viewer = viewerSocket();
    instance.subscribe(viewer, 7);
    await flush();
    await instance.input(viewer, 7, { kind: "bringToFront" });
    await flush();
    expect(ext.cdpCommands.some((c) => c.method === "Page.bringToFront")).toBe(true);
  });
});

describe("lifecycle ends (X4-X7)", () => {
  it("surfaces DevTools detach and errors later commands for that tab (X7)", async () => {
    const { instance, ext, cdpSide } = await boot();
    // Capture the relay session BEFORE the detach: the vendored model drops the
    // tab session when it processes the detach, so the client's in-flight
    // commands still reference a sessionId that no longer resolves.
    const sessionId = instance.sessionIdForTab(7);
    expect(sessionId).toBeDefined();
    // Before the take-over the tab reports `live` (no tap view yet).
    expect(instance.tabList().find((t) => t.tabId === 7)).toMatchObject({ state: "live" });

    ext.detach(7, "canceled_by_user");
    await flush();

    // The status view carries the take-over so the tile renders its overlay
    // and stops input (task 3.4).
    expect(instance.tabList().find((t) => t.tabId === 7)).toEqual({
      tabId: 7,
      title: expect.any(String),
      url: expect.any(String),
      state: "detached",
      reason: "devtools",
    });

    cdpSide.send(JSON.stringify({ id: 11, method: "Runtime.evaluate", sessionId, params: {} }));
    await flush();
    expect(cdpError(cdpSide, 11).message).toBe("Target detached: devtools");
  });

  it("closes the extension socket when the CDP client disconnects (X4)", async () => {
    const { instance, closed, extSide } = await boot();
    // Drive it through the real path: the client socket closing.
    instance.tapState.closeAll();
    (instance as unknown as { cdp?: { close(code?: number, reason?: string): void } }).cdp?.close(1000, "client gone");
    await flush();
    expect(closed).toEqual(["cdp-closed"]);
    expect(extSide.closed[0]?.reason).toBe("CDP client disconnected");
  });

  it("closes the CDP socket with `Extension disconnected` when the extension dies (X5)", async () => {
    const { instance, extSide, cdpSide } = await boot();
    extSide.close(1000, "boom");
    await flush();
    expect(cdpSide.closed[0]?.reason).toContain("Extension disconnected");
    expect(instance.isClosed).toBe(true);
  });

  it("ends the session when the last controlled tab closes (X6)", async () => {
    const { ext, closed } = await boot();
    ext.tabRemoved(7);
    await flush();
    expect(closed.some((r) => r === "extension-closed:All controlled tabs detached")).toBe(true);
  });

  it("close() is idempotent and notifies the manager exactly once", async () => {
    const { instance, closed } = await boot();
    instance.close("a");
    instance.close("b");
    expect(closed).toEqual(["a"]);
  });
});

describe("audit hooks", () => {
  let audit: AuditRing;
  beforeEach(() => {
    audit = new AuditRing();
  });

  it("records attach + navigate with URL-only detail", async () => {
    const harness = await boot();
    harness.cdpSide.send(JSON.stringify({ id: 1, method: "Page.navigate", params: { url: "https://a.test/p?q=1" } }));
    await flush();
    const kinds = harness.audit.list().map((e) => e.kind);
    expect(kinds).toContain("attach");
    expect(kinds).toContain("navigate");
    const nav = harness.audit.list().find((e) => e.kind === "navigate");
    expect(nav?.detail).toBe("https://a.test/p?q=1");
    expect(JSON.stringify(harness.audit.list())).not.toContain("set-auto-attach-guid");
    void audit;
  });

  it("never records a payload body or a guid for a denied verb", async () => {
    const harness = await boot();
    harness.cdpSide.send(
      JSON.stringify({ id: 1, method: "Network.getCookies", params: { urls: ["https://secret.test"] } }),
    );
    await flush();
    const denied = harness.audit.list().find((e) => e.kind === "denied");
    expect(denied?.detail).toBe("Network.getCookies");
    expect(JSON.stringify(harness.audit.list())).not.toContain("secret.test");
  });
});

describe("logging (task 2.11)", () => {
  it("logs a denied verb with profile + method", async () => {
    const warn = vi.fn();
    const instance = new RelayInstance({
      instanceId: "i",
      profileDirectory: "OSS",
      allowedDomains: [],
      audit: new AuditRing(),
      logger: { info: () => {}, warn, error: () => {} },
      onClosed: () => {},
      onStatusChange: () => {},
    });
    const [relayExt, extSide] = socketPair();
    instance.attachExtension(relayExt);
    new FakeExtension(extSide).initialize();
    await flush();
    await instance.waitForHandshake();
    const [relayCdp, cdpSide] = socketPair();
    instance.attachCdp(relayCdp);
    cdpSide.send(JSON.stringify({ id: 1, method: "Storage.getCookies", params: {} }));
    await flush();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("[browser-relay] denied Storage.getCookies"));
  });
});
