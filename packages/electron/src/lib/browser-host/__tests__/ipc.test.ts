/**
 * Browser-host IPC: trusted-sender gating, connect → consent → Chrome launch →
 * shim flow, cancel / navigation teardown, tee, token + identity hygiene. Fake
 * ipcMain / window / dialog / launcher; real shim + `ws` fake extension.
 * See change: add-operator-browser-relay (test-plan #E35 #E39–#E51 #E53 #E54 #X10 #X11).
 */
import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { verifyHostSignature } from "@blackbelt-technology/pi-dashboard-shared/browser-host-identity.js";
import { type BrowserHostConnectAnswer, type BrowserHostFrame, type BrowserHostIdentity, BROWSER_HOST_CHANNELS as CH } from "@blackbelt-technology/pi-dashboard-shared/browser-host-ipc.js";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { isTrustedSenderUrl, type SenderEventLike, UntrustedSenderError } from "../../ipc-trust.js";
import type { DialogPort } from "../consent.js";
import { type BrowserHost, createBrowserHost } from "../ipc.js";
import { FakeExtension, fakeCrypto, noCrypto, tempDir, until } from "./fixtures.js";

const LOCAL = "http://localhost:8000";
const TARGET = "http://192.168.16.204:8000";
const LINK = "link-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const ALLOW_ONCE = 0;
const ALWAYS = 1;
const DENY = 2;

type Handler = (event: unknown, ...a: unknown[]) => unknown;
class FakeIpcMain {
  handlers = new Map<string, Handler>();
  listeners = new Map<string, Handler>();
  handle(c: string, h: Handler) { this.handlers.set(c, h); }
  removeHandler(c: string) { this.handlers.delete(c); }
  on(c: string, h: Handler) { this.listeners.set(c, h); }
  removeListener(c: string) { this.listeners.delete(c); }
}

let tmp: ReturnType<typeof tempDir>;
let ipc: FakeIpcMain;
let host: BrowserHost;
let win: EventEmitter & { webContents: EventEmitter & { send: ReturnType<typeof vi.fn>; isDestroyed: () => boolean } };
let launches: Array<{ cmd: string; args: string[] }>;
let logs: string[];
let health: { instanceId: string | Error };
let dialogShow: Mock<(o: unknown, s: AbortSignal) => Promise<number>>;
let canOpen: boolean;
let extensions: FakeExtension[];

const trusted = (url: string) => ({ sender: win.webContents, senderFrame: { url } });
const local = () => trusted(`${LOCAL}/`);
const invoke = (c: string, ...a: unknown[]) => ipc.handlers.get(c)!(local(), ...a);
const fire = (c: string, ...a: unknown[]) => ipc.listeners.get(c)!(local(), ...a);
const pushes = <T>(channel: string): T[] => win.webContents.send.mock.calls.filter((c) => c[0] === channel).map((c) => c[1] as T);
const answers = () => pushes<BrowserHostConnectAnswer>(CH.connectAnswer);
const extEvents = () => pushes<{ kind: string; linkId: string; data?: string; code?: number }>(CH.extEvent);
const lastUrl = () => new URL(launches.at(-1)!.args.at(-1)!);
const connectReq = (over: Record<string, unknown> = {}) => ({ requestId: "R1", linkId: LINK, instanceId: "inst-1", profileDirectory: "Default", serverLabel: "mac-home:8000", ...over });
const portOfLaunch = () => Number(new URL(lastUrl().searchParams.get("mcpRelayUrl")!).port);

function build(over: { crypto?: ReturnType<typeof fakeCrypto>; launch?: (cmd: string, args: string[]) => void; now?: () => number } = {}) {
  ipc = new FakeIpcMain();
  host = createBrowserHost({
    ipcMain: ipc,
    isTrustedSender: (e: SenderEventLike) => isTrustedSenderUrl(e.senderFrame?.url, { loadingPagePath: "/x/loading.html", localPort: 8000 }),
    dir: tmp.dir,
    crypto: over.crypto ?? fakeCrypto(),
    platform: "linux",
    hostLabel: () => "operator-mac",
    chrome: { canOpen: () => canOpen, listProfiles: async () => [{ profileDirectory: "Default", label: "Me", installed: true }, { profileDirectory: "Profile 1", label: "Other", installed: true }] },
    dialog: { show: (...a: Parameters<DialogPort["show"]>) => dialogShow(...a) } as DialogPort,
    launch: over.launch ?? ((cmd, args) => void launches.push({ cmd, args })),
    fetchImpl: (async () => {
      if (health.instanceId instanceof Error) throw health.instanceId;
      return { ok: true, json: async () => ({ instanceId: health.instanceId }) };
    }) as never,
    log: (l) => void logs.push(l),
    now: over.now,
  });
  host.attachWindow(win as never);
}

