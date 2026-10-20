/**
 * L1 — `mountApp` (the `ctx.serveApp` engine): serving rules, guards, wasm/gz
 * negotiation, CSP (string + function), cross-origin frame, mount registry.
 * test-plan #E12, #E13 (mount-level), 3.3a–3.3d of add-plugin-capability-routes.
 *
 * Exemplar for the fastify.inject style: packages/server/src/__tests__/csp.test.ts.
 *
 * See change: add-plugin-capability-routes, edit-office-in-pane-with-craft-web.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import compress from "@fastify/compress";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppMountRegistry, type MountAppEnv, mountApp, type ServeAppOptions } from "../server/app-mount.js";

let tmp: string;
let pkgRoot: string;
let dataDir: string;
let app: FastifyInstance | undefined;
let registry: AppMountRegistry;
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

function write(file: string, content: string | Buffer): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function env(fastify: FastifyInstance, over: Partial<MountAppEnv> = {}): MountAppEnv {
  return { fastify, pluginId: "wall", packageRoot: pkgRoot, dataDir, logger, registry, ...over };
}

async function boot(opts: Partial<ServeAppOptions> & { dir: string }, withCompress = false): Promise<FastifyInstance> {
  const f = Fastify({ logger: false });
  if (withCompress) await f.register(compress, { global: true, threshold: 16, encodings: ["gzip", "deflate"] });
  mountApp(env(f), { csp: "default-src 'self'", ...opts });
  await f.ready();
  app = f;
  return f;
}

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "app-mount-")));
  pkgRoot = path.join(tmp, "pkg");
  dataDir = path.join(tmp, "data");
  fs.mkdirSync(pkgRoot, { recursive: true });
  fs.mkdirSync(dataDir, { recursive: true });
  registry = new AppMountRegistry();
  logger.info.mockClear();
  logger.warn.mockClear();
  logger.error.mockClear();
});

afterEach(async () => {
  await app?.close();
  app = undefined;
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("serveApp mount — serving rules (E12)", () => {
  let dir: string;
  beforeEach(() => {
    dir = path.join(pkgRoot, "dist");
    write(path.join(dir, "index.html"), "<html>shell</html>");
    write(path.join(dir, "assets", "app.3f9a.js"), "console.log(1)");
    write(path.join(dir, "plain.css"), "a{}");
    write(path.join(dir, "config.json"), "{}");
    write(path.join(dir, "app.js.map"), "{}");
    write(path.join(dir, ".env"), "SECRET=1");
    write(path.join(tmp, "outside.js"), "stolen");
    fs.symlinkSync(path.join(tmp, "outside.js"), path.join(dir, "evil.js"));
    fs.symlinkSync(tmp, path.join(dir, "linkdir"));
  });

  it("serves a content-hashed asset immutable with the enforced CSP", async () => {
    const f = await boot({ dir });
    const res = await f.inject({ method: "GET", url: "/apps/wall/assets/app.3f9a.js" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/javascript");
    expect(res.headers["cache-control"]).toContain("immutable");
    expect(res.headers["content-security-policy"]).toBe("default-src 'self'");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.body).toBe("console.log(1)");
  });

  it("serves a non-hashed asset without immutable", async () => {
    const f = await boot({ dir });
    const res = await f.inject({ method: "GET", url: "/apps/wall/plain.css" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).not.toContain("immutable");
  });

  it.each([
    ["json", "/apps/wall/config.json"],
    ["source map", "/apps/wall/app.js.map"],
    ["dotfile", "/apps/wall/.env"],
    ["symlink file escaping dir", "/apps/wall/evil.js"],
    ["file through a symlinked dir", "/apps/wall/linkdir/outside.js"],
    ["dot-dot", "/apps/wall/../../etc/passwd"],
    ["encoded dot-dot", "/apps/wall/%2e%2e/%2e%2e/etc/passwd"],
    ["encoded slash dot-dot", "/apps/wall/..%2f..%2fpkg/dist/config.json"],
    ["backslash", "/apps/wall/..%5cconfig.json"],
    ["NUL byte", "/apps/wall/a%00.js"],
    ["directory", "/apps/wall/assets"],
    ["missing asset", "/apps/wall/assets/missing.js"],
    ["raw .gz request", "/apps/wall/assets/app.3f9a.js.gz"],
  ])("refuses %s with 404 and no body leak", async (_name, url) => {
    const f = await boot({ dir });
    const res = await f.inject({ method: "GET", url });
    expect(res.statusCode, url).toBe(404);
    expect(res.body).not.toContain("stolen");
    expect(res.body).not.toContain("SECRET");
    expect(res.body).not.toContain("shell");
  });

  it("serves the shell for a deep link, no-store", async () => {
    const f = await boot({ dir });
    const res = await f.inject({ method: "GET", url: "/apps/wall/m/abc" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe("<html>shell</html>");
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.headers["content-security-policy"]).toBe("default-src 'self'");
  });

  it("serves the shell at the trailing-slash root", async () => {
    const f = await boot({ dir });
    const res = await f.inject({ method: "GET", url: "/apps/wall/" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("308-redirects the bare mount to the trailing slash, keeping the query, for GET and HEAD", async () => {
    const f = await boot({ dir });
    for (const method of ["GET", "HEAD"] as const) {
      const res = await f.inject({ method, url: "/apps/wall?x=1" });
      expect(res.statusCode, method).toBe(308);
      expect(res.headers.location).toBe("/apps/wall/?x=1");
    }
  });

  it("answers HEAD with headers and no body", async () => {
    const f = await boot({ dir });
    const res = await f.inject({ method: "HEAD", url: "/apps/wall/assets/app.3f9a.js" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-length"]).toBe(String("console.log(1)".length));
    expect(res.body).toBe("");
  });

  it("does not answer unsafe methods", async () => {
    const f = await boot({ dir });
    const res = await f.inject({ method: "POST", url: "/apps/wall/assets/app.3f9a.js" });
    expect(res.statusCode).toBe(404);
  });

  it("falls back to 503 when index.html is absent for a deep link", async () => {
    fs.rmSync(path.join(dir, "index.html"));
    const f = await boot({ dir });
    const res = await f.inject({ method: "GET", url: "/apps/wall/m/abc" });
    expect(res.statusCode).toBe(503);
  });
});

describe("serveApp mount — registration guards (E13)", () => {
  it("throws for a dir outside package root and data dir; nothing mounted", () => {
    const f = Fastify({ logger: false });
    for (const dir of ["/", path.join(os.homedir(), ".ssh"), path.join(tmp, "elsewhere")]) {
      expect(() => mountApp(env(f), { dir, csp: "default-src 'none'" }), dir).toThrow(/inside the plugin package/);
    }
    expect(registry.list()).toEqual([]);
  });

  it("accepts a dir under the package root and under the data dir", () => {
    const f = Fastify({ logger: false });
    mountApp(env(f), { dir: path.join(pkgRoot, "dist"), csp: "default-src 'none'", appId: "a" });
    mountApp(env(f), { dir: path.join(dataDir, "x-web", "current"), csp: "default-src 'none'", appId: "b" });
    expect(registry.list().map((m) => m.appId)).toEqual(["a", "b"]);
  });

  it("refuses a dir whose realpath escapes via a symlink at registration", () => {
    const f = Fastify({ logger: false });
    fs.symlinkSync(os.tmpdir(), path.join(pkgRoot, "sneaky"));
    expect(() => mountApp(env(f), { dir: path.join(pkgRoot, "sneaky"), csp: "x" })).toThrow(/inside the plugin package/);
  });

  it("throws on a second mount of the same appId", () => {
    const f = Fastify({ logger: false });
    mountApp(env(f), { dir: path.join(pkgRoot, "dist"), csp: "default-src 'none'" });
    expect(() => mountApp(env(f), { dir: path.join(pkgRoot, "dist"), csp: "default-src 'none'" })).toThrow(/already mounted/);
  });

  it.each(["Wall", "a/b", "a b", "", "wall_1", ".."])("rejects invalid appId %j", (appId) => {
    const f = Fastify({ logger: false });
    expect(() => mountApp(env(f, { pluginId: "ok" }), { dir: pkgRoot, csp: "x", appId })).toThrow(/appId/);
  });

  it("defaults appId to the plugin id", () => {
    const f = Fastify({ logger: false });
    mountApp(env(f, { pluginId: "voice-wall" }), { dir: pkgRoot, csp: "x" });
    expect(registry.has("voice-wall")).toBe(true);
    expect(registry.isMountPath("/apps/voice-wall/x?y=1")).toBe(true);
    expect(registry.isMountPath("/apps/voice-wall2/")).toBe(false);
    expect(registry.coversRoute("/apps/voice-wall/*")).toBe(true);
    expect(registry.coversRoute("/apps/rogue/*")).toBe(false);
  });

  it("requires csp", () => {
    const f = Fastify({ logger: false });
    for (const csp of [undefined, "", "  ", 3] as unknown[]) {
      expect(() => mountApp(env(f), { dir: pkgRoot, csp: csp as string }), String(csp)).toThrow(/csp is required/);
    }
  });
});

describe("serveApp mount — data-dir build appears after provisioning (3.3a)", () => {
  it("503 before, the build after, with no re-registration; a `current` symlink swap takes effect", async () => {
    const current = path.join(dataDir, "craft-wordcraft-web", "current");
    const f = await boot({ dir: current, appId: "craft-wordcraft" });
    let res = await f.inject({ method: "GET", url: "/apps/craft-wordcraft/index.html" });
    expect(res.statusCode).toBe(503);
    expect(res.headers["cache-control"]).toBe("no-store");

    const v1 = path.join(dataDir, "craft-wordcraft-web", "v1");
    write(path.join(v1, "index.html"), "v1");
    fs.symlinkSync(v1, current);
    res = await f.inject({ method: "GET", url: "/apps/craft-wordcraft/" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe("v1");

    const v2 = path.join(dataDir, "craft-wordcraft-web", "v2");
    write(path.join(v2, "index.html"), "v2");
    fs.rmSync(current);
    fs.symlinkSync(v2, current);
    res = await f.inject({ method: "GET", url: "/apps/craft-wordcraft/" });
    expect(res.body).toBe("v2");
  });

  it("logs the missing build once", async () => {
    const f = await boot({ dir: path.join(dataDir, "nope") });
    for (let i = 0; i < 3; i++) await f.inject({ method: "GET", url: "/apps/wall/" });
    expect(logger.warn.mock.calls.filter((c) => String(c[0]).includes("build missing"))).toHaveLength(1);
  });

  it("refuses (404, not 503) once `current` is swapped to a target outside the allowed roots", async () => {
    const current = path.join(dataDir, "w", "current");
    const f = await boot({ dir: current });
    const outside = path.join(tmp, "outside-build");
    write(path.join(outside, "index.html"), "evil");
    fs.mkdirSync(path.dirname(current), { recursive: true });
    fs.symlinkSync(outside, current);
    const res = await f.inject({ method: "GET", url: "/apps/wall/" });
    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain("evil");
  });
});

describe("serveApp mount — wasm and precompressed variants (3.3b)", () => {
  let dir: string;
  beforeEach(() => {
    dir = path.join(dataDir, "w", "current");
    write(path.join(dir, "index.html"), "x");
    write(path.join(dir, "app-1a2b3c4d5e6f7a8b_bg.wasm"), Buffer.alloc(4096, 1));
    write(path.join(dir, "app-1a2b3c4d5e6f7a8b_bg.wasm.gz"), Buffer.from("GZ-BYTES"));
    write(path.join(dir, "big.js"), "x".repeat(5000));
  });

  it("serves the .gz sibling to a gzip client with application/wasm, Content-Encoding and Vary", async () => {
    const f = await boot({ dir }, true);
    const res = await f.inject({ method: "GET", url: "/apps/wall/app-1a2b3c4d5e6f7a8b_bg.wasm", headers: { "accept-encoding": "gzip, deflate" } });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("application/wasm");
    expect(res.headers["content-encoding"]).toBe("gzip");
    expect(res.headers.vary).toContain("Accept-Encoding");
    expect(res.headers["content-length"]).toBe("8");
    expect(res.rawPayload.toString()).toBe("GZ-BYTES");
    expect(res.headers["cache-control"]).toContain("immutable");
  });

  it("serves the plain file (still Vary) to a client that does not accept gzip", async () => {
    const f = await boot({ dir }, true);
    const res = await f.inject({ method: "GET", url: "/apps/wall/app-1a2b3c4d5e6f7a8b_bg.wasm", headers: { "accept-encoding": "identity" } });
    expect(res.headers["content-encoding"]).toBeUndefined();
    expect(res.headers.vary).toContain("Accept-Encoding");
    expect(res.rawPayload.length).toBe(4096);
  });

  it("treats gzip;q=0 as not accepted", async () => {
    const f = await boot({ dir }, true);
    const res = await f.inject({ method: "GET", url: "/apps/wall/app-1a2b3c4d5e6f7a8b_bg.wasm", headers: { "accept-encoding": "gzip;q=0" } });
    expect(res.headers["content-encoding"]).toBeUndefined();
  });

  it("bypasses the global compressor: no on-the-fly encoding, stable Content-Length", async () => {
    const f = await boot({ dir }, true);
    const res = await f.inject({ method: "GET", url: "/apps/wall/big.js", headers: { "accept-encoding": "gzip" } });
    expect(res.headers["content-encoding"]).toBeUndefined();
    expect(res.headers["content-length"]).toBe("5000");
  });

  it("a .gz sibling that is a symlink out of the dir is ignored", async () => {
    fs.rmSync(path.join(dir, "app-1a2b3c4d5e6f7a8b_bg.wasm.gz"));
    write(path.join(tmp, "evil.gz"), "EVIL");
    fs.symlinkSync(path.join(tmp, "evil.gz"), path.join(dir, "app-1a2b3c4d5e6f7a8b_bg.wasm.gz"));
    const f = await boot({ dir });
    const res = await f.inject({ method: "GET", url: "/apps/wall/app-1a2b3c4d5e6f7a8b_bg.wasm", headers: { "accept-encoding": "gzip" } });
    expect(res.headers["content-encoding"]).toBeUndefined();
    expect(res.rawPayload.length).toBe(4096);
  });
});

describe("serveApp mount — csp as a function (3.3d)", () => {
  let dir: string;
  beforeEach(() => {
    dir = path.join(pkgRoot, "dist");
    write(path.join(dir, "index.html"), "x");
  });

  it("evaluates per request: different forwarded hosts → different policies", async () => {
    const f = await boot({
      dir,
      csp: (req) => `script-src https://${String(req.headers["x-forwarded-host"])}/apps/wall/`,
    });
    const a = await f.inject({ method: "GET", url: "/apps/wall/", headers: { "x-forwarded-host": "a.example" } });
    const b = await f.inject({ method: "GET", url: "/apps/wall/", headers: { "x-forwarded-host": "b.example" } });
    expect(a.headers["content-security-policy"]).toBe("script-src https://a.example/apps/wall/");
    expect(b.headers["content-security-policy"]).toBe("script-src https://b.example/apps/wall/");
  });

  it("a throwing csp function → 500 for that response, logged once", async () => {
    const f = await boot({
      dir,
      csp: () => {
        throw new Error("boom");
      },
    });
    for (let i = 0; i < 3; i++) {
      const res = await f.inject({ method: "GET", url: "/apps/wall/" });
      expect(res.statusCode).toBe(500);
      expect(res.headers["content-security-policy"]).toBeUndefined();
    }
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it("a csp function returning a non-string or header-injecting value → 500", async () => {
    for (const bad of ["", "a\r\nSet-Cookie: x=1", 5 as unknown as string]) {
      const f2 = Fastify({ logger: false });
      const reg = new AppMountRegistry();
      mountApp(env(f2, { registry: reg }), { dir, csp: () => bad });
      await f2.ready();
      const res = await f2.inject({ method: "GET", url: "/apps/wall/" });
      expect(res.statusCode, JSON.stringify(bad)).toBe(500);
      expect(res.headers["set-cookie"]).toBeUndefined();
      await f2.close();
    }
  });
});

describe("serveApp mount — cross-origin frame (3.3c)", () => {
  let dir: string;
  beforeEach(() => {
    dir = path.join(pkgRoot, "dist");
    write(path.join(dir, "index.html"), "x");
    write(path.join(dir, "app.3f9a.js"), "1");
  });

  it("adds ACAO * and CORP cross-origin, never credentials, on file responses", async () => {
    const f = Fastify({ logger: false });
    // A host CORS layer that would otherwise reflect/credential the origin: the mount overrides it.
    f.addHook("onRequest", async (_req, reply) => {
      reply.header("Access-Control-Allow-Origin", "https://dash.example");
      reply.header("Access-Control-Allow-Credentials", "true");
    });
    mountApp(env(f), { dir, csp: "default-src 'none'", crossOriginFrame: true });
    f.get("/api/thing", async () => ({ ok: true }));
    await f.ready();
    app = f;
    for (const url of ["/apps/wall/app.3f9a.js", "/apps/wall/", "/apps/wall/deep/link"]) {
      const res = await f.inject({ method: "GET", url, headers: { origin: "null" } });
      expect(res.headers["access-control-allow-origin"], url).toBe("*");
      expect(res.headers["cross-origin-resource-policy"], url).toBe("cross-origin");
      expect(res.headers["access-control-allow-credentials"], url).toBeUndefined();
    }
    // Other routes keep whatever CORS the host gave them: the mount grants nothing there.
    const api = await f.inject({ method: "GET", url: "/api/thing", headers: { origin: "null" } });
    expect(api.headers["access-control-allow-origin"]).toBe("https://dash.example");
    expect(api.headers["cross-origin-resource-policy"]).toBeUndefined();
  });

  it("without the option no cross-origin headers are added", async () => {
    const f = await boot({ dir });
    const res = await f.inject({ method: "GET", url: "/apps/wall/app.3f9a.js", headers: { origin: "null" } });
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    expect(res.headers["cross-origin-resource-policy"]).toBeUndefined();
  });

  it("404s carry no cross-origin grant", async () => {
    const f = await boot({ dir, crossOriginFrame: true });
    const res = await f.inject({ method: "GET", url: "/apps/wall/app.map" });
    expect(res.statusCode).toBe(404);
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });
});

describe("serveApp mount — extraTypes (extend-craft-web-to-all-apps)", () => {
  let dir: string;
  beforeEach(() => {
    dir = path.join(dataDir, "web");
    write(path.join(dir, "index.html"), "<html>shell</html>");
    write(path.join(dir, "app", "parts.txt"), "photocraft-web-1a2b.part-aa\n");
    write(path.join(dir, "app", "photocraft-web-1a2b.part-aa"), Buffer.alloc(32, 7));
    write(path.join(dir, "notes.json"), "{}");
  });

  it("without extraTypes the split-wasm part list and parts are 404 (built-in allowlist only)", async () => {
    const f = await boot({ dir });
    expect((await f.inject({ url: "/apps/wall/app/parts.txt" })).statusCode).toBe(404);
    expect((await f.inject({ url: "/apps/wall/app/photocraft-web-1a2b.part-aa" })).statusCode).toBe(404);
  });

  it("serves declared extensions with their inert type, still under the CSP; other unknown extensions stay 404", async () => {
    const f = await boot({ dir, crossOriginFrame: true, extraTypes: { ".txt": "text/plain; charset=utf-8", ".part-aa": "application/octet-stream" } });
    const txt = await f.inject({ url: "/apps/wall/app/parts.txt" });
    expect(txt.statusCode).toBe(200);
    expect(txt.headers["content-type"]).toBe("text/plain; charset=utf-8");
    expect(txt.headers["content-security-policy"]).toBe("default-src 'self'");
    expect(txt.headers["x-content-type-options"]).toBe("nosniff");
    expect(txt.headers["access-control-allow-origin"]).toBe("*");
    const part = await f.inject({ url: "/apps/wall/app/photocraft-web-1a2b.part-aa" });
    expect(part.statusCode).toBe(200);
    expect(part.headers["content-type"]).toBe("application/octet-stream");
    expect((await f.inject({ url: "/apps/wall/notes.json" })).statusCode).toBe(404);
  });

  it.each([
    [{ ".txt": "text/html; charset=utf-8" }, /not an inert data type/],
    [{ ".js": "text/plain; charset=utf-8" }, /not a new lower-case extension/],
    [{ txt: "text/plain; charset=utf-8" }, /not a new lower-case extension/],
    [{ ".TXT": "text/plain; charset=utf-8" }, /not a new lower-case extension/],
  ])("refuses %j (nothing mounted)", (extraTypes, err) => {
    const f = Fastify({ logger: false });
    expect(() => mountApp(env(f), { dir, csp: "default-src 'self'", extraTypes })).toThrow(err);
    expect(registry.has("wall")).toBe(false);
    void f.close();
  });
});
