## Context

Rewritten 2026-10-05. It replaces the child-process-behind-`/live/<id>/` design; see the proposal's "Why". UX and mockups are in `mockups/` (`ui-plan.md`, `share-dialog.html`, `join.html`, `wall-app.html`, `input-states.html`, `presentation.html`). Folded from the `add-plugin-app-host` coordination note: embedded folder app, no-meeting state, replay.

Upstream `set-copilot@32b6a7d` facts, read at `/tmp/set-copilot` (upstream paths under `src/`):

- `wall/index.ts:130-175` `runWall` builds `new WallServer({ port, windows, layouts, registry, publicDir, projectRoot, redaction, scrollHistory, runtimeDir, transcriptPath, dictationPath, stagingTtlMs, presentation, transcriptPage })`. Before that it calls `resolveWindows`, `resolveCategories`, `jsonlTailSource`. After `start()` it writes `wall.pid`/`wall.url` and installs `process.once("SIGTERM"|"SIGINT"|"exit")`. These process-level effects are in `runWall` only.
- `wall/server.ts:15-29` imports only node built-ins and sibling wall modules. `start()` listens on `opts.host ?? "127.0.0.1"`; `boundPort()` supports port 0 (`:381-418`). `stop()` stops sources, timers and clients (`:420-428`). The `createServer` request callback has no try/catch (`:382`).
- `wall/server.ts:884` `payloadFor` is the per-client gate for live and resume delivery. It is parameterised by the client's window: public clients (`audience !== "operator"`, `:872`) never get private-zone events or `stage-expired` markers. `handleSse` (`:1298`) takes the window from `?route=`. It resumes from `Last-Event-ID` within a 200-entry tail (`:297`), else sends a full replay (`{kind:"replay",mode:"full"}`, `:1311-1324`).
- `wall/server.ts:1160-1164` serves `/api/transcript` only when `transcriptPage.route` is set. The default is `null` (`config.ts:804`).
- `wall/server.ts:1349-1367` `serveMedia`: `MEDIA_EXTENSIONS` (`:55`, includes `.svg`), realpath confinement, file check, then **synchronous** `statSync`/`readFileSync` outside the try block.
- `wall/layout.ts:107-143`: unknown or ambiguous window audiences resolve to **public**.
- `wall/categories.ts:83-111` `resolveCategories(cfg)` `await import`s the project's `wall.categoriesModule` (arbitrary project code). `buildRegistry(raw)` (`:59`) is the pure part.
- `wall/event-source.ts:52` `jsonlTailSource` re-reads the whole file with `readFileSync` every 200 ms. `parseWireLine` (`:27`) is pure.
- `config.ts:1059` `loadConfig(root)` is synchronous. It adds project and user `.env` keys to `process.env` (`:376-404`) and reads `SET_COPILOT_DIR` and API keys (`:1111`).
- `wall/input.ts:41` `normalizeWallInput` caps at 400 characters. `poll.ts:73` `wallInputsFrom` forwards only `text`.
- `wall/emit.ts:124-129` `normalizeEvent(raw, { projectRoot })` needs `projectRoot` to accept a local `image.src`.
- `wall/public/wall-core.mjs` and `text-format.mjs` are DOM-free. `wall.js:1496` uses `innerHTML` for charts, `:1118-1126` iframes `webpage` payloads, and `index.html:15-17` loads cytoscape and dagre from `unpkg.com`.

Dashboard facts:
- seam (`ctx.registerCapabilityRoute`, `ctx.requestPrincipal`, `ctx.serveApp`): `openspec/changes/add-plugin-capability-routes/design.md` D1–D7. Trust for capability routes = listed in `bundledPlugins`.
- `AppHost`, `<EmbeddedApp>`, `presentation: "content"`: `openspec/changes/add-plugin-app-host/design.md` D1–D9.
- app-kit `authedFetch` sends nothing without a credential in `oidc`/`unknown` modes (`openspec/changes/extract-standalone-app-kit/design.md` D3/D4).
- plugin WebSocket routes are genuine-local only (`openspec/specs/plugin-ws-route`), so the wall uses SSE.
- client Tailwind needs one `@source` per client-bearing plugin (`openspec/specs/client-build-config`, `packages/client/src/index.css:16-24`).

