/**
 * Minimal CDP client (task 2.2): no Origin header over a real `ws` server, a
 * flattened session per page, redirect-guard arming, AX queries, click/fill
 * sequences, and that no error carries a protocol payload. Against a fake CDP
 * socket (`FakeConsole`) and one raw scripted socket. See change: add-gmail-auto-setup.
 */
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocketServer } from "ws";
import { FakeConsole } from "../../__tests__/fake-console.js";
import { CdpConnection, CdpError, CdpPage, NavigationError, type WsLike } from "../setup/cdp-page.js";

const open = async (c: FakeConsole, onSignInBlocked = () => {}) => {
  const conn = await CdpConnection.connect("ws://fake", c.wsFactory);
  return { conn, page: await CdpPage.open(conn, { onSignInBlocked }) };
};

describe("transport", () => {
  const servers: WebSocketServer[] = [];
  afterEach(async () => {
    for (const s of servers.splice(0)) await new Promise((r) => s.close(r));
  });

  it("connects with no Origin header (the dedicated proxy refuses one), round-trips a command, reports a close", async () => {
    const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
    servers.push(wss);
    let origin: string | undefined = "unset";
    wss.on("connection", (ws, req) => {
      origin = req.headers.origin;
      ws.on("message", (d) => {
        const m = JSON.parse(String(d));
        ws.send(JSON.stringify({ id: m.id, result: { echoed: m.method, sessionId: m.sessionId } }));
        if (m.method === "bye") ws.close();
      });
    });
    await new Promise((r) => wss.once("listening", r));
    const conn = await CdpConnection.connect(`ws://127.0.0.1:${(wss.address() as AddressInfo).port}/devtools/browser/x`);
    expect(await conn.send("Browser.getVersion", {}, "S9")).toEqual({ echoed: "Browser.getVersion", sessionId: "S9" });
    expect(origin).toBeUndefined();
    let closed = 0;
    conn.onClose(() => closed++);
    await conn.send("bye").catch(() => {});
    await new Promise((r) => setTimeout(r, 30));
    expect(closed).toBe(1);
    expect(conn.closed).toBe(true);
    await expect(conn.send("x")).rejects.toBeInstanceOf(CdpError);
  });

  it("a connect to a dead port rejects with a CdpError", async () => {
    await expect(CdpConnection.connect("ws://127.0.0.1:1/")).rejects.toBeInstanceOf(CdpError);
  });

  it("a socket closing rejects every pending command", async () => {
    const c = new FakeConsole();
    c.hang = () => true;
    const conn = await CdpConnection.connect("ws://fake", c.wsFactory);
    const p = conn.send("Target.createTarget", {});
    c.serverClose();
    await expect(p).rejects.toBeInstanceOf(CdpError);
  });
});