beforeEach(() => {
  tmp = tempDir();
  launches = [];
  logs = [];
  extensions = [];
  health = { instanceId: "I1" };
  canOpen = true;
  dialogShow = vi.fn(async (_o: unknown, _s: AbortSignal) => ALLOW_ONCE);
  const wc = Object.assign(new EventEmitter(), { send: vi.fn(), isDestroyed: () => false });
  win = Object.assign(new EventEmitter(), { webContents: wc });
  build();
});
afterEach(() => {
  host.dispose();
  for (const e of extensions) e.ws?.terminate();
  tmp.cleanup();
  vi.useRealTimers();
});

async function connect(over: Record<string, unknown> = {}) {
  await invoke(CH.setTarget, TARGET);
  await invoke(CH.connect, connectReq(over));
}
async function attachExtension(linkId = LINK): Promise<FakeExtension> {
  const ext = new FakeExtension();
  extensions.push(ext);
  await ext.connect(portOfLaunch(), linkId);
  return ext;
}

describe("trusted-sender gating (E35)", () => {
  const remote = () => trusted("http://192.168.16.204:8000/");
  it("every invoke channel rejects a remote-origin sender with UntrustedSenderError and does nothing", async () => {
    const invokes = [CH.identity, CH.sign, CH.setTarget, CH.connect, CH.cancelConnect, CH.setToken, CH.listConsents, CH.revokeConsent];
    for (const c of invokes) {
      const h = ipc.handlers.get(c);
      expect(h, c).toBeDefined();
      expect(() => h!(remote(), "a", "b"), c).toThrow(UntrustedSenderError);
    }
    expect(dialogShow).not.toHaveBeenCalled();
    expect(launches).toHaveLength(0);
  });

  it("fire-and-forget channels drop a remote sender silently", () => {
    for (const c of [CH.extSend, CH.extClose, CH.tee]) {
      expect(() => ipc.listeners.get(c)!(remote(), LINK, "x", 1, true), c).not.toThrow();
    }
  });

  it("a trusted URL from ANOTHER window (not the attached main window) is refused", () => {
    const other = { sender: new EventEmitter(), senderFrame: { url: `${LOCAL}/` } };
    expect(() => ipc.handlers.get(CH.identity)!(other)).toThrow(UntrustedSenderError);
  });

  it("the loading-page file URL alone does not make a carrier of another window", () => {
    expect(() => ipc.handlers.get(CH.listConsents)!({ sender: new EventEmitter(), senderFrame: { url: `file:///x/loading.html` } })).toThrow(UntrustedSenderError);
  });
});

describe("identity + sign over IPC (E36 E38)", () => {
  it("identity() returns the contract fields only; sign verifies for the fetched instanceId", async () => {
    const id = (await invoke(CH.identity)) as BrowserHostIdentity;
    expect(Object.keys(id).sort()).toEqual(["canOpenChrome", "hostId", "label", "platform", "profiles", "publicKey"]);
    expect(id.label).toBe("operator-mac");
    await invoke(CH.setTarget, TARGET);
    const sig = (await invoke(CH.sign, "nonce-1", "I1")) as string;
    expect(verifyHostSignature(id.publicKey, "nonce-1", "I1", sig)).toBe(true);
    await expect(invoke(CH.sign, "nonce-1", "I2")).rejects.toThrow();
  });

  it("sign refuses before any target is set", async () => {
    await expect(invoke(CH.sign, "nonce-1", "I1")).rejects.toThrow();
  });

  it("E36: no IPC return value or push contains the private key", async () => {
    const crypto = fakeCrypto();
    host.dispose();
    build({ crypto });
    const id = await invoke(CH.identity);
    await invoke(CH.setTarget, TARGET);
    const sig = await invoke(CH.sign, "n", "I1");
    const stored = JSON.parse(fs.readFileSync(path.join(tmp.dir, "browser-host-key.json"), "utf8")) as { privateKey: { data: string } };
    const priv = crypto.decryptString(Buffer.from(stored.privateKey.data, "base64"));
    expect(JSON.stringify([id, sig, win.webContents.send.mock.calls])).not.toContain(priv);
  });
});