## Goals / Non-Goals

**Goals:** room screen and participants' devices; anonymous read-only viewing via a revocable link; typing only by known, allow-listed people; upstream delivery semantics (zones, staging, director, resume) reused; no child process; no CDN; no raw HTML from event content; one app, embedded and standalone.

**Non-Goals:** producing wall content; copilot reply mirroring; editing the board from the app; `webpage` iframes in v1 (they render as link cards); share links surviving a dashboard restart; viewer access to past meetings; `wall.categoriesModule` (project code) in the dashboard.

## Decisions

**D1. In-process `WallServer` per meeting.** `ensureWall` (single-flight per `meetingId`: a concurrent call awaits the in-flight start) builds options (D2) and calls `new WallServer({ …, host: "127.0.0.1", port: 0, publicDir: <empty plugin-owned dir>, redaction: cfg.wall.redaction, scrollHistory: cfg.wall.scrollHistory, proxySecret, transcriptPage: { ...cfg.wall.transcriptPage, route: "/transcript", speakers } })`. `redaction` is passed explicitly: upstream runs with **no** redaction when it is omitted. Forcing a non-null `transcriptPage.route` enables upstream's `/api/transcript`; the plugin never proxies the page itself.
- **Event source:** the plugin's own `incrementalTailSource`, which implements upstream's `EventSource` interface. It reads only appended bytes via `fs.promises` at a stored offset and parses with vendored `parseWireLine`, replacing `jsonlTailSource`'s whole-file `readFileSync` every 200 ms on the dashboard event loop. A missing file is waited for. A shrink (truncation or rotation) resets the offset to 0 and replays, as upstream's full re-read would. A partial trailing line is buffered up to 1 MiB, then dropped with a warning.
- **Input seam reset:** like `runWall` (`wall/index.ts:97,139`), `ensureWall` writes `wall-input-offset` = `0` so a stale offset cannot swallow the next meeting's input.
- The loopback port is never registered or exposed. Only plugin routes talk to it (D3), and only for `events`, `bootstrap` and `transcript`. **Media is served by the plugin itself (D3).**
- **One named vendored patch: `vendor/patches/proxy-secret.patch`.** Upstream's loopback endpoints `/api/input` and `/media` are unauthenticated. Upstream itself calls the loopback bind "the WHOLE security story" (`server.ts:1073-1077`). On a host where the operator browses the web, a cross-origin simple POST or DNS rebinding can reach them. The patch adds an optional `proxySecret` to `WallServerOptions` and one guard at the top of `handle`: a request without header `x-voice-wall-proxy: <secret>` gets 404. The plugin generates a 256-bit secret per host and sends it on every proxied request. The patch is recorded in `NOTICE`, re-applied on each re-vendor, and covered by a test.
- Not vendored: `wall/index.ts`, `feed-script.ts`, the upstream page, `wall.js`, `wall.css`, `transcript.*`.
- Rejected: "no patches" at the price of leaving upstream's loopback input and media endpoints open to cross-origin requests.
- Rejected: a child process. It existed only for `runWall`/`loadConfig`'s process-level effects, which D1 and D2 avoid.
- Rejected: re-implementing `WallServer`. That is 1388 lines of zone gates, staging, director and resume, and the gate logic is the security-critical part.
- **Crash surface:** the dashboard's process-level safety net (`openspec/specs/dashboard-server/spec.md`, "Process-level crash safety net") keeps the process alive on an uncaught throw. The residual risk is a **hung request**: the upstream request callback has no try/catch (`server.ts:382`). Task 3.3 audits the remaining paths (`handle`, SSE, bootstrap, transcript, timers), and the proxy times out a non-SSE upstream request after 10 s. Requests reach the host only from the plugin proxy, with validated paths. A failed start leaves nothing registered.

