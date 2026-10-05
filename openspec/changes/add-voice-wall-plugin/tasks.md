> Land after `extract-standalone-app-kit`, `add-plugin-app-host` and `add-plugin-capability-routes`. Consumer: `add-voice-assistant-dashboard-plugin`.

## 1. Scaffold and registrations

- [ ] 1.1 Run `dashboard-plugin-scaffold` (`new` mode), then hand-add what it does not template (claims, `exports["./emit"]`, `src/app/`): id `voice-wall`, display name "Voice wall", server entry yes, client entry yes, bridge no, `defaultEnabled: false`. Claims: `sidebar-folder-section`; `shell-overlay-route` `/folder/:encodedCwd/wall` (depth 2, parent `/folder/:encodedCwd`, `presentation: "content"`) and `/wall/:meetingId` (depth 1, `presentation: "content"`). `configSchema.json`: `shareLinks.enabled` (default `true`).
- [ ] 1.2 Apply `add-new-plugin-package-checklist`; `pnpm install`. Explicitly:
  - add the directory name `voice-wall-plugin` to `packages/server/package.json#piDashboard.bundledPlugins` (Electron bundle and capability-route trust; the list and the trust check key on directory names);
  - add `@source` lines for `voice-wall-plugin/src/client` and `src/app` to `packages/client/src/index.css`;
  - add `ROUTE_TIERS` and MCP denylist rows for every `/api/plugins/voice-wall/*` route (the completeness tests boot with the plugin disabled, so add them deliberately).
- [ ] 1.3 Build wiring: Vite library entry `src/app/index.ts` (`defineDashboardApp`), imported lazily by the client entry. A standalone Vite config builds `src/app/standalone.html` to `dist/app/index.html` (the `serveApp` fallback name), with relative base and no inline script or style. Its own Tailwind entry `src/app/app.css` uses `@source` over `src/app`. It runs as part of root `npm run build`. `dist/app/` is copied at pack time. Add the package to the Electron bundle-freshness inputs.
- [ ] 1.4 `NOTICE` + README: upstream `tatargabor/set-copilot` (MIT), the SHA copied, the vendored file list, what is deliberately not vendored or not used (page, `runWall`, fake feed, `jsonlTailSource`, `serveMedia`, `categoriesModule`), and bundled cytoscape/dagre licences.

## 2. Vendor

- [ ] 2.1 Copy from the pinned SHA into `src/vendor/set-copilot/`: `wall/{server,emit,input,redaction,routing,channels,director,categories,layout,event-source,types}.ts`, `config.ts`, and the rest of the import closure of `wall/server.ts` and `config.ts`. `tsc --noEmit` confirms nothing reaches `cli.ts`, `capture.ts`, `mirror-*` or `wall/index.ts`.
- [ ] 2.1a Write and apply `vendor/patches/proxy-secret.patch` (optional `proxySecret`; requests without `x-voice-wall-proxy` get 404 in `handle`). Record it in `NOTICE` (design D1).
- [ ] 2.2 Copy `wall/public/{wall-core,text-format}.mjs` with type declarations (`.d.mts`) written alongside, unedited.

## 3. Wall host (server)

- [ ] 3.1 `src/server/wall-host.ts`: single-flight `startWallHost`, `new WallServer({…, host: "127.0.0.1", port: 0, publicDir: <empty dir>, redaction, scrollHistory, proxySecret, transcriptPage.route: "/transcript" })`, `stopWallHost` (design D1).
- [ ] 3.2 `src/server/wall-config.ts`: `loadWallConfig` with the exact env snapshot and restore around `loadConfig`; afterwards `resolveWindows` and `buildRegistry(cfg.wall.categories ?? [])`; ignore `categoriesModule` with a warning and a status note (D2).
- [ ] 3.3 Throw-path audit of the vendored `wall/server.ts` paths still used (`handle`, SSE, bootstrap, transcript, timers): list each in `NOTICE` with how the host contains it (D1).
- [ ] 3.4 `src/server/tail-source.ts`: `incrementalTailSource` implementing upstream `EventSource` (async reads from the byte offset, `parseWireLine`, wait for a missing file, reset on shrink, 1 MiB partial-line cap) (D1). `ensureWall` resets `wall-input-offset`.
- [ ] 3.5 `src/server/registry.ts`: `Map<meetingId, WallEntry>` (`host`, `port`, `projectRoot`, `runtimeDir`, `owner`, `title`, `allowList`, `transcriptPolicy`, `share`, `streams`, `referencedMedia` per audience) plus a recently-ended list for `meetings/:id`.

