/**
 * The per-socket locality bit: stamped once at the `/ws` upgrade, readable by
 * handlers through the context, unstamped = remote.
 * See change: harden-server-capability-bounds (test-plan #E28).
 */
import { EventEmitter } from "node:events";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBrowserGateway } from "../pairing/browser-gateway.js";
import { isSocketLocallyTrusted, stampSocketLocality } from "../pairing/socket-locality.js";
import { createMemoryEventStore } from "../persistence/memory-event-store.js";
import { createMemorySessionManager } from "../session/memory-session-manager.js";

const req = (remoteAddress: string, headers: Record<string, string> = {}) => ({ socket: { remoteAddress }, headers });

describe("stampSocketLocality", () => {
  it("E28 loopback = local; loopback + x-forwarded-for = remote; LAN peer = remote", () => {
    const a = {}, b = {}, c = {};
    expect(stampSocketLocality(a, req("127.0.0.1"))).toBe(true);
    expect(stampSocketLocality(b, req("127.0.0.1", { "x-forwarded-for": "203.0.113.9" }))).toBe(false);
    expect(stampSocketLocality(c, req("192.168.1.5"))).toBe(false);
    expect([a, b, c].map(isSocketLocallyTrusted)).toEqual([true, false, false]);
  });

  it("an unstamped socket is not local (fail closed)", () => {
    expect(isSocketLocallyTrusted({})).toBe(false);
  });
});

describe("gateway exposes the locality bit and root resolver on the handler context", () => {
  let tmp: string;
  beforeEach(async () => {
    tmp = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), "gw-locality-")));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await fsp.rm(tmp, { recursive: true, force: true });
  });

  function makeWs() {
    const ws = new EventEmitter() as EventEmitter & { send: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn>; readyState: number; OPEN: number };
    ws.send = vi.fn();
    ws.close = vi.fn();
    ws.readyState = 1;
    ws.OPEN = 1;
    return ws;
  }

  async function pinFrom(ws: ReturnType<typeof makeWs> & { locallyTrusted?: boolean }, outside: string) {
    const pinDirectory = vi.fn();
    const store = new Proxy({} as Record<string, unknown>, {
      get: (_t, k) => (k === "pinDirectory" ? pinDirectory : k === "getPinnedDirectories" ? () => [] : vi.fn(() => [])),
    });
    const args: unknown[] = new Array(28).fill(undefined);
    args[0] = createMemorySessionManager();
    args[1] = createMemoryEventStore(() => false);
    args[2] = { start: vi.fn(), stop: vi.fn(), sendToSession: vi.fn(), getConnectedSessionIds: vi.fn(() => []), hasSession: vi.fn(() => false), onEvent: vi.fn() };
    args[6] = store;
    args[27] = async () => ({ roots: [path.join(tmp, "home")], sensitive: [] }); // browseRoots
    const gateway = (createBrowserGateway as (...a: unknown[]) => ReturnType<typeof createBrowserGateway>)(...args);
    gateway.wss.emit("connection", ws, {});
    ws.emit("message", Buffer.from(JSON.stringify({ type: "pin_directory", path: outside })));
    await new Promise((r) => setTimeout(r, 50));
    return { pinDirectory, ws };
  }

  it("a stamped-remote socket is gated: outside path refused with folder_refused on that socket", async () => {
    const outside = path.join(tmp, "opt");
    await fsp.mkdir(outside);
    const ws = makeWs();
    stampSocketLocality(ws, req("192.168.1.5"));
    const { pinDirectory } = await pinFrom(ws, outside);
    expect(pinDirectory).not.toHaveBeenCalled();
    const sent = ws.send.mock.calls.map((c) => String(c[0]));
    expect(sent.some((m) => m.includes("folder_refused"))).toBe(true);
  });

  it("an UNSTAMPED socket is treated as remote too (fail closed)", async () => {
    const outside = path.join(tmp, "opt");
    await fsp.mkdir(outside);
    const { pinDirectory } = await pinFrom(makeWs(), outside);
    expect(pinDirectory).not.toHaveBeenCalled();
  });

  it("a stamped-local socket pins the same path", async () => {
    const outside = path.join(tmp, "opt");
    await fsp.mkdir(outside);
    const ws = makeWs();
    stampSocketLocality(ws, req("127.0.0.1"));
    const { pinDirectory } = await pinFrom(ws, outside);
    expect(pinDirectory).toHaveBeenCalledTimes(1);
  });
});
