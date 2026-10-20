/**
 * `injectImportMap` / `createIndexHtmlSender`: one importmap before the first module script,
 * deterministic bytes, optional nonce, mtime-cached plain read (never the `.gz`).
 * See change: decouple-plugins-from-core (tasks 6.4; test-plan #E74, #E94).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  HOST_IMPORT_MAP_IMPORTS,
  HOST_IMPORT_MAP_SPECIFIERS,
} from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/host-import-map.js";
import Fastify from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { createIndexHtmlSender, injectImportMap } from "../index-html.js";

const HTML = `<!doctype html><html><head><meta charset="utf-8"><link rel="modulepreload" href="/assets/vendor.js"><script type="module" crossorigin src="/assets/index.js"></script></head><body><div id="root"></div></body></html>`;

describe("injectImportMap", () => {
  it("inserts exactly one importmap before the first module script / modulepreload", () => {
    const out = injectImportMap(HTML);
    expect(out.match(/<script type="importmap"/g)).toHaveLength(1);
    expect(out.indexOf('type="importmap"')).toBeLessThan(out.indexOf('type="module"'));
    expect(out.indexOf('type="importmap"')).toBeLessThan(out.indexOf("modulepreload"));
  });

  it("maps every shared specifier to a /host/*.js shim, JSON-parseable", () => {
    const body = /<script type="importmap">(.*?)<\/script>/s.exec(injectImportMap(HTML))?.[1] ?? "";
    const parsed = JSON.parse(body) as { imports: Record<string, string> };
    expect(Object.keys(parsed.imports)).toEqual([...HOST_IMPORT_MAP_SPECIFIERS]);
    for (const url of Object.values(parsed.imports)) expect(url).toMatch(/^\/host\/[a-z-]+\.js$/);
    expect(parsed.imports).toEqual({ ...HOST_IMPORT_MAP_IMPORTS });
  });

  it("is byte-identical across calls (E74)", () => {
    expect(injectImportMap(HTML)).toBe(injectImportMap(HTML));
  });

  it("sets a nonce attribute only when given (E94), sanitised", () => {
    expect(injectImportMap(HTML)).not.toContain("nonce");
    expect(injectImportMap(HTML, { nonce: "n1" })).toContain('<script type="importmap" nonce="n1">');
    expect(injectImportMap(HTML, { nonce: 'n1"><x' })).toContain('nonce="n1x"');
  });

  it("falls back to before </head>, then to the top, for HTML without a module script", () => {
    expect(injectImportMap("<html><head></head><body></body></html>")).toMatch(/importmap.*<\/head>/s);
    expect(injectImportMap("<p>x</p>").startsWith('<script type="importmap">')).toBe(true);
  });
});

describe("createIndexHtmlSender", () => {
  let dir: string;
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  async function get(sendDir: string, headers: Record<string, string> = {}) {
    const app = Fastify();
    const sender = createIndexHtmlSender(sendDir);
    app.get("/", (_req, reply) => sender.sendIndexWithImportMap(reply));
    const res = await app.inject({ method: "GET", url: "/", headers });
    await app.close();
    return res;
  }

  it("serves the plain index.html (never the .gz) with no-cache headers", async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "index-html-"));
    fs.writeFileSync(path.join(dir, "index.html"), HTML);
    fs.writeFileSync(path.join(dir, "index.html.gz"), "GZ-BODY-MARKER");
    const res = await get(dir, { "accept-encoding": "gzip" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-cache, no-store, must-revalidate");
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.body).toContain('type="importmap"');
    expect(res.body).not.toContain("GZ-BODY-MARKER");
  });

  it("re-reads when the file changes (mtime-cached otherwise)", async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "index-html-"));
    const file = path.join(dir, "index.html");
    fs.writeFileSync(file, HTML);
    const app = Fastify();
    const sender = createIndexHtmlSender(dir);
    app.get("/", (_req, reply) => sender.sendIndexWithImportMap(reply));
    expect((await app.inject("/")).body).toContain("root");
    fs.writeFileSync(file, HTML.replace("root", "changed-root"));
    const later = new Date(Date.now() + 5000);
    fs.utimesSync(file, later, later);
    expect((await app.inject("/")).body).toContain("changed-root");
    await app.close();
  });

  it("answers 404 when index.html is missing", async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "index-html-"));
    expect((await get(dir)).statusCode).toBe(404);
  });
});