**D2. Config: upstream `loadConfig` inside an env snapshot; registry without project code.** `loadWallConfig(projectRoot, runtimeDir)`:
1. snapshot `process.env`;
2. set `SET_COPILOT_DIR`;
3. call vendored `loadConfig(projectRoot)` (synchronous);
4. in `finally`, restore exactly (delete added keys, reset changed ones).

Only after restore:
- `windows = resolveWindows(cfg.wall…)` as `runWall` does;
- `registry = buildRegistry(cfg.wall.categories ?? [])`. A set `wall.categoriesModule` is **ignored**, with a logged warning and a `status` note, because importing it would run project code in the dashboard process.

Only wall fields are kept: `wall.*`, `transcriptOutput`, `dictationOutput`, `transcript.speakers`, `projectRoot`, `runtimeDir`. The `CopilotConfig` (which carries `sonioxApiKey`) is dropped.
- Rejected: a hand-written config reader, which drifts from upstream's merge.
- Rejected: a `no-dotenv` patch, which is a re-vendor cost.

**D3. Audience-forcing routes.** All data routes live under `/api/plugins/voice-wall/`. Caller class per request:

| Class | Admitted by | Windows |
|---|---|---|
| `operator` | `requestPrincipal` is the meeting owner or the local operator | any |
| `typist` | `requestPrincipal` is on the meeting allow-list, not `operator` | public-audience only, plus input |
| `member` | the guard's normal pass, neither of the above | public-audience only |
| `viewer` | capability prefix `/api/plugins/voice-wall/s/` + valid share token (D4) | public-audience only |

**Window selection** for `typist`/`member`/`viewer`:
- the requested `?route=` if its resolved audience is public;
- else the meeting's default public window (the first public window in config order);
- a config with **no** public window gives `member`/`viewer` a 404 `no_public_window`, and share minting is refused with that reason.

The proxy builds the upstream URL **from the selected window only**; the caller's `route` is never forwarded. It asserts that the forwarded window's `audience === "public"`, and denies and logs on mismatch (defence in depth). Event filtering stays upstream's `payloadFor`.

Routes:
- `m/:meetingId/{events,bootstrap,transcript,media}` for `operator`/`typist`/`member` (typists follow member scope for transcript and media);
- `s/{events,bootstrap,transcript,media}` for `viewer`;
- `m/:meetingId/input` (POST, D5);
- `m/:meetingId/share` (owner, D4);
- `m/:meetingId/policy` (owner: transcript policy, typists);
- `meetings?cwd=` and `meetings/:meetingId` (folder state; `cwd` and title for live and recently ended meetings).

The proxy forwards `Last-Event-ID`, streams SSE with backpressure, propagates close, and appends the plugin's own `share-ended` frame when it ends a stream.

**Transcript policy** is meeting-level, independent of any link: `{ members: boolean, viewers: boolean }`, both default `false`, set by the owner. An operator always may read it. Upstream's transcript is **pattern-redacted only, not zone-filtered** (`server.ts:1200-1280`): private-zone withholding applies to wall events, not to what people said. The share dialog states this next to each toggle.

**Media** is served by the plugin, not proxied:
- For `member`/`viewer`, `src` must be in the meeting's per-audience referenced set (capped at 10 000 entries per meeting; oldest evicted). That set is built from every image reference in public payloads the proxy delivered, including resume and full replay: event `image.src` and string image fields of graph nodes.
- Then upstream's three checks are re-applied with async `fs`: vendored `MEDIA_EXTENSIONS`, realpath inside `projectRoot`, regular file.
- Responses carry `Content-Type` from the extension, `X-Content-Type-Options: nosniff` and `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; sandbox`, so an SVG opened directly runs no script.
- The app fetches media through its data transport and renders it from a `blob:` URL. A bare `<img src>` could not carry the share header, and putting the token in the URL would leak it.

