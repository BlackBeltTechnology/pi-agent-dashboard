## Context

See proposal.md — Why. Research and live-spike evidence: `docs/research/browser-relay-playwright-extension.md` (§2 mechanics, §4 security, §6 tap, §7 spike numbers).

Constraints that shape the design:

- Core upgrade handler (`packages/server/src/server.ts:2521`) routes strictly on `WsRouteScope` (`auth/ws-ticket.ts:30`, closed union) after host-gate → `isWsOriginTrusted` → auth. MV3 extension sockets carry `Origin: chrome-extension://<id>` and are rejected by today's origin policy.
- `ServerPluginContext` (`dashboard-plugin-runtime/src/server/server-context.ts`) has no upgrade hook. User chose: extend the runtime, relay lives in the plugin.
- Stock Playwright extension (Web Store 0.4.0) is loopback-only (`connect.tsx:61`), requires `protocolVersion=2`, token per profile in extension-origin `localStorage`, tab group per socket, `chrome.debugger` = one session per tab, `chrome.windows.create` / `chrome.tabs.update` not allow-listed.
- Upstream relay (`playwright-core/src/tools/mcp/{cdpRelay,cdpRelayV2,browserModel}.ts`) is one-extension + one-CDP-client per instance; multi-client = multiple instances.
- Chrome profile registry source: `Local State → profile.info_cache` (17 profiles on the dev host; labels + emails, zero permissions). Reach: `open -na "Google Chrome" --args --profile-directory=<dir> <url>` works with Chrome running (verified).

## Goals / Non-Goals

**Goals:**
- One plugin package owns relay, REST, gateway messages, settings, live view.
- Plugin runtime upgrade hook is generic (not browser-specific) and keeps every core gate in core.
- Existing browser skill + `agent-browser` unchanged at the tool level; only routing docs change.
- Vendored relay code stays diff-able against upstream for future refresh.

**Non-Goals:**
- Forking the extension (remote Chrome, separate agent window, custom identity).
- Replacing the bundled headless browser for tests/mockups (§15 of the earlier research still holds for hermetic use).
- Persisting guids across server restarts.

## Decisions

### D1 — Upgrade hook shape: `registerWsRoute(scope, opts)` on `ServerPluginContext`

Core keeps a `Map<scope, WsRouteRegistration>`; `routeScopeForUrl` consults the map after the four core prefixes. `WsRouteScope` type becomes `CoreWsRouteScope | (string & {})`; ticket minting (`POST /api/ws-ticket`) and `wsTicketStore.consume` accept only `CoreWsRouteScope`, so plugin scopes are structurally unticketable.

Registration shape: `{ pathPrefix, admitOrigins: readonly string[], handleUpgrade(request, socket, head, meta) }`. Gate order for a plugin scope, all in core: (1) host gate unchanged; (2) origin — if `admitOrigins` is non-empty the request Origin must exactly match one entry (core `isWsOriginTrusted` is **not** consulted, so a loopback page origin cannot reach the extension endpoint); if empty, `isWsOriginTrusted` applies unchanged; (3) peer must satisfy `isGenuinelyLocal(remoteAddress, headers)` **and**, deterministically, the request `Host` must be a loopback host (`127.0.0.1`, `[::1]`, `localhost`, any port) and no proxy-forwarding header (`x-forwarded-*`, `forwarded`, `via`) may be present — so tunnel reachability does not depend on whether zrok injects markers; neither the secret-configured branch (`validateWsUpgrade` cookie) nor the no-secret branch (`verifyLocalToken` / `isBypassedHost` / ticket) runs for plugin scopes. The credential is the plugin's own per-connection secret checked inside `handleUpgrade` (here: the 128-bit guid in the path). The `browser-cdp` registration additionally rejects any upgrade that carries an `Origin` header at all: Playwright / Node `ws` clients send none, browsers always do, so a loopback web page — even one that called `connect` itself and read its own `cdpUrl` — cannot open a CDP socket. Rationale: neither the Chrome extension nor `agent-browser connect` can attach custom headers or dashboard cookies; the guid protects one session's tab group from every other local process, and the no-`Origin` rule keeps the CDP endpoint out of reach of web content. The forwarding-header check reuses `hasProxyForwardingHeaders` from `localhost-guard.ts` **extended** with `via`, `x-forwarded-server`, `x-forwarded-port` (the extension is a behaviour change only for plugin scopes; core callers keep the old list via the existing export). Registration is per activation: a plugin toggled off then on registers again on its new activation — "later" means after the *current* activation completed. Core scopes see zero behaviour change (existing fixtures must pass byte-identical).

