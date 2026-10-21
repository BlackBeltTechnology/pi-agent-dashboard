# Design: improve-canvas-html-and-url-ux

## Context

See proposal.md for why. Current state, with citations:

- **Canvas tool.** `canvas` returns `{ok:true}` text (`packages/extension/src/canvas-tool.ts:105-110`). It has no registry entry (`packages/client/src/components/tool-renderers/registry.ts:11-25`), so `GenericToolRenderer` prints the JSON. `CanvasState` is `{target, mode, title, phase, version, chip}`, with no source call id (`packages/client/src/lib/canvas/canvas-gate.ts:65-77`).
- **Canvas open routing** lives inside `CanvasDriver` (`packages/client/src/components/canvas/CanvasDriver.tsx:121-149`):
  - file → `openInSplit(path, …, true, {background, autoOpened: background})` (`:138`). The chip tap is therefore `autoOpened:false`, i.e. operator, which matches `preview-denial-remedy` "A user tap is not an auto-open".
  - loopback URL → `openLiveTarget`;
  - any other URL → `openUrlTarget`, which renders through `dispatchPreview`. A host without a known extension maps to `fallback` (`PreviewCard.tsx:128-130`).
- **Provenance today** is `PreviewProvenance` / `autoOpened` (`packages/client/src/lib/access-grants/preview-provenance.tsx:21-38`). `FilePreviewOverlay.tsx:109` and `ImageLightbox.tsx:48` declare `operator`.
- **Live tabs are idempotent by path.** `openLiveTarget` dispatches `openFile` with path `live:<url>` (`SplitWorkspaceContext.tsx:290-300`). `LiveServerViewer` launches only on a `viewerPath` change (`LiveServerViewer.tsx:123-127`). Mints carry no policy (`:100-120,129-150`). The frame `src` appends an unvalidated `deep` (`:168`).
- **Agent-declared loopback URLs are persisted.** `openLiveTarget` → preset auto-launch → `startLiveServer` → `manager.start()` → `persist()` (`live-server-manager.ts:32-50`). Seeding keeps only `{id,label,host,port}`.
- **`HtmlPreview`** renders `<iframe sandbox="allow-same-origin" srcDoc>` from `/api/file/raw` (`HtmlPreview.tsx:30-77`). It is mounted by `viewer-registry.tsx:35` and `PreviewCard.tsx:142` → `PreviewBody` (also used by `UrlViewer.tsx:38` and `PreviewOverlayView.tsx:40`).
- **The raw-read gate** is `gateFilePath` → `evaluateContainment(resolved, [cwd], {allowGrant})`, which admits path grants (`packages/server/src/routes/file-routes.ts:328-350`).
- **Live proxy.** `/live/<id>/…` goes through `reply.from` (`live-server-proxy.ts:116-191`). The capability prefix is stripped. `/live/` is in `GUARD_JURISDICTION_PREFIXES` (`localhost-guard.ts:479`). The baseline CSP skips `/live/` (`auth/csp.ts:29`), so no capability response carries a CSP today.
- **`/live/` admission without a token** also passes for genuinely-local callers. `isGenuinelyLocal` checks only the peer IP and the absence of forwarding headers (`localhost-guard.ts:82-84`, `auth-plugin.ts:743`). The `live` WS scope accepts `Origin: null` (`cors-origin.ts:277`). So an opaque frame on the operator's machine reaches any port target without a capability.
- **Loopback origins are trusted** by CORS (`cors-origin.ts:138`) and the mutation-origin gate.
- **Capabilities:** 256-bit tokens, at most 64 per principal with oldest-first eviction (`live-capability.ts:32,99-105`).
- **Access:**
  - planes `filesystem`, `cwd`, `network`, `cors` (`access/planes.ts:1-17`);
  - prompting is off by default (`access-grant-dialog` "Prompting is opt-in");
  - the registry records pending entries per (plane, subject) (`access-grant-registry`);
  - `writeConfigPartial` is an unlocked read-modify-write of `config.json` (`config-api.ts:235-245`).
