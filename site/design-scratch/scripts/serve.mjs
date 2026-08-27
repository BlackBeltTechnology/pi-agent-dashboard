#!/usr/bin/env node
/**
 * Static file server for the mockup. Zero dependencies on purpose: the mockup
 * has to be servable from a clean checkout without an install step.
 *
 *   node scripts/serve.mjs [--port 8791] [--root <dir>]
 *
 * Why a server at all rather than opening index.html over file:// --
 * field.js is an ES module and the vendored three.js build is imported by URL,
 * and module imports are blocked under the file: scheme by CORS.
 *
 * 8791 is the default because that is the port the screenshot script and the
 * playbook assume; change it in one place and both follow.
 */
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : argv[i + 1];
};

// Default root is site/ -- the mockup was promoted to BE the site, so the
// page under test and the deployed page are the same file.
const ROOT = resolve(arg("root", join(fileURLToPath(new URL(".", import.meta.url)), "..", "..")));
const PORT = Number(arg("port", 8791));

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
};

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    // normalize() first, then confirm the result is still inside ROOT: a path
    // like /../../.ssh/id_rsa is otherwise a working file read.
    const rel = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, "");
    let file = join(ROOT, rel);
    if (!file.startsWith(ROOT)) return res.writeHead(403).end("forbidden");

    const info = await stat(file).catch(() => null);
    if (info?.isDirectory()) file = join(file, "index.html");

    const body = await readFile(file);
    res.writeHead(200, {
      "content-type": TYPES[extname(file)] ?? "application/octet-stream",
      "cache-control": "no-store", // always re-read: this is an edit-refresh loop
    });
    res.end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
}).listen(PORT, () => {
  console.log(`mockup: http://localhost:${PORT}/index.html`);
  console.log(`lab:    http://localhost:${PORT}/design-scratch/field-lab.html`);
});
