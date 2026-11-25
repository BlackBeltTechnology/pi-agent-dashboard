# Live-preview L3 suite (host-run isolated server)

Browser-level checks for change `serve-live-previews-on-capability-origin`.
Config: `playwright.live-preview.config.ts` · run: `npm run test:e2e:live-preview`
(`-- --project chromium|firefox|chromium-resolver`, `-g "F28"`).

**Not the docker harness.** `global-setup.ts` starts `packages/server/src/cli.ts` on the host with
`HOME=/tmp/pi-lp-*`, a free non-8000 port, `liveServer.previewOrigins` tiers 1/2/3/5 and
`allowedHosts: [dash.test, dash5.test]`. The browser is a real loopback peer, so tier 1 applies. The
live :8000 server and `~/.pi` are never touched. Teardown kills it and deletes the HOME.

Prereqs: `npm run build` (needs `packages/client/dist`), Node >= 26 for the server (auto-found under
`~/.nvm/versions/node/v26*`, or `PI_LP_NODE=/path/to/node`), `npx playwright install chromium firefox`.

## Projects

| Project | Dashboard reached as | Runs |
|---|---|---|
| `chromium` | `http://localhost:<port>` | every `*.spec.ts` except `*.resolver.spec.ts` |
| `firefox` | `http://localhost:<port>` | same as chromium |
| `chromium-resolver` | `http://dash.test:<port>` (`--host-resolver-rules` maps `*.preview.test`, `dash.test`, `dash5.test` → 127.0.0.1) | only `*.resolver.spec.ts` (tier 2 via dash.test, tier 5 via dash5.test) |

## Fixtures (`fixture.ts`, import `test`/`expect` from it)

- `isolatedServer` (worker): `.port .url .origin(host) .home`, `.restart({patch, reset})` (config rewrite + restart, same port), `.config()`, `.logMark() .logSince(mark, re) .livePreviewLog(mark)` (grep `[live-preview]` lines), `.api(method, path, body)` (signed as local operator), `.rawRequest({host, path, headers})` (arbitrary `Host`, e.g. a label host the OS cannot resolve).
- `upstream` (per test): controllable dev server on 127.0.0.1; `.url`, `.script` (inline JS run by `/`; set BEFORE opening the viewer), `.route(path, body|handler)`, `.requests`; has `/@vite/client`, `/hmr`, WS echo.
- `operator`: `.authenticate(ctx, origin)` (local-proof cookie, no login), `.fakeSession()` (bridge session over the gateway socket), `.gotoDashboard(page, origin)`, `.openLivePreview(page, {dashOrigin, target, session?})`.
- `livePreview.open(page, {dashHost?, target?, session?})` → `LiveViewer` (`.iframe .frameLocator .src() .srcOrigin() .sandbox() .frame() .ready(sel) .reopen()`): opens `upstream` through the REAL viewer UI (session card → split → `+` → Live preview → URL → confirm).
- options/derived: `dashHost` (project option), `dashOrigin`, `baseURL`.

## Writing a spec

Title with the row id (`T.F28 / #F28 ...`). Drive the preview page with `upstream.script`
(write outcomes to `window.__result`); to run a payload after your listeners are armed, have the
script wait for `postMessage("go")` (see `tier1-isolation.spec.ts`). Tier-2/5 specs go in
`*.resolver.spec.ts`. Change config with `isolatedServer.restart({patch})` and restore with
`restart({reset:true})` in a `finally`.

## Known engine notes

- Chromium collapses `Domain=localhost` into a host-only cookie, so a real duplicate `pi_dash_*`
  cookie at `/` needs host `dash.test` (host-only + `Domain=.dash.test`): see `host-gate-refusal.resolver.spec.ts`.
- Firefox drops a trailing-dot source (`http://localhost.:<p>`) from CSP `frame-ancestors`, so F5 is Chromium-only.