Alternatives: (a) relay in core `packages/server/src/browser-relay/` — smaller diff, but user chose plugin ownership; (b) plugin opens its own `http.Server` on a second port — bypasses every core gate and the localhost-guard; rejected.

### D2 — Vendored relay, adapted not rewritten

Copy `cdpRelay.ts`, `cdpRelayV2.ts`, `browserModel.ts`, `protocol.ts`, and the minimal extension-protocol types from `extensionContextFactory.ts` into `packages/browser-plugin/src/server/relay/vendor/` with upstream SHA + Apache-2.0 `NOTICE`; adapt in `relay-instance.ts` via subclass/wrapper, never by editing vendor files, so a future upstream refresh is a re-copy. Changes needed: (1) `BrowserModel._emit` → listener list (tap + CDP client); (2) bypass the built-in `http.Server`/`ws` listener — instances receive already-upgraded sockets from `handleUpgrade` (first implementation task verifies the upstream constructor does not self-listen unconditionally; if it does, the wrapper constructs the inner classes directly instead of `CDPRelayServer`); (3) deny-list interceptor in the CDP-client message path (`Storage.getCookies`, `Network.getAllCookies`, `Network.getCookies`, `Browser.setDownloadBehavior`; `Page.navigate`/`Target.createTarget` denied for `file:`, `javascript:`, `data:`, `blob:` and any URL without a host when `allowedDomains` is non-empty); (4) audit hooks on attach/detach/navigate/createTarget.

### D3 — One `RelayInstance` per guid; the caller keeps its `cdpUrl`

`RelayManager` holds `Map<guid, RelayInstance>` and `Map<profileDirectory, guid[]>`; each instance also carries a short non-secret `instanceId` (for UI/audit addressing — never usable to open a socket). `POST /api/browser/connect` (ordinary dashboard REST auth, same as every other `/api/*` call a skill makes) mints a guid, opens the extension, waits for the handshake and returns `{cdpUrl, instanceId}`. There is deliberately no "look up my cdpUrl" endpoint: the dashboard has no per-pi-session identity on REST calls, so any lookup keyed by profile could hand one local process another session's tab group. The agent holds `cdpUrl` in its own context for the task's duration. Guids minted but never claimed expire when the connect timeout (60 s) fires; claimed instances die with their extension socket. `disconnect` requires `instanceId` (REST callers are unattributable; the settings UI lists instances and disconnects them one by one). An instance also closes when its CDP client socket closes — Playwright disconnect means the task is over — and when no CDP client has attached within 30 s of the extension handshake (agent crashed, or the pi session runs on another host and cannot dial `127.0.0.1`; the skill states the relay requires the pi session to run on the dashboard host); without these a live tab group would sit in the user's Chrome forever. Config and maps are keyed by `profileDirectory` (stable), never by the user-editable label. Multiple sockets from the same profile's single service worker (needed for two sessions on one profile) is an upstream extension feature the research verified only across profiles — a spike task confirms it before relay work proceeds.

### D4 — Profile reach and pairing

`connect` opens `chrome-extension://<id>/connect.html?mcpRelayUrl=ws://127.0.0.1:<port>/ws/browser-ext/<guid>&client={"name":"pi-dashboard"}&protocolVersion=2[&token=]` through the existing `systemOpen` capability with `--profile-directory=<dir>` (macOS `open -na`, Linux/Windows direct binary args). The `token` query param is added only when the profile config sets `zeroDialog: true` (default false → the extension shows its Allow dialog once per connect). A token mismatch is reported by the extension only inside its own page (research §7) — nothing reaches the relay — so mismatch, Reject, and no-answer all surface as the 60 s 504; the settings UI explains this next to the `Zero-dialog` toggle. Extension-absent and profile-busy both use 409 with a `reason` field (`not-installed` | `busy`) so the skill can branch. Accepted exposure: the URL is in Chrome's argv for the launch, visible to same-user `ps` — the same trust boundary as the same-user-readable local token file; the guid is single-claim and expires in 60 s. Port = the dashboard's own listener; extension accepts because host is loopback. Tokens live in `plugins.browser.browsers.<profileDirectory>.token` via the plugin config store; `configSchema.json` marks the field `writeOnly`, and the settings REST read path redacts it. `installed` = `fs.existsSync(<userDataDir>/<profileDirectory>/Extensions/mmlmfjhmonkocbjadbfplnigmagldckm)`; userDataDir per OS (`~/Library/Application Support/Google/Chrome`, `~/.config/google-chrome`, `%LOCALAPPDATA%\Google\Chrome\User Data`).

