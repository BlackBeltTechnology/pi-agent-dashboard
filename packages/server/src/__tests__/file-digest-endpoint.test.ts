/**
 * Tests for `GET /api/file/digest` (content-hash token, no content) and the
 * hash limiter behind it, plus the `sha1`/`size` round-trip of
 * `POST /api/file/write`.
 *
 * See change: add-editor-pane-file-handlers (minimal slice of
 * gate-changed-on-disk-by-content, tasks 2.1–2.14).
 */
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHashLimiter, DIGEST_CEILING_BYTES } from "../lib/file-digest.js";
import { registerFileRoutes } from "../routes/file-routes.js";

const execFileAsync = promisify(execFile);

function makeApp(cwds: string[]): FastifyInstance {
  const app = Fastify({ logger: false });
  registerFileRoutes(app, {
    sessionManager: { listAll: () => cwds.map((cwd) => ({ cwd })) } as any,
    preferencesStore: { getPinnedDirectories: () => [] } as any,
    networkGuard: async () => undefined,
  });
  return app;
}

const sha1 = (b: Buffer | string): string => createHash("sha1").update(b).digest("hex");
const q = (cwd: string, p: string): string => `cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(p)}`;

describe("GET /api/file/digest", () => {
  let app: FastifyInstance;
  let cwd: string;
  let outside: string;

  const digest = (p: string, c: string = cwd) => app.inject({ method: "GET", url: `/api/file/digest?${q(c, p)}` });
  const read = (p: string, c: string = cwd) => app.inject({ method: "GET", url: `/api/file?${q(c, p)}` });

  beforeEach(async () => {
    cwd = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), "fd-cwd-")));
    outside = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), "fd-out-")));
    app = makeApp([cwd]);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    await fsp.rm(cwd, { recursive: true, force: true });
    await fsp.rm(outside, { recursive: true, force: true });
  });

  it("returns size, full-precision mtime and hex sha1 — no content — with Cache-Control: no-store", async () => {
    const bytes = Buffer.from([0, 1, 2, 255, 254, 0x50, 0x4b]);
    const target = path.join(cwd, "report.docx");
    await fsp.writeFile(target, bytes);
    const res = await digest("report.docx");
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data).toEqual({ size: bytes.length, mtime: (await fsp.stat(target)).mtimeMs, sha1: sha1(bytes) });
  });

  it("hashes an empty file", async () => {
    await fsp.writeFile(path.join(cwd, "empty.bin"), "");
    const res = await digest("empty.bin");
    expect(res.json().data).toMatchObject({ size: 0, sha1: sha1("") });
  });

  it("follows an in-cwd symlink to a regular file", async () => {
    await fsp.writeFile(path.join(cwd, "real.docx"), "abc");
    await fsp.symlink(path.join(cwd, "real.docx"), path.join(cwd, "alias.docx"));
    const res = await digest("alias.docx");
    expect(res.statusCode).toBe(200);
    expect(res.json().data.sha1).toBe(sha1("abc"));
  });

  describe("admit/refuse parity with GET /api/file", () => {
    it("admits and refuses identically across the read-gate cases", async () => {
      await fsp.writeFile(path.join(cwd, "in.txt"), "in");
      await fsp.writeFile(path.join(outside, "out.txt"), "out");
      await fsp.symlink(path.join(outside, "out.txt"), path.join(cwd, "escape.txt"));
      const cases: Array<{ name: string; cwd?: string; path: string }> = [
        { name: "in-cwd file", path: "in.txt" },
        { name: "absolute in-cwd", path: path.join(cwd, "in.txt") },
        { name: "file:// URI", path: `file://${path.join(cwd, "in.txt")}` },
        { name: "outside file", path: path.join(outside, "out.txt") },
        { name: "outside missing", path: path.join(outside, "nope.txt") },
        { name: "traversal", path: "../x.txt" },
        { name: "unknown session cwd", cwd: outside, path: "out.txt" },
        { name: "missing in-cwd", path: "nope.txt" },
      ];
      for (const c of cases) {
        const a = await read(c.path, c.cwd);
        const b = await digest(c.path, c.cwd);
        expect(b.statusCode, c.name).toBe(a.statusCode);
        if (a.statusCode !== 200) {
          const ab = a.json();
          const bb = b.json();
          expect(bb.error, c.name).toBe(ab.error);
          expect(bb.reason, c.name).toBe(ab.reason);
          expect(bb.hint, c.name).toBe(ab.hint);
        }
      }
    });

    it("requires cwd and path (400) and a known session (403), as /api/file does", async () => {
      const noPath = await app.inject({ method: "GET", url: `/api/file/digest?cwd=${encodeURIComponent(cwd)}` });
      expect(noPath.statusCode).toBe(400);
      expect(noPath.json().error).toBe("cwd and path parameters required");
      const unknown = await digest("out.txt", outside);
      expect(unknown.statusCode).toBe(403);
      expect(unknown.json().error).toBe("unknown session path");
    });
  });

  describe("regular files only", () => {
    it("404s a directory", async () => {
      await fsp.mkdir(path.join(cwd, "sub"));
      const res = await digest("sub");
      expect(res.statusCode).toBe(404);
    });

    it.skipIf(process.platform === "win32")("404s a FIFO without blocking", async () => {
      await execFileAsync("mkfifo", [path.join(cwd, "pipe")]);
      const started = Date.now();
      const res = await digest("pipe");
      expect(res.statusCode).toBe(404);
      expect(Date.now() - started).toBeLessThan(1000);
    });
  });

  describe("256 MiB ceiling", () => {
    it("hashes exactly the ceiling and omits sha1 one byte above it (sparse files)", async () => {
      const at = path.join(cwd, "at.bin");
      const above = path.join(cwd, "above.bin");
      await fsp.writeFile(at, "");
      await fsp.truncate(at, DIGEST_CEILING_BYTES);
      await fsp.writeFile(above, "");
      await fsp.truncate(above, DIGEST_CEILING_BYTES + 1);

      const atRes = await digest("at.bin");
      expect(atRes.json().data.size).toBe(DIGEST_CEILING_BYTES);
      expect(atRes.json().data.sha1).toMatch(/^[0-9a-f]{40}$/);

      const aboveRes = await digest("above.bin");
      expect(aboveRes.statusCode).toBe(200);
      const data = aboveRes.json().data;
      expect(data.size).toBe(DIGEST_CEILING_BYTES + 1);
      expect(data).not.toHaveProperty("sha1");
      expect(typeof data.mtime).toBe("number");
    }, 30_000);
  });
});

