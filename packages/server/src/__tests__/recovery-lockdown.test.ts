/**
 * Recovery server lockdown (B9): loopback bind by default + gated mutating
 * actions. `node:child_process.spawn` is mocked so no `npm install` ever runs.
 *
 * See change: harden-server-capability-bounds (test-plan T4).
 */
import { EventEmitter } from "node:events";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const spawnMock = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, spawn: spawnMock };
});

import { PLUGIN_PROXY_FORWARDING_HEADERS } from "../auth/localhost-guard.js";
import { isRecoveryActionAllowed, RECOVERY_FORWARDING_HEADERS, startRecoveryServer } from "../lifecycle/recovery-server.js";

function fakeChild() {
  const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; unref: () => void };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.unref = () => undefined;
  queueMicrotask(() => child.emit("exit", 0));
  return child;
}

function post(
  port: number,
  urlPath: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path: urlPath, method: "POST", headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    req.end();
  });
}

describe("isRecoveryActionAllowed (pure gate)", () => {
  const gate = (
    peer: string | undefined,
    headers: Record<string, string>,
    token: string | null = null,
  ) => isRecoveryActionAllowed({ remoteAddress: peer, headers }, token);

  // test-plan #E29: the 10-row Host / Origin / token / peer decision table.
  it.each([
    ["token match from a LAN peer", "192.168.1.5", { host: "dash.lan:8000", "x-pi-local-token": "s3cret" }, "s3cret", true],
    ["token mismatch", "192.168.1.5", { host: "dash.lan:8000", "x-pi-local-token": "nope" }, "s3cret", false],
    ["loopback Host, no Origin", "127.0.0.1", { host: "localhost:8000" }, null, true],
    ["loopback Host + same-origin Origin", "127.0.0.1", { host: "localhost:8000", origin: "http://localhost:8000" }, null, true],
    ["Origin on another local port (page served from :3000)", "127.0.0.1", { host: "localhost:8000", origin: "http://localhost:3000" }, null, false],
    ["opaque Origin: null", "127.0.0.1", { host: "localhost:8000", origin: "null" }, null, false],
    ["default-port normalisation (Host localhost vs Origin :80)", "127.0.0.1", { host: "localhost", origin: "http://localhost:80" }, null, true],
    ["IPv6 loopback same-origin", "::1", { host: "[::1]:8000", origin: "http://[::1]:8000" }, null, true],
    ["tunnel hostname with a matching Origin", "127.0.0.1", { host: "abc.share.zrok.io", origin: "https://abc.share.zrok.io" }, null, false],
    ["non-loopback peer, no token", "192.168.1.5", { host: "localhost:8000" }, null, false],
    // CodeRabbit r1: a DNS NAME that merely starts with `127.` is not loopback (DNS rebinding).
    ["rebinding hostname 127.attacker.example", "127.0.0.1", { host: "127.attacker.example:8000", origin: "http://127.attacker.example:8000" }, null, false],
    ["literal 127.0.0.2 is loopback", "127.0.0.1", { host: "127.0.0.2:8000", origin: "http://127.0.0.2:8000" }, null, true],
    ["out-of-range 127.0.0.256 is not an IPv4 literal", "127.0.0.1", { host: "127.0.0.256:8000" }, null, false],
  ] as const)("E29 %s -> %s", (_name, peer, headers, token, want) => {
    expect(gate(peer, headers as Record<string, string>, token)).toBe(want);
  });

  it("accepts an IPv4-mapped loopback peer", () => {
    expect(gate("::ffff:127.0.0.1", { host: "localhost:8000" })).toBe(true);
  });

  it("an absent Host or absent peer is refused", () => {
    expect(gate("127.0.0.1", {})).toBe(false);
    expect(gate(undefined, { host: "localhost:8000" })).toBe(false);
  });

  // test-plan #E30: every forwarding header alone flips a loopback request to deny.
  it.each([
    "x-forwarded-for",
    "x-forwarded-host",
    "x-forwarded-proto",
    "x-real-ip",
    "forwarded",
    "via",
    "x-forwarded-server",
    "x-forwarded-port",
  ])("E30 loopback request carrying %s is refused", (header) => {
    expect(gate("127.0.0.1", { host: "localhost:8000", [header]: "203.0.113.9" })).toBe(false);
  });

  it("a forwarding header does not defeat the token path", () => {
    expect(gate("127.0.0.1", { host: "localhost:8000", "x-forwarded-for": "1.2.3.4", "x-pi-local-token": "t" }, "t")).toBe(true);
  });

  // test-plan #E31: the inline copy (node-built-in-only rule) must not drift from the guard's list.
  it("E31 recovery's inline header list equals PLUGIN_PROXY_FORWARDING_HEADERS", () => {
    expect([...RECOVERY_FORWARDING_HEADERS].sort()).toEqual([...PLUGIN_PROXY_FORWARDING_HEADERS].sort());
  });
});