- **Exposure inputs:**
  - the resolved bind host (`bind-reachability-service.ts:36`);
  - `collectEndpoints`, which covers tunnels, manual `publicBaseUrls` and TLS listeners (`tunnel/tunnel-endpoints.ts:67-75`).

## Goals / Non-Goals

**Goals**
- One opener for canvas targets.
- Agent HTML renders as authored, with isolation no weaker than today's live preview.
- Auto-open egress stays at or below manual-click egress, widened only by operator action.
- No script-readable credential is usable by a remote party unless the operator chose to run scripts with the dashboard exposed.
- No opaque frame reaches `/live/` without a capability.

**Non-Goals**
- Rendering non-loopback URLs inline. LAN URLs are handled by guidance only.
- Any dashboard-spawned dev server or a direct-open localhost URL for **repo HTML**. A loopback origin is trusted by CORS and the mutation gate.
- Root-absolute URL rewriting. The viewer shows a hint instead.
- Tracking in-frame navigation in the address bar.
- Reworking `UrlViewer`'s fallback card.

## Decisions

### D1. Static targets are served on `/live/`, capability-only, with per-request gating

```mermaid
flowchart LR
  subgraph Manager["LiveServerManager"]
    P["port targets {host,port,addedBy}<br/>persisted: addedBy=user only"]
    PP["preset port targets (agent-declared, after confirm-chip tap)<br/>in-memory only, ≤16/session LRU"]
    S["static targets {cwd, root}<br/>in-memory only, ≤32/session LRU"]
  end
  R["/live/&lt;id&gt;/…"] --> BR{browser-originated?<br/>Origin:null or Sec-Fetch-*}
  BR -->|yes, no valid capability| X[404]
  BR -->|no (inject/curl)| ADM[admission as today, port targets only]
  BR -->|valid capability| K{kind}
  K -->|port| RF["reply.from + CSP from token"]
  K -->|static| G["gateFilePath(cwd, rel) again"] --> FS["serveStatic + CSP from token"]
```

- `POST /api/live-server/start-static {cwd, path}` uses `gateFilePath(cwd, path, {allowGrant:true})`, so granted files are admitted exactly as a raw read. It resolves the root (D2) and registers or reuses a static target keyed by `(cwd, root)` in a separate in-memory map.
- **Static targets are not reachable without a capability, by any caller.**
- **Every static request re-runs `gateFilePath(cwd, <absolute real path>)`**, so a revoked grant or pin takes effect on the next request. That holds for out-of-cwd roots too.
- **Agent-declared localhost URLs** (`canvas` `kind:"url"` loopback) are **not auto-opened**. Server normalization routes them to the existing confirm chip, as for `kind:"server"`. The tap probes `127.0.0.1:port` and registers an in-memory **preset** target that is **restricted**. The tap consents to connecting, not to widening egress.
- **All port targets** reject the dashboard's own listen ports. The proxy sets `X-Forwarded-For` on every upstream request, so a proxied loopback hop is never "genuinely local".
- **Eviction:** when a cap is hit, the least recently used preset or static target is evicted and its tokens are revoked. "Use" means registration or any accepted request.

### D2. Root and servable files

- **Inside the cwd:** the root is the nearest ancestor (inclusive) with `index.html` or `package.json`, searched no higher than the cwd. When none exists, the root is the file's own directory. There is no whole-cwd fallback.
- **Granted file outside the cwd:** the root is the file's own directory. The per-request gate (D1) still limits serving to what the grant covers, so a file-only grant serves only that file.
- **Extension allowlist:** `html htm css js mjs json svg png jpg jpeg gif webp avif ico woff woff2 ttf otf mp4 webm ogg mp3 wav m4a`. There are no source maps or `.txt`.
- **Size:** any file size, streamed, with single-`Range` → `206` support. There is no cap (decision C4).
- **Perf budget (C5):** the first-serve scan adds ≤ 150 ms p95 (2 MiB HTML + 10 linked CSS), and the per-request gate adds ≤ 10 ms p95.
- **404:**
  - dot, `.git` and `node_modules` segments;
  - forbidden path subjects;
  - secret-like names: `*.pem`, `*.key`, `*.p12`, `*.pfx`, `*.jks`, `*.keystore`, `*secret*`, `*credential*`, `*token*`, `*password*`, `*passwd*`, `*private*`, `id_rsa*`, `auth.json`, `service-account*.json`, `*.tfstate*`.