describe("connect → consent → launch (E39 E44 E45 E47 E53 X11)", () => {
  it("E39: Allow → Chrome opened on connect.html with the loopback shim URL + protocolVersion=2; ext_open reaches the renderer", async () => {
    await connect();
    await until(() => launches.length === 1);
    await until(() => answers().length === 1);
    expect(answers()[0]).toEqual({ requestId: "R1", ok: true });
    expect(launches[0]!.args).toContain("--profile-directory=Default");
    const url = lastUrl();
    expect(url.protocol).toBe("chrome-extension:");
    expect(url.host).toBe("mmlmfjhmonkocbjadbfplnigmagldckm");
    expect(url.pathname).toBe("/connect.html");
    const relay = new URL(url.searchParams.get("mcpRelayUrl")!);
    expect(relay.protocol).toBe("ws:");
    expect(relay.hostname).toBe("127.0.0.1");
    expect(relay.pathname).toBe(`/ws/browser-ext/${LINK}`);
    expect(JSON.parse(url.searchParams.get("client")!)).toEqual({ name: "pi-dashboard" });
    expect(url.searchParams.get("protocolVersion")).toBe("2");
    expect(url.searchParams.has("token")).toBe(false);

    const ext = await attachExtension();
    await until(() => extEvents().some((e) => e.kind === "open"));
    ext.ws.send("from-extension");
    await until(() => extEvents().some((e) => e.kind === "data"));
    expect(extEvents().find((e) => e.kind === "data")).toEqual({ kind: "data", linkId: LINK, data: "from-extension" });
    fire(CH.extSend, LINK, "to-extension");
    await until(() => ext.received.length === 1);
    expect(ext.received[0]).toBe("to-extension");
  });

  it("E44: Always allow → dialog once, Chrome launched twice, consent file has one entry", async () => {
    dialogShow.mockResolvedValue(ALWAYS);
    await connect();
    await until(() => launches.length === 1);
    await invoke(CH.connect, connectReq({ requestId: "R2", linkId: "link-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" }));
    await until(() => launches.length === 2);
    expect(dialogShow).toHaveBeenCalledTimes(1);
    const file = JSON.parse(fs.readFileSync(path.join(tmp.dir, "browser-host-consent.json"), "utf8")) as { consents: Record<string, unknown> };
    expect(Object.keys(file.consents)).toHaveLength(1);
    expect((await invoke(CH.listConsents)) as unknown[]).toHaveLength(1);
  });

  it("audit #4: after a Deny the same (target, profile) is auto-denied for 60 s without a new dialog", async () => {
    let t = 1_000_000;
    host.dispose();
    build({ now: () => t });
    dialogShow.mockResolvedValue(DENY);
    await connect({ requestId: "R1" });
    await until(() => answers().length === 1);
    await invoke(CH.connect, connectReq({ requestId: "R2", linkId: "link-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" }));
    await until(() => answers().length === 2);
    expect(answers().map((a) => a.reason)).toEqual(["denied", "denied"]);
    expect(dialogShow).toHaveBeenCalledTimes(1);
    expect(launches).toHaveLength(0);
    t += 60_001;
    await invoke(CH.connect, connectReq({ requestId: "R3", linkId: "link-cccccccccccccccccccccccccccccccc" }));
    await until(() => answers().length === 3);
    expect(dialogShow).toHaveBeenCalledTimes(2);
  });

  it("audit #5: a profileDirectory that is not one of this machine's profiles is refused (not-installed), no dialog, no launch", async () => {
    await connect({ profileDirectory: "Profile 99" });
    await until(() => answers().length === 1);
    expect(answers()[0]).toMatchObject({ ok: false, reason: "not-installed" });
    expect(dialogShow).not.toHaveBeenCalled();
    expect(launches).toHaveLength(0);
  });

  it("E45: Deny → respondConnect(false,'denied'), no launch, no link", async () => {
    dialogShow.mockResolvedValue(DENY);
    await connect();
    await until(() => answers().length === 1);
    expect(answers()[0]).toEqual({ requestId: "R1", ok: false, reason: "denied" });
    expect(launches).toHaveLength(0);
  });

  it("E47: a consent for (origin, I1) does not apply once the target reports I2", async () => {
    dialogShow.mockResolvedValue(ALWAYS);
    await connect();
    await until(() => launches.length === 1);
    health.instanceId = "I2";
    await invoke(CH.connect, connectReq({ requestId: "R2", linkId: "link-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" }));
    await until(() => launches.length === 2);
    expect(dialogShow).toHaveBeenCalledTimes(2);
  });

  it("E53: no desktop Chrome → no-chrome, no dialog, no launch", async () => {
    canOpen = false;
    await connect();
    await until(() => answers().length === 1);
    expect(answers()[0]).toEqual({ requestId: "R1", ok: false, reason: "no-chrome" });
    expect(dialogShow).not.toHaveBeenCalled();
    expect(launches).toHaveLength(0);
  });

  it("X11: target /api/health fails → server-unverified, no dialog, no launch", async () => {
    health.instanceId = new Error("ECONNREFUSED");
    await connect();
    await until(() => answers().length === 1);
    expect(answers()[0]).toEqual({ requestId: "R1", ok: false, reason: "server-unverified" });
    expect(dialogShow).not.toHaveBeenCalled();
    expect(launches).toHaveLength(0);
  });

  it("no target set → server-unverified", async () => {
    await invoke(CH.connect, connectReq());
    await until(() => answers().length === 1);
    expect(answers()[0]).toMatchObject({ ok: false, reason: "server-unverified" });
  });

  it("a launch failure answers launch-failed", async () => {
    host.dispose();
    build({
      launch: () => {
        throw new Error("spawn failed");
      },
    });
    await connect();
    await until(() => answers().length === 1);
    expect(answers()[0]).toEqual({ requestId: "R1", ok: false, reason: "launch-failed" });
  });

  it("rejects malformed connect requests with 'invalid' (no dialog)", async () => {
    await invoke(CH.setTarget, TARGET);
    for (const bad of [connectReq({ profileDirectory: "../etc" }), connectReq({ profileDirectory: "a/b" }), connectReq({ profileDirectory: "--user-data-dir=x" }), connectReq({ linkId: "bad link!" }), connectReq({ requestId: "" }), connectReq({ serverLabel: 5 })]) {
      await invoke(CH.connect, bad);
    }
    await until(() => answers().length >= 1);
    expect(dialogShow).not.toHaveBeenCalled();
    expect(launches).toHaveLength(0);
    expect(answers().every((a) => a.ok === false && a.reason === "invalid")).toBe(true);
  });

  it("caps concurrent pending connects (host-busy) so a hostile server cannot flood dialogs", async () => {
    dialogShow.mockImplementation(() => new Promise<number>(() => {}));
    await invoke(CH.setTarget, TARGET);
    for (let i = 0; i < 6; i++) await invoke(CH.connect, connectReq({ requestId: `R${i}`, linkId: `link-${String(i).padStart(32, "0")}` }));
    await until(() => answers().some((a) => a.reason === "host-busy"));
    expect(dialogShow.mock.calls.length).toBeLessThanOrEqual(4);
  });
});

