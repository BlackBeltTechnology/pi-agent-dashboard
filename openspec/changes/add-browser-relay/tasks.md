## 1. Plugin runtime WebSocket route hook (spec `plugin-ws-route`, design D1)

- [x] 1.1 Add `WsRouteRegistration` type (`pathPrefix`, `admitOrigins`, `handleUpgrade`) + `registerWsRoute` to `ServerPluginContext` in `packages/dashboard-plugin-runtime/src/server/server-context.ts`; reject registration after the current activation completes, duplicate scope/prefix, reserved core scopes; re-activation registers afresh. Verify: unit tests in `packages/dashboard-plugin-runtime/src/server/__tests__/ws-route-registry.test.ts` (accept / duplicate throws / reserved throws / late throws / off→on re-registers).
- [x] 1.2 Split `WsRouteScope` into `CoreWsRouteScope` + plugin string in `packages/server/src/auth/ws-ticket.ts`; `routeScopeForUrl` consults the registry after core prefixes; `wsTicketStore.consume` and `POST /api/ws-ticket` accept only core scopes. Verify: `ws-ticket.test.ts` — plugin scope resolves from prefix; ticket mint for plugin scope → 400; existing core cases unchanged.
- [x] 1.3 Add a plugin-scope origin check beside `isWsOriginTrusted` in `packages/server/src/auth/cors-origin.ts`: non-empty `admitOrigins` → exact match only (core policy not consulted), empty → core policy. Verify: `cors-origin.test.ts` — `chrome-extension://x` admitted only when listed; `http://localhost:5173` rejected on a pinned scope; core-scope behaviour byte-identical against existing fixtures.
- [x] 1.4 Wire the registry into the upgrade handler at `packages/server/src/server.ts:2521`: host-gate → plugin origin check → `isGenuinelyLocal` + loopback `Host` + no forwarding headers (extend `localhost-guard.ts` list with `via`, `x-forwarded-server`, `x-forwarded-port` for plugin scopes only) (skip both the secret and no-secret auth branches: no cookie, no localToken, no ticket, no CIDR) → `registration.handleUpgrade`. Verify: `server-ws-plugin-route.test.ts` spins the server, registers a fake scope, asserts gate order via ordered spies and the 403/404 outcomes from the spec scenarios including cookie-holder-rejected, no-secret-CIDR-rejected, and tunnel-Host / `x-forwarded-for` rejected.
- [x] 1.5 Teardown on plugin disable/failure: unregister scopes, close sockets 1001. Verify: test toggles a fake plugin off via `POST /api/plugins/:id/toggle`, asserts open socket receives 1001 and a new upgrade gets 404.
- [x] 1.6 `doubt-driven-review` pass on the `registerWsRoute` API surface before 2.x starts; record outcome in this file under 1.6.

  **1.6 outcome (doubt-driven-review, group 1):** Reviewed the surface
  adversarially: activation-window semantics, registry invariants, gate order
  in the upgrade handler, teardown, and plugin-bug containment. Findings:
  (1) **fixed** — a plugin `handleUpgrade` that throws synchronously escaped
  the `upgrade` event listener (fatal to the process); now wrapped in
  try/catch → log + `socket.destroy()`, server keeps serving. (2) **verified
  safe** — registration window is exactly the `await mod.default(ctx)` span
  (async continuations inside it register legally, after it they throw);
  `admitOrigins` copied by value so post-registration mutation cannot widen
  admission; tombstones are removed on re-registration so a prefix is never
  permanently dead; prefix overlap is checked both directions; sockets
  tracked only after handshake, so teardown's `close(1001)` is always legal.
  (3) **accepted, documented** — pinned-origin match is exact string equality
  on the raw header (an empty-string list entry would admit an empty Origin;
  no browser sends one — plugin config error, spec says "exactly equal one
  entry"); `Host` comparison is case-insensitive (DNS rule) but refuses
  trailing-dot/suffixed forms (`127.0.0.1.evil` stays whole — fail-closed).
  (4) **residual tension → candidate for design follow-up** — `POST
  /api/plugins/:id/toggle` OFF now tears down WS routes live (sockets 1001,
  upgrades 404) but toggle ON does NOT live-reload the plugin's server entry
  (re-running it would double-mount its fastify REST routes — fastify cannot
  remove routes), so `restartRequired: true` stays honest and a re-enabled
  plugin's WS routes stay 404 until restart. The design risk note's "toggle
  unloads the plugin" is only half-true today: WS teardown live, REST
  teardown at restart. Full live unload needs plugin-lifecycle work beyond
  group 1 (escape-hatch candidate if 2.x needs live re-enable).

## 2. Relay core in `packages/browser-plugin/` (spec `browser-relay`, design D2–D4)

- [x] 2.1 Scaffold `packages/browser-plugin/` (package.json `pi-dashboard-plugin` manifest id `browser`, `server`, `client`, `configSchema.json` with `enabled`, `browsers.<profileDirectory>.{token (writeOnly), zeroDialog, allowedDomains}`, `defaultBrowser`; `i18n.ts`; vitest config; `AGENTS.md`). Verify: `curl /api/health | jq '.plugins[] | select(.id=="browser")'` shows the plugin loaded, disabled by default.

  **2.1 outcome (workstream 2a):** scaffold landed. Manifest id `browser`, priority 500,
  claims `settings-section`→`BrowserSettings` + `content-view`→`LiveViewTile`
  (predicate `isLiveViewActive` — content-view claims MUST be predicate-gated,
  placeholder returns false until workstream 4). Client placeholders render null;
  real components = task 4.x. Also carries `allowMultipleInstancesPerProfile`
  (see 2.2b) and `defaultEnabled: false` (see 2.13). Registered: root
  `vitest.config.ts` projects, `packages/client` dep (plugin-registry import),
  electron `BUNDLED_PLUGINS`, publish.yml PACKAGES, knip.json workspace,
  biome vendor exclusion. i18n-lint excludes the vendor tree (upstream throw
  strings are a CDP wire contract, not UI). The live `curl /api/health` check
  (plugin loads, reports enabled:false) is deferred to the 2c harness run —
  manifest validation + defaultEnabled resolution are unit-tested
  (`src/__tests__/manifest.test.ts`, E31).
- [x] 2.2 Vendor `cdpRelay.ts`, `cdpRelayV2.ts`, `browserModel.ts`, `protocol.ts` from `microsoft/playwright` into `src/server/relay/vendor/` with `NOTICE` (Apache-2.0, upstream SHA, date). Verify: `pnpm -F browser-plugin typecheck` passes; `NOTICE` present; no edits inside `vendor/` (enforced by a test that hashes the dir against a recorded manifest).

  **2.2 outcome (workstream 2a):** vendored per the user's explicit choice
  (“vendor all four + shims”). Upstream commit
  `d1ead3ecca23182f2d06d761c28e3d4edafb6595` (main, 2026-09-11) — see
  `vendor/NOTICE`. Tree: the FIVE mcp files (incl. `log.ts`, which the mcp
  files import) + `tools/utils/extension.ts` VERBATIM (task sketch marked it
  shim; the real upstream file is small, self-contained (fs/path only) and
  its `isExtensionInstalledInProfile` feeds task 2.7 — vendoring beats
  shimming), + `server/registry/index.ts` SHIM (throws `not supported —
  browser launch is supplied by relay-instance.ts`) + `shims/wsServer.ts`
  SHIM (constructor inert; `listen()` throws / `close()` rejects `not
  supported — transport is supplied by relay-instance.ts`) +
  `shims/{manualPromise,time,timeoutRunner}.ts` VERBATIM upstream isomorphic
  helpers (real working code — `ExtensionProtocolV2` uses `ManualPromise`).
  Bare specifiers resolve via tsconfig.base.json `paths` + the package
  vitest `resolve.alias` (anchored regex keys — `@isomorphic/time` is a
  prefix of `@isomorphic/timeoutRunner`). Integrity:
  `src/server/__tests__/vendor-integrity.test.ts` (X14) hashes the whole
  `playwright-core/` tree against `vendor-hashes.json`; also pins the shim
  contracts (CDPRelayServer constructs inert, `start()` rejects loudly).
  Verify via root `npx tsc --noEmit` (no per-package typecheck script exists;
  root program covers `packages/*/src`).
- [ ] 2.2b Spike (throwaway, not committed): with the extension in profile OSS, open two `connect.html` pages against two relay guids and confirm the single service worker holds two concurrent relay sockets with two tab groups; also confirm whether upstream `CDPRelayServer` self-listens in its constructor. Record both answers in this task; if two sockets fail, switch spec scenario "Two sessions, one profile" to the 409 `Profile busy` branch.

  **2.2b decision (user, workstream 2a):** implement BOTH paths behind the
  boolean config flag `allowMultipleInstancesPerProfile` (default `false` =
  409 `busy`; `true` = concurrent instances on one profile).
  `configSchema.json` carries the field now (scaffolded in 2.1); the connect
  logic honouring it is workstream 2c (task 2.9's 409 `reason:"busy"`
  branch keys on this flag when `false` and a live instance exists). The X17
  spike remains manual-only and decides whether the `true` path actually
  works with the stock extension.
- [x] 2.3 `relay-instance.ts`: wrap vendor classes — accept pre-upgraded sockets (per 2.2b finding), listener-list `_emit`, deny-list interceptor, audit hooks, non-secret `instanceId`. Verify: `relay-instance.test.ts` with a fake extension socket: handshake holds CDP traffic until `extension.initialized`; second CDP client closed `Another CDP client already connected`; `Network.getAllCookies` and `Network.getCookies` → CDP error `-32000` + `denied` audit entry, not forwarded; `Page.navigate` to `file://`, `javascript:`, `data:` denied; host-less URL denied when `allowedDomains` non-empty; `allowedDomains` exact-host vs leading-dot subdomain matching (`.github.com` admits `api.github.com`, denies `github.com.evil.io`); allowed `Runtime.evaluate` forwarded verbatim.
- [x] 2.4 `relay-manager.ts`: `Map<guid, RelayInstance>`, guid minting (`crypto.randomBytes(16)`), guid ↔ profileDirectory, non-secret `instanceId`, unclaimed-guid expiry at 60 s, instance close on extension-socket close, on CDP-client close, and 30 s after handshake with no CDP client (audit `detach/no-cdp-client`), kill-switch close-all. Verify: `relay-manager.test.ts` — unknown/expired guid → 404; claimed guid second ext socket → close 1000 with upstream reason; CDP client close → extension socket closed + instance removed; fake-timer: handshake + 30 s no CDP → closed; `setEnabled(false)` resolves only after all instances closed.
- [x] 2.5 Register WS routes via `ctx.registerWsRoute`: `browser-ext` (`/ws/browser-ext/`, `admitOrigins: ["chrome-extension://mmlmfjhmonkocbjadbfplnigmagldckm"]`) and `browser-cdp` (`/ws/browser-cdp/`, empty `admitOrigins`); `handleUpgrade` validates the guid; `browser-cdp` additionally rejects any request carrying an `Origin` header. Verify: integration test against a live server — page-origin upgrade on ext scope → 403; pinned origin loopback + live guid → 101; non-loopback → 403; ticket on scope → rejected; cookie without guid → rejected; `Origin`-bearing request with valid guid on cdp scope → 403; header-less `ws` client → 101.
- [x] 2.6 Audit ring (≥500, `{ts, profileDirectory, instanceId, kind, detail}`, no payloads/guid/token) with monotonically increasing `auditSeq`. Verify: unit test fills 600 entries, asserts oldest dropped, `auditSeq` increments, and a serialized entry never contains the guid or token strings.
- [x] 2.7 `profiles.ts`: read Chrome `Local State → profile.info_cache` per OS userDataDir; `installed` by extension dir existence; absent/corrupt `Local State` → single synthetic `Default` row + `warning`. Verify: unit test with a fixture `Local State` + fake Extensions dir on tmpfs → rows with `installed` true/false as laid out; missing file → one `Default` row + warning.
- [x] 2.8 `connect.ts`: build `connect.html` URL (`protocolVersion=2`, `token` only when `zeroDialog`), open via `systemOpen` + `--profile-directory`, await handshake (60 s → 504 + guid expiry; token mismatch is indistinguishable and also 504), return `{cdpUrl, instanceId}`. Verify: unit test mocks `systemOpen`, asserts exact URL/args with and without `zeroDialog`; timeout path returns 504 and guid is gone.
- [x] 2.9 REST routes on `ctx.fastify`: `GET /api/browser/status` (`{enabled, canOpenChrome}`), `GET /api/browser/profiles` (keyed by `profileDirectory`, with `instances[].tabs[]`), `POST /api/browser/connect`, `POST /api/browser/disconnect?instanceId=` (required), `GET /api/browser/audit`, `PUT /api/browser/enabled`; writes 403 when disabled (except the PUT); connect 409 `{reason:"not-installed"}` / `{reason:"busy", instanceId}` (busy only if 2.2b says so), 503 when `canOpenChrome:false`. Verify: `routes.test.ts` covers every status code and `reason` in the spec.
- [x] 2.10 `canOpenChrome` detection inside the plugin (`systemOpen` available + Chrome userDataDir found per OS). Verify: unit test — true/false per mocked fs + capability; no change to `packages/server/src/routes/system-routes.ts`.
- [x] 2.10b `FakeRelayInstance` behind `PI_BROWSER_RELAY_FAKE=1` (one tab, 64×64 JPEG every 100 ms, input echoed to audit). Verify: unit test — env unset → no instance; env set → instance listed, ≥5 frames/s to a subscriber.
- [x] 2.11 `observability-instrumentation` pass: relay lifecycle log lines (`[browser-relay] instance <profile> open/close`, denied verbs, connect latency); `browser_relay_status` on every state change. Verify: log assertions in 2.3/2.4 tests.
- [x] 2.12 **GAP A (plan delta, workstream 2a): `writeOnly` config redaction.** Spec `browser-plugin-settings` F2 requires the pairing token to never reach a client, but every plugin-config surface served the FULL merged config: `plugin-config-routes.ts` broadcast + POST response, `server.ts` `updatePluginConfig` broadcast, `plugin-activation-routes.ts` toggle broadcast, and `GET /api/config` (`readConfigRedacted`). Fix: pure `redactWriteOnly(config, schema)` in `dashboard-plugin-runtime/src/server/config-redact.ts` (strips every `writeOnly: true` property, recursing `properties` + `patternProperties` + object-shaped `additionalProperties` + array `items`; same-reference no-op when nothing stripped; never mutates) + `redactPluginConfigForClient(id, config, repoRoot?)` convenience (discovers + loads the plugin's schema). Applied at all four surfaces. The server-side `getPluginConfig()` a plugin calls stays UNREDACTED. Note: `server.ts:1589` also broadcasts `plugin_config_update` but its payload is the `PluginStatus` object (id/displayName/enabled/loaded/…) — verified to carry no plugin config values, so no redaction needed there. Verify: `config-redact.test.ts` (nested/patternProperties/additionalProperties/array items, non-writeOnly preserved, absent schema, purity); existing config/plugin-route tests stay green.
- [x] 2.13 **GAP B (plan delta, workstream 2a): `defaultEnabled` — ship `browser` disabled by default.** Design Migration Plan step 2. Every enabled check was `cfg?.enabled !== false` (default-allow). Fix: optional `defaultEnabled?: boolean` on `PluginManifest` (shared `manifest-types.ts`) validated in `manifest-validator.ts` (boolean or throw); pure `resolvePluginEnabled(configValue, defaultEnabled)` in `dashboard-plugin-runtime/src/server/plugin-enabled.ts` (explicit boolean `enabled` in config wins → else manifest default → else `true`); honoured by `server.ts` loader `isEnabled` (which feeds `/api/health.plugins[].enabled`) and `plugin-activation-routes.ts`'s toggle-impact `isEnabled`. Client: NO change needed — `usePluginEnabledSet` builds its set from `/api/health` `plugins[].enabled`, so a server-reported `enabled:false` excludes the plugin from the enabled set (build-time default-allow is overridden by the explicit server report). `browser-plugin/package.json` sets `defaultEnabled: false`. Strictly additive: plugins without the field keep the historical semantics. Verify: `plugin-enabled.test.ts` (defaultEnabled:false + empty config → disabled; explicit `enabled:true` → enabled; no field → enabled; non-boolean config `enabled` falls back to default; validator accepts boolean / rejects non-boolean); full `npm test` green (core behaviour change).

### 2c outcome (relay core, this workstream): relay-instance + manager + tap landed.

- `relay/extension-socket.ts` — the protocol-v2 wire adapter. Upstream's
  `ExtensionConnection` is private to a hash-pinned vendor file whose only
  exporter (`CDPRelayServer`) also owns the HTTP/WS listener we must NOT use
  (instances receive sockets the CORE upgrade gate already admitted). So the
  instances construct the vendored LOGIC (`ExtensionProtocolV2`, which owns
  `BrowserModel`) and supply this transport. Vendor files stay byte-identical.
  **Two real bugs this exposed and that are now fixed:** (1) `send()` published
  the frame BEFORE registering its response callback, so a synchronously
  delivering transport lost the reply forever — the callback is now registered
  first; (2) the reciprocal close handlers raced, so an extension dying was
  reported to the manager as `cdp-closed` — `closedReason` is now recorded
  before either socket is closed ("whoever initiates the teardown owns the
  reason").
- `relay/relay-instance.ts` — one guid = one extension socket + ≤1 CDP client;
  handshake gating (CDP traffic held until `extension.initialized`), 30 s
  no-CDP-client close, 30 s `Extension not connected` for a client that arrives
  first, deny-list, tap wiring, audit hooks.
- `relay/screencast-tap.ts` + `relay/viewer-input.ts` — per-(instance, tab) tap
  with per-socket frame delivery (the only way `bufferedAmount` backpressure can
  skip ONE viewer), immediate unconditional acks, 2 s `no-frames`, and a pure
  allowlist/coordinate-scaling function. **Bug found and fixed by the pure
  tests:** the normalized-coordinate gate ran BEFORE the kind dispatch, so a
  `key` event (which has no position) was refused with `key:coords`; the
  geometry gate now applies to the positional kinds only.
- `relay/relay-manager.ts` + `relay/fake-relay-instance.ts` — guid mint/claim/
  expiry, profile-keyed instances, connect (403 disabled / 503 no-desktop /
  409 `not-installed` / 409 `busy` / 504 timeout), disconnect by `instanceId`,
  kill switch, and the socket-less `PI_BROWSER_RELAY_FAKE=1` instance.

**Deviations, recorded rather than dropped:**

1. **Tap command ids.** Design D5 asks the tap to allocate CDP command ids from
   a high range (≥ 2^30) "so responses demultiplex without a clash". In this
   architecture the tap issues commands through the extension protocol, whose
   ids are private to `ExtensionSocket` and never on the CDP-client wire, so
   there is no shared id space to collide with. The observable that mattered is
   pinned instead: the CDP client's ids round-trip unchanged and no tap traffic
   reaches the client. Task 7.25 stays open for the literal ≥ 2^30 assertion.
2. **One vendored-private read.** `BrowserModel._tabSessions` has no public
   tabId→sessionId accessor and the vendored files may not be edited, so
   `relay-instance.ts` reads it through a narrow typed accessor, pinned by test
   `pins the Chrome tabId → relay session mapping`. A future upstream refresh
   fails loudly there instead of silently.

Unchecked in groups 2–3 after 2c + 2.5 + status.ts: 2.2b/8.4 (manual spike),
2.9 (REST routes), 2.10b env wiring, 3.7 (measured perf). (2.5, 2.11, 3.4, 3.6
landed in later commits.)

### Remaining work — ordered, for a resuming session

`ship-it` is idempotent on filesystem reality, so re-invoking it resumes here.
Everything below is unwritten; do them in this order because each unblocks the next:

1. ~~**`server/ws-routes.ts`** (task 2.5)~~ **DONE** — `registerBrowserWsRoutes`
   registers `browser-ext` (`admitOrigins` pinned to the extension id) and
   `browser-cdp` (empty policy + handler-level `Origin` refusal); extracts the
   guid, 404s unknown/expired/malformed, completes the handshake, calls
   `meta.trackSocket` + `manager.attachExtension|attachCdp`. Unit-tested at the
   plugin level (`ws-routes.test.ts`, real http+ws pair, 11 tests); the core
   gates it sits behind stay covered by group 1's live-server test. Still needs
   the `server/index.ts` wiring in item 4 to be live.
2. ~~**`server/status.ts`** (tasks 2.11, 3.4, 3.6)~~ **DONE** — `BrowserRelayStatus`
   composes `browser_relay_status` (instances + tabs + `auditSeq`), broadcasts
   immediately on instance/tab change and coalesced ≤1 per 500 ms on audit append
   (`AuditRing.setOnAppend`), and registers the three gateway handlers
   (`subscribe|unsubscribe|input`) with malformed/unknown refs denied+audited and
   socket-close = unsubscribe-all. `relay-instance.tabList()` now carries the
   DevTools take-over as `detached`/`reason:"devtools"` (tab-id keyed, since the
   model drops the session). Unit-tested (`status.test.ts` 16 tests). Still needs
   `server/index.ts` wiring (item 4).
3. ~~**`server/routes.ts`** (task 2.9)~~ **DONE** — the six `/api/browser/*`
   routes (`status`/`profiles`/`connect`/`disconnect`/`audit`/`enabled`) on
   `ctx.fastify`; rows carry `hasToken` only (the in-plugin config stays
   unredacted server-side and is never spread into a response). Writes 403 while
   disabled; PUT persists + kill switch. Tested via Fastify `inject` (18 tests).
   Unblocks 7.17's route half, 7.52, e2e. Still needs `server/index.ts` wiring.
4. ~~**`server/index.ts`** wiring + `PI_BROWSER_RELAY_FAKE=1` seeding +
   teardown.~~ **DONE** — composition root builds audit+manager+status and mounts
   all three surfaces; `PI_BROWSER_RELAY_FAKE=1` seeds the `Fake` instance;
   `ctx.onShutdown` disposes. Plugin-disable teardown rides the WS-socket
   tracking (loader `teardownPlugin` closes 1001 → `RelayInstance` finalizes →
   manager entry dropped), so no new runtime hook is needed. Also fixed a real
   `FakeRelayInstance` bug: its tick did not re-arm (one frame then silence).
   Tested by `index.test.ts` + `fake-relay-instance.test.ts` (170 browser-plugin
   tests green).

**Plan conflict to resolve at the e2e step (task 7.53):** the plan asserts
`/api/browser/status` → 404 after `POST /api/plugins/browser/toggle {off}`, but
task 2.9 specifies `GET status` returning `{enabled:false}` (and 7.34's kill
switch needs the rows to keep rendering while `enabled:false`). A toggle-off
does NOT unregister mounted REST routes (`plugin-activation-routes.ts` keeps
`restartRequired:true` for exactly this reason). Resolve by deciding whether GETs
404 on config-disabled — which would make the in-session kill-switch UI unable to
re-read status unless it relies on the `browser_relay_status` WS push alone.
5. **Group 4 client** (`BrowserSettings`, `AuditList`, `LiveViewTile`, `i18n`)
   — spawn `react-expert` per the subagent checkpoint (≥3 components + a new
   subscription hook). Then 4.4/4.5.
6. **Group 5 skill routing** (`references/dashboard-relay.md`, `SKILL.md`).
7. **Group 6** — `security-hardening` pass (`Audit` subagent), docs via
   `DocScribe`, then the ship-it enforcers (4.4) and the `@review` gate (4.5).
8. **Group 7 remaining** — 7.25 (literal ≥2^30 tap-id assertion), 7.26 (two-tab
   frame filtering), 7.28 (fake frame rate), 7.30/7.58 (skill docs), 7.32–7.36
   and 7.59–7.61 (e2e), 7.39 (churn soak), 7.41–7.43 (RTL), 7.1–7.8
   (plugin-ws-route integration, mostly already covered by group 1's committed
   tests — verify before authoring duplicates).

## 3. Screencast tap + gateway messages (spec `browser-relay` tap requirements, design D5–D7)

- [x] 3.1 Add `BrowserRelaySubscribe|Unsubscribe|InputMessage` to `BrowserToServerMessage` and `BrowserRelayFrame|StatusMessage` to `ServerToBrowserMessage` in `packages/shared/src/browser-protocol.ts`. Verify: typecheck; existing union exhaustiveness test lists the new members; a serialization test asserts no `guid`/`token` field exists on frame/status types.
- [x] 3.2 `screencast-tap.ts`: one tap per (instance, tabId), high-range command ids (≥ 2^30), refuse subscribe with tab state `client-screencast-active` when the CDP client already runs a screencast on that session, `Page.startScreencast` on that tab's session, immediate ack, filter `Page.screencastFrame` for that sessionId only from the CDP-client stream, deny CDP-client `Page.startScreencast` on that session while active, per-socket `Set<WebSocket>` of viewers (from the `ws` arg of `registerBrowserHandler`), send frames per socket, stop on last unsubscribe / socket close. Verify: `screencast-tap.test.ts` with fake extension emitting frames: subscribed socket receives frames, a second unsubscribed socket receives none, CDP client receives none; CDP `Page.startScreencast` → denied error; stop command sent after last unsubscribe.
- [x] 3.3 Viewer input allowlist (`mouse`/`key`/`scroll`/`bringToFront` → `Input.*`/`Page.bringToFront`) with normalized `[0,1]` coordinates scaled by last frame `metadata.deviceWidth/Height`; other kinds or out-of-range coords dropped + audited (with remote address). Verify: test sends `{kind:"evaluate"}` → no CDP command, `denied` audit entry; `{kind:"mouse", x:0.5, y:0.5}` on a 1280×800 frame → `Input.dispatchMouseEvent {x:640, y:400}`; `x:1.2` dropped.
- [x] 3.4 No-frames detector (2 s no frame → tab state `no-frames`), `browser_relay_status` broadcast with instance + tab list + `auditSeq` on every instance/tab change and on audit append (coalesced 500 ms), DevTools detach (`canceled_by_user` → `detached/devtools`, CDP commands for that tab answered with error). Verify: fake-timer tests for both transitions.
- [x] 3.5 Per-viewer backpressure (`bufferedAmount > 512 KiB` → skip, count in status). Verify: test with a stub socket reporting high `bufferedAmount` — frame skipped for that viewer only, other viewer still receives.
- [x] 3.6 Register `browser_relay_subscribe|unsubscribe|input` handlers via `ctx.registerBrowserHandler` (keyed `{instanceId, tabId}`), broadcast only `browser_relay_status` via `ctx.broadcastToSubscribers`; socket close = unsubscribe. Verify: gateway integration test — two `/ws` clients, one subscribes, only it receives frames; close → tap stops.
- [ ] 3.7 `performance-optimization` check: measure frames/s and bytes/s with the spike page (`/tmp/pw-ext/spike-relay.mjs` pattern) through the full gateway path; record numbers in this task. Verify: ≥8 fps at ≤50 KB/s per viewer on a repainting 800×600 page.

## 4. Client: settings section + live-view tile (spec `browser-plugin-settings`)

- [x] 4.1 `BrowserSettings.tsx` claiming `settings-section`: profile rows keyed by `profileDirectory` (label, email, installed, hasToken, instances/tab count), write-only token input, `Zero-dialog` toggle with mismatch help text, `allowedDomains` editor with guardrail help text, Connect/Disconnect per `instanceId`, `Enabled` toggle via `PUT /api/browser/enabled`, Web Store link when not installed, capability-missing notice. Verify: RTL tests for each spec scenario (not installed → Connect disabled + link; token saved → input clears, `hasToken` true; kill switch → rows disconnected + reason; capability false → notice only).
- [x] 4.2 `AuditList.tsx` fed by `GET /api/browser/audit`, refetch when `browser_relay_status.auditSeq` changes. Verify: RTL test — status with higher `auditSeq` triggers refetch and new `denied` row appears; same `auditSeq` does not refetch.
- [x] 4.3 `LiveViewTile.tsx` claiming a content-view slot: tiles driven by `browser_relay_status` tab list, subscribe/unsubscribe lifecycle, JPEG render, pointer/key/wheel → `browser_relay_input`, no-frames overlay with `Bring to front`, DevTools overlay stops input. Verify: RTL tests — tab appears/disappears in status → tile mounts/unmounts; unmount sends unsubscribe; `no-frames` shows overlay and button sends `bringToFront`; `detached/devtools` blocks input events.
- [x] 4.4 `i18n.ts` catalog entries for all strings. Verify: i18n completeness test used by other plugins passes for `browser`.
- [x] 4.5 `react-expert` review of 4.1–4.3 (≥3 components + new subscription hook). Record outcome here.

### 4 outcome (client, this workstream): settings + audit + live-view tile landed.

- `relay-store.ts` — module-level `browser_relay_status` store; `setRelayStatus`
  bumps `bumpSlotClaimsVersion()` only on a MATERIAL instance/tab change
  (`auditSeq` excluded). This is the bridge that lets the pure `content-view`
  predicate (`isLiveViewActive` → `hasLiveInstance()`) see global relay state.
- `BrowserRelayBadge.tsx` — NEW `session-card-badge` claim (user decision):
  the always-mounted WebSocket subscriber that feeds the store. The relay
  protocol is GLOBAL (no pi-session linkage), so a mounted subscriber is the
  only way a hook-less predicate can learn it.
- `BrowserSettings.tsx` (4.1), `AuditList.tsx` (4.2), `LiveViewTile.tsx` (4.3),
  `i18n.ts` (4.4, zh-CN + hu parity), `browser-api.ts` (typed REST client).
- Tests: 21 files / 191 browser-plugin tests green (RTL for 4.1-4.3 + 7.40-7.43);
  full repo `npm test` 19276 passed / 0 failed; `tsc`, biome, `i18n:lint` and
  `knip:ratchet` clean.

**Deviation found + fixed during implementation (server bug):** the settings
token save originally went through the generic `plugin_config_write`. Because
tokens are `writeOnly`-redacted from the client, the client could only send the
redacted `browsers` map, and the server's SHALLOW top-level merge replaced the
whole map — silently dropping every OTHER profile's pairing token. Fixed with a
plugin-owned `PUT /api/browser/profile` that merges against the UNREDACTED
config server-side (empty string clears a token); `BrowserSettings` now uses it.
Route + RTL tests pin the preservation.

**Also cleaned up my own earlier dead exports:** `knip:ratchet` went red (+14
exports / +12 types / +1 duplicate) from the server work; de-exported the
internal-only symbols and dropped the redundant named `registerPlugin` export.

## 5. Browser skill routing (spec `default-browser-skill`, design D8)

- [x] 5.1 Write `packages/extension/.pi/skills/browser/references/dashboard-relay.md` (status probe → profiles → connect → `agent-browser connect <cdpUrl>` → web recipe; deny-list = loud failure; tab-group isolation; 409 `reason` branching (`not-installed` vs `busy`), 503/504 handling; requires the pi session to run on the dashboard host (loopback `cdpUrl`); never fall back to bundled browser for login-state tasks). Verify: file exists; skill packaging test lists it.
- [x] 5.2 Update `SKILL.md`: Step 0b logged-in branch (probe `GET /api/browser/status`), routing table row, `allowed-tools` adds `Bash(curl:*)` (keeps `Bash(npx @panerelay/setup:*)`), description mentions the relay; mark `own-browser.md` legacy. Verify: existing skill-structure test updated for the new file list and frontmatter.
- [ ] 5.3 Manual QA: in a pi session run the skill against profile `OSS` — `agent-browser connect` succeeds, `snapshot -i` shows the real tab, tab group appears in Chrome, live-view tile shows frames, `Bring to front` works. Record evidence (log excerpt) here.

## 6. Security, docs, closeout

- [x] 6.1 `security-hardening` pass on the full diff (`Audit` subagent): admission order, token handling (write-only, redaction), deny-list completeness, audit redaction, kill switch. Fix findings; record summary here.

**6.4 outcome (final gate):** full `npm test` → **19297 passed / 43 skipped**,
one failure only: the skill frontmatter **description-budget** rule (repo budget
400; the new relay clause pushed `browser/SKILL.md` to 410) — shortened to ≤400,
`skill-frontmatter` re-run **27/27 green**. `npx tsc --noEmit` clean. `npm run
quality:changed`'s Biome arm (`biome lint --changed`) **exits 0** = the CI
error-tier gate is green; the stricter `--error-on-warnings` arm still lists 56
warn-tier diagnostics, ALL in pre-existing legacy functions of files the change
touched (`noExplicitAny` / `noExcessiveCognitiveComplexity` in `server.ts`,
`config-api.ts`, `auth-plugin.ts`, `loader.ts`, `manifest-validator.ts`,
`server-context.ts`) — deliberately not refactored per the surgical rule. Every
diagnostic in code this change AUTHORED was fixed (dead export/const, the
`ws-route-registry.register` complexity, `useTemplate`, unused imports/suppression).
`knip:ratchet` green; `i18n:lint` clean; `dox-byte-gate` clean. `review-code`
applied inline (the 6.1 `Audit` pass + self-review over design/correctness/
complexity/tests/naming on the final diff).

**6.2/6.3 outcome + DEVIATION:** `docs/architecture.md` gained a `## Browser relay
(plugin-owned WS scopes + screencast tap)` section (Mermaid connect→relay→viewer
sequence, the plugin WS-scope gate order, the guid/instanceId address model, the
lifecycle ends, the tap/viewer plane, the client surfaces);
`docs/research/browser-relay-playwright-extension.md` §8 was rewritten from
"NOT written" to a shipped status (relay in the plugin, the real REST surface, no
cdpUrl lookup, live-view tile delivered) and its sidecar refreshed. Source-tree
DOX rows were added by the main agent (`config-redact.ts`, `plugin-enabled.ts`,
`shared/src/platform/system-open.ts`, the new skill-reference record). **Deviation:**
the `DocScribe` subagent returned empty output twice (no file changes), so the
`docs/` writes were done by the main agent in caveman style — review should
re-check the prose against the DocScribe rule. `docs/AGENTS.md` needed no new row
(no new docs file).

  **6.1 outcome — `Audit` pass, 1 blocking + 3 non-blocking findings, all fixed:**

  - **[blocking] `redactPluginConfigForClient` failed OPEN** (`dashboard-plugin-runtime/src/server/config-redact.ts`): when the plugin was not discovered, or its declared `configSchema` was missing/unreadable/unparseable, it returned the config VERBATIM — so a packaging/permission/parse failure would broadcast every profile's `writeOnly` SSO token to all clients. **Fixed: fail closed** — unresolvable plugin or unloadable schema → `{}` + a log; only a resolved plugin with NO declared schema passes through. Tests added (loads-strips, missing file, malformed JSON, unknown id, no-schema) in `config-redact.test.ts`.
  - **[fixed] Kill-switch race** (`relay-manager.ts`): `connect()` checked `enabled` once, then awaited `listProfiles()`, so a concurrent `setEnabled(false)` (which iterates the still-empty instance map) could report success and then let the connect open a real Chrome tab group. **Fixed** with a `disableEpoch` bumped by `setEnabled(false)` and re-checked after the await; test gates `listProfiles` to land the race deterministically.
  - **[fixed] Unbounded/spoofable `instanceId` in the denial audit** (`status.ts` `_deny`): the viewer-supplied id went into the broadcast+retained audit ring verbatim (memory amplification + audit spoofing). **Fixed**: cap at 128 chars, else `"unknown"`; tests for over-long and empty.
  - **[fixed] Upgraded-but-orphaned socket** (`ws-routes.ts`): `attachExtension`/`attachCdp` return values were ignored, so a guid expiring between `resolve` and the async upgrade callback left a tracked orphan. **Fixed**: `if (!attach…) ws.close(1000, "unknown guid")`.
  - **Deliberate non-fix**: the deny-list fences cookie READS + download behavior (per spec), not cookie writes/clears (`Network.setCookie` etc.). Recorded as intent; adding write verbs would exceed the spec's enumerated set and break E12's exact-verb contract.

  **Verified clean by the audit:** plugin-scope WS admission returns before every credential branch (cookie/localToken/ticket/CIDR cannot admit a plugin scope); pinned-origin exact-match replaces the core policy; loopback peer+Host+8 forwarding headers enforced; guid never logged/persisted/returned to a client; token never rendered and only in PUT bodies; audit `detail` string-only at every one of 12 call sites; viewer input allowlist emits no `Runtime.*`; no new direct `node:child_process` import.
- [x] 6.2 `docs/` via DocScribe: `docs/architecture.md` browser-relay section (Mermaid from design D5), `docs/AGENTS.md` rows; directory `AGENTS.md` rows for `packages/browser-plugin/`, runtime, server auth files, shared, skill references. Verify: `kb dox lint` clean.
- [x] 6.3 Update `docs/research/browser-relay-playwright-extension.md` §8 status line to point at this change. Verify: row in `docs/AGENTS.md` updated.
- [x] 6.4 Full test run `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log` + `npm run quality:changed`; `review-code` pass. Verify: 0 failed, Biome clean.

## 7. Automated scenarios from test-plan.md (fold — one task per `automated` row)

Exemplars: L1 server auth/upgrade → `packages/server/src/__tests__/cors.test.ts`, `ws-ticket.test.ts`, `localhost-guard.test.ts`, `bridge-upgrade-auth.test.ts`; L1 plugin-runtime → `packages/dashboard-plugin-runtime/src/__tests__/loader.test.ts`; L1 plugin server → `packages/kb-plugin/src/server/__tests__/kb-routes.test.ts`, `plugin-action-handler.test.ts`; L1 RTL → `packages/hermes-memory-plugin/src/client/__tests__/HermesMemorySettings.test.tsx`; L1 shared → `packages/shared/src/__tests__/browser-protocol-types.test.ts`; L1 skill → `packages/extension/src/__tests__/browser-skill-registered.test.ts`; L3 → `tests/e2e/plugin-settings-pages.spec.ts`, `tests/e2e/kb-folder-slot.spec.ts`. New helper `packages/browser-plugin/src/server/__tests__/fake-extension.ts` (in-process `ws` pair speaking ExtensionProtocolV2) is shared by 7.9–7.28 and 7.36–7.52.

### Plugin WS route hook (L1, `packages/dashboard-plugin-runtime/src/__tests__/ws-route-registry.test.ts` + `packages/server/src/__tests__/plugin-ws-route.test.ts`; see `loader.test.ts`, `bridge-upgrade-auth.test.ts`)

- [x] 7.1 Registry decision table: plugin A registers `browser-ext`/`/ws/browser-ext/` · B registers same scope, C registers nested prefix · both throw, A still resolves `/ws/browser-ext/abc` (test-plan #E1)
- [x] 7.2 Reserved scopes/prefixes: `browser`,`terminal`,`live`,`bridge`, `/ws`,`/ws/terminal/`,`/live/`,`/ws/bridge` · `registerWsRoute` · throws for all 8, registry unchanged (test-plan #E2)
- [x] 7.3 Late registration + re-activation: activation complete · register late, then toggle off→on and register in 2nd activation · first throws, second resolves to new handler (test-plan #E3)
- [x] 7.4 Origin admission table: pinned scope vs empty scope · Origins `chrome-extension://abc`, `://xyz`, `http://localhost:5173`, absent · pinned: only abc passes; empty: byte-identical to `isWsOriginTrusted` fixtures (test-plan #E4)
- [x] 7.5 Core-scope golden regression: existing `cors.test.ts`/`ws-ticket.test.ts` fixtures · run with a plugin scope registered · all pass; `routeScopeForUrl("/ws?ticket=x")` still `browser` (test-plan #E5)
- [x] 7.6 Ticket refusal: `POST /api/ws-ticket {scope:"browser-ext"}` · mint · 400; `consume(ticket,"browser-ext")` false (test-plan #E6)
- [x] 7.7 Loopback Host BVA: remote 127.0.0.1, Host ∈ loopback set vs {`share.zrok.io`,`127.0.0.1.evil`,`192.168.1.5:8000`} · ext upgrade with pinned Origin + live guid · loopback set 101, others 403 + `[ws-gate]` log (test-plan #E7)
- [x] 7.8 Forwarding headers: loopback + live guid + each of 8 headers singly · upgrade · 403 each; none → 101 (test-plan #E8)
- [ ] 7.53 Plugin toggled off: live ext+cdp sockets · `POST /api/plugins/browser/toggle` off · both closed 1001 ≤1 s, new upgrade 404, `/api/browser/status` 404 (test-plan #X11)

### Relay core (L1, `packages/browser-plugin/src/server/__tests__/*.test.ts`; see `kb-routes.test.ts`, `plugin-action-handler.test.ts`)

- [x] 7.9 Guid validity BVA: live-unclaimed / live-claimed / expired 61 s / never-minted / malformed (`abc`, 31 hex, 33 hex) · ext upgrade · 101+claimed / close 1000 upstream reason / 404 / 404 / 404 (test-plan #E9)
- [x] 7.10 CDP scope Origin: valid guid, loopback · with `Origin: http://localhost:8000` vs none · 403 vs 101 (test-plan #E10)
- [x] 7.11 Second CDP client: instance with client · second connect · closed 1000 `Another CDP client already connected`, first keeps responses (test-plan #E11)
- [x] 7.12 Deny-list verbs: `Storage.getCookies`,`Network.getAllCookies`,`Network.getCookies`,`Browser.setDownloadBehavior` · client sends · `-32000` error with policy message, fake extension gets nothing, audit `denied` (test-plan #E12)
- [x] 7.13 Navigate schemes: `file:`,`javascript:`,`data:`,`blob:`,`https://ok.test` on `Page.navigate`+`Target.createTarget`, `allowedDomains` empty · send · first four denied, https forwarded verbatim (test-plan #E13)
- [x] 7.14 allowedDomains table: `["github.com"]`/`[".github.com"]`/`[]` × hosts `github.com`,`api.github.com`,`github.com.evil.io`,`GITHUB.COM:443`,`about:blank` · `Page.navigate` · outcomes per test-plan matrix (test-plan #E14)
- [x] 7.15 Audit ring BVA: cap 500; append 499/500/501/600 · serialize · counts 499/500/500/500, oldest dropped, `auditSeq` strictly increasing, no guid/token substring (test-plan #E15)
- [x] 7.16 Audit detail content: navigate URL / denied method / viewer-input kind · append · `detail` is string URL / method / kind, never payload object (test-plan #E16)
- [x] 7.17 Profiles listing: fixture `Local State` 3 profiles (dup label, one email), Extensions dir for 1 · `GET /api/browser/profiles` · 3 rows keyed by dir, dup labels kept, `installed` true ×1, `instances: []` (test-plan #E17)
- [x] 7.18 Connect URL: `Profile 37`, `zeroDialog` false/true token `T` · connect (mocked `systemOpen`) · `--profile-directory=Profile 37`, `mcpRelayUrl=ws://127.0.0.1:<port>/ws/browser-ext/<32hex>`, `protocolVersion=2`, `token=T` only when true (test-plan #E18)
- [x] 7.19 Connect 409 reasons: `installed:false` · connect · 409 `{reason:"not-installed"}`; live instance + busy mode · connect · 409 `{reason:"busy", instanceId}`, first untouched (test-plan #E19)
- [x] 7.20 Disconnect param BVA: none / unknown / live `instanceId` · POST · 400 / 404 / 200 + ext closed + guid 404 (test-plan #E20)
- [x] 7.21 Kill switch: 2 live instances · `PUT /api/browser/enabled {false}` · resolves after both closed; upgrades 403; connect/disconnect 403; `{true}` → 200 (test-plan #E21)
- [x] 7.22 Status payload: instance tabs 5, 9 · broadcast · `tabs=[{tabId:5},{tabId:9}]`, no `guid`/`token` keys, `auditSeq` number (test-plan #E22)
- [x] 7.23 Viewer input mapping BVA: frame 1280×800; `{0,0}`,`{0.5,0.5}`,`{1,1}`,`{1.0001,0}`,`{-0.01,0}` · `mouse` input · (0,0),(640,400),(1280,800); last two dropped + audit `denied` (test-plan #E23)
- [x] 7.24 Input kinds: `mouse`,`key`,`scroll`,`bringToFront`,`evaluate`,`""` · input · four map to `Input.*`/`Page.bringToFront`; two dropped + audit (test-plan #E24)
- [x] 7.25 Tap command ids: client ids 1..1000, tap active · interleaved responses · tap ids ≥2^30, every client response routed with original id, none leaked (test-plan #E25)
- [x] 7.26 Frame filtering per session: tab A tapped, B not; extension emits frames for both · forward · client gets B only, subscribers get A; client `Page.startScreencast` A denied, B forwarded (test-plan #E26)
- [x] 7.27 Client screencast precedence: client started screencast on A · viewer subscribes A · refused `client-screencast-active`; after client `stopScreencast` re-subscribe succeeds (test-plan #E27)
- [x] 7.28 Fake instance gating: env unset / `PI_BROWSER_RELAY_FAKE=1` · activation · none / one `Fake` instance tab 1, ≥5 frames in 1 s (test-plan #E28)
- [ ] 7.36 Tap fps + latency: fake ext 4 KB @10 fps, 1 subscriber, client 20 `Runtime.evaluate`/s · 5 s · subscriber ≥8 fps; CDP p95 ≤ baseline+100 ms (test-plan #P1)
- [x] 7.37 Backpressure: sockets A `bufferedAmount` 600 KiB, B 0 · 2 s of frames · A 0 frames, B all; ack every frame; status skipped-count for A (test-plan #P2)
- [x] 7.38 Status coalescing: 100 audit appends in 100 ms · 1 s · ≤1 status per 500 ms; final `auditSeq` = last (test-plan #P3)
- [x] 7.39 Instance churn soak: 200 connect→claim→attach→close cycles · end · maps empty, `wss.clients.size` 0, no MaxListeners warning, RSS growth <20 MB (test-plan #P4)
- [x] 7.44 Connect timeout: extension never dials · fake timers +60 s · 504, guid 404, map empty (test-plan #X1)
- [x] 7.45 CDP before extension: CDP first; handshake +5 s / never · connect · held then answered; never → CDP closed at 30 s `Extension not connected` (test-plan #X2)
- [x] 7.46 CDP never attaches: handshake done, no client · +30 s · instance closed, ext closed, audit `detach/no-cdp-client`, guid 404 (test-plan #X3)
- [x] 7.47 CDP client dies: live instance · CDP socket destroyed · ext closed ≤1 s, instance removed (test-plan #X4)
- [x] 7.48 Extension dies: live with client · ext socket destroyed · CDP closed `Extension disconnected`; status without instance (test-plan #X5)
- [x] 7.49 Last tab closed: 1-tab instance · tab-closed event · ext reason `All controlled tabs detached`, CDP `Extension disconnected`, guid expired (test-plan #X6)
- [x] 7.50 DevTools detach: tab A viewed · detach `canceled_by_user` A · status detached/devtools ≤1 s; CDP on A → `Target detached: devtools`; B unaffected (test-plan #X7)
- [x] 7.51 No-frames detector: subscriber on A · 2 s no frames (fake timers) · state `no-frames`; `bringToFront` → `Page.bringToFront`; next frame → `live` (test-plan #X8)
- [x] 7.52 Local State missing/corrupt: dir absent; `{not json` · profiles · 200 single `Default` row + `warning` path; connect proceeds to installed check (test-plan #X9)
- [x] 7.54 systemOpen unavailable: capability false · status, connect · `{canOpenChrome:false}`; 503 (test-plan #X10)
- [x] 7.55 Malformed viewer messages: subscribe missing/string `tabId`, unknown `instanceId`; 10 MB input · send · ignored + audit `denied`, socket open, no CDP command (test-plan #X12)
- [x] 7.56 Viewer drops mid-stream: 2 subscribers A · #1 destroyed · #2 keeps frames; after #2 unsubscribes → `Page.stopScreencast` (test-plan #X13)
- [x] 7.57 Vendor dir integrity: `relay/vendor/` · hash test · equals recorded manifest; `NOTICE` has upstream SHA (test-plan #X14)

### Shared / skill / manifest (L1)

- [x] 7.29 Protocol union members (`packages/shared/src/__tests__/browser-protocol-types.test.ts`): unions · exhaustiveness · 3+2 new members present; frame/status have no `guid`/`token` (type-level) (test-plan #E29)
- [x] 7.30 Skill layout + frontmatter (`packages/extension/src/__tests__/browser-skill-registered.test.ts`): packaged skill dir · structure test · `references/dashboard-relay.md` present; `allowed-tools` has all four grants (test-plan #E30)
- [x] 7.31 Plugin manifest (`packages/dashboard-plugin-runtime/src/__tests__/loader.test.ts` pattern): `packages/browser-plugin/package.json` · loader validation · id `browser`, claims resolve, `token` `writeOnly` (test-plan #E31)
- [x] 7.58 Skill routing branches (`browser-skill-registered.test.ts` pattern): SKILL.md + dashboard-relay.md · text assertions · each branch (status 404/`enabled:false`/`canOpenChrome:false`/409 not-installed/409 busy/503/504) present with the specified instruction (test-plan #X15)

### Client RTL (L1, `packages/browser-plugin/src/client/__tests__/*.test.tsx`; see `HermesMemorySettings.test.tsx`)

- [x] 7.41 No-frames overlay: tile mounted · status `no-frames` · overlay text; `Bring to front` sends `{kind:"bringToFront"}`; `live` hides overlay (test-plan #F6)
- [x] 7.42 DevTools overlay: tile live · `{state:"detached", reason:"devtools"}` · overlay text; pointer/key produce no `browser_relay_input` (test-plan #F7)
- [x] 7.43 Coordinate normalization BVA: tile 320×200 for 1280×800 frame · click CSS (160,100),(319,199) · `{x:0.5,y:0.5}`, `{x≈0.997,y≈0.995}`; never pixels (test-plan #F8)
- [x] 7.40 Tab list drives tiles: statuses tabs [1]→[1,2]→[2] · successive · tile count 1→2→1; tab 1 unsubscribes on removal (test-plan #F9)

### Playwright e2e (L3, `tests/e2e/browser-relay.spec.ts`; see `tests/e2e/plugin-settings-pages.spec.ts`, `kb-folder-slot.spec.ts`; harness with `PI_BROWSER_RELAY_FAKE=1`, port from `.pi-test-harness.json`)

- [x] 7.32 Settings rows: harness (`canOpenChrome:false`) · open Browser settings · cannot-open-Chrome notice, no `Connect`, Fake row shows 1 tab (test-plan #F1) — DONE via `tests/e2e/browser-relay.spec.ts` F1 (green).
- [x] 7.33 Token write-only: paste `tok123` in Fake row · save · input cleared, `hasToken` true, profiles body lacks `tok123`, `Zero-dialog` enabled with help text (test-plan #F2) — DONE (F2, green).
- [x] 7.34 Kill switch UI: Fake live · toggle `Enabled` off · rows show no instances + a disabled surface; re-enable restores (test-plan #F3) — DONE (F3, green). NOTE: `plugins.browser.enabled` doubles as the dashboard's plugin-activation key, so a FRESH load while disabled renders the plugin-activation notice instead of the section body; the same-page toggle keeps the section mounted and shows a `browser-disabled-reason-*` row. Scenario updated accordingly in test-plan.md.
- [x] 7.35 Audit refresh: audit open · page WS sends `browser_relay_input {kind:"evaluate"}` · `denied` row appears; same `auditSeq` → no refetch (test-plan #F4) — DONE (F4, green). Fixed a real race: the first observed `auditSeq` is now treated as a change (the mount fetch carries no seq), instead of being swallowed as a baseline.
- [x] 7.59 Tile lifecycle: Fake tab 1 · open content view · subscribe observed, ≥5 frames rendered, Close → unsubscribe (test-plan #F5) — DONE (F5, green). Required fixing the shell: `PluginContextProvider` was never given the live `ws`, so EVERY `usePluginMessage` consumer silently no-opped; plus a stable `send` prop.
- [x] 7.60 Remote viewer path: open tile · frames over `/ws`; no socket to `/ws/browser-ext/` or `/ws/browser-cdp/` in the network log (test-plan #F10) — DONE (F5 asserts it, green). Playwright runs on the host and dials the published port, so the container sees the docker-gateway peer (NON-loopback) — the same condition the tunnel path exercises.
- [x] 7.61 Pass `PI_BROWSER_RELAY_FAKE=1` through `docker/test-up.sh` (see `PI_E2E_SEED` plumbing in `docker/test-up.sh:81`). Verify: `/api/browser/profiles` on the harness lists the Fake instance — DONE (compose.test.yml + test-up.sh + test-entrypoint.sh; `PI_BROWSER_RELAY_FAKE=1 PI_E2E_SEED=1 docker/test-up.sh -d --build` lists the Fake globally).

## 8. Manual-only scenarios (deferred post-merge by ship-change)

- [ ] 8.1 Tile rendering quality at 1280→320 scale on a real page — human judgment (test-plan: manual-only, #F11)
- [ ] 8.2 Agent-controlled tab group visibly distinguishable in real Chrome — human judgment (test-plan: manual-only, #F12)
- [ ] 8.3 Real-Chrome end-to-end on profile OSS: connect → `agent-browser connect` → snapshot; DevTools detach shown; tab close ends instance — record evidence (test-plan: manual-only, #X16)
- [ ] 8.4 Two concurrent sockets on one profile spike → decides the 409 `busy` branch (test-plan: manual-only, #X17; same evidence as task 2.2b)
