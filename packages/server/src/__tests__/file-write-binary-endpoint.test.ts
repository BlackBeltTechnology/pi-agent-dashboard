/**
 * Tests for `POST /api/file/write-binary` — the save road for
 * `editor-pane-file-handler` edit claims (test-plan E12–E19, E21–E23, P1, X4–X6)
 * plus observability and body-limit scoping (tasks 2.1–2.6).
 *
 * See change: add-editor-pane-file-handlers.
 */
import { createHash } from "node:crypto";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { routeTier } from "@blackbelt-technology/pi-dashboard-shared/route-tiers.js";
import Fastify, { type FastifyInstance, type LightMyRequestResponse } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRouteTierGate } from "../auth/route-tier-gate.js";
import { createFileValidatorPool, type FileValidatorPool } from "../lib/file-validator-pool.js";
import { serializeWrite } from "../lib/file-write-lock.js";
import type { HandlerClaimInfo } from "../lib/writable-handler-target.js";
import { registerFileRoutes } from "../routes/file-routes.js";
import { type RegisteredValidator, registerFileWriteBinaryRoutes } from "../routes/file-write-binary-routes.js";

const sha1 = (b: Buffer | string): string => createHash("sha1").update(b).digest("hex");
const MiB = 1024 * 1024;

function makeClaim(over: Partial<HandlerClaimInfo> = {}): HandlerClaimInfo {
  return {
    pluginId: "demo",
    claimId: "word",
    mode: "edit",
    extensions: [".docx"],
    maxBytes: 128 * MiB,
    copySuffix: "wordcraft",
    validator: false,
    pluginEnabled: true,
    ...over,
  };
}

interface Harness {
  app: FastifyInstance;
  cwd: string;
  logs: string[];
  claims: Map<string, HandlerClaimInfo>;
  validators: Map<string, RegisteredValidator>;
  loaded: Set<string>;
  validatorDir: string;
  pool: FileValidatorPool;
  post: (q: Record<string, string | undefined>, body: Buffer | string) => Promise<LightMyRequestResponse>;
  /** Overwrite `rel` with `bytes` using `expect` as the token. */
  overwrite: (rel: string, bytes: Buffer | string, expect?: string, claim?: string) => Promise<LightMyRequestResponse>;
}

let h: Harness;
const cleanup: string[] = [];