describe("hash limiter", () => {
  const deferred = () => {
    let resolve!: () => void;
    const promise = new Promise<void>((r) => {
      resolve = r;
    });
    return { promise, resolve };
  };

  it("never runs more than 2 tasks at once", async () => {
    const limiter = createHashLimiter(2);
    let inFlight = 0;
    let peak = 0;
    const gates = Array.from({ length: 6 }, deferred);
    const runs = gates.map((g) =>
      limiter.run(new AbortController().signal, async () => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await g.promise;
        inFlight--;
      }),
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(inFlight).toBe(2);
    for (const g of gates) {
      g.resolve();
      await new Promise((r) => setTimeout(r, 5));
    }
    await Promise.all(runs);
    expect(peak).toBe(2);
  });

  it("a task aborted while queued never starts; an aborted in-flight task frees its slot at once", async () => {
    const limiter = createHashLimiter(2);
    const aborters = [new AbortController(), new AbortController()];
    // Two in-flight tasks that end only when their signal aborts.
    const inflight = aborters.map((a) =>
      limiter.run(a.signal, () => new Promise<void>((_, rej) => a.signal.addEventListener("abort", () => rej(new Error("aborted"))))),
    );
    const settled = inflight.map((p) => p.catch(() => {}));
    const queuedAbort = new AbortController();
    let queuedStarted = false;
    const queued = limiter.run(queuedAbort.signal, async () => {
      queuedStarted = true;
    });
    queuedAbort.abort();
    const third = { started: false };
    const next = limiter.run(new AbortController().signal, async () => {
      third.started = true;
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(third.started).toBe(false); // both slots held

    const t0 = Date.now();
    aborters[0].abort();
    await settled[0];
    await queued.catch(() => {});
    await next;
    expect(Date.now() - t0).toBeLessThan(100);
    expect(queuedStarted).toBe(false);
    expect(third.started).toBe(true);
    aborters[1].abort();
    await settled[1];
  });
});

describe("POST /api/file/write returns size + sha1 of the written bytes", () => {
  let app: FastifyInstance;
  let cwd: string;

  beforeEach(async () => {
    cwd = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), "fd-write-")));
    app = makeApp([cwd]);
    await app.ready();
  });
  afterEach(async () => {
    await app.close();
    await fsp.rm(cwd, { recursive: true, force: true });
  });

  it("matches the digest for BOM, CRLF and non-ASCII content", async () => {
    const target = path.join(cwd, "AGENTS.md");
    await fsp.writeFile(target, "# x\n");
    const content = "\uFEFF# Título\r\nárvíztűrő tükörfúrógép — 🚀\r\n";
    const mtime = (await fsp.stat(target)).mtimeMs;
    const res = await app.inject({ method: "POST", url: "/api/file/write", payload: { cwd, path: target, content, mtime } });
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    const bytes = Buffer.from(content, "utf-8");
    expect(data.size).toBe(bytes.length);
    expect(data.sha1).toBe(sha1(bytes));
    expect(typeof data.mtime).toBe("number");

    const dig = await app.inject({ method: "GET", url: `/api/file/digest?${q(cwd, target)}` });
    expect(dig.json().data.sha1).toBe(data.sha1);
    expect(dig.json().data.size).toBe(data.size);
  });
});