### D5 — Screencast tap as in-process listener

One `ScreencastTap` per `(instance, tabId)` with at least one viewer. If the CDP client already has a screencast running on that session (the relay tracks its `Page.startScreencast`/`stopScreencast`), the subscribe is refused with tab state `client-screencast-active` rather than silently overriding the client's parameters. It subscribes to the instance's `BrowserModel` listener list, issues `Page.startScreencast {format:"jpeg", quality:50, maxWidth:1280, maxHeight:800, everyNthFrame:1}` on that tab's `pw-tab-N` session via `model.sendCommand` (ids are promise-mapped by `ExtensionConnection`, no clash with Playwright ids), acks every `Page.screencastFrame` immediately, and sends frames **per viewer socket** as `browser_relay_frame`: the tap keeps `Set<WebSocket>` of subscribers captured from the `ws` argument `ctx.registerBrowserHandler` passes to `browser_relay_subscribe` handlers (`ctx.broadcastToSubscribers` is a global broadcast with no targeting — unusable for frames). `browser_relay_status` (instance list, per-instance tab list `{tabId, title, url}` from `BrowserModel`, state, and a monotonically increasing `auditSeq`) IS broadcast, since it is small and every client's settings/tiles need it; it is emitted on every instance/tab change **and** on every audit append (coalesced to at most one per 500 ms), so the audit viewer can refresh on `auditSeq` change. While a tap is active on a tab, `Page.screencastFrame` events **for that sessionId** are filtered out of the CDP-client stream and CDP-client `Page.startScreencast` on that sessionId is denied (Playwright's `CRPage` would otherwise ack and interleave); other tabs are untouched. Command ids: the tap allocates from a high range (≥ 2^30) distinct from the CDP client's forwarded ids, so responses demultiplex without a clash. Viewer input carries **normalized** coordinates (`x, y ∈ [0,1]` of the rendered frame); the relay multiplies by the last frame's `metadata.deviceWidth/deviceHeight` before `Input.dispatchMouseEvent`, so tile scaling on the client never mis-targets. Viewer input maps to `Input.dispatchMouseEvent` / `Input.dispatchKeyEvent` / `Input.synthesizeScrollGesture` / `Page.bringToFront` only. No-frames detector: no frame for 2 s while subscribed → `browser_relay_status {state:"no-frames"}`. Screencast emits only on repaint (spike §7: a visible idle tab also produced 0 frames), so the tile wording is neutral ("No repaints — tab may be idle or in the background") and `Bring to front` is offered either way.

Alternative: second `chrome.debugger` session for the viewer — impossible (one session per tab per extension).

### D6 — Backpressure

Per-viewer (possible because frames are sent per socket, D5): if `ws.bufferedAmount > 512 KiB`, skip the frame for that viewer (count skipped in `browser_relay_status`). Never block the ack, never buffer frames server-side. Spike numbers: ~4 KB/frame, ~10 fps on a repainting page → ~40 KB/s per viewer.

### D7 — Gateway messages via existing browser gateway

`browser_relay_subscribe {instanceId, tabId}|unsubscribe|input` registered through `ctx.registerBrowserHandler` (handler receives the socket → tap tracks it; socket close = unsubscribe); `browser_relay_frame` per-socket, `browser_relay_status` via `ctx.broadcastToSubscribers`. `tabId` is the Chrome integer tab id as reported by `BrowserModel` (the `pw-tab-N` CDP sessionId stays internal). Shared union in `packages/shared` gains these five members (loader spec already requires the `plugin_config_update` pattern for plugin-added members). Relay endpoints never go over the tunnel; the viewer path inherits the gateway's existing auth/tunnel gating.

### D8 — Skill routing

`SKILL.md` Step 0b gains a first branch: intent = "logged-in state" → probe `curl -s localhost:8000/api/browser/status` (`{enabled, canOpenChrome}`, served by the plugin; 404 when the plugin is not loaded) — both true → `references/dashboard-relay.md`; else Panerelay legacy → else halt. No core `/api/health` capability is added: keeping Chrome detection inside the plugin avoids a browser-specific seam in core and lets the status reflect the kill switch. On `connect` 409 the recipe branches on `reason`: `not-installed` → tell the user to install the extension in that profile; `busy` → report the live instance and ask whether to reuse (disconnect) or pick another profile. No `browser_*` tools; `allowed-tools` adds `Bash(curl:*)` and keeps `Bash(npx @panerelay/setup:*)` for the legacy path. `allowed-tools` is advisory (the agent already has Bash); the `pi-dashboard` skill sets the precedent for curl-driven REST.

## Risks / Trade-offs

- [`allowedDomains` is a navigation guardrail, not a sandbox] → only `Page.navigate` / `Target.createTarget` are checked; `Runtime.evaluate` (`location.href=`), link clicks and HTTP redirects can still leave the allowlist. Documented in the spec and settings help text; a full sandbox would need `Page.frameNavigated` policing and is out of scope.
- [Any authenticated dashboard client can view and steer any instance] → accepted: the dashboard is a single-operator trust model (an authenticated client can already open terminals and send prompts); viewer input is limited to the `Input.*` allowlist and every `viewer-input` is audited (kind + method name; `detail` stays URLs/method names only per spec).
- [Kill switch vs. plugin toggle are different mechanisms] → `plugins.browser.enabled` is plugin config: the plugin stays loaded, its own `PUT` handler flips the flag and closes instances synchronously, and its routes answer 403. The loader-level `POST /api/plugins/browser/toggle` unloads the plugin: routes and WS prefixes are torn down (404). Both are specified; they are not the same switch.

- [Relay code drifts from upstream Playwright] → vendor dir + SHA + wrapper-only adaptation; refresh = re-copy + run relay contract tests.
- [Extension auto-update changes protocol version] → `protocolVersion` constant in one place; connect failure surfaces the extension's error text verbatim in `connect` 502 response.
- [Real SSO profile drivable by an agent] → loopback-only endpoints, pinned Origin, per-profile token, deny-list, per-profile `allowedDomains`, kill switch, audit; tab-group colour makes control visible to the user.
- [User opens DevTools on a controlled tab] → detach surfaced as status; CDP errors are loud; extension reattach not attempted (upstream only reattaches on `target_closed`).
- [Hidden or idle tab produces no frames] → `no-frames` status + `Bring to front`; agent-side automation is unaffected (CDP works on background tabs).
- [Same profile, two concurrent relay sockets unverified] → spike task first; if the extension serialises connections, fall back to one instance per profile (queue second `connect` with 409 `Profile busy`) — spec scenario "Two sessions, one profile" becomes conditional on the spike result.
- [guid/token in Chrome argv] → accepted (same-user boundary), `zeroDialog` opt-in, 60 s single-claim guid.
- [`systemOpen` absent (docker/headless)] → `status.canOpenChrome:false`, 503 on connect, settings section explains; documented Option-2 (fork) trigger.
- [Plugin scope registry widens the upgrade surface] → registration only during activation, reserved core scopes, no tickets, no CIDR bypass, teardown on disable; contract tests on the gate order.
- [17 profiles × token paste onboarding] → token optional; without it the extension shows Allow/Reject once per connect.

## Migration Plan

1. Land runtime hook (D1) behind no flag — zero behaviour change for core scopes; contract tests prove gate order unchanged.
2. Land plugin disabled by default (`plugins.browser.enabled: false`); enabling is a settings toggle.
3. Land skill routing last; `own-browser.md` stays as legacy fallback.
Rollback: disable plugin (routes torn down per spec), revert skill routing commit. Runtime hook is inert without a registrant.

### D9 — Test-only fake instance

`PI_BROWSER_RELAY_FAKE=1` makes `RelayManager` seed a `FakeRelayInstance` (same interface as `RelayInstance`, no sockets) with one tab emitting a static 64×64 JPEG every 100 ms and echoing viewer input into the audit ring. Purpose: the docker e2e harness has no Chrome, so settings rows, tiles, subscribe/unsubscribe, no-frames overlay and input plumbing are exercised end-to-end against the fake. Ignored when unset; never enabled by config.

## Open Questions

- Should `allowedDomains` default to empty (allow all) or to the profile's email domain? Defaults to empty; revisit after first real use. (Matching: exact host, or leading-dot entry for subdomains — decided.)
- Does zrok inject forwarding headers? Irrelevant to the relay after D1's deterministic Host/forwarding-header rule, but still worth recording from the tunnel E2E for core.
- JPEG quality/size defaults for the tile on mobile viewports — tune after measuring over the tunnel.
