/**
 * `DedicatedInstance` over a `FakeChromePipe` (tasks 3.1–3.4; test-plan #E7 #E8
 * #E9 #E11 #E12 #E13 #F1–#F5). See change: add-dedicated-agent-browser.
 */
import { describe, expect, it } from "vitest";
import { viewerSocket } from "../../relay/__tests__/fake-socket.js";
import { CHROME_INTERNAL_ID_BASE } from "../chrome-process.js";
import { makeRig } from "./dedicated-rig.js";

const kinds = (rig: { audit: { list(): Array<{ kind: string; detail: string }> } }, kind: string) =>
  rig.audit.list().filter((e) => e.kind === kind);

describe("id rewriting (#3.1)", () => {
  it("rewrites client ids below the internal range and restores them on the reply", async () => {
    const rig = await makeRig();
    const id = rig.client.send("Browser.getVersion");
    await rig.pipe.flush();
    const written = rig.pipe.commands("Browser.getVersion").at(-1);
    expect(written?.id).toBeTypeOf("number");
    expect(written?.id).toBeLessThan(CHROME_INTERNAL_ID_BASE);
    const reply = rig.client.reply(id);
    expect(reply?.id).toBe(id);
    expect((reply?.result as { product: string } | undefined)?.product).toContain("Chrome");
  });

  it("two clients' identical ids never collide with server-owned commands", async () => {
    const rig = await makeRig();
    // client id 1 twice in a row, interleaved with the server's own setup commands
    rig.serverSocket.deliver(JSON.stringify({ id: 1, method: "Browser.getVersion" }));
    rig.serverSocket.deliver(JSON.stringify({ id: 1, method: "Target.getTargets" }));
    await rig.pipe.flush();
    const ids = rig.pipe.written.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(rig.client.all().filter((m) => m.id === 1)).toHaveLength(2);
  });

  it("restores the session id on a session-bound reply and routes events", async () => {
    const rig = await makeRig();
    await rig.client.call("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
    await rig.pipe.flush();
    const sid = rig.pipe.sessionOf("BLANK0") as string;
    const reply = await rig.client.call("Runtime.evaluate", { expression: "1" }, sid);
    expect(reply.sessionId).toBe(sid);
    rig.pipe.emitSession(sid, "Page.loadEventFired", { timestamp: 1 });
    await rig.pipe.flush();
    expect(rig.client.events("Page.loadEventFired")[0]?.sessionId).toBe(sid);
  });

  it("drops unknown reply ids and malformed client frames", async () => {
    const rig = await makeRig();
    rig.pipe.emit({ id: 123456, result: {} });
    rig.serverSocket.deliver("not json");
    rig.serverSocket.deliver(JSON.stringify({ method: "Browser.getVersion" })); // no id
    await rig.pipe.flush();
    expect(rig.client.all()).toHaveLength(0);
    expect(rig.closed).toEqual([]);
  });
});

describe("#E7 dedicated deny set — URL allow-list", () => {
  const forwarded = ["https://a.test", "http://a.test", "about:blank"];
  const refused = [
    "about:settings",
    "chrome://settings",
    "chrome-untrusted://x",
    "devtools://x",
    "chrome-extension://x/y",
    "file:///etc/passwd",
    "javascript:1",
  ];

  for (const method of ["Page.navigate", "Target.createTarget"] as const) {
    it(`${method}: the first three are forwarded, the rest get -32000 + a denied audit`, async () => {
      const rig = await makeRig();
      // a visible page session for Page.navigate
      await rig.client.call("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
      await rig.pipe.flush();
      const sid = method === "Page.navigate" ? (rig.pipe.sessionOf("BLANK0") as string) : undefined;
      for (const url of forwarded) {
        const before = rig.pipe.commands(method).length;
        const reply = await rig.client.call(method, { url }, sid);
        expect(reply.error, url).toBeUndefined();
        expect(rig.pipe.commands(method).length).toBe(before + 1);
      }
      const written = rig.pipe.commands(method).length;
      for (const url of refused) {
        const reply = await rig.client.call(method, { url }, sid);
        expect((reply.error as { code: number }).code, url).toBe(-32000);
        expect(JSON.stringify(reply.error)).toContain(method);
      }
      expect(rig.pipe.commands(method).length).toBe(written);
      expect(kinds(rig, "denied").filter((e) => e.detail === method)).toHaveLength(refused.length);
    });
  }

  it("a navigate without a url is refused (fail closed)", async () => {
    const rig = await makeRig();
    await rig.client.call("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
    await rig.pipe.flush();
    const reply = await rig.client.call("Page.navigate", {}, rig.pipe.sessionOf("BLANK0"));
    expect((reply.error as { code: number }).code).toBe(-32000);
  });
});

describe("#E8 dedicated deny set — methods", () => {
  const methods: Array<[string, Record<string, unknown>?]> = [
    ["Target.attachToBrowserTarget"],
    ["Target.exposeDevToolsProtocol", { targetId: "BLANK0" }],
    ["Browser.close"],
    ["Browser.crash"],
    ["Browser.crashGpuProcess"],
    ["Browser.setPermission", { permission: { name: "geolocation" }, setting: "granted" }],
    ["Browser.grantPermissions", { permissions: ["geolocation"] }],
    ["Browser.resetPermissions"],
    ["Extensions.loadUnpacked", { path: "/tmp/x" }],
    ["Extensions.getExtensions"],
    ["Tethering.bind", { port: 1 }],
    ["Tethering.unbind", { port: 1 }],
    ["Network.setCookie", { name: "a", value: "b" }],
    ["Network.setCookies", { cookies: [] }],
    ["Network.deleteCookies", { name: "a" }],
    ["Network.clearBrowserCookies"],
    ["Storage.setCookies", { cookies: [] }],
    ["Storage.clearCookies"],
    ["Storage.clearDataForOrigin", { origin: "https://accounts.google.com", storageTypes: "cookies" }],
    ["Storage.clearDataForStorageKey", { storageKey: "k", storageTypes: "all" }],
    ["Storage.getCookies"],
    ["Network.getAllCookies"],
    ["Fetch.enable"],
    ["Network.enable"],
    ["Target.sendMessageToTarget", { message: "{}", sessionId: "x" }],
    ["Target.fooBar"],
  ];
  for (const [method, params] of methods) {
    it(`${method} is answered with the deny error and never written to the pipe`, async () => {
      const rig = await makeRig();
      const before = rig.pipe.written.length;
      const reply = await rig.client.call(method, params);
      expect(reply.error).toMatchObject({ code: -32000 });
      expect((reply.error as { message: string }).message).toContain(method);
      expect(rig.pipe.written.length).toBe(before);
      expect(kinds(rig, "denied").some((e) => e.detail === method)).toBe(true);
    });
  }

  it("Fetch.* / Network.* are denied browser-level only; a page session may use them", async () => {
    const rig = await makeRig();
    await rig.client.call("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
    await rig.pipe.flush();
    const sid = rig.pipe.sessionOf("BLANK0") as string;
    expect((await rig.client.call("Network.enable", {}, sid)).error).toBeUndefined();
    expect((await rig.client.call("Fetch.enable", {}, sid)).error).toBeUndefined();
    // …but cookie writes stay denied everywhere
    expect((await rig.client.call("Network.setCookie", { name: "a", value: "b" }, sid)).error).toBeDefined();
  });

  it("ordinary automation is forwarded unchanged", async () => {
    const rig = await makeRig();
    await rig.client.call("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
    await rig.pipe.flush();
    const sid = rig.pipe.sessionOf("BLANK0") as string;
    for (const method of ["Runtime.evaluate", "DOM.getDocument", "Input.dispatchMouseEvent"]) {
      const reply = await rig.client.call(method, {}, sid);
      expect(reply.error, method).toBeUndefined();
    }
    expect((await rig.client.call("Browser.getWindowForTarget", { targetId: "BLANK0" })).error).toBeUndefined();
  });
});

describe("#E9 ack-and-drop", () => {
  it("Page.setDownloadBehavior and Browser.setDownloadBehavior: empty success, dropped audit, not forwarded", async () => {
    const rig = await makeRig();
    await rig.client.call("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
    await rig.pipe.flush();
    const sid = rig.pipe.sessionOf("BLANK0") as string;
    const a = await rig.client.call("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: "/tmp" });
    const b = await rig.client.call("Page.setDownloadBehavior", { behavior: "allow", downloadPath: "/tmp" }, sid);
    expect(a.result).toEqual({});
    expect(b.result).toEqual({});
    expect(b.sessionId).toBe(sid);
    expect(rig.pipe.commands("Browser.setDownloadBehavior")).toHaveLength(0);
    expect(rig.pipe.commands("Page.setDownloadBehavior")).toHaveLength(0);
    expect(kinds(rig, "dropped").map((e) => e.detail).sort()).toEqual(["Browser.setDownloadBehavior", "Page.setDownloadBehavior"]);
    expect(kinds(rig, "denied")).toHaveLength(0);
  });
});

describe("#E11 cookie stripping", () => {
  it("removes Cookie / Set-Cookie and cookie fields from forwarded Network events, other headers intact", async () => {
    const rig = await makeRig();
    await rig.client.call("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
    await rig.pipe.flush();
    const sid = rig.pipe.sessionOf("BLANK0") as string;
    rig.pipe.emitSession(sid, "Network.requestWillBeSent", {
      requestId: "1",
      request: { url: "https://a.test/", method: "GET", headers: { Cookie: "sid=SECRET", Accept: "*/*" } },
    });
    rig.pipe.emitSession(sid, "Network.requestWillBeSentExtraInfo", {
      requestId: "1",
      headers: { cookie: "sid=SECRET", "User-Agent": "x" },
      associatedCookies: [{ blockedReasons: [], cookie: { name: "sid", value: "SECRET" } }],
    });
    rig.pipe.emitSession(sid, "Network.responseReceivedExtraInfo", {
      requestId: "1",
      headers: { "Set-Cookie": "sid=SECRET; HttpOnly", "Content-Type": "text/html" },
      headersText: "HTTP/1.1 200 OK\r\nSet-Cookie: sid=SECRET\r\nContent-Type: text/html\r\n\r\n",
      blockedCookies: [{ blockedReasons: ["SecureOnly"], cookie: { name: "sid", value: "SECRET" } }],
    });
    rig.pipe.emitSession(sid, "Network.responseReceived", {
      requestId: "1",
      response: { url: "https://a.test/", status: 200, headers: { "set-cookie": "sid=SECRET", Server: "nginx" }, requestHeaders: { Cookie: "sid=SECRET" } },
    });
    rig.pipe.emitSession(sid, "Fetch.requestPaused", {
      requestId: "f1",
      request: { url: "https://a.test/", headers: { Cookie: "sid=SECRET", Accept: "*/*" } },
      responseHeaders: [{ name: "Set-Cookie", value: "sid=SECRET" }, { name: "ETag", value: "abc" }],
    });
    await rig.pipe.flush();

    const wire = rig.client.socket.received.join("\n");
    expect(wire).not.toContain("SECRET");
    expect(wire.toLowerCase()).not.toContain("set-cookie");
    const sent = rig.client.events("Network.requestWillBeSent")[0].params as { request: { headers: Record<string, string> } };
    expect(sent.request.headers).toEqual({ Accept: "*/*" });
    const extra = rig.client.events("Network.requestWillBeSentExtraInfo")[0].params as { headers: Record<string, string>; associatedCookies: unknown[] };
    expect(extra.headers).toEqual({ "User-Agent": "x" });
    expect(extra.associatedCookies).toEqual([]);
    const resp = rig.client.events("Network.responseReceivedExtraInfo")[0].params as { headers: Record<string, string>; headersText: string; blockedCookies: unknown[] };
    expect(resp.headers).toEqual({ "Content-Type": "text/html" });
    expect(resp.headersText).toContain("Content-Type: text/html");
    expect(resp.blockedCookies).toEqual([]);
    const paused = rig.client.events("Fetch.requestPaused")[0].params as { responseHeaders: Array<{ name: string }> };
    expect(paused.responseHeaders.map((h) => h.name)).toEqual(["ETag"]);
  });

  it("non-Network events pass through untouched", async () => {
    const rig = await makeRig();
    await rig.client.call("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
    await rig.pipe.flush();
    const sid = rig.pipe.sessionOf("BLANK0") as string;
    rig.pipe.emitSession(sid, "Runtime.consoleAPICalled", { type: "log", args: [{ type: "string", value: "cookie=1" }] });
    await rig.pipe.flush();
    expect(JSON.stringify(rig.client.events("Runtime.consoleAPICalled")[0].params)).toContain("cookie=1");
  });
});

describe("#E12 effective allowed domains (dedicated half: global list only)", () => {
  const cases: Array<{ global: string[]; allowed: boolean }> = [
    { global: [], allowed: true },
    { global: ["github.com"], allowed: false },
  ];
  for (const c of cases) {
    it(`global=${JSON.stringify(c.global)} → https://example.com ${c.allowed ? "allowed" : "denied"}`, async () => {
      const rig = await makeRig({ global: c.global });
      const reply = await rig.client.call("Target.createTarget", { url: "https://example.com" });
      expect(reply.error === undefined).toBe(c.allowed);
      expect(kinds(rig, "denied").length).toBe(c.allowed ? 0 : 1);
    });
  }

  it("a profile list cannot exist for the dedicated profile: global list is the only input (live getter)", async () => {
    let list: string[] = ["github.com"];
    const rig = await makeRig({ deps: { globalAllowedDomains: () => list } });
    expect((await rig.client.call("Target.createTarget", { url: "https://example.com" })).error).toBeDefined();
    list = ["example.com"];
    expect((await rig.client.call("Target.createTarget", { url: "https://example.com" })).error).toBeUndefined();
  });

  it("exact about:blank is exempt from the domain list (Playwright newPage needs it); other hostless URLs are not", async () => {
    const rig = await makeRig({ global: ["github.com"] });
    expect((await rig.client.call("Target.createTarget", { url: "about:blank" })).error).toBeUndefined();
    expect((await rig.client.call("Target.createTarget", { url: "about:blank#x" })).error).toBeDefined();
  });

  it("cookie reads stay denied (relay deny-list runs first)", async () => {
    const rig = await makeRig();
    expect((await rig.client.call("Network.getCookies")).error).toBeDefined();
  });
});

describe("#E13 audit trail query stripping (dedicated half)", () => {
  it("navigate and createTarget details lose query and fragment", async () => {
    const rig = await makeRig();
    await rig.client.call("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
    await rig.pipe.flush();
    await rig.client.call("Page.navigate", { url: "https://example.com/cb?code=abc#state=x" }, rig.pipe.sessionOf("BLANK0"));
    await rig.client.call("Target.createTarget", { url: "https://example.com/cb?code=abc#state=x" });
    expect(kinds(rig, "navigate").map((e) => e.detail)).toEqual(["https://example.com/cb"]);
    expect(kinds(rig, "createTarget").map((e) => e.detail)).toEqual(["https://example.com/cb"]);
    expect(JSON.stringify(rig.audit.list())).not.toContain("code=abc");
  });
});

describe("audit rows are profile @dedicated with the instance id", () => {
  it("denied rows carry profile and instance", async () => {
    const rig = await makeRig();
    await rig.client.call("Network.getAllCookies");
    const [row] = rig.audit.list();
    expect(row).toMatchObject({ profileDirectory: "@dedicated", instanceId: "inst-ded", kind: "denied", detail: "Network.getAllCookies" });
  });
});

describe("lifecycle", () => {
  it("client close: closes the targets the client created and the instance; Chrome keeps running", async () => {
    const rig = await makeRig();
    await rig.client.call("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
    const created = (await rig.client.call("Target.createTarget", { url: "https://a.test/" })).result as { targetId: string };
    const ctx = (await rig.client.call("Target.createBrowserContext")).result as { browserContextId: string };
    await rig.pipe.flush();
    rig.serverSocket.close(1000, "bye");
    await rig.pipe.flush();
    expect(rig.closed).toEqual(["cdp-closed"]);
    expect(rig.instance.isClosed).toBe(true);
    expect(rig.pipe.commands("Target.closeTarget").map((c) => c.params?.targetId)).toEqual([created.targetId]);
    expect(rig.pipe.commands("Target.disposeBrowserContext").map((c) => c.params?.browserContextId)).toEqual([ctx.browserContextId]);
    // the server's browser-level state is undone for the next instance
    expect(rig.pipe.autoAttach.on).toBe(false);
    expect(rig.pipe.discover).toBe(false);
    // Chrome is never asked to quit
    expect(rig.pipe.commands("Browser.close")).toHaveLength(0);
    expect(rig.pipe.targets.has("BLANK0")).toBe(true);
  });

  it("does not close targets it did not create (a user tab, a hidden tab)", async () => {
    const rig = await makeRig();
    const user = rig.pipe.addTarget({ url: "https://user.test/" });
    const { targetId: hiddenId } = await rig.instance.openHiddenTab("https://accounts.google.com/");
    rig.instance.close("x");
    expect(rig.pipe.commands("Target.closeTarget")).toHaveLength(0);
    expect(rig.pipe.targets.has(user)).toBe(true);
    expect(rig.pipe.targets.has(hiddenId)).toBe(true);
  });

  it("an unexpected Chrome exit audits detach closed:chrome-exited and closes the client socket", async () => {
    const rig = await makeRig();
    rig.pipe.exit({ expected: false });
    expect(rig.closed).toEqual(["chrome-exited"]);
    expect(kinds(rig, "detach").map((e) => e.detail)).toEqual(["closed:chrome-exited"]);
    expect(rig.serverSocket.closed.at(-1)?.reason).toBe("chrome-exited");
  });

  it("an expected exit (stop) closes without a detach row", async () => {
    const rig = await makeRig();
    rig.pipe.exit({ expected: true });
    expect(rig.closed).toEqual(["chrome-stopped"]);
    expect(kinds(rig, "detach")).toHaveLength(0);
  });

  it("closeWithDetach audits the cause once and closes once", async () => {
    const rig = await makeRig({ attach: false });
    rig.instance.closeWithDetach("no-cdp-client");
    rig.instance.closeWithDetach("idle");
    rig.instance.close("again");
    expect(rig.closed).toEqual(["no-cdp-client"]);
    expect(kinds(rig, "detach").map((e) => e.detail)).toEqual(["no-cdp-client"]);
  });

  it("a second client is refused; statusState follows the client", async () => {
    const rig = await makeRig({ attach: false });
    expect(rig.instance.statusState()).toBe("no-cdp-client");
    rig.instance.attachCdp(rig.serverSocket);
    expect(rig.instance.statusState()).toBe("connected");
    const other = viewerSocket();
    rig.instance.attachCdp(other);
    expect(other.closed[0]?.reason).toBe("Another CDP client already connected");
    expect(rig.closed).toEqual([]);
  });

  it("lastActivity is stamped by client commands (not events), lastUsed via chrome.touch", async () => {
    let t = 1000;
    const rig = await makeRig({ deps: { now: () => t } });
    expect(rig.instance.lastActivity).toBe(1000);
    t = 2000;
    rig.pipe.emit({ method: "Target.targetCreated", params: { targetInfo: { targetId: "Z", type: "page", title: "", url: "about:blank" } } });
    await rig.pipe.flush();
    expect(rig.instance.lastActivity).toBe(1000);
    const touched = rig.pipe.touched;
    await rig.client.call("Browser.getVersion");
    expect(rig.instance.lastActivity).toBe(2000);
    expect(rig.pipe.touched).toBe(touched + 1);
  });

  it("holder and instance id are exposed", async () => {
    const rig = await makeRig({ deps: { holder: { sessionId: "S1" } } });
    expect(rig.instance.holder).toEqual({ sessionId: "S1" });
    expect(rig.instance.instanceId).toBe("inst-ded");
    expect(rig.instance.profileDirectory).toBe("@dedicated");
  });
});

describe("server session setup", () => {
  it("re-arms discovery and auto-attach at attach (false→true so existing targets re-attach)", async () => {
    const rig = await makeRig();
    const setups = rig.pipe.commands("Target.setAutoAttach").map((c) => c.params?.autoAttach);
    expect(setups).toEqual([false, true]);
    expect(rig.pipe.commands("Target.setAutoAttach")[1].params).toMatchObject({ waitForDebuggerOnStart: true, flatten: true });
    expect(rig.pipe.discover).toBe(true);
    expect(rig.pipe.sessionOf("BLANK0")).toBeDefined();
  });

  it("does not forward the client's browser-level setDiscoverTargets / setAutoAttach", async () => {
    const rig = await makeRig();
    const before = rig.pipe.written.length;
    await rig.client.call("Target.setDiscoverTargets", { discover: true });
    await rig.client.call("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
    expect(rig.pipe.written.length).toBe(before);
  });
});