The app reads SSE with `fetch` streaming (not `EventSource`, which cannot send headers), with `Last-Event-ID` reconnect. **Reconnect policy** (decided 2026-10-05): exponential backoff from 2 s up to 30 s; the "Reconnecting" banner (stale board dimmed) from the first failure; after 5 minutes without a connection, "Connection lost" with a Retry button that restarts the cycle. A `share-ended` frame, or a refused request after admission, ends retrying immediately.

**D4. Share links.**
- `POST m/:id/share` (owner or local operator) with `{ expiry: "meeting" | "2h" | "24h" }`. It creates a 256-bit random token (base64url), stores `sha256(token)` in memory with `{ meetingId, expiresAt, revoked:false }`, and returns the token once.
- One active link per meeting; re-minting revokes the previous one.
- Expiry is the earlier of the duration and the meeting's end (the UI labels them "up to 2 h" and "up to 24 h"). A timer at `expiresAt` closes that link's open viewer streams with `share-ended` (reason `expired`), through the same path as revoke.
- `DELETE m/:id/share` revokes the link and closes every open `viewer` stream for it with a `share-ended` frame.
- Verifier: reads `X-Wall-Share` and looks up the hash. It accepts only a live, unexpired, unrevoked link of a running meeting. It is pure (no state change), as the seam requires. Every refusal gets the normal denial, so there is no oracle.
- The app words a dead-end reason only from a prior bootstrap or a `share-ended` frame.
- The token lives in the URL fragment (`/apps/wall/#/s/<token>`). Viewer count = open `viewer` streams.
- **Viewer transport:** app-kit refuses to send without a credential (`extract-standalone-app-kit` D3/D4), so viewer mode needs a credentialless same-origin request with `X-Wall-Share`. Rather than deviate from app-host D7 ("data only via `host.api`"), this change asks `add-plugin-app-host` for a standalone-host option `createStandaloneHost({ anonymousHeaders })`: `host.api.fetch` then sends same-origin requests with those headers and no bearer (task 8.3). Signed-in and embedded modes use `host.api` unchanged.

**D5. Authenticated input.** `POST m/:id/input`:
- `operator` or `typist`; others get 403 `not_allowed`. This realises "signed in and on the allow-list": the owner is the allow-list's default entry, and in single-user mode the local operator is the only identity. Being allowed to type grants no extra viewing scope.
- Text goes through vendored `normalizeWallInput`.
- Rate limit per principal per meeting: 1 per 2 s and 20 per minute, else 429 with `Retry-After`.
- Appends the upstream-shaped `{ ts, route, text: "<label>: <text>" }`. `<label>` is the principal's `name`, else `sub`, with control characters, `[`, `]` and `:` stripped, 40 characters max; `operator` for the local operator.
- `poll.ts` forwards it unchanged, and the voice-assistant copilot prefixes `[wall operator]:`, so the copilot sees `[wall operator]: Anna: …` (intended, task 8.1).
- Upstream's own `/api/input` is never proxied. It is reachable only on loopback.
- The allow-list defaults to the owner and is edited via `policy`. In single-user mode it is fixed to the local operator.

**D6. App: one component, two hosts.** `src/app/`:
- library entry `defineDashboardApp({ id: "wall", title: "Live wall", App, HeaderContext })`;
- standalone `standalone.html`: `createStandaloneHost()` + `<StandaloneBar>`.

The route table is relative: `m/<meetingId>`, `s/<token>` (standalone only), `replay/<encodedCwd>`, and a `present` modifier. Location source per host: **standalone uses hash location** (`/apps/wall/#/…`, which keeps the token out of requests); **embedded uses the host's pathname router under `basePath`**.