- **Containment:** realpath containment. `%2e`/`%2f` are decoded once and re-checked (`harden-path-matcher-vs-router`). Symlinks out of the root return 404 (documented).
- **Response headers:** `Cache-Control: no-store`, `nosniff`, `Referrer-Policy: no-referrer`.

### D3. Isolation headers on every capability response

| Mode | Frame `sandbox` | Response CSP |
|---|---|---|
| open egress, scripts | `allow-scripts allow-forms allow-popups allow-downloads` | `sandbox` same tokens; `object-src 'none'; frame-ancestors 'self'` |
| restricted, scripts | `allow-scripts allow-forms` | `sandbox` same; egress directives (D4) |
| scripts off | empty | `sandbox`; egress directives when restricted |

- This applies to **port and static** targets alike. It closes direct-open ("Open ↗") execution on the dashboard origin for port targets too.
- **"Open ↗" for a user-added (`addedBy:"user"`) port target, for a genuinely-local operator,** opens the real `http://localhost:<port>/<deep>`. The operator confirmed that server. Preset and static targets, and remote operators, always get the sandboxed capability URL, because a loopback origin is trusted by the dashboard's CORS and mutation gate.
- Our CSP header is **appended** to an upstream CSP. Browsers enforce both, so the result is the stricter intersection. Upstream headers are never stripped.
- "Open ↗" mints a fresh token rather than exposing the tab's token in history.

### D4. Policy is bound to the capability, fail-closed

- **Mint body** `{egress:"open"|"restricted", scripts:boolean, runScripts?:true}`:
  - absent or invalid `egress` → `restricted`;
  - absent `scripts` → `false`;
  - the token stores the policy.
- **Restricted CSP:**
  - `default-src 'none'; script-src <S>; style-src <S>; img-src <S> data: blob:; font-src <S> data:; media-src <S> blob:; connect-src <P> <G>; form-action 'none'; base-uri 'none'; frame-src 'none'; object-src 'none'; frame-ancestors 'self'`;
  - plus `report-uri`/`report-to` and `Reporting-Endpoints`.
  - `<P>` = the absolute capability prefix, as http(s) plus ws(s) for HMR. `<S>` = `<P>` + `'unsafe-inline'` (+ `'unsafe-eval'` with scripts) + `<G>`. `<G>` = project grants ∪ the viewer's allow-once set.
  - `<P>` is built from the request's `Host`, which host admission has already validated (`host-admission`), never from an unvalidated header.
  - Also `worker-src <P> blob:` and `manifest-src 'none'`.
  - Never `'self'` or a bare dashboard origin, so `/api/*` and dashboard assets are unreachable. Spike S1 verifies prefix matching. The fallback is inline-only for `<S>`, keeping `<P>` for `connect-src`.
