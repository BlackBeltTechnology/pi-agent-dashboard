/**
 * Unit tests for EditorKeeperManager.
 *
 * Mocks the on-disk sidecar layout + `net.createConnection` to exercise:
 *   - editorIdFromCwd (task 7.1)
 *   - probe success/failure modes (task 7.2)
 *   - discoverExistingKeepers 4-way adoption table (task 7.3)
 *
 * Integration of the real keeper.cjs binary is exercised in
 * `editor-keeper/__tests__/keeper.test.ts`.
 */
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import os from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createEditorKeeperManager,
  editorIdFromCwd,
  pidPathFor,
  sockPathFor,
} from "../keeper-manager.js";

// ── Fake socket layer ────────────────────────────────────────────────────────

interface FakeServerOpts {
  /** What the server replies with on `getStatus`. null = no reply (timeout). */
  statusReply?: object | null;
  /** Throw on connect (simulating a missing socket). */
  refuse?: boolean;
}

function makeFakeCreateConnection(o: FakeServerOpts = {}): typeof net.createConnection {
  return ((..._args: unknown[]) => {
    const sock = new EventEmitter() as net.Socket & EventEmitter;
    sock.setEncoding = vi.fn() as any;
    sock.write = vi.fn((line: string) => {
      // Parse the JSON line and reply if it's getStatus.
      try {
        const msg = JSON.parse(line.trim());
        if (msg.cmd === "getStatus") {
          if (o.statusReply === null) return true; // no reply -> timeout
          const reply = o.statusReply ?? { event: "status" };
          setImmediate(() => sock.emit("data", JSON.stringify(reply) + "\n"));
        }
      } catch { /* ignore */ }
      return true;
    }) as any;
    sock.end = vi.fn((line: string, _enc: string, cb?: () => void) => {
      if (cb) setImmediate(cb);
      return sock;
    }) as any;
    sock.destroy = vi.fn(() => sock) as any;
    if (o.refuse) {
      setImmediate(() => sock.emit("error", new Error("ECONNREFUSED")));
    } else {
      setImmediate(() => sock.emit("connect"));
    }
    return sock;
  }) as unknown as typeof net.createConnection;
}

// ── Test bed ─────────────────────────────────────────────────────────────────

let tmpHome: string;
let editorsDir: string;

beforeEach(() => {
  tmpHome = mkdtempSync(path.join(os.tmpdir(), "edt-"));
  editorsDir = path.join(tmpHome, "editors");
  mkdirSync(editorsDir, { recursive: true });
});

afterEach(() => {
  rmSync(tmpHome, { recursive: true, force: true });
});

function writeSidecar(editorId: string, body: object): void {
  writeFileSync(pidPathFor(editorsDir, editorId), JSON.stringify(body), "utf8");
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("editorIdFromCwd (task 7.1)", () => {
  it("is deterministic and 12 hex chars", () => {
    const a = editorIdFromCwd("/Users/x/proj");
    const b = editorIdFromCwd("/Users/x/proj");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{12}$/);
  });

  it("differs across distinct cwds", () => {
    expect(editorIdFromCwd("/a")).not.toBe(editorIdFromCwd("/b"));
  });
});

describe("probe (task 7.2)", () => {
  it("returns alive:false on missing sidecar", async () => {
    const km = createEditorKeeperManager({ editorsDir });
    const r = await km.probe("aaaaaaaaaaaa");
    expect(r.alive).toBe(false);
  });

  it("returns alive:false on dead keeperPid", async () => {
    const km = createEditorKeeperManager({
      editorsDir,
      isProcessAlive: (pid) => pid === 99, // childPid only
      createConnection: makeFakeCreateConnection(),
    });
    writeSidecar("bbbbbbbbbbbb", {
      editorId: "bbbbbbbbbbbb",
      keeperPid: 1, childPid: 99, port: 65535, cwd: "/x", dataDir: "/d",
    });
    const r = await km.probe("bbbbbbbbbbbb");
    expect(r.alive).toBe(false);
  });

  it("returns alive:false on dead childPid", async () => {
    const km = createEditorKeeperManager({
      editorsDir,
      isProcessAlive: (pid) => pid === 1,
      createConnection: makeFakeCreateConnection(),
    });
    writeSidecar("cccccccccccc", {
      editorId: "cccccccccccc",
      keeperPid: 1, childPid: 99, port: 65535, cwd: "/x", dataDir: "/d",
    });
    const r = await km.probe("cccccccccccc");
    expect(r.alive).toBe(false);
  });

  it("returns alive:false on socket timeout", async () => {
    const km = createEditorKeeperManager({
      editorsDir,
      isProcessAlive: () => true,
      createConnection: makeFakeCreateConnection({ statusReply: null }),
    });
    writeSidecar("dddddddddddd", {
      editorId: "dddddddddddd",
      keeperPid: 1, childPid: 2, port: 65535, cwd: "/x", dataDir: "/d",
    });
    const r = await km.probe("dddddddddddd");
    expect(r.alive).toBe(false);
  });

  it("returns alive:false when TCP port is not bound", async () => {
    const km = createEditorKeeperManager({
      editorsDir,
      isProcessAlive: () => true,
      // Socket says status OK, but port 1 will fail TCP connect.
      createConnection: makeFakeCreateConnection({ statusReply: { event: "status" } }),
    });
    writeSidecar("eeeeeeeeeeee", {
      editorId: "eeeeeeeeeeee",
      keeperPid: 1, childPid: 2, port: 1, cwd: "/x", dataDir: "/d",
    });
    const r = await km.probe("eeeeeeeeeeee");
    expect(r.alive).toBe(false);
  });

  it("returns alive:true when sidecar+pids+socket+port all valid", async () => {
    // Bind a real TCP listener so the tcpProbe inside `probe` succeeds.
    const server = net.createServer().listen(0, "127.0.0.1");
    await new Promise((r) => server.once("listening", () => r(null)));
    const port = (server.address() as net.AddressInfo).port;
    try {
      const km = createEditorKeeperManager({
        editorsDir,
        isProcessAlive: () => true,
        createConnection: makeFakeCreateConnection({ statusReply: { event: "status" } }),
      });
      writeSidecar("ffffffffffff", {
        editorId: "ffffffffffff",
        keeperPid: 1, childPid: 2, port, cwd: "/x", dataDir: "/d",
      });
      const r = await km.probe("ffffffffffff");
      expect(r.alive).toBe(true);
      expect(r.port).toBe(port);
      expect(r.cwd).toBe("/x");
    } finally {
      server.close();
    }
  });
});