## 4. Routes (server)

- [ ] 4.1 `classify(request, entry)` → `operator | typist | member | viewer` via `ctx.requestPrincipal`; proxied requests carry the proxy secret; window selection (requested public window → default public window → `no_public_window`) plus the post-selection audience assertion (D3).
- [ ] 4.2 Proxy `m/:id/{events,bootstrap,transcript}` and `s/{events,bootstrap,transcript}`: upstream URL built from the selected window only, forwarded-audience assertion, 10 s timeout for non-SSE, `Last-Event-ID`, SSE with backpressure, close propagation, `share-ended` frames, transcript policy (D3).
- [ ] 4.3 Plugin-served media `m/:id/media`, `s/media`: referenced set built from delivered public payloads (event images, graph-node images, resume and replay frames; 10 000-entry cap), upstream's three checks with async `fs`, `nosniff` and sandbox CSP headers (D3).
- [ ] 4.4 Share links: `POST`/`DELETE m/:id/share`, hashed store, expiry cap, expiry timer closes open streams, re-mint revokes, revocation closes streams. Register `ctx.registerCapabilityRoute({ prefix: "/api/plugins/voice-wall/s/", verify })` with a side-effect-free verifier on `X-Wall-Share` (D4). Honour `shareLinks.enabled`.
- [ ] 4.5 `PUT m/:id/policy` (owner: transcript policy, typists).
- [ ] 4.6 `POST m/:id/input`: operator or typist, `normalizeWallInput`, rate limit, label sanitising, upstream-shaped append (D5).
- [ ] 4.7 `GET meetings?cwd=` and `GET meetings/:id` (folder state, `cwd`, title, owner flag, `lastReplay`) (D8).
- [ ] 4.8 `GET replay?cwd=<encodedCwd>`: transient read-only host over `lastReplay.path`, 5-minute idle stop, operator only (D9).
- [ ] 4.9 `ctx.serveApp({ dir: dist/app, appId: "wall", csp })` with the D7 policy.

## 5. Service and teardown (server)

- [ ] 5.1 `ctx.provide("voice-wall", { version: 2, scratchRoot, ensureWall, stopWall, status, appendEvent })`: scratch-root confinement, `appendEvent` passes `projectRoot`, `stopWall` stop-then-copy `archiveTo` with validation and the `lastReplay` record (D9, D10).
- [ ] 5.2 `src/emit.ts` + `package.json` `exports["./emit"]` (pure `normalizeEvent`, `wallEventsFile`).
- [ ] 5.3 Teardown on `stopWall`, disable and `ctx.onShutdown`: revoke, `share-ended`, `WallServer.stop()`, evict (D11).

## 6. Wall app (`src/app/`)