describe("teardown (E42 E43)", () => {
  it("E42: renderer main-frame navigation while the dialog is open closes the dialog, unregisters the link, launches nothing", async () => {
    let signal!: AbortSignal;
    dialogShow.mockImplementation((_o: unknown, s: AbortSignal) => {
      signal = s;
      return new Promise<number>((resolve) => s.addEventListener("abort", () => resolve(ALLOW_ONCE)));
    });
    await connect();
    await until(() => dialogShow.mock.calls.length === 1);
    win.webContents.emit("did-start-navigation", { isMainFrame: true, isSameDocument: false });
    expect(signal.aborted).toBe(true);
    await new Promise((r) => setTimeout(r, 30));
    expect(launches).toHaveLength(0);
    expect(answers()).toHaveLength(0);
  });

  it("E42: webContents destroyed / window closed also cancel pending connects", async () => {
    for (const fire of [() => win.webContents.emit("destroyed"), () => win.emit("closed")]) {
      launches.length = 0;
      let aborted = false;
      dialogShow.mockImplementation((_o: unknown, s: AbortSignal) => new Promise<number>((resolve) => s.addEventListener("abort", () => ((aborted = true), resolve(ALLOW_ONCE)))));
      await connect({ requestId: `R${Math.random()}` });
      await until(() => dialogShow.mock.calls.length > 0);
      fire();
      expect(aborted).toBe(true);
      dialogShow.mockClear();
    }
    expect(launches).toHaveLength(0);
  });

  it("same-document and subframe navigations do NOT cancel anything", async () => {
    await connect();
    await until(() => launches.length === 1);
    const ext = await attachExtension();
    await until(() => extEvents().some((e) => e.kind === "open"));
    win.webContents.emit("did-start-navigation", { isMainFrame: true, isSameDocument: true });
    win.webContents.emit("did-start-navigation", { isMainFrame: false, isSameDocument: false });
    await new Promise((r) => setTimeout(r, 30));
    expect(ext.ws.readyState).toBe(1);
  });

  it("E42: a main-frame navigation closes live extension sockets and forgets the target", async () => {
    await connect();
    await until(() => launches.length === 1);
    const ext = await attachExtension();
    await until(() => extEvents().some((e) => e.kind === "open"));
    win.webContents.emit("did-start-navigation", { isMainFrame: true, isSameDocument: false });
    await ext.closed;
    await expect(invoke(CH.sign, "n", "I1")).rejects.toThrow(); // target cleared; carrier must setTarget again
  });

  it("legacy positional did-start-navigation args are honoured (event, url, isInPlace, isMainFrame)", async () => {
    await connect();
    await until(() => launches.length === 1);
    const ext = await attachExtension();
    win.webContents.emit("did-start-navigation", {}, "http://localhost:8000/", false, true);
    await ext.closed;
  });

  it("E43: cancelConnect closes the attached extension socket and unregisters the link", async () => {
    await connect();
    await until(() => launches.length === 1);
    const ext = await attachExtension();
    await until(() => extEvents().some((e) => e.kind === "open"));
    await invoke(CH.cancelConnect, "R1");
    await ext.closed;
    await expect(new FakeExtension().connect(portOfLaunch(), LINK)).rejects.toBeDefined();
  });

  it("cancelConnect while the dialog is open closes it and never launches", async () => {
    let aborted = false;
    dialogShow.mockImplementation((_o: unknown, s: AbortSignal) => new Promise<number>((resolve) => s.addEventListener("abort", () => ((aborted = true), resolve(ALLOW_ONCE)))));
    await connect();
    await until(() => dialogShow.mock.calls.length === 1);
    await invoke(CH.cancelConnect, "R1");
    expect(aborted).toBe(true);
    await new Promise((r) => setTimeout(r, 30));
    expect(launches).toHaveLength(0);
  });

  it("X10: extension close → ext_close{code} to the renderer", async () => {
    await connect();
    await until(() => launches.length === 1);
    const ext = await attachExtension();
    await until(() => extEvents().some((e) => e.kind === "open"));
    ext.ws.close(1000);
    await until(() => extEvents().some((e) => e.kind === "close"));
    expect(extEvents().find((e) => e.kind === "close")).toEqual({ kind: "close", linkId: LINK, code: 1000 });
  });

  it("extClose closes the extension with that code", async () => {
    await connect();
    await until(() => launches.length === 1);
    const ext = await attachExtension();
    await until(() => extEvents().some((e) => e.kind === "open"));
    fire(CH.extClose, LINK, 1013);
    expect(await ext.closed).toBe(1013);
  });
});

