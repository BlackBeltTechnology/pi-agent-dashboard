// Tiny static file server that adds permissive CORS headers so the built
// ES-module bundle loads inside the dashboard's sandboxed opaque-origin iframe
// (sandbox="allow-scripts" with NO allow-same-origin → module fetch uses
// CORS with `Origin: null`, which requires Access-Control-Allow-Origin).
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const ROOT = new URL("./canvas-dist/", import.meta.url).pathname;
const PORT = Number(process.argv[2] ?? 5181);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  try {
    let path = decodeURIComponent((req.url ?? "/").split("?")[0]);
    if (path === "/" || path.endsWith("/")) path += "index.html";
    // Prevent path traversal.
    const full = normalize(join(ROOT, path));
    if (!full.startsWith(ROOT)) {
      res.statusCode = 403;
      return res.end("forbidden");
    }
    const s = await stat(full).catch(() => null);
    if (!s || !s.isFile()) {
      res.statusCode = 404;
      return res.end("not found");
    }
    const body = await readFile(full);
    res.setHeader("Content-Type", MIME[extname(full)] ?? "application/octet-stream");
    res.end(body);
  } catch (e) {
    res.statusCode = 500;
    res.end(String(e));
  }
}).listen(PORT, "127.0.0.1", () => {
  process.stdout.write(`CORS static server for canvas-dist on http://127.0.0.1:${PORT}/\n`);
});
