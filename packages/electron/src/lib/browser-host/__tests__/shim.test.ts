/**
 * Loopback relay shim — real `ws` pair on 127.0.0.1 with a fake extension.
 * See change: add-operator-browser-relay (test-plan #E39 #E40 #E41 #E43 #X10).
 */
import net from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserHostExtEvent } from "@blackbelt-technology/pi-dashboard-shared/browser-host-ipc.js";
import { createShim, type Shim } from "../shim.js";
import { EXT_ORIGIN, FakeExtension, until } from "./fixtures.js";

let shim: Shim;
let events: BrowserHostExtEvent[];
beforeEach(() => {
  events = [];
  shim = createShim({ log: () => {} });
  shim.onEvent((e) => events.push(e));
});
afterEach(() => {
  vi.useRealTimers();
  shim.closeAll();
});
const opens = () => events.filter((e) => e.kind === "open");
const L = "link-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const refuses = (port: number): Promise<boolean> =>
  new Promise((resolve) => {
    const s = net.connect(port, "127.0.0.1");
    s.on("connect", () => {
      s.destroy();
      resolve(false);
    });
    s.on("error", () => resolve(true));
  });

describe("shim accept + relay (E39)", () => {
  it("accepts the pinned Origin for a registered link, emits ext_open and relays both ways", async () => {
    const port = await shim.register(L);
    const ext = new FakeExtension();
    await ext.connect(port, L);
    await until(() => opens().length === 1);
    expect(opens()[0]).toEqual({ kind: "open", linkId: L });

    ext.ws.send('{"method":"chrome.debugger.onEvent","params":[]}');
    await until(() => events.some((e) => e.kind === "data"));
    expect(events.find((e) => e.kind === "data")).toEqual({ kind: "data", linkId: L, data: '{"method":"chrome.debugger.onEvent","params":[]}' });

    shim.send(L, '{"id":1,"method":"attachToTab"}');
    await until(() => ext.received.length === 1);
    expect(ext.received[0]).toBe('{"id":1,"method":"attachToTab"}');
  });

  it("binds to loopback only", async () => {
    const port = await shim.register(L);
    expect(port).toBeGreaterThan(0);
    expect(shim.port()).toBe(port);
    expect(shim.address()).toBe("127.0.0.1");
  });
});

describe("shim refusals (E40)", () => {
  it("rejects a web Origin, no Origin, an unknown path and a claimed link; no extra ext_open", async () => {
    const port = await shim.register(L);
    await expect(new FakeExtension().connect(port, L, "http://localhost:5173")).rejects.toThrow(/404/);
    await expect(new FakeExtension().connect(port, L, null)).rejects.toThrow(/404/);
    await expect(new FakeExtension().connect(port, "unknown-link", EXT_ORIGIN)).rejects.toThrow(/404/);
    expect(opens()).toHaveLength(0);

    const first = new FakeExtension();
    await first.connect(port, L);
    await until(() => opens().length === 1);
    await expect(new FakeExtension().connect(port, L)).rejects.toThrow(/404/);
    await new Promise((r) => setTimeout(r, 50));
    expect(opens()).toHaveLength(1);
  });

  it("answers plain HTTP with 404", async () => {
    const port = await shim.register(L);
    const res = await fetch(`http://127.0.0.1:${port}/ws/browser-ext/${L}`);
    expect(res.status).toBe(404);
  });

  it("a rejected dial does not consume the link", async () => {
    const port = await shim.register(L);
    await expect(new FakeExtension().connect(port, L, "http://evil.example")).rejects.toThrow();
    const ext = new FakeExtension();
    await ext.connect(port, L);
    await until(() => opens().length === 1);
  });
});

describe("shim lifecycle", () => {
  it("E41: stops listening when the last link closes", async () => {
    const port = await shim.register(L);
    const ext = new FakeExtension();
    await ext.connect(port, L);
    await until(() => opens().length === 1);
    ext.ws.close(1000);
    await until(() => events.some((e) => e.kind === "close"));
    await until(() => shim.port() === undefined);
    expect(await refuses(port)).toBe(true);
  });

  it("X10: extension close emits ext_close with the code", async () => {
    const port = await shim.register(L);
    const ext = new FakeExtension();
    await ext.connect(port, L);
    await until(() => opens().length === 1);
    ext.ws.close(1000, "bye");
    await until(() => events.some((e) => e.kind === "close"));
    expect(events.find((e) => e.kind === "close")).toEqual({ kind: "close", linkId: L, code: 1000 });
  });

  it("keeps listening while another link is registered, one listener for all links", async () => {
    const p1 = await shim.register(L);
    const p2 = await shim.register("link-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
    expect(p2).toBe(p1);
    shim.unregister(L);
    expect(shim.port()).toBe(p1);
    shim.unregister("link-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
    await until(() => shim.port() === undefined);
  });

  it("E43: unregister (cancel) closes the attached extension socket and frees the link without events", async () => {
    const port = await shim.register(L);
    const ext = new FakeExtension();
    await ext.connect(port, L);
    await until(() => opens().length === 1);
    shim.unregister(L);
    await ext.closed;
    expect(shim.has(L)).toBe(false);
    expect(events.some((e) => e.kind === "close")).toBe(false);
    await until(() => shim.port() === undefined);
  });

  it("close(linkId, code) closes the extension with that code and unregisters without echoing ext_close", async () => {
    const port = await shim.register(L);
    const ext = new FakeExtension();
    await ext.connect(port, L);
    await until(() => opens().length === 1);
    shim.close(L, 1013);
    expect(await ext.closed).toBe(1013);
    expect(shim.has(L)).toBe(false);
    expect(events.some((e) => e.kind === "close")).toBe(false);
  });

  it("an unclaimed link expires after 60 s and the listener stops", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await shim.register(L);
    expect(shim.has(L)).toBe(true);
    await vi.advanceTimersByTimeAsync(59_999);
    expect(shim.has(L)).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(shim.has(L)).toBe(false);
    vi.useRealTimers();
    await until(() => shim.port() === undefined);
  });

  it("closeAll() unregisters every link and extension", async () => {
    const port = await shim.register(L);
    const ext = new FakeExtension();
    await ext.connect(port, L);
    await until(() => opens().length === 1);
    shim.closeAll();
    await ext.closed;
    await until(() => shim.port() === undefined);
  });

  it("send/close for an unknown link are no-ops", () => {
    expect(() => shim.send("nope", "x")).not.toThrow();
    expect(() => shim.close("nope", 1000)).not.toThrow();
  });
});
