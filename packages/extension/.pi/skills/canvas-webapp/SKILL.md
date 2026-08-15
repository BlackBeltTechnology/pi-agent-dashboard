---
name: canvas-webapp
description: >-
  Render a React/Vite (or any bundled) web app on the pi-dashboard canvas, which
  loads loopback URLs in a sandboxed opaque-origin iframe. Use when a
  canvas(target:{kind:"url"|"server"}) target shows up blank white, an empty
  surface, or a /live/<id> 500 ECONNREFUSED. Covers why Vite dev servers and
  non-CORS static servers fail there, and the static-build + CORS-server recipe
  that works.
license: MIT
---

# canvas-webapp — show a web app on the dashboard canvas

The dashboard opens a loopback `canvas(kind:"url")` target inside a
`sandbox="allow-scripts"` iframe with **no `allow-same-origin`** (opaque origin),
proxied under `/live/<id>/` (`LiveServerViewer.tsx` → `live-server-proxy`). That
sandbox breaks two common serving strategies; this skill is the fix.

## When to Use

Use when you must display a running web app / React / Vite / MUI mockup on the
pi-dashboard canvas via `canvas(target:{kind:"url"|"server"})` and it shows up
blank white, an empty surface, or a `/live/<id>` 500 ECONNREFUSED.

## Procedure

1. **Do NOT point the canvas at a Vite DEV server.** The dashboard proxies
   loopback targets under `/live/<id>/`, but Vite dev emits ABSOLUTE asset paths
   (`/main.tsx`, `/@vite/client`, and runtime fetches like `/__schema.json`) that
   resolve against the dashboard root, not the proxy prefix → 404 → blank page.
2. **Produce a STATIC production build with a RELATIVE base:** a vite config with
   `base:'./'`, a dedicated `index.html` entry, and the runtime data
   (schema/props) IMPORTED statically (no fetch of an absolute path). Run
   `npx vite build --config <config>`.
3. **Verify** the built `index.html` references `./assets/...` (relative). Copy
   the entry html to `index.html` so the proxy root (`/live/<id>/`) serves it.
4. **Serve the dist with a tiny node static server that sets
   `Access-Control-Allow-Origin: *`** (and `Cross-Origin-Resource-Policy:
   cross-origin`) on every response. This is REQUIRED: the opaque-origin iframe
   fetches `<script type=module>` in CORS mode with `Origin: null`, so without
   ACAO:* the module is blocked → blank white even though the build is correct. A
   plain `python3 -m http.server` does NOT set CORS and renders blank.
5. **Point the canvas:** `canvas(target:{kind:'url',
   url:'http://127.0.0.1:<port>/'}, mode:'replace')`. Loopback is required (SSRF
   gate); `127.0.0.1` is safest.
6. **Self-verify** by iframing your own harness before touching the canvas:
   serve an HTML with `<iframe sandbox="allow-scripts allow-forms allow-popups"
   src="http://127.0.0.1:<port>/">` on another port, open it in the browser tool,
   and screenshot — this reproduces the exact dashboard sandbox.

## Minimal CORS static server

```js
// canvas-serve.mjs  —  node canvas-serve.mjs <port>   (serves ./canvas-dist/)
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
const ROOT = new URL("./canvas-dist/", import.meta.url).pathname;
const PORT = Number(process.argv[2] ?? 5181);
const MIME = { ".html":"text/html;charset=utf-8", ".js":"text/javascript;charset=utf-8",
  ".css":"text/css;charset=utf-8", ".json":"application/json", ".woff":"font/woff",
  ".woff2":"font/woff2", ".svg":"image/svg+xml", ".png":"image/png", ".ico":"image/x-icon" };
createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  let p = decodeURIComponent((req.url ?? "/").split("?")[0]);
  if (p.endsWith("/")) p += "index.html";
  const full = normalize(join(ROOT, p));
  if (!full.startsWith(ROOT)) { res.statusCode = 403; return res.end("forbidden"); }
  const s = await stat(full).catch(() => null);
  if (!s?.isFile()) { res.statusCode = 404; return res.end("not found"); }
  res.setHeader("Content-Type", MIME[extname(full)] ?? "application/octet-stream");
  res.end(await readFile(full));
}).listen(PORT, "127.0.0.1", () => console.log(`CORS static on http://127.0.0.1:${PORT}/`));
```

## Pitfalls

- bash `kill %1` job control does NOT carry across separate Bash tool calls — a
  dev server started in one call cannot be killed by `%1` in another. Kill stale
  servers by PID: `lsof -tiTCP:<port> -sTCP:LISTEN | xargs kill -9`.
- Vite dev may bind IPv6 `[::1]:<port>` only, while the dashboard proxy dials
  IPv4 `127.0.0.1:<port>` → the `/live/<id>` route returns 500
  `FST_REPLY_FROM_INTERNAL_SERVER_ERROR 'connect ECONNREFUSED 127.0.0.1:<port>'`.
  Another reason to avoid dev servers and bind static servers explicitly to
  `127.0.0.1`.
- `canvas(target:{kind:'server', port})` produces a tap-to-open CHIP on desktop,
  not an auto-opened view; `kind:'url'` with a loopback URL auto-opens via
  `openLiveTarget`. Prefer `kind:'url'`.
- The build succeeds and renders fine in a NORMAL browser tab yet is blank in the
  dashboard — that difference is the sandbox/CORS issue, not a build bug. Don't
  chase the build.
- Non-loopback/remote URLs are refused by the dashboard SSRF gate
  (`validateLiveTarget`).

## Verification

1. The static server responds 200 with header `Access-Control-Allow-Origin: *`
   (`curl -D - -o /dev/null`).
2. An `<iframe sandbox="allow-scripts">` pointed at the server renders the app
   (browser-tool screenshot), matching the dashboard's opaque-origin sandbox.
3. After `canvas(kind:'url')`, the user confirms the app is visible on the canvas
   (not blank, no 500).