describe("revoke (E48)", () => {
  it("revokeAll empties consents, leaves a live link open, and the next connect asks again", async () => {
    dialogShow.mockResolvedValue(ALWAYS);
    await connect();
    await until(() => launches.length === 1);
    await invoke(CH.connect, connectReq({ requestId: "R2", profileDirectory: "Profile 1", linkId: "link-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" }));
    await until(() => launches.length === 2);
    const ext = await attachExtension();
    await until(() => extEvents().some((e) => e.kind === "open"));
    expect((await invoke(CH.listConsents)) as unknown[]).toHaveLength(2);

    expect(host.revokeAll()).toBe(2);
    expect((await invoke(CH.listConsents)) as unknown[]).toEqual([]);
    expect(ext.ws.readyState).toBe(1);

    await invoke(CH.connect, connectReq({ requestId: "R3", linkId: "link-cccccccccccccccccccccccccccccccc" }));
    await until(() => dialogShow.mock.calls.length === 3);
  });

  it("revokeConsent(key) removes one", async () => {
    dialogShow.mockResolvedValue(ALWAYS);
    await connect();
    await until(() => launches.length === 1);
    const [row] = (await invoke(CH.listConsents)) as Array<{ key: string }>;
    await invoke(CH.revokeConsent, row!.key);
    expect((await invoke(CH.listConsents)) as unknown[]).toEqual([]);
  });
});

