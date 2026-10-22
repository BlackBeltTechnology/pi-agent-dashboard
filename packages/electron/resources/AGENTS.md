# DOX — packages/electron/resources

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `dirname-shim.js` | ESM global shim loaded via `node --import`. Defines `globalThis.__dirname` (returns `process.cwd()`) + `globalThis.__filename` fallback for CJS deps (node-pty) loaded as ESM. |
| `loading.html` | Electron loading page (`loadFile` after `createMainWindow`). Polls `serverUrl`+`/api/health`, hands off to `serverUrl` on ok via `navigateToServer`, else retries → `showError()` after ~10 attempts (~15s) with Start-server / Open-Doctor / server-log + known-servers buttons. Remote attach (change: fix-remote-connect-cors-gates): for a **non-loopback** `serverUrl` with `piDashboard.probeServer`, reachability comes from the MAIN-process probe (Node fetch, no Origin, not CORS-bound) instead of a renderer `fetch` — a remote deliberately refuses this `file://` page's `Origin: null`, so a renderer fetch would hang. Loopback / older-preload fallback keeps the renderer fetch path. All three navigations (known-server click, reachable handoff, launch-outcome redirect) go through `window.piDashboard.navigateToServer`; no `location.href` for dashboard targets. See change: fix-pairing-approval-credential. Meta CSP `default-src 'none'; script-src/style-src 'unsafe-inline'; connect-src http: https:; require-trusted-types-for 'script'`; known-server buttons built with DOM APIs. See change: harden-client-sinks. |
