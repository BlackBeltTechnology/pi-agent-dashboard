#!/usr/bin/env node
// CORS-enabled static server for a render root (§8.3 canvas display).
//
// The dashboard opens the canvas in a `sandbox="allow-scripts"` iframe with NO
// `allow-same-origin` (opaque origin), proxied under `/live/<id>/`. In that
// sandbox the viewer's runtime `fetch('package-data.json')` (and any module
// script) goes out with `Origin: null`, so the static server MUST answer with
// `Access-Control-Allow-Origin: *` or the browser rejects it as "Failed to
// fetch" and the canvas shows a blank diagram. `serve_mockup` does NOT set that
// header, so serve canvas render roots with THIS instead.
//
//   node scripts/serve.mjs <renderRoot> [port]
//   → binds 127.0.0.1:<port> (ephemeral if omitted) and prints the URL
//
// Symlinks are followed (the asset root + source artifacts are symlinked into
// the render root, mirroring serve_mockup); URL paths are lexically confined so
// a `../` in the request cannot escape the render root.

import http from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { join, normalize, extname, resolve } from 'node:path';

const [rootArg, portArg] = process.argv.slice(2);
if (!rootArg) {
  console.error('usage: node scripts/serve.mjs <renderRoot> [port]');
  process.exit(1);
}
const ROOT = resolve(rootArg);
const PORT = portArg ? Number(portArg) : 0;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.bpmn': 'application/xml; charset=utf-8',
  '.dmn': 'application/xml; charset=utf-8',
  '.form': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.eot': 'application/vnd.ms-fontobject',
};

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }
  // Lexically confine the request path: strip the query, decode, normalize, and
  // drop any leading `../` so traversal above the render root is impossible.
  let rel = decodeURIComponent((req.url || '/').split('?')[0]);
  if (rel === '/' || rel === '') rel = '/index.html';
  rel = normalize(rel).replace(/^(\.\.[/\\])+/, '').replace(/^[/\\]+/, '');
  const full = join(ROOT, rel);
  if (full !== ROOT && !full.startsWith(ROOT + '/')) {
    res.writeHead(403);
    return res.end('forbidden');
  }
  let st;
  try {
    st = statSync(full); // follows symlinks (asset root + artifacts are links)
  } catch {
    res.writeHead(404);
    return res.end('not found');
  }
  if (!st.isFile()) {
    res.writeHead(404);
    return res.end('not found');
  }
  res.setHeader('Content-Type', TYPES[extname(full).toLowerCase()] || 'application/octet-stream');
  if (req.method === 'HEAD') {
    res.writeHead(200);
    return res.end();
  }
  createReadStream(full).on('error', () => {
    res.writeHead(500);
    res.end('read error');
  }).pipe(res);
});

server.listen(PORT, '127.0.0.1', () => {
  const port = server.address().port;
  console.log(`http://127.0.0.1:${port}/`);
  console.error(`[serve] CORS static server for ${ROOT} on 127.0.0.1:${port}`);
});