- **Spike S1 result (Chrome, docker harness, `canvas-static-mockup.spec.ts` F17):** an agent-opened restricted page (`script-src`/`style-src` = absolute capability prefix, no `'self'`) loads its relative `./style.css`; prefix matching works, so the inline-only fallback is NOT adopted. Firefox and Safari are checked by the manual task 8.3 (test-plan #X12).
- **Provenance** reuses `PreviewProvenance`/`autoOpened`, extended with an explicit opener parameter `operator | agent`:
  - operator: overlay click, tree click, an editor tab last activated by the operator, the **canvas chip tap**, the **canvas card click**;
  - agent: the canvas auto-open effect, agent preview cards, any undeclared surface (the default).
  - Clicks on linkified loopback URLs in tool output also count as operator.
  - The confirm-chip tap for an agent-declared server or URL is **restricted**: it consents to connecting only.
  - Operator → `open`. Agent → `restricted`.
- **Trust boundary:** the server trusts the policy a caller asks for when that caller may mint (control tier for port targets, raw-read tier for static targets). The threat is agent-authored *content*. That content runs in an opaque origin and cannot call the mint API: CORS rejects `null`, and there is no dashboard credential in the frame. An agent with shell access is out of scope; it can already read files.
- **Mint tiers:** static targets mint at the raw-file-read tier, so observe-tier readers keep HTML previews. Port targets keep the control tier.
- **Agent-declared port targets** (canvas loopback URL auto-open) are now restricted too.
- **Policy lives in tab state** and is passed on every mint: launch, reopen, re-mint, reload, toggle. Reload and toggle always re-mint with the current policy and exposure. A token is reused only when (target, policy, exposure epoch, viewer) is unchanged. The Scripts ⇄ Static toggle flips `scripts` only and preserves `egress`.

### D5. Scripts on restricted opens depend on exposure; tokens bind to local clients

- **`exposed`** = the resolved bind host is not loopback-only (unparseable → exposed) **or** `collectEndpoints()` is non-empty (tunnel, `publicBaseUrls`, TLS) **or** any request carrying forwarding headers has been seen since start. Otherwise `local-only`.
  - The server computes it, publishes it on `GET /api/live-server/policy` (observe tier) and bumps an **exposure epoch** on any change.
  - The forwarded-request signal is sticky until restart. That fails closed: a local `curl` with a forwarding header pins `exposed`.
  - A same-host relay that adds no forwarding header (SSH `-L`, socat) is undetectable. Operators using one set `liveServer.previewExposure: "exposed"` in `config.json`. This is a documented residual.
- **The server enforces scripts on restricted mints:**
  - `local-only` → allowed;
  - `exposed` → refused unless the mint carries `runScripts:true`, which only the viewer's "Run scripts" click sends.
  - The marker is client-asserted. That is acceptable because frames cannot call the mint API: they have an opaque origin, CORS rejects `null`, and there is no token on `/api`.
- **When the epoch changes to `exposed`,** restricted scripts-on tokens minted under `local-only` are revoked. The server pushes `preview_exposure_changed {epoch}` on the browser WebSocket, and open viewers re-mint without scripts and re-frame within 2 s (decision C2).
- **Client binding:** a token minted by a genuinely-local principal is accepted only from genuinely-local requests. A leaked local token is useless remotely, even when the dashboard is exposed.
- **Residual:** a remote operator (paired device or tunnel) who opens with scripts mints a token usable from anywhere until expiry (10 min idle / 2 h). A page with scripts can leak it by self-navigation. This is accepted for **operator** opens and "Run scripts", and documented in the viewer tooltip.

### D6. Detecting needed origins

1. **Static scan** of HTML up to 2 MiB plus same-root CSS (tags as listed in the spec) → canonical origins `{source:"markup"}`. Truncation or failure sets `scanIncomplete`. Root-absolute references set `rootAbsolute`.
2. **CSP reports** go to the reserved `__pi/csp-report` path under the prefix, capability-required.
   - Both media types are accepted. Limits: 64 KiB body (413 above it), and 20 reports/s and 600/h per token (429 above them) (decision C4).
   - Only `blocked-uri` is read. All logging goes through `redactCapability`.
   - **Runtime detection is best-effort.** Where reports do not arrive (spike S2), `scanIncomplete`-style "Some resources may be blocked" is shown.
   - The page itself can post reports, so runtime-only entries are labelled "reported by this page" and offer **Allow once only**, never a project grant. Report budgets are separate from the banner's markup entries.
   **Spike S2 status:** report delivery from the opaque-origin frame is covered by server tests (X8) and verified per browser by manual task 8.3 (#X12). Runtime detection stays best-effort until then.
3. **The blocked set is per token**, bounded to 64. Eviction removes the oldest `runtime` entries first and never removes markup or granted ones.
4. `GET /api/live-server/:id/egress?token=<tokenId>` and `POST /api/live-server/:id/allow-once {tokenId, origin}` are **control tier** (route-tier map). They are accepted only from the token's **minting principal**.
   - Allow-once sets are keyed by a client-generated **viewer id** (one per tab instance), carried across that viewer's re-mints, and bounded to 32.

### D7. Grants: the `preview-egress` deferred plane

| Field | Value |
|---|---|
| id | `preview-egress`, deferred, `allow-always` / `deny`, not YOLO-eligible |
| canonical subject | shared `canonicalHttpsOrigin`: WHATWG origin, https only, no userinfo, trailing-dot strip, punycode, default port elided |
| ungrantable | shared `isUngrantableEgressOrigin` (origin semantics, separate from path forbidden-subjects): non-https; `localhost`, `*.localhost`; IP literals in every parsed form in loopback/unspecified/private/link-local/CGNAT/ULA; single-label; `.local` `.internal` `.lan` `.home.arpa`; any host with a label embedding an IPv4 pattern (`127-0-0-1`, `10.0.0.5.`), which covers wildcard-DNS services structurally; the dashboard's own origins (`classifyCorsOrigin` incl. live tunnels) |
| grant-time resolution | DNS-resolve the host at grant time with a 3 s timeout. Refuse if any address is private or loopback, or if resolution fails or times out ("Could not verify this origin; try again", decision C3). Later rebinding is a documented residual. |
| store | own file `~/.pi/dashboard/preview-egress.json` `{ [projectKey]: string[] }` under `auth/locked-json-file.ts`. Not `config.json`, so no race with `writeConfigPartial`. |
| project key | canonical subject of the session cwd's git common root, else of the cwd (also for out-of-cwd files: the session's project) |

- **"Allow for this project," on the operator's click,** records a **deferred registry entry** `(preview-egress, origin)` charged to the operator's browser as requester. Standard capacity, rate-limit and diagnosable-transition rules apply. The standard dialog is then raised. This is the remedy pattern of `preview-denial-remedy` ("asking … only on the operator's click").
- **When prompting is disabled** (the default), the banner shows "Allow once" only, plus "Project grants need access prompts (Settings → Access)".
- **Banner rows** show the source (`in markup` / `seen at runtime`). Shared hosting is flagged: `github.io`, `pages.dev`, `netlify.app`, `vercel.app`, `workers.dev`, `glitch.me`, `repl.co`, `trycloudflare.com`, `ngrok-free.app`, `ngrok.io`, `onrender.com`, `fly.dev`, `surge.sh`, `share.zrok.io`.

### D8. A shared opener, an active-only tool card, and reload

- `useOpenCanvasTarget(target, {opener, background})` is extracted from `CanvasDriver`:
  - auto-open = `agent`, background;
  - chip = `operator`, foreground;
  - card = `operator`, foreground.
  - `.html` files go to `openStaticTarget`.
- **Tab identity:** `static:<absolute file path>`, one tab per file, also for files outside the cwd. The static target is a backing resource shared by tabs of the same root. Auto-opening a second file under the same root adds its own tab.
- **Selection:** a loopback URL declare, like a `kind:"server"` declare, goes to the chip and is not a `selectCanvasTarget` candidate. A DOC written in the same turn can therefore still auto-open (`auto-canvas` "Target selection priority" unchanged).
- **`CanvasState` gains `sourceCallId`.** The server accumulator sets it to the tool call id of the declare or write that produced the winning target, on eager and settle. A chip carries `declarationId`.
- **`ToolContext.canvas = {key, sourceCallId, chipDeclarationId}`** (scalars). The memo depends on the scalars, not object identity.
- **Card active** ⇔ `toolCallId === sourceCallId` (or `=== chipDeclarationId`). An active server or URL card's click behaves exactly like the confirm-chip tap (probe → restricted preset) (decision C1).
  - When several declares race, the last writer by (version, sequence) wins.
  - After a server restart, canvas state is empty, so every card renders plain. That is documented.
- **Keepalive:** while a viewer is mounted and visible, it calls `POST /api/live-server/:id/touch {tokenId}` every 5 min. That extends the token's idle expiry without re-pointing the frame, so idle pages do not 404 on lazy assets.
- **Version bump:**
  - a background tab reloads (re-mint per D4);
  - the active tab shows "Updated by the agent · Reload".

### D9. Address bar and picker

- **Header:** `[← Targets] [address] [↻] [Scripts ⇄ Static] [Run scripts]* [Open ↗]`. The toggle appears on static targets only. *"Run scripts" shows when restricted + exposed + scripts off.
- **Address validation** (one shared function, also applied to preset `live:` deep paths before framing): an empty whole path means the root, and one trailing `/` is allowed. Otherwise the path is split into segments. Empty, `.`, `..`, backslash and control-character segments are rejected. Each segment is percent-encoded, and `?`/`#` are kept only as query/fragment.
- **Port targets:** a different loopback `host:port` goes through an inline confirm, then `startLiveServer` (`addedBy:"user"`, persisted). A non-loopback address is refused.
- **Root-absolute hint:** "This page uses root-absolute paths (/app.js) that cannot resolve here. Run a dev server bound to localhost and open its localhost URL in the canvas."
- **Picker order:**
  1. the active canvas target;
  2. `user`;
  3. a collapsed "Older targets (N)" with "Clear all" for `legacy` (persisted before this change, including manual ones whose origin is unknown) and in-memory `preset`. "Clear all" asks for confirmation.
- **`addedBy` handling:** seeding and `start()` preserve `addedBy`. Removal revokes the target's tokens, and `DELETE` removes the allowlist entry if one exists.

### D10. Browser-originated `/live/` requests need a capability

- A `/live/` HTTP request or WS upgrade carrying `Origin: null` or any `Sec-Fetch-*` header SHALL present a valid capability. Otherwise it gets 404.
- The `live`-scope `Origin: null` acceptance (`cors-origin.ts:277`) applies only to capability-carrying upgrades.
- Non-browser local callers (`fastify.inject`, curl) keep today's admission for port targets.
- **Coordination:** the active change `add-voice-assistant-dashboard-plugin` (design §audio-ingest) returns a bare `/live/<id>/audio-ingest` path for browser use. It must mint and use a capability path. A coordination task is appended to its `tasks.md` in this planning commit.
- The main capability requirement's "existing admission is unchanged" sentence is MODIFIED to cover non-browser callers only.

### D11. Tool guidance

- A `canvas` guideline is added: "For a local server pass its localhost URL, never a LAN/IP URL."
- For a local HTML file, the guidance prefers `kind:'file'`.
- The `serve_mockup` result text gains: "For canvas(), use the local URL."

## Risks / Trade-offs

- **Remote operator token exfiltration with scripts** (D5 residual) is accepted for operator actions and documented.
- **Agent-declared dev servers become restricted.** HMR works through `<P>` in `connect-src`. Apps calling third-party APIs show the banner, and the operator can allow once or per project.
- **The CSP `sandbox` header on port targets** breaks apps needing `localStorage` or service workers when the capability URL is opened directly. → Mitigation: a local operator's "Open ↗" uses the real localhost URL.
- **Browser-originated tokenless `/live/` requests return 404.** That could affect undocumented consumers. → Mitigation: the viewer already uses capability paths everywhere. The voice-assistant change is flagged (D10).
- **Spikes S1 (CSP prefix matching) and S2 (opaque-origin reports)** gate D4/D6. Each has a fallback, and runtime detection is best-effort in the spec. If S1 fails without a workable fallback, `ship-it` hands back.
- **DNS rebinding of a granted public name** is a residual (grant-time resolution only).
- **Root-absolute URLs and symlinked asset directories do not load.** → Mitigation: hints.
- **Polling load.** → Mitigation: it is bounded (visible + restricted, 30 s idle stop).

## Migration Plan

- **Persisted live targets:** a missing `addedBy` reads as `legacy`, and a persisted entry that was really agent-declared stays `legacy` (collapsed). Preset and static targets are never persisted.
- **Downgrade then upgrade:** an older build re-persists entries without `addedBy`, so they come back as `legacy`. This is documented, and manual targets reappear under "Older targets".
- **Grants:** they live in a new file, `preview-egress.json`, which older builds ignore.
- **Browser access:** tokenless browser `/live/` access stops working (D10). The release notes call it out.
- **Rollback:** a revert. In-memory state vanishes, and the new file and fields are ignored.
- **Rebuild:** extension reload (`canvas-tool.ts`), mockup-loop reload, server restart, client build.

## Open Questions

- **Poll interval and idle-stop tuning** (2 s / 30 s) can change without spec impact.