describe("recovery server lockdown (integration)", () => {
  let createServerSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    spawnMock.mockReset();
    spawnMock.mockImplementation(() => fakeChild());
    createServerSpy = vi.spyOn(http, "createServer");
    exitSpy = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(async () => {
    for (const result of createServerSpy.mock.results) {
      const server = result.type === "return" ? (result.value as http.Server) : undefined;
      if (!server?.close) continue;
      server.closeAllConnections?.();
      await new Promise<void>((r) => server.close(() => r()));
    }
    vi.restoreAllMocks();
  });

  const start = (extra: Record<string, unknown> = {}) =>
    startRecoveryServer({ port: 0, error: new Error("Cannot find module 'fastify'"), missingModule: "fastify", ...extra });
  const boundAddress = () =>
    (createServerSpy.mock.results[0].value as http.Server).address() as AddressInfo;

  it("binds loopback only by default — not 0.0.0.0 / ::", async () => {
    await start();
    expect(boundAddress().address).toBe("127.0.0.1");
  });

  it("binds the configured host when one is given", async () => {
    await start({ host: "::1" }).catch(() => undefined);
    // ::1 may be unavailable on some CI hosts; when it binds, it must be the configured one.
    const server = createServerSpy.mock.results[0]?.value as http.Server | undefined;
    const addr = server?.address() as AddressInfo | null;
    if (addr) expect(addr.address).toBe("::1");
  });

  it("refuses reinstall with a cross-origin request and never spawns npm", async () => {
    const port = await start();
    const res = await post(port, "/api/recovery/reinstall", { origin: "https://evil.example" });
    expect(res.status).toBe(403);
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("refuses reinstall with a non-loopback Host header and never spawns npm", async () => {
    const port = await start();
    const res = await post(port, "/api/recovery/reinstall", { host: "tunnel.example.com" });
    expect(res.status).toBe(403);
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("E33 a forwarded request is refused with remedy text and never spawns npm", async () => {
    const port = await start();
    const res = await post(port, "/api/recovery/reinstall", { "x-forwarded-for": "203.0.113.9" });
    expect(res.status).toBe(403);
    expect(res.body).toMatch(/localhost/);
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("E36 one refusal logs one line naming the route, never a token value", async () => {
    const port = await start({ localToken: "TOPSECRET-TOKEN" });
    errSpy.mockClear();
    const res = await post(port, "/api/recovery/retry", { origin: "https://evil.example", "x-pi-local-token": "wrong" });
    expect(res.status).toBe(403);
    const lines = errSpy.mock.calls.map((c: unknown[]) => String(c[0])).filter((l: string) => l.includes("refused"));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("/api/recovery/retry");
    expect(lines.join("\n")).not.toMatch(/TOPSECRET|wrong/);
  });

  it("refuses retry from a non-loopback origin and does not respawn or exit", async () => {
    const port = await start();
    const res = await post(port, "/api/recovery/retry", { origin: "https://evil.example" });
    expect(res.status).toBe(403);
    expect(spawnMock).not.toHaveBeenCalled();
    await new Promise((r) => setTimeout(r, 350));
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("loopback retry proceeds (respawns the CLI and schedules exit)", async () => {
    const port = await start();
    const res = await post(port, "/api/recovery/retry");
    expect(res.status).toBe(200);
    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(spawnMock.mock.calls[0][0]).toBe(process.execPath);
    await new Promise((r) => setTimeout(r, 350));
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it("loopback reinstall proceeds", async () => {
    const port = await start();
    const res = await post(port, "/api/recovery/reinstall");
    expect(res.status).toBe(200);
    expect(spawnMock).toHaveBeenCalledTimes(1);
  });

  it("the read-only routes stay open (status page + health)", async () => {
    const port = await start();
    const get = (p: string) =>
      new Promise<number>((resolve, reject) =>
        http.get({ host: "127.0.0.1", port, path: p, headers: { origin: "https://evil.example" } }, (r) => {
          r.resume();
          resolve(r.statusCode ?? 0);
        }).on("error", reject),
      );
    expect(await get("/")).toBe(200);
    expect(await get("/api/health")).toBe(200);
  });
});