- [ ] 6.1 App shell: relative route table (`m/`, `s/`, `replay/`, `present`); hash location standalone, host pathname router embedded. Fetch-streaming SSE with `Last-Event-ID` reconnect. Data only via `host.api`; viewer mode uses `createStandaloneHost({ anonymousHeaders: { "X-Wall-Share": token } })` (D4, D6). Media through that transport into `blob:` URLs (D3).
- [ ] 6.2 Views per mockups: Board (vendored `wall-core.mjs` layout, pending TTL, ✕ + reason, figures), Graph (bundled cytoscape + dagre), Transcript, input bar, presentation mode with F/←/→/A/Esc and join QR (`wall-app.html`, `input-states.html`, `presentation.html`).
- [ ] 6.3 Participant states per `join.html`.
- [ ] 6.4 Text via `parseWallText` → React; charts as React SVG; `webpage` → link card. Verify the standalone build passes the D7 CSP (no inline script; cytoscape's injected `<style>` works under `style-src 'unsafe-inline'`).
- [ ] 6.5 `standalone.tsx`: `createStandaloneHost()` + `<StandaloneBar>`. Verify `safeReturnTo` accepts `/apps/wall/` for *Sign in to type*; record the outcome (D7).
- [ ] 6.6 Embedded: `HeaderContext`, `setActions` (Present), `host.openSession` links hidden without `capabilities.dashboard`.

## 7. Dashboard client entry

- [ ] 7.1 `sidebar-folder-section`: state-only `● Live wall →`, only while a wall runs (D8).
- [ ] 7.2 `useFolderMenuItem` (group `open`): *Live wall*, *Open wall standalone*, *Share live wall…* (owner only).
- [ ] 7.3 Share dialog per `share-dialog.html`, updated for the reconciled design:
  - link + QR (`qrcode`), offered only for an admitted origin (live tunnel or LAN host);
  - viewer count, expiry, Revoke kept apart from Done;
  - meeting policy: transcript for members and for viewers (separate toggles, each noting "pattern-redacted, not zone-filtered"), typists;
  - single-user and plain-LAN variants; `no_public_window` refusal.

  Settle the principal-picker source (design open question).
- [ ] 7.4 Route components for both claims → `<EmbeddedApp>`; `/wall/:meetingId` resolves the folder and replaces the location with `/folder/<cwd>/wall/m/<id>`; no-meeting state with replay and *Start meeting…* (D8, D9).
- [ ] 7.5 Mockups: update `mockups/share-dialog.html` (two transcript toggles, policy separate from the link) and `mockups/ui-plan.md` §2 (256-bit token, D7 CSP, plugin-served media).

## 8. Cross-change contracts

- [ ] 8.1 `add-voice-assistant-dashboard-plugin`:
  - `ensureWall` adds `meetingId`, `owner`, `title`;
  - replace its task 4.4 step 6a copy with `stopWall(meetingId, { archiveTo: "docs/meetings/<date>-<slug>.wall.jsonl" })`, called after the notes turn;
  - its `wallInputAllowed` flag becomes "`voice-wall` v2 service present" (the wall authorises every line that reaches the file); update its `voice-assistant-copilot-control` requirement and the "non-allow-listed project" scenario to the per-meeting allow-list. The copilot sees `[wall operator]: <label>: <text>`.
- [ ] 8.2 `add-voice-assistant-dashboard-plugin`: the *Live wall* link targets `/folder/<cwd>/wall` (its task 8.5); the standalone fallback is `/apps/wall/#/m/<id>`.
- [ ] 8.3 `add-plugin-app-host` (with `extract-standalone-app-kit`): add `createStandaloneHost({ anonymousHeaders })`, with `host.api.fetch` sending same-origin requests with those headers and no bearer. Needed before 6.1 (D4).
- [ ] 8.4 Contract for *Start meeting…* from the wall's no-meeting page: voice-assistant exposes a way to open its start dialog for a cwd (route or client service). Agree on it before 7.4.

## 9. Discipline checkpoints

- [ ] 9.1 `security-hardening` pass: classification, window forcing and assertion, token store and oracle, input path, media scope and headers, CSP, text-only rendering, viewer transport.
- [ ] 9.2 `observability-instrumentation`: log lines for host start, stop and error, ignored `categoriesModule`, share mint, revoke and expire, input accept and reject (no text), viewer stream counts.
- [ ] 9.3 `performance-optimization`: dashboard initial-bundle size before and after; 30-viewer SSE fan-out latency and memory; tail-source and media event-loop time.
- [ ] 9.4 `doubt-driven-review` on the 3.3 audit outcome before section 4 lands.
- [ ] 9.5 `review-code` before commit.

## 10. Build and verify

- [ ] 10.1 `npm test` green; `npm run quality:changed` clean.
- [ ] 10.2 `npm run build`; `curl -X POST :8000/api/restart`; enable the plugin; `/api/health` lists `voice-wall`.
- [ ] 10.3 Docs: DocScribe adds a `docs/` entry for the wall plugin (access model, share links, CSP); package `AGENTS.md` rows for every new file.

## 11. Tests (folded from test-plan.md)

- [ ] 11.E1 Level L1: opt-in package (EP). Triple: input manifest · trigger read `package.json` `pi-dashboard-plugin` · observable `server` + `client` entries, no `bridge`, `defaultEnabled:false`, three claims as in task 1.1. Harness exemplar: see `packages/dashboard-plugin-runtime/src/server/__tests__/plugin-enabled.test.ts`. (test-plan #E1)
- [ ] 11.E2 Level L1: opt-in package (state). Triple: input no plugin config · trigger server boot with package present · observable no `/api/plugins/voice-wall/*` route, no `/apps/wall/`, `consume("voice-wall")` undefined. Harness exemplar: see `packages/dashboard-plugin-runtime/src/server/__tests__/plugin-enabled.test.ts`. (test-plan #E2)
- [ ] 11.E3 Level L1: vendored files match upstream (regression). Triple: input `src/vendor/set-copilot/` vs pinned SHA blobs + `proxy-secret.patch` · trigger diff after reverse-applying the patch · observable zero differences; every file listed in `NOTICE`. Harness exemplar: see `packages/kb-plugin/src/server/__tests__/kb-routes.test.ts`. (test-plan #E3)
- [ ] 11.E4 Level L1: no .env leak (EP). Triple: input temp project with `.env` `SONIOX_API_KEY=x`, `FOO=1`, user `.env` `BAR=2` · trigger `loadWallConfig` · observable `process.env` deep-equals the snapshot before; returned object has no `sonioxApiKey`. Harness exemplar: see `packages/kb-plugin/src/server/__tests__/kb-routes.test.ts`. (test-plan #E4)
- [ ] 11.E5 Level L1: no project code (EP). Triple: input config `wall.categoriesModule: "./cats.mjs"` whose import writes `marker.txt` · trigger `ensureWall` · observable wall running with config categories; `marker.txt` absent; `status.notes` mentions the ignored module. Harness exemplar: see `packages/kb-plugin/src/server/__tests__/kb-routes.test.ts`. (test-plan #E5)
- [ ] 11.E6 Level L1: single-flight (state). Triple: input one `meetingId` · trigger two concurrent `ensureWall` · observable one bound loopback port (spy on `WallServer.start` ×1); both resolve equal. Harness exemplar: see `packages/kb-plugin/src/server/__tests__/kb-routes.test.ts`. (test-plan #E6)
- [ ] 11.E7 Level L1: proxy secret patch (EP). Triple: input running host · trigger direct loopback `POST /api/input` and `GET /media?src=a.png` without, then with, `x-voice-wall-proxy` · observable without: 404 and `wall-input.jsonl` unchanged; with: upstream behaviour. Harness exemplar: see `packages/kb-plugin/src/server/__tests__/kb-routes.test.ts`. (test-plan #E7)
- [ ] 11.E8 Level L1: redaction passed (EP). Triple: input config redaction `\b\d{4}-\d{4}\b`, public event text `card 1234-5678` · trigger viewer stream reads event · observable delivered text redacted per upstream. Harness exemplar: see `packages/kb-plugin/src/server/__tests__/kb-routes.test.ts`. (test-plan #E8)
- [ ] 11.E9 Level L1: runtime dir confinement (EP). Triple: input runtime dir inside project tree; under `scratchRoot` · trigger `ensureWall`, `appendEvent` · observable inside project: rejects, nothing appended; under scratch: ok. Harness exemplar: see `packages/kb-plugin/src/server/__tests__/kb-routes.test.ts`. (test-plan #E9)
- [ ] 11.E10 Level L1: appendEvent projectRoot (decision table). Triple: input event `image.src: "docs/a.png"` × {registry knows runtime dir, option given, neither} · trigger `appendEvent` · observable ok, ok, `{ok:false}` naming the missing root. Harness exemplar: see `packages/kb-plugin/src/server/__tests__/kb-routes.test.ts`. (test-plan #E10)
- [ ] 11.E11 Level L1: caller class (decision table). Triple: input {owner, local operator, allow-listed principal, other principal, trusted-network anon, share token} · trigger `classify` · observable operator, operator, typist, member, member, viewer. Harness exemplar: see `packages/kb-plugin/src/server/__tests__/kb-routes.test.ts`. (test-plan #E11)
- [ ] 11.E12 Level L1: window forcing (decision table). Triple: input windows: `/ops` (operator), `/room` (public), `/present` (public); caller ∈ {operator, typist, member, viewer} × requested route ∈ {`/ops`, `/present`, none} · trigger events request · observable upstream URL route: operator gets requested; others get `/present` when asked, else `/room`; caller's `route` never forwarded. Harness exemplar: see `packages/kb-plugin/src/server/__tests__/kb-routes.test.ts`. (test-plan #E12)
- [ ] 11.E13 Level L1: no public window (EP). Triple: input only operator windows · trigger viewer/member events request; owner mints share · observable `no_public_window` for both. Harness exemplar: see `packages/kb-plugin/src/server/__tests__/kb-routes.test.ts`. (test-plan #E13)
- [ ] 11.E14 Level L1: private never reaches non-operators (invariant). Triple: input event `zone:"private"` appended, then 200+ events to force full replay · trigger operator, typist, member, viewer streams live + reconnect with old `Last-Event-ID` · observable only the operator stream ever contains it. Harness exemplar: see `packages/kb-plugin/src/server/__tests__/kb-routes.test.ts`. (test-plan #E14)
- [ ] 11.E15 Level L1: share link expiry options (BVA). Triple: input expiry `meeting`, `2h`, `24h`, meeting ends at +1 h; fake clock · trigger verify at +59 min, +61 min, +2 h · observable `2h`/`24h`/`meeting` all accept at +59, refuse at +61 (capped at meeting end). Harness exemplar: see `packages/kb-plugin/src/server/__tests__/kb-routes.test.ts`. (test-plan #E15)
- [ ] 11.E16 Level L1: token storage (EP). Triple: input mint · trigger inspect registry · observable only a sha256 hex stored; token ≥ 43 base64url chars (256 bit); second mint invalidates first. Harness exemplar: see `packages/kb-plugin/src/server/__tests__/kb-routes.test.ts`. (test-plan #E16)
- [ ] 11.E17 Level L1: no oracle (EP). Triple: input unknown, expired, revoked, ended-meeting tokens · trigger `GET s/bootstrap` · observable identical status + body for all four. Harness exemplar: see `packages/kb-plugin/src/server/__tests__/kb-routes.test.ts`. (test-plan #E17)
- [ ] 11.E18 Level L1: non-owner mint (EP). Triple: input member principal · trigger `POST m/:id/share` · observable 403, no link. Harness exemplar: see `packages/kb-plugin/src/server/__tests__/kb-routes.test.ts`. (test-plan #E18)
- [ ] 11.E19 Level L1: transcript policy (decision table). Triple: input policy {members, viewers} × caller {operator, typist, member, viewer}; with and without a share link · trigger `transcript` · observable operator always 200; others 200 only when their flag is true; independent of link existence. Harness exemplar: see `packages/kb-plugin/src/server/__tests__/kb-routes.test.ts`. (test-plan #E19)
- [ ] 11.E20 Level L1: media scope (EP). Triple: input delivered public event `image.src: a.png`, graph node `image: docs/arch.png`, private event `secret.png`, existing unreferenced `README.png` · trigger viewer `s/media` for each · observable 200, 200, 404, 404. Harness exemplar: see `packages/kb-plugin/src/server/__tests__/kb-routes.test.ts`. (test-plan #E20)
- [ ] 11.E21 Level L1: media headers (EP). Triple: input referenced `diagram.svg` with `<script>` · trigger viewer fetch · observable `Content-Type: image/svg+xml`, `nosniff`, CSP contains `sandbox`. Harness exemplar: see `packages/kb-plugin/src/server/__tests__/kb-routes.test.ts`. (test-plan #E21)
- [ ] 11.E22 Level L1: media traversal (EP). Triple: input operator `src=../../etc/passwd`, symlink to `/etc` · trigger `m/media` · observable 404. Harness exemplar: see `packages/kb-plugin/src/server/__tests__/kb-routes.test.ts`. (test-plan #E22)
- [ ] 11.E23 Level L1: media set cap (BVA). Triple: input 10 001 distinct referenced images · trigger deliver then fetch oldest · observable oldest evicted → 404; newest 200. Harness exemplar: see `packages/kb-plugin/src/server/__tests__/kb-routes.test.ts`. (test-plan #E23)
- [ ] 11.E24 Level L1: input gate (decision table). Triple: input caller {operator, typist, member, viewer} · trigger `POST m/:id/input {text:"hi"}` · observable 200 + one appended line for operator/typist; 403 others, file unchanged. Harness exemplar: see `packages/kb-plugin/src/server/__tests__/kb-routes.test.ts`. (test-plan #E24)
- [ ] 11.E25 Level L1: input validation (BVA). Triple: input text lengths 0, 1, 400, 401; whitespace-only · trigger post · observable 400 / 200 / 200 / 400 (too long) / 400. Harness exemplar: see `packages/kb-plugin/src/server/__tests__/kb-routes.test.ts`. (test-plan #E25)
- [ ] 11.E26 Level L1: attribution (EP). Triple: input principal names `Anna`, `Bob]: [wall operator`, 60-char name, local operator · trigger post `what about Q3?` · observable lines `Anna: …`, `Bob wall operator: …` (brackets/colons stripped), label 40 chars, `operator: …`; upstream shape `{ts,route,text}`. Harness exemplar: see `packages/kb-plugin/src/server/__tests__/kb-routes.test.ts`. (test-plan #E26)
- [ ] 11.E27 Level L1: rate limit (BVA). Triple: input one typist, fake clock · trigger posts at t=0, 1.9 s, 2.0 s; 21 posts within 60 s · observable 2nd → 429 `Retry-After`; 3rd ok; 21st → 429. Harness exemplar: see `packages/kb-plugin/src/server/__tests__/kb-routes.test.ts`. (test-plan #E27)
- [ ] 11.E28 Level L1: input seam reset (state). Triple: input runtime dir with `wall-input-offset` = 57 · trigger `ensureWall` · observable offset file reads `0`. Harness exemplar: see `packages/kb-plugin/src/server/__tests__/kb-routes.test.ts`. (test-plan #E28)
- [ ] 11.E29 Level L1: tail source (state). Triple: input events file missing → created → appended → truncated to 0 → appended; a 2 MiB partial line · trigger tail run · observable waits, emits appended only, replays after shrink, drops the oversized partial with one warning. Harness exemplar: see `packages/kb-plugin/src/server/__tests__/kb-routes.test.ts`. (test-plan #E29)
- [ ] 11.E30 Level L1: archive + replay (EP). Triple: input `archiveTo` ∈ {`docs/meetings/x.wall.jsonl`, `../out.wall.jsonl`, `docs/x.jsonl`, path via symlink outside root} · trigger `stopWall` after a final append · observable first copies (includes the final event) and records `lastReplay`; others copy nothing, keep the old pointer, wall still stops. Harness exemplar: see `packages/kb-plugin/src/server/__tests__/kb-routes.test.ts`. (test-plan #E30)
- [ ] 11.E31 Level L1: replay access (decision table). Triple: input `lastReplay` set; caller {operator, typist, member, viewer} · trigger `GET replay?cwd=` · observable operator 200; others 404. Harness exemplar: see `packages/kb-plugin/src/server/__tests__/kb-routes.test.ts`. (test-plan #E31)
- [ ] 11.E32 Level L1: ./emit purity (EP). Triple: input import graph of `./emit` · trigger static module-graph walk · observable no server entry, `loadConfig`, `WallServer` reachable; `process.env` unchanged after import. Harness exemplar: see `packages/kb-plugin/src/server/__tests__/kb-routes.test.ts`. (test-plan #E32)
- [ ] 11.E33 Level L1: text never HTML (static scan). Triple: input `src/app/**` · trigger lint test · observable no `dangerouslySetInnerHTML`, `innerHTML`, `outerHTML`. Harness exemplar: see `packages/kb-plugin/src/client/__tests__/FolderKbSection.test.tsx`. (test-plan #E33)
- [ ] 11.E34 Level L1: text never HTML (EP). Triple: input event text `<img src=x onerror=alert(1)>` · trigger render Board (RTL) · observable literal text node; no `img` element. Harness exemplar: see `packages/kb-plugin/src/client/__tests__/FolderKbSection.test.tsx`. (test-plan #E34)
- [ ] 11.E35 Level L1: webpage payload (EP). Triple: input event `webpage: { url: "https://x.test" }` · trigger render · observable link card `<a rel="noopener noreferrer">`, no `iframe`. Harness exemplar: see `packages/kb-plugin/src/client/__tests__/FolderKbSection.test.tsx`. (test-plan #E35)
- [ ] 11.E36 Level L1: folder slot visibility (state). Triple: input meetings state {none running, running for cwd A} · trigger render client slot for A and B · observable entry + menu items only for A while running; *Share live wall…* only when owner. Harness exemplar: see `packages/kb-plugin/src/client/__tests__/FolderKbSection.test.tsx`. (test-plan #E36)
- [ ] 11.E37 Level L1: `/wall/:meetingId` (decision table). Triple: input meeting running in `/repo/acme`; ended-known; unknown · trigger render route component · observable replace to `/folder/<enc>/wall/m/<id>`; "Meeting ended" + folder link; "Meeting ended" without link. Harness exemplar: see `packages/kb-plugin/src/client/__tests__/FolderKbSection.test.tsx`. (test-plan #E37)
- [ ] 11.E38 Level L1: reconnect policy (state-transition). Triple: input fetch-SSE reader with fake timers, server down · trigger drop stream · observable retry delays 2, 4, 8, 16, 30, 30… s; banner state `reconnecting` from first failure; at 5 min state `lost`; Retry restarts at 2 s; `share-ended` frame → no retry. Harness exemplar: see `packages/kb-plugin/src/client/__tests__/useKbStats.test.tsx`. (test-plan #E38)
- [ ] 11.P1 Level L1: SSE fan-out (load). Triple: workload 30 concurrent viewer streams on one meeting, 1 event/s appended · metric p95 append→receive latency and RSS growth — measure only, printed · window 5 min. Harness exemplar: see `packages/kb-plugin/src/server/__tests__/kb-routes.test.ts`. (test-plan #P1)
- [ ] 11.P2 Level L1: tail event-loop cost (soak). Triple: workload 50 MB events file, 1 event/s appended · metric max event-loop block per tick (`monitorEventLoopDelay`) — measure only · window 5 min. Harness exemplar: see `packages/kb-plugin/src/server/__tests__/kb-routes.test.ts`. (test-plan #P2)
- [ ] 11.P3 Level ci: lazy app (bundle size). Triple: workload `npm run build` before/after · metric dashboard initial-chunk gzip delta — measure only, printed in CI log · window per build. Harness exemplar: see `.github/workflows/ci.yml`. (test-plan #P3)
- [ ] 11.F1 Level L3: standalone share link (state-convergence). Triple: input harness, owner mints link via API, page opened with `/apps/wall/#/s/<token>` from a non-trusted context · trigger append 3 events · observable board shows the 3 items in their areas; no sidebar; requests carry `X-Wall-Share`; no request URL contains the token. Harness exemplar: see `tests/e2e/network-guard.spec.ts`. (test-plan #F1)
- [ ] 11.F2 Level L3: revoke mid-meeting (state-transition). Triple: input F1 page connected · trigger owner `DELETE share` · observable within 1 s "Link revoked" view; board items no longer in DOM. Harness exemplar: see `tests/e2e/network-guard.spec.ts`. (test-plan #F2)
- [ ] 11.F3 Level L1: expiry ends streams (state-transition). Triple: input link `2h`, fake clock · trigger advance to expiry · observable open viewer stream receives `share-ended` (`expired`) and closes. Harness exemplar: see `packages/kb-plugin/src/server/__tests__/kb-routes.test.ts`. (test-plan #F3)
- [ ] 11.F4 Level L3: embedded folder app (state-convergence). Triple: input harness, plugin enabled, wall running for a folder · trigger click `● Live wall →` · observable wall in the content area with sidebar visible; Back returns to the folder; reload of the URL restores it. Harness exemplar: see `tests/e2e/kb-folder-slot.spec.ts`. (test-plan #F4)
- [ ] 11.F5 Level L3: no-meeting page (state). Triple: input wall stopped with `archiveTo` · trigger open `/folder/<cwd>/wall` · observable "No live meeting", replay board with the last title; no redirect. Harness exemplar: see `tests/e2e/kb-folder-slot.spec.ts`. (test-plan #F5)
- [ ] 11.F6 Level L3: transcript tab absent (state). Triple: input viewer link, default policy · trigger open · observable no Transcript tab in the tablist. Harness exemplar: see `tests/e2e/network-guard.spec.ts`. (test-plan #F6)
- [ ] 11.F7 Level L3: presentation keys (state-transition). Triple: input presentation mode with 3 show commands queued · trigger press A, →, A, Esc · observable auto-advance paused, step advances one, resumes, exits fullscreen. Harness exemplar: see `tests/e2e/kb-folder-slot.spec.ts`. (test-plan #F7)
- [ ] 11.F8 Level L3: input bar states (state-transition). Triple: input typist session; route mocked to 429 then network error · trigger type 401 chars; send; send again; fail · observable counter shows over-limit and blocks send; rate-limited message with seconds; failed send keeps text + Retry. Harness exemplar: see `tests/e2e/kb-folder-slot.spec.ts`. (test-plan #F8)
- [ ] 11.F9 Level L3: reconnecting banner (state-convergence). Triple: input F1 page · trigger harness blocks the events route for 10 s, then unblocks · observable dimmed board + "Reconnecting" banner, then live again with missed events filled. Harness exemplar: see `tests/e2e/network-guard.spec.ts`. (test-plan #F9)
- [ ] 11.F10 Level L3: sign in to type (state). Triple: input harness with identity enforced, viewer page · trigger *Sign in to type* → login → return · observable back on `/apps/wall/#/…`; input bar present only for the allow-listed account. Harness exemplar: see `tests/e2e/automation-identity-restart.spec.ts`. (test-plan #F10)
- [ ] 11.F11 Manual check: room-screen legibility — presentation at 1080p on a projector; humans read from 5 m; [judgment: text readable at distance; QR scannable from the room] (test-plan #F11) (test-plan: manual-only)
- [ ] 11.F12 Manual check: mobile share flow — phone over zrok tunnel; scan QR, read board, rotate; [judgment: layout usable, no overflow; join < 10 s feels instant] (test-plan #F12) (test-plan: manual-only)
- [ ] 11.X1 Level L1: malformed events (fault-injection). Triple: input 1 000 lines: invalid JSON, 2 MiB line, injected `show` and `heartbeat`, then a valid event · trigger tail · observable server keeps serving; valid event delivered; no uncaught exception. Harness exemplar: see `packages/kb-plugin/src/server/__tests__/kb-routes.test.ts`. (test-plan #X1)
- [ ] 11.X2 Level L1: failed start (fault-injection (abort)). Triple: input `WallServer.start` rejects (`EACCES`) · trigger `ensureWall` · observable rejects with reason; `status` = error; proxy routes for the meeting 404. Harness exemplar: see `packages/kb-plugin/src/server/__tests__/kb-routes.test.ts`. (test-plan #X2)
- [ ] 11.X3 Level L1: upstream hang (fault-injection (delay)). Triple: input loopback host stalls `bootstrap` · trigger proxied request · observable 504 after 10 s; dashboard still answers `/api/health`. Harness exemplar: see `packages/kb-plugin/src/server/__tests__/kb-routes.test.ts`. (test-plan #X3)
- [ ] 11.X4 Level L1: stop teardown (state-transition). Triple: input 3 viewer streams open · trigger `stopWall`, plugin disable, `onShutdown` (each in turn) · observable each stream gets `share-ended` before close; port released (connect refused). Harness exemplar: see `packages/kb-plugin/src/server/__tests__/kb-routes.test.ts`. (test-plan #X4)
- [ ] 11.X5 Level L2: restart (fault-injection). Triple: input dashboard with a running wall and a curl SSE client · trigger `POST /api/restart` · observable curl stream closes; old wall port not bound after restart. Harness exemplar: see `qa/tests/18-server-port-hygiene.sh`. (test-plan #X5)
- [ ] 11.X6 Level L1: client input failure (fault-injection (abort)). Triple: input input POST rejects with network error · trigger send · observable component keeps text and shows Retry. Harness exemplar: see `packages/kb-plugin/src/client/__tests__/FolderKbSection.test.tsx`. (test-plan #X6)