async function mkHarness(opts: { poolTimeoutMs?: number; cwds?: (cwd: string) => string[] } = {}): Promise<Harness> {
  const cwd = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), "fwb-cwd-")));
  const validatorDir = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), "fwb-val-")));
  cleanup.push(cwd, validatorDir);
  const logs: string[] = [];
  const claims = new Map<string, HandlerClaimInfo>([["demo/word", makeClaim()]]);
  const validators = new Map<string, RegisteredValidator>();
  const loaded = new Set<string>(["demo"]);
  const pool = createFileValidatorPool({ timeoutMs: opts.poolTimeoutMs });
  const app = Fastify({ logger: false });
  app.get("/api/health", async () => ({ ok: true }));
  const cwds = opts.cwds ? opts.cwds(cwd) : [cwd];
  registerFileRoutes(app, {
    sessionManager: { listAll: () => cwds.map((c) => ({ cwd: c })) } as any,
    preferencesStore: { getPinnedDirectories: () => [] } as any,
    networkGuard: async () => undefined,
  });
  await registerFileWriteBinaryRoutes(app, {
    sessionManager: { listAll: () => cwds.map((c) => ({ cwd: c })) } as any,
    networkGuard: async () => undefined,
    pool,
    log: (l) => logs.push(l),
    resolveClaim: (p, c) => claims.get(`${p}/${c}`) ?? null,
    isPluginServerLoaded: (p) => loaded.has(p),
    getValidator: (p, c) => validators.get(`${p}/${c}`),
  });
  await app.ready();
  const post: Harness["post"] = (q, body) => {
    const qs = Object.entries(q)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${k}=${encodeURIComponent(v as string)}`)
      .join("&");
    return app.inject({
      method: "POST",
      url: `/api/file/write-binary?${qs}`,
      headers: { "content-type": "application/octet-stream" },
      payload: body,
    });
  };
  return {
    app,
    cwd,
    logs,
    claims,
    validators,
    loaded,
    validatorDir,
    pool,
    post,
    overwrite: (rel, bytes, expect, claim = "demo/word") =>
      post({ cwd, path: rel, mode: "overwrite", claim, expectSha1: expect }, Buffer.from(bytes)),
  };
}

async function writeValidator(name: string, body: string): Promise<string> {
  const p = path.join(h.validatorDir, name);
  await fsp.writeFile(p, body);
  return p;
}

beforeEach(async () => {
  h = await mkHarness();
});

afterEach(async () => {
  await h.app.close();
  await h.pool.dispose();
  for (const d of cleanup.splice(0)) await fsp.rm(d, { recursive: true, force: true });
});

const read = (rel: string) => fsp.readFile(path.join(h.cwd, rel));

describe("body limit scoping (2.1)", () => {
  it("accepts a 2 MiB octet-stream body while other routes keep the 1 MiB default", async () => {
    await fsp.writeFile(path.join(h.cwd, "a.docx"), "old");
    const big = Buffer.alloc(2 * MiB, 7);
    const ok = await h.overwrite("a.docx", big, sha1("old"));
    expect(ok.statusCode).toBe(200);

    await fsp.writeFile(path.join(h.cwd, "AGENTS.md"), "x");
    const text = await h.app.inject({
      method: "POST",
      url: "/api/file/write",
      payload: { cwd: h.cwd, path: path.join(h.cwd, "AGENTS.md"), content: "y".repeat(2 * MiB), mtime: 0 },
    });
    expect(text.statusCode).toBe(413);
  });

  it("the octet-stream parser is not installed on other routes (415)", async () => {
    const res = await h.app.inject({
      method: "POST",
      url: "/api/file/write",
      headers: { "content-type": "application/octet-stream" },
      payload: Buffer.from("zz"),
    });
    expect(res.statusCode).toBe(415);
  });
});

describe("E12 write authorization", () => {
  it("200 only for known cwd + under cwd + enabled edit claim + claimed extension; else 403 and bytes unchanged", async () => {
    const outside = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), "fwb-out-")));
    cleanup.push(outside);
    await fsp.writeFile(path.join(outside, "secret.docx"), "secret");
    await fsp.writeFile(path.join(h.cwd, "ok.docx"), "ok");
    await fsp.writeFile(path.join(h.cwd, "ok.xlsx"), "x");
    await fsp.symlink(path.join(outside, "secret.docx"), path.join(h.cwd, "link.docx"));
    await fsp.mkdir(path.join(h.cwd, "sub"));
    await fsp.writeFile(path.join(h.cwd, "sub", "deep.docx"), "deep");

    const cases: Array<{ name: string; claim?: Partial<HandlerClaimInfo>; cwd?: string; rel: string; token: string; expect: number }> = [
      { name: "known + under + edit + claimed", rel: "ok.docx", token: sha1("ok"), expect: 200 },
      { name: "nested path", rel: "sub/deep.docx", token: sha1("deep"), expect: 200 },
      { name: "unknown cwd", cwd: outside, rel: "secret.docx", token: sha1("secret"), expect: 403 },
      { name: ".. escape", rel: "../" + path.basename(outside) + "/secret.docx", token: sha1("secret"), expect: 403 },
      { name: "symlink outside cwd", rel: "link.docx", token: sha1("secret"), expect: 403 },
      { name: "absolute path outside", rel: path.join(outside, "secret.docx"), token: sha1("secret"), expect: 403 },
      { name: "claim disabled (plugin)", claim: { pluginEnabled: false }, rel: "ok.docx", token: sha1("ok"), expect: 403 },
      { name: "claim is preview mode", claim: { mode: "preview" }, rel: "ok.docx", token: sha1("ok"), expect: 403 },
      { name: "extension not claimed", rel: "ok.xlsx", token: sha1("x"), expect: 403 },
    ];
    for (const c of cases) {
      h.claims.set("demo/word", makeClaim(c.claim));
      const res = await h.post(
        { cwd: c.cwd ?? h.cwd, path: c.rel, mode: "overwrite", claim: "demo/word", expectSha1: c.token },
        Buffer.from("NEW"),
      );
      expect(res.statusCode, c.name).toBe(c.expect);
    }
    expect((await read("ok.docx")).toString()).toBe("NEW");
    expect((await read("sub/deep.docx")).toString()).toBe("NEW");
    expect((await fsp.readFile(path.join(outside, "secret.docx"))).toString()).toBe("secret");
    expect((await read("ok.xlsx")).toString()).toBe("x");
  });

  it("refuses an unknown claim and a malformed query (400)", async () => {
    await fsp.writeFile(path.join(h.cwd, "a.docx"), "a");
    expect((await h.overwrite("a.docx", "n", sha1("a"), "demo/nope")).statusCode).toBe(403);
    expect((await h.overwrite("a.docx", "n", sha1("a"), "not-a-claim")).statusCode).toBe(400);
    const badMode = await h.post({ cwd: h.cwd, path: "a.docx", mode: "append", claim: "demo/word", expectSha1: sha1("a") }, Buffer.from("n"));
    expect(badMode.statusCode).toBe(400);
    expect((await read("a.docx")).toString()).toBe("a");
  });
});

describe("E13 symlink dual extension", () => {
  it("refuses a .docx symlink that resolves to an unclaimed extension", async () => {
    await fsp.writeFile(path.join(h.cwd, "notes.md"), "# notes");
    await fsp.symlink(path.join(h.cwd, "notes.md"), path.join(h.cwd, "report.docx"));
    const res = await h.overwrite("report.docx", "pwn", sha1("# notes"));
    expect(res.statusCode).toBe(403);
    expect((await read("notes.md")).toString()).toBe("# notes");
  });
});

describe("E14 size cap", () => {
  it("claim maxBytes 40 MiB: −1 and exact pass, +1 → 413; above 128 MiB → body-limit 413; files unchanged on refusal", async () => {
    h.claims.set("demo/word", makeClaim({ maxBytes: 40 * MiB }));
    const target = path.join(h.cwd, "big.docx");
    await fsp.writeFile(target, "seed");
    let token = sha1("seed");

    const under = Buffer.alloc(40 * MiB - 1, 1);
    const r1 = await h.overwrite("big.docx", under, token);
    expect(r1.statusCode).toBe(200);
    token = r1.json().data.sha1;

    const exact = Buffer.alloc(40 * MiB, 2);
    const r2 = await h.overwrite("big.docx", exact, token);
    expect(r2.statusCode).toBe(200);
    token = r2.json().data.sha1;
    expect(sha1(await fsp.readFile(target))).toBe(token);

    const over = await h.overwrite("big.docx", Buffer.alloc(40 * MiB + 1, 3), token);
    expect(over.statusCode).toBe(413);
    expect(sha1(await fsp.readFile(target))).toBe(token);

    const huge = await h.overwrite("big.docx", Buffer.alloc(128 * MiB + 1), token);
    expect(huge.statusCode).toBe(413);
    expect(sha1(await fsp.readFile(target))).toBe(token);
  }, 60_000);
});

describe("E15–E17 overwrite conflict by content", () => {
  it("E15: a different rewrite with the old mtime restored is a 409 carrying the current sha1", async () => {
    const target = path.join(h.cwd, "r.docx");
    await fsp.writeFile(target, "snapshot");
    const snapshotSha = sha1("snapshot");
    const old = await fsp.stat(target);
    await fsp.writeFile(target, "AGENTCHG"); // same length, different content
    await fsp.utimes(target, old.atime, old.mtime);
    const res = await h.overwrite("r.docx", "mine", snapshotSha);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ success: false, sha1: sha1("AGENTCHG") });
    expect(typeof res.json().mtime).toBe("number");
    expect((await fsp.readFile(target)).toString()).toBe("AGENTCHG");
  });

  it("E16: overwrite without expectSha1 is a 400 and writes nothing", async () => {
    const target = path.join(h.cwd, "r.docx");
    await fsp.writeFile(target, "seed");
    const res = await h.overwrite("r.docx", "mine", undefined);
    expect(res.statusCode).toBe(400);
    const bad = await h.overwrite("r.docx", "mine", "not-hex");
    expect(bad.statusCode).toBe(400);
    expect((await fsp.readFile(target)).toString()).toBe("seed");
  });

  it("E17: a file deleted after the snapshot is a 409 without sha1", async () => {
    const res = await h.overwrite("gone.docx", "mine", sha1("whatever"));
    expect(res.statusCode).toBe(409);
    expect(res.json()).not.toHaveProperty("sha1");
    await expect(fsp.stat(path.join(h.cwd, "gone.docx"))).rejects.toThrow();
  });

  it("a matching token overwrites and returns { mtime, sha1, path } of the written bytes", async () => {
    const target = path.join(h.cwd, "r.docx");
    await fsp.writeFile(target, "seed");
    const bytes = Buffer.from([0, 255, 1, 2, 3]);
    const res = await h.overwrite("r.docx", bytes, sha1("seed").toUpperCase());
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data).toEqual({ mtime: (await fsp.stat(target)).mtimeMs, sha1: sha1(bytes), path: target });
    expect(await fsp.readFile(target)).toEqual(bytes);
  });
});

describe("E18 file mode", () => {
  it.skipIf(process.platform === "win32")("overwrite keeps 0600; a copy of a deleted source gets 0644 & ~umask; a copy of an existing source takes its mode", async () => {
    const target = path.join(h.cwd, "p.docx");
    await fsp.writeFile(target, "seed");
    await fsp.chmod(target, 0o600);
    const res = await h.overwrite("p.docx", "new", sha1("seed"));
    expect(res.statusCode).toBe(200);
    expect((await fsp.stat(target)).mode & 0o777).toBe(0o600);

    const copyExisting = await h.post({ cwd: h.cwd, path: "p.docx", mode: "copy", claim: "demo/word" }, Buffer.from("c1"));
    expect(copyExisting.statusCode).toBe(200);
    expect((await fsp.stat(path.join(h.cwd, "p.wordcraft.docx"))).mode & 0o777).toBe(0o600);

    const umask = process.umask();
    const copyDeleted = await h.post({ cwd: h.cwd, path: "deleted.docx", mode: "copy", claim: "demo/word" }, Buffer.from("c2"));
    expect(copyDeleted.statusCode).toBe(200);
    expect((await fsp.stat(path.join(h.cwd, "deleted.wordcraft.docx"))).mode & 0o777).toBe(0o644 & ~umask);
  });
});

describe("E19 copy naming", () => {
  it("creates <stem>.<suffix>.<ext>, then -2…-99, then 409 'no free name'; never modifies an existing file", async () => {
    await fsp.writeFile(path.join(h.cwd, "report.docx"), "source");
    const copy = () => h.post({ cwd: h.cwd, path: "report.docx", mode: "copy", claim: "demo/word" }, Buffer.from("copy-bytes"));

    const first = await copy();
    expect(first.statusCode).toBe(200);
    expect(first.json().data).toEqual({
      mtime: expect.any(Number),
      sha1: sha1("copy-bytes"),
      path: path.join(h.cwd, "report.wordcraft.docx"),
    });
    const second = await copy();
    expect(second.json().data.path).toBe(path.join(h.cwd, "report.wordcraft-2.docx"));

    // Occupy -3 with foreign content: it must be skipped, not overwritten.
    await fsp.writeFile(path.join(h.cwd, "report.wordcraft-3.docx"), "foreign");
    for (let n = 4; n <= 99; n++) await fsp.writeFile(path.join(h.cwd, `report.wordcraft-${n}.docx`), "foreign");
    const full = await copy();
    expect(full.statusCode).toBe(409);
    expect(full.json().error).toMatch(/no free name/);
    expect((await read("report.wordcraft-3.docx")).toString()).toBe("foreign");
    expect((await read("report.docx")).toString()).toBe("source");
    expect((await read("report.wordcraft.docx")).toString()).toBe("copy-bytes");
  });

  it("two concurrent copies create two distinct files", async () => {
    await fsp.writeFile(path.join(h.cwd, "c.docx"), "s");
    const [a, b] = await Promise.all([
      h.post({ cwd: h.cwd, path: "c.docx", mode: "copy", claim: "demo/word" }, Buffer.from("A")),
      h.post({ cwd: h.cwd, path: "c.docx", mode: "copy", claim: "demo/word" }, Buffer.from("B")),
    ]);
    expect([a.statusCode, b.statusCode]).toEqual([200, 200]);
    expect(a.json().data.path).not.toBe(b.json().data.path);
    const contents = [await fsp.readFile(a.json().data.path, "utf8"), await fsp.readFile(b.json().data.path, "utf8")];
    expect(contents.sort()).toEqual(["A", "B"]);
  });

  it("refuses a copy whose parent escapes the cwd, and one whose extension is unclaimed", async () => {
    const outside = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), "fwb-out-")));
    cleanup.push(outside);
    await fsp.symlink(outside, path.join(h.cwd, "outdir"));
    const viaLink = await h.post({ cwd: h.cwd, path: "outdir/x.docx", mode: "copy", claim: "demo/word" }, Buffer.from("z"));
    expect(viaLink.statusCode).toBe(403);
    expect(await fsp.readdir(outside)).toEqual([]);
    const badExt = await h.post({ cwd: h.cwd, path: "x.md", mode: "copy", claim: "demo/word" }, Buffer.from("z"));
    expect(badExt.statusCode).toBe(403);
  });
});

describe("E21 validator fail-closed", () => {
  it("registered validator runs (sees the bytes + extension); not-loaded → 503; enabled() false → 403; files unchanged when refused", async () => {
    const check = await writeValidator(
      "check.mjs",
      `export function validate(bytes, ext) { return bytes[0] === 0x50 && bytes[1] === 0x4b && ext === ".docx" ? { ok: true } : { ok: false, reason: "not a zip" }; }`,
    );
    h.claims.set("demo/word", makeClaim({ validator: true }));
    h.validators.set("demo/word", { modulePath: check });
    const target = path.join(h.cwd, "v.docx");
    await fsp.writeFile(target, "seed");
    const seedSha = sha1("seed");

    // registered + loaded: validator runs — a zip-looking body passes, others are rejected.
    expect((await h.overwrite("v.docx", Buffer.from("not zip"), seedSha)).statusCode).toBe(422);
    expect((await read("v.docx")).toString()).toBe("seed");

    // plugin server entry not loaded → 503, nothing written, even for a valid body.
    h.loaded.delete("demo");
    const notLoaded = await h.overwrite("v.docx", Buffer.from("PKok"), seedSha);
    expect(notLoaded.statusCode).toBe(503);
    expect((await read("v.docx")).toString()).toBe("seed");

    // declared validator but none registered → 503.
    h.loaded.add("demo");
    h.validators.delete("demo/word");
    expect((await h.overwrite("v.docx", Buffer.from("PKok"), seedSha)).statusCode).toBe(503);

    // enabled() false → 403 (checked before anything else for the claim).
    h.validators.set("demo/word", { modulePath: check, enabled: () => false });
    expect((await h.overwrite("v.docx", Buffer.from("PKok"), seedSha)).statusCode).toBe(403);
    expect((await read("v.docx")).toString()).toBe("seed");

    // enabled() true + loaded + registered: the valid body is written.
    h.validators.set("demo/word", { modulePath: check, enabled: () => true });
    const ok = await h.overwrite("v.docx", Buffer.from("PKok"), seedSha);
    expect(ok.statusCode).toBe(200);
    expect((await read("v.docx")).toString()).toBe("PKok");
  });

  it("a throwing enabled() predicate refuses (fail closed)", async () => {
    const ok = await writeValidator("ok.mjs", `export function validate() { return { ok: true }; }`);
    h.validators.set("demo/word", {
      modulePath: ok,
      enabled: () => {
        throw new Error("boom");
      },
    });
    await fsp.writeFile(path.join(h.cwd, "t.docx"), "seed");
    expect((await h.overwrite("t.docx", "n", sha1("seed"))).statusCode).toBe(403);
  });
});

describe("E22 route tier", () => {
  it("is `control`; a non-loopback observe-tier login session is refused with 403 insufficient_scope", async () => {
    expect(routeTier("POST", "/api/file/write-binary")).toBe("control");
    expect(routeTier("GET", "/api/file/digest")).toBe("observe");

    const app = Fastify({ logger: false });
    app.addHook("onRequest", async (req) => {
      (req as any).authVia = "session";
      (req as any).principalTier = "observe";
    });
    app.addHook("onRequest", createRouteTierGate({ getTrustedNetworks: () => [], logRefusal: () => {} }));
    await registerFileWriteBinaryRoutes(app, {
      sessionManager: { listAll: () => [{ cwd: h.cwd }] } as any,
      networkGuard: async () => undefined,
      pool: h.pool,
      resolveClaim: () => makeClaim(),
      isPluginServerLoaded: () => true,
      getValidator: () => undefined,
    });
    await app.ready();
    await fsp.writeFile(path.join(h.cwd, "t.docx"), "seed");
    const res = await app.inject({
      method: "POST",
      url: `/api/file/write-binary?cwd=${encodeURIComponent(h.cwd)}&path=t.docx&mode=overwrite&claim=demo/word&expectSha1=${sha1("seed")}`,
      headers: { "content-type": "application/octet-stream" },
      payload: Buffer.from("n"),
      remoteAddress: "203.0.113.9",
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: "insufficient_scope", scope: "control" });
    expect((await read("t.docx")).toString()).toBe("seed");
    await app.close();
  });
});

describe("E23 lock key is the realpath, shared with /api/file/write", () => {
  it("overwrites via a symlink alias and via the real path serialize: the second sees the first's content → 409", async () => {
    const real = path.join(h.cwd, "real.docx");
    await fsp.writeFile(real, "seed");
    await fsp.symlink(real, path.join(h.cwd, "alias.docx"));
    const token = sha1("seed");

    let release!: () => void;
    const held = serializeWrite(real, () => new Promise<void>((r) => (release = r)));
    const viaAlias = h.overwrite("alias.docx", "FIRST", token);
    await new Promise((r) => setTimeout(r, 40));
    const viaReal = h.overwrite("real.docx", "SECOND", token);
    await new Promise((r) => setTimeout(r, 60));
    expect((await fsp.readFile(real)).toString()).toBe("seed"); // both parked behind the held lock
    release();
    await held;
    const [a, b] = await Promise.all([viaAlias, viaReal]);
    expect([a.statusCode, b.statusCode]).toEqual([200, 409]);
    expect(b.json().sha1).toBe(sha1("FIRST"));
    expect((await fsp.readFile(real)).toString()).toBe("FIRST");
  });

  it("POST /api/file/write via a symlink alias waits on the same realpath lock", async () => {
    const real = path.join(h.cwd, "real.md");
    await fsp.writeFile(real, "# seed\n");
    await fsp.symlink(real, path.join(h.cwd, "alias.md"));
    const mtime = (await fsp.stat(real)).mtimeMs;
    let release!: () => void;
    const held = serializeWrite(await fsp.realpath(real), () => new Promise<void>((r) => (release = r)));
    const pending = h.app.inject({
      method: "POST",
      url: "/api/file/write",
      payload: { cwd: h.cwd, path: path.join(h.cwd, "alias.md"), content: "# changed\n", mtime },
    });
    await new Promise((r) => setTimeout(r, 80));
    expect((await fsp.readFile(real, "utf8"))).toBe("# seed\n");
    release();
    await held;
    expect((await pending).statusCode).toBe(200);
    expect((await fsp.readFile(real, "utf8"))).toBe("# changed\n");
  });
});

describe("X4 validator hang", () => {
  it("a synchronous infinite loop yields 422 after ≈5 s while GET /api/health still answers within 200 ms; file unchanged", async () => {
    const hang = await writeValidator("hang.mjs", `export function validate() { while (true) {} }`);
    h.validators.set("demo/word", { modulePath: hang });
    await fsp.writeFile(path.join(h.cwd, "h.docx"), "seed");

    const started = Date.now();
    const save = h.overwrite("h.docx", "n", sha1("seed"));
    await new Promise((r) => setTimeout(r, 600)); // validator is spinning by now
    const t0 = Date.now();
    const health = await h.app.inject({ method: "GET", url: "/api/health" });
    const healthMs = Date.now() - t0;
    expect(health.statusCode).toBe(200);
    expect(healthMs).toBeLessThan(200);

    const res = await save;
    const elapsed = Date.now() - started;
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toMatch(/timed out/);
    expect(elapsed).toBeGreaterThanOrEqual(4500);
    expect(elapsed).toBeLessThan(8000);
    expect((await read("h.docx")).toString()).toBe("seed");
    expect(h.logs.some((l) => l.includes("validator") && l.includes("outcome=timeout"))).toBe(true);
  }, 20_000);
});

describe("X5 validator overflow", () => {
  it("with 2 workers busy and 8 queued the 11th save is a retryable 503", async () => {
    const slow = await writeValidator("slow.mjs", `export async function validate() { await new Promise((r) => setTimeout(r, 1200)); return { ok: true }; }`);
    h.validators.set("demo/word", { modulePath: slow });
    const saves: Array<Promise<LightMyRequestResponse>> = [];
    for (let i = 0; i < 10; i++) {
      await fsp.writeFile(path.join(h.cwd, `f${i}.docx`), `seed${i}`);
      saves.push(h.overwrite(`f${i}.docx`, "n", sha1(`seed${i}`)));
    }
    await new Promise((r) => setTimeout(r, 300)); // all 10 admitted (2 running + 8 queued)
    await fsp.writeFile(path.join(h.cwd, "f10.docx"), "seed10");
    const eleventh = await h.overwrite("f10.docx", "n", sha1("seed10"));
    expect(eleventh.statusCode).toBe(503);
    expect(eleventh.json()).toMatchObject({ retryable: true });
    expect((await read("f10.docx")).toString()).toBe("seed10");
    const results = await Promise.all(saves);
    expect(results.map((r) => r.statusCode)).toEqual(Array(10).fill(200));
    expect(h.logs.some((l) => l.includes("outcome=busy"))).toBe(true);
  }, 30_000);
});

describe("X6 validator reject / error", () => {
  it("{ ok:false } and a throwing validator both give 422 with the file untouched", async () => {
    const reject = await writeValidator("reject.mjs", `export function validate() { return { ok: false, reason: "corrupt zip" }; }`);
    const boom = await writeValidator("boom.mjs", `export function validate() { throw new Error("kaput"); }`);
    const target = path.join(h.cwd, "x.docx");
    await fsp.writeFile(target, "seed");

    h.validators.set("demo/word", { modulePath: reject });
    const r1 = await h.overwrite("x.docx", "n", sha1("seed"));
    expect(r1.statusCode).toBe(422);
    expect(r1.json().error).toMatch(/corrupt zip/);

    h.validators.set("demo/word", { modulePath: boom });
    const r2 = await h.overwrite("x.docx", "n", sha1("seed"));
    expect(r2.statusCode).toBe(422);

    h.validators.set("demo/word", { modulePath: path.join(h.validatorDir, "missing.mjs") });
    const r3 = await h.overwrite("x.docx", "n", sha1("seed"));
    expect(r3.statusCode).toBe(422);
    expect((await fsp.readFile(target)).toString()).toBe("seed");
  });

  it("a validator runs before the lock: a held lock on the file does not delay a rejection", async () => {
    const reject = await writeValidator("reject2.mjs", `export function validate() { return { ok: false, reason: "no" }; }`);
    h.validators.set("demo/word", { modulePath: reject });
    const real = path.join(h.cwd, "l.docx");
    await fsp.writeFile(real, "seed");
    let release!: () => void;
    const held = serializeWrite(real, () => new Promise<void>((r) => (release = r)));
    const t0 = Date.now();
    const res = await h.overwrite("l.docx", "n", sha1("seed"));
    expect(res.statusCode).toBe(422);
    expect(Date.now() - t0).toBeLessThan(1500);
    release();
    await held;
  });
});

describe("observability (2.6)", () => {
  it("emits one outcome line per request: cwd-relative path, claim, mode, byte count — no absolute paths or content", async () => {
    await fsp.writeFile(path.join(h.cwd, "o.docx"), "seed");
    await h.overwrite("o.docx", "12345", sha1("seed")); // ok
    await h.overwrite("o.docx", "x", sha1("stale")); // conflict
    await h.overwrite("o.xlsx", "x", sha1("a")); // forbidden
    await h.overwrite("o.docx", "x", undefined); // bad-request
    h.claims.set("demo/word", makeClaim({ maxBytes: 3 }));
    await h.overwrite("o.docx", "toolong", sha1("12345")); // too-large
    const lines = h.logs.filter((l) => l.startsWith("[file-write-binary] claim="));
    expect(lines.map((l) => /outcome=(\S+)/.exec(l)?.[1])).toEqual(["ok", "conflict", "forbidden", "bad-request", "too-large"]);
    expect(lines[0]).toContain('claim="demo/word" mode=overwrite bytes=5 outcome=ok path="o.docx"');
    for (const l of lines) {
      expect(l).not.toContain(h.cwd);
      expect(l).not.toContain("12345");
    }
  });
});

describe("P1 write-binary tail latency (measure only, never fails)", () => {
  it("records p95 of sequential overwrites with a no-op worker validator", async () => {
    const full = process.env.PI_P1_FULL === "1";
    const runs = full ? 20 : 5;
    const size = (full ? 40 : 4) * MiB;
    const noop = await writeValidator("noop.mjs", `export function validate() { return { ok: true }; }`);
    h.validators.set("demo/word", { modulePath: noop });
    const target = path.join(h.cwd, "p1.docx");
    await fsp.writeFile(target, "seed");
    let token = sha1("seed");
    const times: number[] = [];
    for (let i = 0; i < runs; i++) {
      const body = Buffer.alloc(size, i + 1);
      const t0 = performance.now();
      const res = await h.overwrite("p1.docx", body, token);
      times.push(performance.now() - t0);
      expect(res.statusCode).toBe(200);
      token = res.json().data.sha1;
    }
    times.sort((a, b) => a - b);
    const p95 = times[Math.min(times.length - 1, Math.ceil(times.length * 0.95) - 1)];
    console.info(`[P1] write-binary ${runs}×${size / MiB} MiB: p95=${p95.toFixed(0)} ms (measure-only${full ? ", full" : ", reduced — set PI_P1_FULL=1 for 20×40 MiB"})`);
    expect(times).toHaveLength(runs);
  }, 120_000);
});