Rendering:
- text via vendored `parseWallText` into React elements, never `dangerouslySetInnerHTML` (lint test);
- charts as React SVG;
- graphs with bundled npm `cytoscape` + `dagre` + `cytoscape-dagre`;
- `webpage` as a link card (`rel="noopener noreferrer"`).

Board layout uses vendored `wall-core.mjs`. Presentation follows upstream `show` commands plus F, ←/→, A and Esc.

Embedded:
- title + live dot → `HeaderContext`;
- *Present* → `setActions` with `requestFullscreen`;
- viewer strip and *Sign in to type* are standalone only;
- turn and speaker links call `host.openSession`, hidden without `capabilities.dashboard`.

**D7. Standalone mount and CSP.** `ctx.serveApp({ dir: <pkg>/dist/app, appId: "wall", csp })`, so the mount is `/apps/wall/` while the plugin id stays `voice-wall`. The policy:

```
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self';
img-src 'self' data: blob:; font-src 'self'; frame-src 'none';
frame-ancestors 'self'; base-uri 'none'; form-action 'self'
```

The build emits no inline scripts. `style-src` allows `'unsafe-inline'` because cytoscape injects a `<style>` element at runtime (`cytoscape.cjs.js:28136-28140`). Script execution stays `'self'`-only, and event text is never markup, so the remaining risk is CSS injection, which has no data path here. When embedded, the dashboard's CSP applies and text-only rendering (D6) is the XSS barrier.

The package directory `voice-wall-plugin` is listed in `packages/server/package.json#piDashboard.bundledPlugins` (a list of directory names). That both ships it in Electron and makes it trusted for the capability seam, whose trust check keys on the directory name. Standalone sign-in uses the host's login seam via the app-kit standalone host, as `add-team-plugin` D14 does. Task 6.5 verifies that `safeReturnTo` accepts `/apps/wall/`.

**D8. Dashboard integration (client entry).**
- `sidebar-folder-section`: state-only `● Live wall →`, only while a wall runs for that folder.
- `useFolderMenuItem`, group `open`, only while running: *Live wall*; *Open wall standalone* (`openStandalone`, projector); *Share live wall…* (owner; plugin-owned dialog).
- `shell-overlay-route` claims, registered whenever the plugin is enabled, both rendering `<EmbeddedApp>`:
  - `/folder/:encodedCwd/wall` (depth 2, parent `/folder/:encodedCwd`, `presentation: "content"`);
  - `/wall/:meetingId` (depth 1, `presentation: "content"`).

  The app route table lives under the folder base, so the `/wall/:meetingId` route component resolves the folder via `meetings/:meetingId` and replaces history with `/folder/<encodedCwd>/wall/m/<meetingId>`. `AppHost` passes no props, so the meeting id must travel in the app path. For an unknown meeting, the component itself renders "Meeting ended", with the folder link when known.
- The client entry and app need Tailwind `@source` lines in `packages/client/src/index.css`.

**D9. No-meeting state and replay.** `/folder/<cwd>/wall` with no running wall shows "No live meeting", *Start meeting…* (voice-assistant start dialog; contract task 8.4) and the last meeting's board read-only.

Replay without a race:
- `stopWall(meetingId, { archiveTo })` stops the host first, so no more tail. It then copies the runtime `wall-events.jsonl` to `archiveTo`.
- `archiveTo` must end in `.wall.jsonl`, and its parent's realpath must be inside `projectRoot` by the repo convention: `path.relative(realRoot, realParent)` is not absolute and does not start with `..` (`openspec/specs/session-diff-extraction`; upstream `server.ts:1358`). Otherwise there is no copy.
- It records `lastReplay[projectRoot] = { path, meetingId, title, endedAt }` in plugin config.

Viewing a replay (`GET replay?cwd=<encodedCwd>`, operator only) starts a transient `WallServer` over the archived file with no tail growth. It stops after 5 minutes without a client.

**D10. Service `voice-wall` v2.**