describe("discoverExistingKeepers (task 7.3)", () => {
  it("4-way classification: live / orphan-keeper / orphan-child / both-dead", async () => {
    // Bind a real listener so the LIVE case passes the TCP probe.
    const server = net.createServer().listen(0, "127.0.0.1");
    await new Promise((r) => server.once("listening", () => r(null)));
    const port = (server.address() as net.AddressInfo).port;
    try {
      const aliveIds = new Set<number>([10, 11, 20, 31]);
      const killed: Array<{ pid: number; sig: NodeJS.Signals }> = [];

      const km = createEditorKeeperManager({
        editorsDir,
        isProcessAlive: (pid) => aliveIds.has(pid),
        killPid: (pid, sig) => { killed.push({ pid, sig }); return true; },
        createConnection: makeFakeCreateConnection({ statusReply: { event: "status" } }),
      });

      // LIVE (keeper alive, child alive, probes succeed) → adopt
      writeSidecar("aaaaaaaaaaaa", {
        editorId: "aaaaaaaaaaaa",
        keeperPid: 10, childPid: 11, port, cwd: "/proj-a", dataDir: "/d/a",
      });
      // ORPHAN KEEPER (keeper alive, child dead) → stop+kill keeper
      writeSidecar("bbbbbbbbbbbb", {
        editorId: "bbbbbbbbbbbb",
        keeperPid: 20, childPid: 99, port: 65500, cwd: "/proj-b", dataDir: "/d/b",
      });
      // ORPHAN CHILD (keeper dead, child alive) → SIGTERM child
      writeSidecar("cccccccccccc", {
        editorId: "cccccccccccc",
        keeperPid: 30, childPid: 31, port: 65501, cwd: "/proj-c", dataDir: "/d/c",
      });
      // BOTH DEAD → unlink
      writeSidecar("dddddddddddd", {
        editorId: "dddddddddddd",
        keeperPid: 40, childPid: 41, port: 65502, cwd: "/proj-d", dataDir: "/d/d",
      });

      const adopted = await km.discoverExistingKeepers();
      const ids = adopted.map((a) => a.editorId).sort();
      expect(ids).toEqual(["aaaaaaaaaaaa"]);

      // orphan-child case must SIGTERM pid 31
      expect(killed.some((k) => k.pid === 31 && k.sig === "SIGTERM")).toBe(true);

      // both-dead sidecar (dddd) and orphan-child sidecar (cccc) must be unlinked.
      const fs = await import("node:fs");
      expect(fs.existsSync(pidPathFor(editorsDir, "dddddddddddd"))).toBe(false);
      expect(fs.existsSync(pidPathFor(editorsDir, "cccccccccccc"))).toBe(false);
      // Live sidecar (aaaa) must remain.
      expect(fs.existsSync(pidPathFor(editorsDir, "aaaaaaaaaaaa"))).toBe(true);
    } finally {
      server.close();
    }
  });
});

describe("path conventions", () => {
  it("derives POSIX socket + pid paths", () => {
    expect(sockPathFor("/x/editors", "abc123def456", "darwin")).toBe(
      path.join("/x/editors", "abc123def456.sock"),
    );
    expect(pidPathFor("/x/editors", "abc123def456", "darwin")).toBe(
      path.join("/x/editors", "abc123def456.sock.pid"),
    );
  });
  it("derives Windows named-pipe + pid paths", () => {
    expect(sockPathFor("C:/x/editors", "abc123def456", "win32")).toBe(
      "\\\\.\\pipe\\pi-editor-abc123def456",
    );
    expect(pidPathFor("C:/x/editors", "abc123def456", "win32")).toBe(
      path.join("C:/x/editors", "pi-editor-abc123def456.pid"),
    );
  });
});