describe("token (E50 E51)", () => {
  it("E50: the stored token is appended to the Chrome URL and appears nowhere else", async () => {
    await invoke(CH.setToken, "Default", "T0KEN-xyz");
    await connect();
    await until(() => launches.length === 1);
    await until(() => answers().length === 1);
    expect(lastUrl().searchParams.get("token")).toBe("T0KEN-xyz");
    const ret = [await invoke(CH.identity), await invoke(CH.listConsents), await invoke(CH.setToken, "Default", "T0KEN-xyz")];
    expect(JSON.stringify(ret)).not.toContain("T0KEN-xyz");
    expect(JSON.stringify(win.webContents.send.mock.calls)).not.toContain("T0KEN-xyz");
    expect(logs.join("\n")).not.toContain("T0KEN-xyz");
    expect(fs.readFileSync(path.join(tmp.dir, "browser-host-tokens.json"), "utf8")).not.toContain("T0KEN-xyz");
  });

  it("E51: without encryption the token works in-run, nothing on disk", async () => {
    host.dispose();
    build({ crypto: noCrypto() });
    await invoke(CH.setToken, "Default", "T0KEN-xyz");
    await connect();
    await until(() => launches.length === 1);
    expect(lastUrl().searchParams.get("token")).toBe("T0KEN-xyz");
    expect(fs.readdirSync(tmp.dir).filter((f) => f.includes("tokens"))).toEqual([]);
  });

  it("setToken(profile, null) clears it; invalid input rejects", async () => {
    await invoke(CH.setToken, "Default", "T");
    await invoke(CH.setToken, "Default", null);
    await connect();
    await until(() => launches.length === 1);
    expect(lastUrl().searchParams.has("token")).toBe(false);
    expect(() => invoke(CH.setToken, 5, "x")).toThrow();
  });

  it("no log line carries a linkId, URL or token", async () => {
    await invoke(CH.setToken, "Default", "T0KEN-xyz");
    await connect();
    await until(() => launches.length === 1);
    const all = logs.join("\n");
    expect(all).not.toContain(LINK);
    expect(all).not.toContain("T0KEN");
    expect(all).not.toContain("mcpRelayUrl");
  });
});

describe("tee over IPC (E54)", () => {
  it("copies the top-level tab's screencastFrame to onFrame and still forwards every event unchanged", async () => {
    await connect();
    await until(() => launches.length === 1);
    const ext = await attachExtension();
    await until(() => extEvents().some((e) => e.kind === "open"));
    fire(CH.tee, LINK, "inst-1", 7, true);
    const params = (d: string) => ({ data: d, metadata: { deviceWidth: 10, deviceHeight: 20, timestamp: 1 } });
    const msgs = [
      FakeExtension.debuggerEvent(7, "Page.screencastFrame", params("A")),
      FakeExtension.debuggerEvent(7, "Page.screencastFrame", params("B"), "s"),
      FakeExtension.debuggerEvent(8, "Page.screencastFrame", params("C")),
      FakeExtension.debuggerEvent(7, "Page.loadEventFired", {}),
    ];
    for (const m of msgs) ext.ws.send(m);
    await until(() => extEvents().filter((e) => e.kind === "data").length === 4);
    expect(extEvents().filter((e) => e.kind === "data").map((e) => e.data)).toEqual(msgs);
    expect(pushes<BrowserHostFrame>(CH.frame)).toEqual([{ instanceId: "inst-1", tabId: 7, jpegBase64: "A", metadata: { deviceWidth: 10, deviceHeight: 20, timestamp: 1 } }]);
    fire(CH.tee, LINK, "inst-1", 7, false);
    ext.ws.send(FakeExtension.debuggerEvent(7, "Page.screencastFrame", params("D")));
    await until(() => extEvents().filter((e) => e.kind === "data").length === 5);
    expect(pushes(CH.frame)).toHaveLength(1);
  });

  it("tee for an unregistered link is ignored", () => {
    expect(() => fire(CH.tee, "link-unknown", "inst-1", 7, true)).not.toThrow();
  });
});

describe("app-menu hook", () => {
  it("dispose() removes every handler it registered", () => {
    host.dispose();
    expect(ipc.handlers.size).toBe(0);
    expect(ipc.listeners.size).toBe(0);
  });
});