describe("page session", () => {
  it("creates its own target, attaches flattened, arms the sign-in guard FIRST, then every command carries the session", async () => {
    const c = new FakeConsole();
    await open(c);
    const methods = c.log.map((e) => e.method);
    expect(methods.slice(0, 3)).toEqual(["Target.createTarget", "Target.attachToTarget", "Fetch.enable"]);
    expect(c.commands("Target.attachToTarget")[0]?.params).toEqual({ targetId: "T1", flatten: true });
    expect(c.commands("Fetch.enable")[0]?.params).toEqual({
      patterns: [{ urlPattern: "https://accounts.google.com/*", resourceType: "Document", requestStage: "Request" }],
    });
    for (const e of c.log.filter((x) => x.kind === "cmd" && x.method !== "Target.createTarget" && x.method !== "Target.attachToTarget")) {
      expect(e.sessionId).toBe("S1");
    }
  });

  it("a paused accounts.google.com request is failed at once and reported", async () => {
    const c = new FakeConsole();
    c.signedIn = false;
    let blocked = 0;
    const { page } = await open(c, () => blocked++);
    await expect(page.navigate("https://console.cloud.google.com/x")).rejects.toBeInstanceOf(NavigationError);
    expect(blocked).toBe(1);
    expect(c.commands("Fetch.failRequest")[0]?.params).toMatchObject({ requestId: "req-1", errorReason: "BlockedByClient" });
  });

  it("navigate: a CDP refusal and an errorText both become NavigationError", async () => {
    const c = new FakeConsole();
    const { page } = await open(c);
    c.denyNavigation = () => true;
    await expect(page.navigate("https://console.cloud.google.com/")).rejects.toBeInstanceOf(NavigationError);
    c.denyNavigation = undefined;
    await page.navigate("https://console.cloud.google.com/auth/audience?project=p");
    expect(await page.info()).toEqual({ href: "https://console.cloud.google.com/auth/audience?project=p", lang: "en", ready: "complete" });
  });

  it("queryAXTree returns the exact role+name node with its checked state; nothing when absent", async () => {
    const c = new FakeConsole();
    c.override = () => ({
      text: "t",
      ax: [
        { role: "checkbox", name: "Agree", checked: false },
        { role: "button", name: "Next" },
      ],
    });
    const { page } = await open(c);
    await page.navigate("https://console.cloud.google.com/x");
    expect(await page.queryAXTree("checkbox", "Agree")).toMatchObject({ role: "checkbox", name: "Agree", checked: false });
    expect(await page.queryAXTree("button", "Next")).toMatchObject({ checked: undefined });
    expect(await page.queryAXTree("button", "Agree")).toBeUndefined(); // wrong role
    expect(await page.queryAXTree("checkbox", "agree")).toBeUndefined(); // name is exact
    c.override = () => ({ ax: [{ role: "checkbox", name: "Agree", checked: true }] });
    expect((await page.queryAXTree("checkbox", "Agree"))?.checked).toBe(true);
  });

  it("clickNode presses and releases at the centre of the node's box", async () => {
    const c = new FakeConsole();
    c.override = () => ({ ax: [{ role: "button", name: "Go" }] });
    const { page } = await open(c);
    await page.clickNode((await page.queryAXTree("button", "Go"))!);
    const mouse = c.commands("Input.dispatchMouseEvent").map((e) => e.params);
    expect(mouse).toEqual([
      { type: "mousePressed", x: 15, y: 15, button: "left", clickCount: 1 },
      { type: "mouseReleased", x: 15, y: 15, button: "left", clickCount: 1 },
    ]);
    expect(c.clicks).toEqual(["button:Go"]);
  });

  it("fill focuses + selects the field, then inserts the text", async () => {
    const c = new FakeConsole();
    const typed: string[] = [];
    c.override = () => ({ ax: [{ role: "textbox", name: "Name", onFill: (t) => typed.push(t) }] });
    const { page } = await open(c);
    await page.fill((await page.queryAXTree("textbox", "Name"))!, "pi-dashboard");
    expect(typed).toEqual(["pi-dashboard"]);
    const order = c.log.map((e) => e.method).filter((m) => ["DOM.resolveNode", "Runtime.callFunctionOn", "Input.insertText"].includes(m));
    expect(order).toEqual(["DOM.resolveNode", "Runtime.callFunctionOn", "Input.insertText"]);
  });

  it("evaluate reads page text; keep-alive ping is Runtime.evaluate('1'); bringToFront; close", async () => {
    const c = new FakeConsole();
    c.override = () => ({ text: "hello" });
    const { page } = await open(c);
    await page.navigate("https://console.cloud.google.com/x");
    expect(await page.text()).toBe("hello");
    await page.ping();
    expect(c.commands("Runtime.evaluate").at(-1)?.params).toMatchObject({ expression: "1", returnByValue: true });
    await page.bringToFront();
    expect(c.commands("Page.bringToFront")).toHaveLength(1);
    await page.close();
    expect(c.commands("Target.closeTarget")[0]?.params).toEqual({ targetId: "T1" });
  });

  it("a page exception → CdpError without the exception text", async () => {
    const c = new FakeConsole();
    c.dialogReadThrows = true;
    const { page } = await open(c);
    const err = await page.dialogText().catch((e) => e);
    expect(err).toBeInstanceOf(CdpError);
    expect(err.message).toBe("cdp Runtime.evaluate failed");
  });
});

describe("never puts a payload into an error", () => {
  it("a CDP error carrying page text/secret surfaces as `cdp <method> failed` only", async () => {
    let onMessage: (d: unknown) => void = () => {};
    const sock: WsLike = {
      send: (data) => {
        const m = JSON.parse(data);
        void Promise.resolve().then(() => onMessage(JSON.stringify({ id: m.id, error: { code: -32000, message: "page says GOCSPX-leaked_secret_1" } })));
      },
      close: () => {},
      on: ((ev: string, cb: (d?: unknown) => void) => {
        if (ev === "message") onMessage = cb;
        if (ev === "open") void Promise.resolve().then(() => cb());
        return sock;
      }) as WsLike["on"],
    };
    const conn = await CdpConnection.connect("ws://x", () => sock);
    const err = await conn.send("Runtime.evaluate", { expression: "secret()" }).catch((e) => e);
    expect(err).toBeInstanceOf(CdpError);
    expect(err.code).toBe(-32000);
    expect(String(err.message) + String(err.stack)).not.toContain("GOCSPX");
    expect(String(err.message)).toBe("cdp Runtime.evaluate failed");
  });
});
