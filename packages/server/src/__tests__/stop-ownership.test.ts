/**
 * Ownership evidence for `pi-dashboard stop`'s port sweep.
 * See change: fix-cli-stop-foreign-home-kill (test-plan E5-E9, E15, E16, X1-X3).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getLockPath, getMetaPath, type LockMetadata } from "../lifecycle/home-lock.js";
import { __resetInstanceIdCache, ensureInstanceId, peekInstanceId } from "../lifecycle/instance-id.js";
import { collectOwnedPids, healthHost, partitionHolders } from "../lifecycle/stop-ownership.js";

const cfg = { port: 18555, piPort: 18556, host: "" };

function meta(pid: number, httpPort: number): LockMetadata {
  return {
    pid, ppid: 1, httpPort, piPort: 18556, startedAt: 1, identity: "i", version: "0", url: "u", hostname: "h",
  };
}
const health = (body: unknown, ok = true) => vi.fn(async () => ({ ok, json: async () => body }));

describe("collectOwnedPids", () => {
  afterEach(() => vi.useRealTimers());

  // E5
  it.each([
    [true, true, true, true],
    [true, true, false, false],
    [true, false, true, false],
    [true, false, false, false],
    [false, true, true, false],
    [false, true, false, false],
    [false, false, true, false],
    [false, false, false, false],
  ])("lock proof present=%s pidMatch=%s portMatch=%s → owned=%s", async (present, pidMatch, portMatch, expected) => {
    const holder = 4242;
    const m = present ? meta(pidMatch ? holder : 1111, portMatch ? cfg.port : 9) : null;
    const owned = await collectOwnedPids(cfg, {
      readLockMeta: () => m,
      peekInstanceId: () => null,
      fetchHealth: health({}),
    });
    expect(owned.has(holder)).toBe(expected);
  });

  // E6 + E7
  it("health proof needs matching instanceId; pid taken from the reply", async () => {
    const peek = vi.fn(() => "ID");
    const ok = await collectOwnedPids(cfg, {
      readLockMeta: () => null,
      peekInstanceId: peek,
      // piGatewayPort is a socket path on POSIX and must be ignored
      fetchHealth: health({ pid: 77, instanceId: "ID", piGatewayPort: "/x/gateway-9999.sock" }),
    });
    expect([...ok]).toEqual([77]);
    expect(peek).toHaveBeenCalledWith(18556);

    const bad = await collectOwnedPids(cfg, {
      readLockMeta: () => null,
      peekInstanceId: () => "ID",
      fetchHealth: health({ pid: 77, instanceId: "OTHER" }),
    });
    expect(bad.size).toBe(0);
  });

  it("matching instanceId with a different holder pid → partition says foreign", async () => {
    const owned = await collectOwnedPids(cfg, {
      readLockMeta: () => null,
      peekInstanceId: () => "ID",
      fetchHealth: health({ pid: 77, instanceId: "ID" }),
    });
    const { owned: o, foreign } = partitionHolders(new Map([[88, [18555, 18556]]]), owned);
    expect(o).toEqual([]);
    expect(foreign).toEqual([{ pid: 88, ports: [18555, 18556] }]);
  });

  // E8
  it("port 0: empty set, no reads, no probes", async () => {
    const readLockMeta = vi.fn(() => meta(1, 0));
    const fetchHealth = health({});
    const owned = await collectOwnedPids({ ...cfg, port: 0 }, { readLockMeta, peekInstanceId: () => "x", fetchHealth });
    expect(owned.size).toBe(0);
    expect(readLockMeta).not.toHaveBeenCalled();
    expect(fetchHealth).not.toHaveBeenCalled();
  });

  // E9
  it.each([
    ["", "127.0.0.1"], ["0.0.0.0", "127.0.0.1"], ["::", "127.0.0.1"], ["[::]", "127.0.0.1"],
    ["localhost", "127.0.0.1"], ["127.0.0.1", "127.0.0.1"], ["192.168.1.5", "192.168.1.5"],
    ["::1", "[::1]"], ["[::1]", "[::1]"],
  ])("healthHost(%j) → %s", (h, expected) => {
    expect(healthHost(h)).toBe(expected);
  });

  // X1
  it.each([
    ["rejects", vi.fn(async () => { throw new Error("ECONNREFUSED"); })],
    ["500", health({ pid: 5, instanceId: "ID" }, false)],
    ["non-JSON", vi.fn(async () => ({ ok: true, json: async () => { throw new SyntaxError("x"); } }))],
    ["no instanceId", health({ pid: 5 })],
  ])("health failure (%s) contributes nothing", async (_n, fetchHealth) => {
    const owned = await collectOwnedPids(cfg, { readLockMeta: () => null, peekInstanceId: () => "ID", fetchHealth });
    expect(owned.size).toBe(0);
  });

  // X2
  it("a never-resolving probe settles after 2000ms, one attempt", async () => {
    vi.useFakeTimers();
    const fetchHealth = vi.fn(() => new Promise<never>(() => {}));
    const p = collectOwnedPids(cfg, { readLockMeta: () => null, peekInstanceId: () => "ID", fetchHealth });
    await vi.advanceTimersByTimeAsync(2000);
    expect((await p).size).toBe(0);
    expect(fetchHealth).toHaveBeenCalledTimes(1);
  });

  // X3 (reader throws)
  it("throwing evidence readers → empty set, no throw", async () => {
    const owned = await collectOwnedPids(cfg, {
      readLockMeta: () => { throw new Error("EACCES"); },
      peekInstanceId: () => { throw new Error("EACCES"); },
      fetchHealth: health({}),
    });
    expect(owned.size).toBe(0);
  });
});

describe("temp HOME on disk", () => {
  let home: string;
  let orig: string | undefined;
  beforeEach(() => {
    __resetInstanceIdCache();
    home = fs.mkdtempSync(path.join(os.tmpdir(), "stop-own-"));
    orig = process.env.HOME;
    process.env.HOME = home;
  });
  afterEach(() => {
    if (orig === undefined) delete process.env.HOME; else process.env.HOME = orig;
    fs.rmSync(home, { recursive: true, force: true });
  });

  // E15
  it("writes nothing; peek sees what ensure wrote", async () => {
    expect(peekInstanceId(undefined, 9999)).toBeNull();
    const owned = await collectOwnedPids({ port: 18555, piPort: 9999 }, { fetchHealth: health({}) });
    expect(owned.size).toBe(0);
    expect(fs.existsSync(path.join(home, ".pi", "dashboard"))).toBe(false);
    const id = ensureInstanceId(undefined, 9999);
    expect(peekInstanceId(undefined, 9999)).toBe(id);
  });

  // X3 (real files)
  it("truncated sidecar and empty id file → empty set", async () => {
    const dir = path.join(home, ".pi", "dashboard");
    fs.mkdirSync(path.join(dir, "instances"), { recursive: true });
    fs.writeFileSync(getMetaPath(getLockPath()), '{"pid": 12');
    fs.writeFileSync(path.join(dir, "instances", "18556.id"), "");
    const owned = await collectOwnedPids(cfg, { fetchHealth: health({ pid: 3, instanceId: "" }) });
    expect(owned.size).toBe(0);
  });

  // E16
  it("lock sidecar is read under the $HOME-honouring dashboard dir", () => {
    expect(getMetaPath(getLockPath()).startsWith(path.join(home, ".pi", "dashboard") + path.sep)).toBe(true);
  });
});
