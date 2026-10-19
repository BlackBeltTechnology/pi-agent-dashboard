/**
 * `GET /api/file/digest` — content digest for the editor pane's changed-on-disk
 * verification. Pins: parity with the `/api/file` read gate (E6), the fixed
 * 256 MiB ceiling (E5), non-regular targets (E7), no-store (E8), opted-out
 * requests never held (X9), grant-admitted swap refusal (X10), and the load
 * bound (P1–P3).
 *
 * See change: gate-changed-on-disk-by-content.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fsp from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { __resetPathDenials, listPathDenials } from "../access/access-denials.js";
import { __resetAccessGrants, recordGrant } from "../access/access-grants.js";
import { createDigestGate, type DigestGate, type DigestLane } from "../lib/digest-gate.js";
import { registerFileRoutes } from "../routes/file-routes.js";

const posix = process.platform !== "win32";
const MiB = 1024 * 1024;

let cwd: string;
let home: string;
let origHome: string | undefined;
let savedStore: string | undefined;
let app: FastifyInstance | undefined;

function makeApp(opts: { gate?: DigestGate; cwds?: string[] } = {}): FastifyInstance {
  const a = Fastify({ logger: false });
  registerFileRoutes(a, {
    sessionManager: { listAll: () => (opts.cwds ?? [cwd]).map((c) => ({ cwd: c })) } as never,
    preferencesStore: { getPinnedDirectories: () => [] } as never,
    networkGuard: async () => undefined,
    ...(opts.gate ? { digestGate: opts.gate } : {}),
  } as never);
  return a;
}

const digestUrl = (p: string, extra = ""): string =>
  `/api/file/digest?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(p)}${extra}`;
const readUrl = (p: string): string => `/api/file?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(p)}`;
const OPT_OUT = { "x-pi-grant-channel": "" };

beforeEach(async () => {
  cwd = await fsp.mkdtemp(path.join(os.tmpdir(), "digest-cwd-"));
  home = await fsp.mkdtemp(path.join(os.tmpdir(), "digest-home-"));
  origHome = process.env.HOME;
  process.env.HOME = home;
  savedStore = process.env.PI_ACCESS_GRANTS_STORE;
  process.env.PI_ACCESS_GRANTS_STORE = path.join(home, "grants.json");
  __resetAccessGrants();
  __resetPathDenials();
});

afterEach(async () => {
  await app?.close();
  app = undefined;
  __resetAccessGrants();
  process.env.HOME = origHome;
  if (savedStore === undefined) delete process.env.PI_ACCESS_GRANTS_STORE;
  else process.env.PI_ACCESS_GRANTS_STORE = savedStore;
  await fsp.rm(cwd, { recursive: true, force: true });
  await fsp.rm(home, { recursive: true, force: true });
});

describe("GET /api/file/digest — parity with GET /api/file (E6)", () => {
  it("admits / refuses identically for every path class", async () => {
    await fsp.writeFile(path.join(cwd, "a.txt"), "alpha\n");
    await fsp.symlink(path.join(cwd, "a.txt"), path.join(cwd, "link.txt"));
    await fsp.mkdir(path.join(home, ".pi"), { recursive: true });
    const piFile = path.join(home, ".pi", "note.txt");
    await fsp.writeFile(piFile, "pi\n");
    const outside = await fsp.mkdtemp(path.join(os.tmpdir(), "digest-out-"));
    const outsideFile = path.join(outside, "x.txt");
    await fsp.writeFile(outsideFile, "x\n");
    app = makeApp();
    await app.ready();

    const paths: Array<[string, string, boolean]> = [
      ["in-cwd file", "a.txt", true],
      ["in-cwd symlink", "link.txt", true],
      ["~/.pi file", piFile, true],
      ["outside-cwd file", outsideFile, false],
      ["missing outside-cwd", path.join(outside, "missing.txt"), false],
      ["file:// path", `file://${encodeURI(path.join(cwd, "a.txt"))}`, true],
    ];
    for (const [label, p, admitted] of paths) {
      const read = await app.inject({ method: "GET", url: readUrl(p), headers: OPT_OUT });
      const dig = await app.inject({ method: "GET", url: digestUrl(p), headers: OPT_OUT });
      expect(dig.statusCode, label).toBe(read.statusCode);
      if (admitted) {
        expect(dig.statusCode, label).toBe(200);
      } else {
        expect(dig.statusCode, label).toBe(403);
        const rb = read.json();
        const db = dig.json();
        expect(db.error, label).toBe(rb.error);
        for (const k of ["reason", "hint", "subject", "ancestors"]) {
          expect(db[k], `${label}:${k}`).toEqual(rb[k]);
        }
      }
    }
    await fsp.rm(outside, { recursive: true, force: true });
  });

  it("an unknown session cwd is refused with the same 403 as /api/file", async () => {
    await fsp.writeFile(path.join(cwd, "a.txt"), "a");
    app = makeApp({ cwds: ["/some/other/cwd"] });
    await app.ready();
    const read = await app.inject({ method: "GET", url: readUrl("a.txt"), headers: OPT_OUT });
    const dig = await app.inject({ method: "GET", url: digestUrl("a.txt"), headers: OPT_OUT });
    expect(read.statusCode).toBe(403);
    expect(dig.statusCode).toBe(403);
    expect(dig.json().error).toBe(read.json().error);
  });

  it("requires cwd and path (400)", async () => {
    app = makeApp();
    await app.ready();
    const res = await app.inject({ method: "GET", url: `/api/file/digest?cwd=${encodeURIComponent(cwd)}` });
    expect(res.statusCode).toBe(400);
  });
});

describe("GET /api/file/digest — payload + ceiling (E5, E8)", () => {
  const sha = (b: Buffer | string): string => createHash("sha1").update(b).digest("hex");

  it("returns sha1 + size + full-precision mtime and no content; no-store (E8)", async () => {
    const file = path.join(cwd, "a.txt");
    await fsp.writeFile(file, "hello\n");
    const st = await fsp.stat(file);
    app = makeApp();
    await app.ready();
    const res = await app.inject({ method: "GET", url: digestUrl("a.txt") });
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    const data = res.json().data;
    expect(data).toEqual({ size: 6, mtime: st.mtimeMs, sha1: sha("hello\n") });
    expect("content" in data).toBe(false);
  });

  it("covers 0 B, 1 KiB and exactly 256 MiB with a correct hash; 256 MiB + 1 has none (E5)", async () => {
    await fsp.writeFile(path.join(cwd, "zero.bin"), "");
    await fsp.writeFile(path.join(cwd, "k.bin"), Buffer.alloc(1024, 7));
    const cap = 256 * MiB;
    await fsp.writeFile(path.join(cwd, "cap.bin"), "");
    await fsp.truncate(path.join(cwd, "cap.bin"), cap);
    await fsp.writeFile(path.join(cwd, "over.bin"), "");
    await fsp.truncate(path.join(cwd, "over.bin"), cap + 1);
    app = makeApp();
    await app.ready();

    const get = async (n: string) => (await app!.inject({ method: "GET", url: digestUrl(n) })).json().data;
    expect((await get("zero.bin")).sha1).toBe(sha(""));
    expect((await get("k.bin")).sha1).toBe(sha(Buffer.alloc(1024, 7)));
    const capData = await get("cap.bin");
    expect(capData.size).toBe(cap);
    const h = createHash("sha1");
    const zeros = Buffer.alloc(MiB);
    for (let i = 0; i < 256; i++) h.update(zeros);
    expect(capData.sha1).toBe(h.digest("hex"));
    const over = await get("over.bin");
    expect(over.size).toBe(cap + 1);
    expect(typeof over.mtime).toBe("number");
    expect("sha1" in over).toBe(false);
  }, 60_000);
});

describe("GET /api/file/digest — non-regular files (E7)", () => {
  it("404 for a directory", async () => {
    await fsp.mkdir(path.join(cwd, "d"));
    app = makeApp();
    await app.ready();
    const res = await app.inject({ method: "GET", url: digestUrl("d") });
    expect(res.statusCode).toBe(404);
  });

  it.skipIf(!posix)("404 for a FIFO, without blocking", async () => {
    execFileSync("mkfifo", [path.join(cwd, "pipe")]);
    app = makeApp();
    await app.ready();
    const t0 = Date.now();
    const res = await app.inject({ method: "GET", url: digestUrl("pipe") });
    expect(res.statusCode).toBe(404);
    expect(Date.now() - t0).toBeLessThan(1000);
  });

  it("404 for a missing file inside cwd", async () => {
    app = makeApp();
    await app.ready();
    const res = await app.inject({ method: "GET", url: digestUrl("nope.txt") });
    expect(res.statusCode).toBe(404);
  });
});

describe("GET /api/file/digest — opted-out never held (X9)", () => {
  it("answers a prompt-eligible miss at once with a remedy, recording no denial", async () => {
    const outside = await fsp.mkdtemp(path.join(os.tmpdir(), "digest-out-"));
    await fsp.writeFile(path.join(outside, "x.txt"), "x");
    app = makeApp();
    await app.ready();
    const t0 = Date.now();
    const res = await app.inject({
      method: "GET",
      url: digestUrl(path.join(outside, "x.txt")),
      headers: OPT_OUT,
    });
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(res.statusCode).toBe(403);
    const body = res.json();
    expect(body.error).toBe("path outside working directory");
    expect(typeof body.subject).toBe("string");
    expect(Array.isArray(body.ancestors)).toBe(true);
    // Ledger behaviour: a background digest records NO denial (so the Access
    // surface never shows it) and therefore hands out no denialId.
    expect(body.denialId).toBeUndefined();
    expect(listPathDenials()).toEqual([]);
    // Control: the same miss through /api/file DOES record one.
    await app.inject({ method: "GET", url: readUrl(path.join(outside, "x.txt")), headers: OPT_OUT });
    expect(listPathDenials().length).toBe(1);
    await fsp.rm(outside, { recursive: true, force: true });
  });
});

describe.skipIf(!posix)("GET /api/file/digest — grant-admitted swap (X10)", () => {
  it("refuses a granted FIFO and a granted symlink to a FIFO exactly like /api/file", async () => {
    const granted = await fsp.mkdtemp(path.join(os.tmpdir(), "digest-grant-"));
    recordGrant({ subject: granted, scope: "project", origin: "test" });
    const fifo = path.join(granted, "pipe");
    execFileSync("mkfifo", [fifo]);
    const alias = path.join(granted, "looks-like-a-file.txt");
    await fsp.symlink(fifo, alias);
    app = makeApp();
    await app.ready();
    for (const p of [fifo, alias]) {
      const read = await app.inject({ method: "GET", url: readUrl(p), headers: OPT_OUT });
      const t0 = Date.now();
      const dig = await app.inject({ method: "GET", url: digestUrl(p), headers: OPT_OUT });
      expect(Date.now() - t0).toBeLessThan(1000);
      expect(read.statusCode).toBe(403);
      expect(dig.statusCode).toBe(403);
      expect(dig.json()).toMatchObject({ success: false, error: "path outside working directory" });
    }
    await fsp.rm(granted, { recursive: true, force: true });
  });

  it("serves a granted regular file", async () => {
    const granted = await fsp.mkdtemp(path.join(os.tmpdir(), "digest-grant-"));
    recordGrant({ subject: granted, scope: "project", origin: "test" });
    await fsp.writeFile(path.join(granted, "ok.txt"), "ok");
    app = makeApp();
    await app.ready();
    const res = await app.inject({ method: "GET", url: digestUrl(path.join(granted, "ok.txt")), headers: OPT_OUT });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.sha1).toBe(createHash("sha1").update("ok").digest("hex"));
    await fsp.rm(granted, { recursive: true, force: true });
  });
});

describe("GET /api/file/digest — load bound (P1–P3)", () => {
  async function bigFile(name: string, mib: number): Promise<void> {
    await fsp.writeFile(path.join(cwd, name), "");
    await fsp.truncate(path.join(cwd, name), mib * MiB);
  }

  it("P1: never more than 2 hashes in flight", async () => {
    const gate = createDigestGate(2);
    for (let i = 0; i < 6; i++) await bigFile(`f${i}.bin`, 32);
    app = makeApp({ gate });
    await app.ready();
    const results = await Promise.all(
      [0, 1, 2, 3, 4, 5].map((i) => app!.inject({ method: "GET", url: digestUrl(`f${i}.bin`) })),
    );
    expect(results.every((r) => r.statusCode === 200)).toBe(true);
    expect(gate.stats().peakActive).toBeLessThanOrEqual(2);
    expect(gate.stats().peakActive).toBeGreaterThan(0);
    expect(gate.stats().active).toBe(0);
  }, 60_000);

  it("P2: a baseline request acquires the next free slot before any queued verify", async () => {
    const order: DigestLane[] = [];
    const gate = createDigestGate(1, (l) => order.push(l));
    await fsp.writeFile(path.join(cwd, "a.txt"), "a");
    app = makeApp({ gate });
    await app.ready();
    const hold = await gate.acquire("verify"); // occupy the only slot
    order.length = 0;
    const done: string[] = [];
    const reqs = [1, 2, 3, 4].map((i) =>
      app!.inject({ method: "GET", url: digestUrl("a.txt", "&purpose=verify") }).then(() => done.push(`v${i}`)),
    );
    await new Promise((r) => setTimeout(r, 50));
    reqs.push(app.inject({ method: "GET", url: digestUrl("a.txt", "&purpose=baseline") }).then(() => done.push("b")));
    await new Promise((r) => setTimeout(r, 50));
    expect(gate.stats().queued).toBe(5);
    hold();
    await Promise.all(reqs);
    expect(order[0]).toBe("baseline");
    expect(done[0]).toBe("b");
  });

  it("P3: a client abort releases the slot within 100 ms", async () => {
    const gate = createDigestGate(2);
    await bigFile("big1.bin", 200);
    await bigFile("big2.bin", 200);
    app = makeApp({ gate });
    await app.listen({ port: 0, host: "127.0.0.1" });
    const port = (app.server.address() as AddressInfo).port;
    const aborted: Promise<void>[] = [];
    for (const n of ["big1.bin", "big2.bin"]) {
      const req = http.get(`http://127.0.0.1:${port}${digestUrl(n)}`);
      req.on("error", () => {});
      aborted.push(new Promise((r) => req.on("close", () => r())));
      setTimeout(() => req.destroy(), 40);
    }
    await new Promise((r) => setTimeout(r, 25));
    expect(gate.stats().active).toBeGreaterThan(0);
    await Promise.all(aborted);
    const t0 = Date.now();
    while (gate.stats().active > 0 && Date.now() - t0 < 1000) await new Promise((r) => setTimeout(r, 5));
    expect(Date.now() - t0).toBeLessThan(100);
    expect(gate.stats().active).toBe(0);
    // A third digest is served straight away.
    await fsp.writeFile(path.join(cwd, "a.txt"), "a");
    const third = await fetch(`http://127.0.0.1:${port}${digestUrl("a.txt")}`);
    expect(third.status).toBe(200);
  }, 30_000);
});