```ts
interface VoiceWallService {
  version: 2;
  scratchRoot: string; // ~/.pi/dashboard/voice
  ensureWall(o: { projectRoot: string; runtimeDir: string; meetingId: string; owner: Principal; title?: string }):
    Promise<{ meetingId: string; folderPath: string; appPath: string }>;
  stopWall(meetingId: string, o?: { archiveTo?: string }): Promise<{ archived?: string }>;
  status(meetingId: string): { state: "stopped" | "running" | "error"; error?: string; notes?: string[]; viewers?: number };
  appendEvent(runtimeDir: string, raw: unknown, o?: { projectRoot?: string }): { ok: true } | { ok: false; reason: string };
}
```

- `ensureWall` is single-flight and idempotent per `meetingId`.
- `runtimeDir` must lie under `scratchRoot`.
- `appendEvent` = vendored `normalizeEvent(raw, { projectRoot })` + append. `projectRoot` comes from the registry entry for that runtime dir, else the option. A local `image.src` without either is rejected.
- `./emit` (pure `normalizeEvent`, `wallEventsFile`) is provided for producers in pi sessions.
- The earlier draft's `inputAllowed` and `wallInput.allowedProjects` are gone (D5).

**D11. Teardown.** `stopWall`, plugin disable and `ctx.onShutdown` each: revoke the meeting's links, end proxied streams with `share-ended`, `WallServer.stop()`, evict. In-process hosts die with the dashboard; there are no orphans.

## Risks / Trade-offs

- **[Risk] Anonymous viewers on the dashboard origin.** → Capability prefix (GET only, own namespace, trusted list), 256-bit token, public windows only with an asserted audience, transcript off, media by reference with a sandboxed CSP, expiry ≤ meeting, revocation closes streams. Residual: a forwarded link works until revoked or expired; the dialog says so.
- **[Risk] XSS on the dashboard origin.** → Text-only rendering with a lint test, strict standalone CSP, no iframes, bundled libraries, sandboxed media.
- **[Risk] A vendored server bug hangs a request or throws.** → The process safety net, media path not used, incremental tail, throw-path audit, 10 s upstream timeout, single-flight start, soak with malformed JSONL.
- **[Risk] Restart skips plugin shutdown.** `/api/restart` exits without dispatching `onShutdown` (`packages/server/src/routes/system-routes.ts:1412`), so open streams drop without a `share-ended` frame. → The app shows "reconnecting", then the generic invalid-link state once the in-memory link is gone. This is acceptable because links never survive a restart.
- **[Risk] Env snapshot misses a mutation.** → Byte-equality test; the re-vendor checklist re-reads `config.ts`.
- **[Risk] Host gate refuses a non-live tunnel origin** before the seam. → Share dialog shows the link only for admitted origins (task 7.3).
- **[Risk] SSE fan-out and event-loop time.** → Measure 30 viewers and tail cost (task 9.3).
- **[Trade-off] `categoriesModule` ignored.** Projects relying on code-defined categories get config categories only, with a warning.
- **[Trade-off] One vendored patch** (`proxy-secret.patch`) to re-apply on each re-vendor.
- **[Trade-off] `style-src 'unsafe-inline'`** in the standalone CSP, required by cytoscape.
- **[Trade-off] Four dependencies land first.** Accepted for one `AppHost`, shared with Team.

## Migration Plan

Order: `extract-standalone-app-kit` → `add-plugin-app-host` → `add-plugin-capability-routes` → this change → `add-voice-assistant-dashboard-plugin`. Add the package and run `pnpm install`. The app build runs as part of `npm run build` (task 1.3); then `curl -X POST :8000/api/restart`. The plugin is disabled by default; enable it in Settings → Plugins. Rollback: disable. Walls stop and links die; only `lastReplay` persists.

## Open Questions

- Allow-list principal picker: is there a dashboard API listing known principals? If not, v1 accepts a typed `iss`+`sub` or an email claim (task 7.3).
