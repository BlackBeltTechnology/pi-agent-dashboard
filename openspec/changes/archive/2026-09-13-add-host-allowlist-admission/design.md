## Context

`fix-ws-origin-cswsh` (archived `2026-09-12-fix-ws-origin-cswsh`, D1 rule 1 + Risks row "Host-match rule and DNS rebinding") shipped the Origin gates and recorded Host allow-listing as the follow-up. Current admission shape on `develop` (`auth/cors-origin.ts`):

```
isOriginAdmitted(origin, hostHeader, opts)
  origin undefined            -> allow   (non-browser clients; ALSO same-origin GET from a browser)
  origin "" / padded          -> deny
  isSameOriginByHost(o, host) -> allow   <- Host is attacker-controlled under rebinding
  isCorsOriginAllowed(o, noZrokWildcard)
```

`networkGuard` (`auth/localhost-guard.ts`) and `isWsAuthorized` (`auth/auth-plugin.ts`) return on `isGenuinelyLocal(request.ip, headers)` — loopback peer, no forwarding header — before any credential is consulted. Under rebinding the attacker page is *same-origin* with the dashboard, so its GETs carry no `Origin` and its peer is `127.0.0.1`: both gates pass, nothing reads a credential. That is why the fix must key on `Host`, not `Origin`.

Constraints shaping the design:

- Hostname-addressed legitimate clients exist and are specced: mDNS (`http://<name>.local:8000`, `mdns-discovery`), plain-LAN pairing pages (`/api/pair/*`), operator reverse proxies, tunnel hosts. `isBypassedHost` matches IP literals only.
- Config is read live through the mtime-gated snapshot (`config-snapshot.ts`, `shared-config` *Live config reads*); a new field must join that path, not the boot config.
- `publicBaseUrls` has two client-side writers (`GatewayEndpoints.tsx` plain append; `gateway-action.ts` add/remove/drift/repair with a `GatewayWroteRecord` provenance so removal reverses exactly what was written — D12 of `config-override-oauth-redirect-base`). The server never writes it.
- No `trustProxy` is set on the Fastify instance; `request.ip` is the socket peer and `X-Forwarded-*` are never trusted (D10 of the pairing change).
- Precedent for a report-only rollout: CSP (`auth/csp.ts`, `PI_DASHBOARD_CSP=enforce`).

## Goals / Non-Goals

**Goals:**
- A rebinding Origin/Host pair (`Origin: http://rebind.example:8000`, `Host: rebind.example:8000`) is refused on `/ws`, on mutating `/api/*`, **and on Origin-less GETs** — the full rebinding surface, not just the half the Origin gate can see.
- Every hostname the dashboard can already justify stays admitted with no operator action: loopback, any IP literal, bind host, `*.local`, `publicBaseUrls` hosts (incl. legacy key), `cors.allowedOrigins` hosts, live tunnel hosts.
- One new operator knob (`allowedHosts`) for the remainder; read live.
- Zero breakage on day one (report-only default) with a log line that is sufficient to decide when to enforce.

**Non-Goals:**
- Honouring `X-Forwarded-Host` / enabling `trustProxy`.
- Tightening `*.local` to the exact advertised mDNS name.
- Writing `allowedHosts` from the gateway "add URL" action or any other `publicBaseUrls` writer.
- Flipping the default to enforce (separate change after a report-only release).
- The pi-gateway TCP listener (`pi-gateway.ts`) — it already refuses any `Origin`, and its peers are bridges dialling by IP/loopback; no browser reaches it.
- The optional model-proxy listener (`server.ts`, `model-proxy/auth-gate.ts`; loopback-bound, bearer-key gate) — reachable same-origin under rebinding, but every route requires the API key a rebinding page does not hold. Residual is key-gated; recorded, not closed here.

## Decisions

### D1 — Gate on `Host` for every request, before CORS, before the Origin gates

One `onRequest` hook registered before `@fastify/cors` (so a refused request carries no ACAO), plus the same check at the top of the `upgrade` handler before `isWsOriginTrusted`. It runs regardless of `Origin` presence — that is the whole point (see Context). Decision is a pure function:

```
isHostAdmitted(hostHeader, opts): boolean
  hostname := parse(hostHeader)            // same positive allowlist regex as isSameOriginByHost;
                                           // strip port; strip IPv6 brackets; strip trailing dot; lower-case
  fail-closed on absent / malformed Host   // HTTP/1.1 requires Host; a missing one is not a browser
  1. loopback literal, net.isIP(hostname) !== 0, or opts.bindHost -> admit   (IP literals cannot be rebound — below)
  2. hostname is "<label>.local", label non-empty       -> admit
  3. hostname in hosts(publicBaseUrls)                  -> admit   (derived, D2)
  4. hostname in hosts(cors.allowedOrigins)             -> admit   (derived, D2)
  5. hostname in hosts(getLiveTunnelOrigins())          -> admit   (derived, D2)
  6. hostname in allowedHosts                           -> admit
  otherwise                                             -> refuse
```

Any IP-literal `Host` is admitted, not only loopback or trusted-network literals: rebinding needs a *name* whose answer changes; a browser that connected to `http://192.168.1.50:8000` resolved nothing and the peer is whatever that address is. This is what keeps the wildcard bind (`PI_DASHBOARD_HOST=0.0.0.0`, the docker default — `bindHost` alone would never match a real `Host`) and plain-LAN pairing by raw IP (`POST /api/pair/*`, archived #E16) working with no operator action. `trustedNetworks` stays an *auth* bypass and plays no role here. Vite's `server.allowedHosts` makes the same call. IP detection is `net.isIP` on the parsed hostname — strict dotted-quad / RFC 4291 forms only (`::ffff:127.0.0.1` counts; shorthand such as `127.1` or `2130706433` does not and fails closed — browsers normalise before sending `Host`, so only hand-built clients notice). Source entries that fail to parse as a URL are skipped, never thrown on.

Hostname only, never `host:port`: a reverse proxy elides or rewrites the port, `publicBaseUrls` entries carry the public port not the listen port, and the port is not an attacker degree of freedom under rebinding (the victim's dashboard listens where it listens). Vite's `server.allowedHosts` and Django's `ALLOWED_HOSTS` make the same call.

`isSameOriginByHost(origin, hostHeader, opts)` additionally requires `isHostAdmitted(hostHeader, opts)` **only when `opts.hostGateMode === "enforce"`**. In report mode the helper keeps today's behaviour: the hook has already logged the would-refuse line, and tightening the Origin gate too would hard-refuse the very population the report-only release exists to size (a reverse-proxy name's `Origin` equals its `Host` and is in no allow-list — both rules would fail, so `/ws` and every POST would 403 on day one). In enforce mode the hook fires first so the tightened helper is unreachable in the server, but the pure helper is what `cors.test.ts` exercises in isolation and must be correct on its own; it also keeps the Origin gate correct if the hook is ever bypassed for a route. `opts` is the single shared options object from D6.

*Alternative rejected — tighten only `isSameOriginByHost` (option A in exploration).* Closes `/ws` and mutations, leaves Origin-less GETs open. Cheaper, but leaves the read half of the rebinding surface — session transcripts, config — reachable, and #637's acceptance would read as satisfied while the vulnerability class is not closed.

### D2 — `publicBaseUrls` / `cors.allowedOrigins` / tunnel hosts are derived at read time, never copied into `allowedHosts`

`publicBaseUrls` already *means* "URLs this dashboard answers on"; admitting their hosts is semantics, not a new decision. Deriving keeps one source of truth, needs no writer changes, and covers configs written before this change (including legacy `pairing.publicBaseUrls`, via `resolvePublicBaseUrls`).

*Alternative rejected — write-through.* Every `publicBaseUrls` writer (`GatewayEndpoints.tsx`, `gateway-action.ts` add/remove/drift/repair) also maintains `allowedHosts`, with a fifth `GatewayWroteRecord` field. Rejected because: (a) existing `publicBaseUrls` entries would have no `allowedHosts` twin → a migration on first boot or a broken enforce flip; (b) it creates a new drift class between two lists — the exact thing the D12 provenance record was invented to fight; (c) an operator would see a URL they added appear under a second key they did not touch.

`allowedHosts` is therefore only for names that are *not* public base URLs — an internal reverse-proxy name, a split-horizon DNS name.

### D3 — `*.local` admitted by suffix

`.local` is reserved for mDNS (RFC 6762); macOS and systemd-resolved do not forward it to unicast DNS, so an attacker cannot rebind `evil.local` to a victim loopback via *public* DNS. Two residuals are accepted: a LAN-adjacent attacker can answer mDNS for `evil.local` with `127.0.0.1` (needs presence on the victim's link — a stronger position than #637's remote page), and legacy unicast `local.` zones (RFC 6762 §4.1 / RFC 8374; non-resolved Linux, Windows suffix search) re-open the remote path on those hosts. Matching the exact advertised name instead would need the same hostname normalization `mdns-discovery` does (case, `-` substitution, collision suffixes); it is the natural follow-up if either residual matters to a supported target. Admitted `.local` names are not logged, so this allowance is deliberate, not observed.

### D4 — Report-only default; mode in `hostGate.mode`, `PI_DASHBOARD_HOST_GATE` overrides

Precedence: env var (when set to a recognised value) > `config.json` `hostGate.mode` > `report`. The env var keeps the CSP-style headless/CI escape hatch; the config key is what the Settings UI writes, read live through the snapshot like `allowedHosts`. The UI renders the mode control disabled with the reason when the env var is set, so the operator never saves a value that has no effect (NN/g #1 visibility of system status). Mirror of `resolveCspMode` / `PI_DASHBOARD_CSP` for the env half, plus the config leg `resolveCspMode` does not have. In report-only mode a refused Host logs and proceeds; in enforce mode it gets `403 { success:false, error:"host_not_allowed", reason:"Host header is not an admitted hostname.", hint:"Add it to allowedHosts, or add the URL to publicBaseUrls." }` — same self-describing shape as `network_not_allowed` so clients can branch on it. An absent or unrecognised env value contributes nothing and the chain falls through to the config value (`PI_DASHBOARD_HOST_GATE=yes` + `hostGate.mode: enforce` → enforce); an unrecognised value is logged once at boot (`[host-gate] ignoring PI_DASHBOARD_HOST_GATE=<v> (expected report|enforce)`) so a typo in the post-flip escape hatch is visible rather than silent, and `envOverridden` is `false` for it — the Settings control stays enabled because its saves do take effect.

*Alternative rejected — enforce day one.* The one population that breaks (reverse-proxy names never registered as a public base URL) is invisible to us until the log line exists; a release of report-only is the only way to size it. The rebinding residual has been open since the project began; one more release with a visible log is an acceptable trade for not breaking operators silently. Flagged for `doubt-driven-review`.

### D5 — Logging shape

One line per refusal in both modes: `[host-gate] <refused|would-refuse> host=<h> origin=<o> <method> <url>` for REST, `[host-gate] <refused|would-refuse> upgrade host=<h> origin=<o> scope=<s>` for WS. All header values pass `sanitizeHeaderForLog` (D5 of the archived change — control chars stripped, length-capped). The log line is rate-limited two ways: one per distinct hostname per minute, and a global cap of 60 lines per minute across all hostnames (a wildcard-DNS scan `a1.rebind.example`, `a2.…` defeats a per-key limiter alone); past the cap one summary line `[host-gate] suppressed <n> refusal lines` closes the minute. The limiter's map is bounded to 256 hostnames (oldest evicted). The refusal ring (D8) counts *every* refusal, is keyed by the parsed hostname (port stripped, D1 normalisation) — malformed / absent Hosts share the single key `(malformed)` — and is bounded to 50 entries, evicting the least-recently-seen. A distinct-hostname scan therefore can evict a genuine `proxy-int.corp` row; accepted: an active scan from the operator's own browser is a louder signal than the row it displaces, and the log's suppressed-count line records that it happened.

### D6 — Live inputs

`config-snapshot.ts` gains `liveAllowedHosts()` and `livePublicBaseUrls()` (the latter through `resolvePublicBaseUrls` so the legacy key is honoured). `corsOpts()` in `server.ts` grows `allowedHosts`, `publicBaseUrls`, `bindHost` so `isHostAdmitted`, `isOriginAdmitted` and `isCorsOriginAllowed` share one options object and cannot drift. `bindHost` is the address the listener was started with (`ServerConfig.host`, resolved CLI `--host` → `PI_DASHBOARD_HOST` → `config.json` `bindHost`; a restart field, so captured once at boot, not read live). It matters only when the bind address is a *name*; an IP bind is covered by rule 1's IP-literal admission. `opts.hostGateMode` comes from `liveHostGateMode()`.

### D8 — Operator UI: derived list, extras editor, recent refusals (mockups/)

The report-only phase is only useful if the operator can *see* what would break and fix it in one motion. Three surfaces, all in this change's `openspec/changes/add-host-allowlist-admission/mockups/` (`ui-plan.md` holds layout, states, tokens, cited rules; not the repo-root `mockups/`):

- **Settings ▸ Security ▸ Allowed hostnames.** The *Currently admitted* list is read-only and grouped by source with a source pill per row; derived rows link to their source page rather than offering a remove, which is D2 made visible — there is exactly one place each name lives. The *Additional hostnames* textarea mirrors the *Allowed Users* field contract and validates on blur with the **same positive hostname regex the gate parses with** (shared from `packages/shared`) plus no scheme / port / path, stating the exact fix (GOV.UK error pattern) — so a name the gate could never admit (`my_service.docker`) is refused at entry, not saved inert. One read endpoint feeds the section: `GET /api/host-gate` → `{ mode, envOverridden, admitted: [{ host, source }], recent: [{ host, count, lastSeen, outcome }] }`. `admitted` is computed server-side from the same `isHostAdmitted` inputs (D1 order, one row per hostname, first source wins; pattern rows `*.local` / `any IP address` rather than enumerations) so the client never re-derives admission. Exposure: it reveals nothing a caller with `GET /api/config` (same auth) and the tunnel status route cannot already read — in report mode a rebinding page can read those too, which is the accepted D4 trade-off; in enforce mode the gate refuses it before any route. The 403 page's non-enumeration rule (below) is different in kind: that page is served *pre-auth, on a refused Host, in enforce mode* — the one response a rebinding page still receives. `recent` is the refusal ring (parsed hostname → count, lastSeen, outcome-at-last-refusal), bounded, most recent first, written on every refusal alongside the rate-limited D5 log line. **Allow** appends the hostname to the panel's *draft* `allowedHosts` (the same draft the textarea edits) — it is persisted by the panel's Save like every other Settings field, never by a side `PUT` that the next Save would clobber (`writeConfigPartial` replaces `allowedHosts` whole). A refusal row whose hostname is in the editor's current value (draft, or saved value after Save) is hidden client-side at render time on every fetch; the server ring keeps its history. The mode control reuses the segmented shape of `components/Gateway/GatewayProviderSection.tsx`; switching states its consequence inline, with no `window.confirm` (the `GatewayProviderActions` convention, `Gateway/AGENTS.md`).
- **Refused page.** In enforce mode a request that accepts HTML gets a static string (inline CSS with a two-scheme palette lifted from the theme tokens via `prefers-color-scheme` — no `data-theme` switch is possible without JS; no JS, no client bundle — the bundle is exactly what a rebinding page wants). It states the received Host (**HTML-escaped**: the value is attacker-controlled and the page is served from the dashboard origin) and three ways in, in likelihood order: `http://localhost:<port>`, add the name to `allowedHosts`, add the URL as a public base URL. It does **not** enumerate the admitted set — under rebinding the attacker page is same-origin with the refused Host and can read the 403 body, so a list of tunnel hosts / LAN names would be an inventory oracle. `fetch` callers still get the JSON body from D4. Negotiation rule, pinned: HTML iff the `Accept` header's first media type is `text/html` (every browser navigation `Accept` starts with it); absent `Accept`, `*/*`, or `application/json, text/html;q=0.9` → JSON.
- **Gateway row pill.** `GatewayUrlManager` row shows *Host admitted* (success family, `title` explains why) when the row URL's hostname is in the live `resolvePublicBaseUrls(config)` ∪ `cors.allowedOrigins` hosts (the client has both in `config`). Informational only, and independent of `data-status`: `incomplete` (`gateway-action.ts` `computeGatewayStatus`) means *any* of the four wrote-deltas is missing, so an incomplete row may still carry the pill (its public base URL is intact, a trusted network is not) or lack it (its public base URL is the missing delta). The pill answers only "is this URL's hostname currently derived-admitted"; it does not claim the gateway is complete, and a hostname admitted via `allowedHosts` or a live tunnel is the Settings section's business, not this row's.

*Alternative rejected — a separate Settings page.* One section on Security keeps the three network-trust concepts (auth, trusted networks, allowed hostnames) adjacent; Hick's Law argues against a fourth nav entry for a list most operators never edit.

### D7 — Tests (TDD, real handler)

- Pure helper (`cors.test.ts` pattern): each admissible source in isolation; `host:port` vs hostname; IPv6 bracket form; malformed / absent Host fail closed; `isSameOriginByHost` no longer admits a non-admissible Host even when it equals the Origin host.
- REST hook via `fastify.inject`: rebinding pair refused on `POST /api/*` **and on `GET /api/sessions` with no Origin** in enforce mode; same requests pass with a log line in report-only; loopback / `.local` / `publicBaseUrls` host / `allowedHosts` entry pass in both modes; `allowedHosts` added at runtime applies with no restart.
- WS via the real `upgrade` handler (`ws-upgrade-routing.test.ts` pattern): rebinding pair refused on `/ws` before any ticket is consumed; `.local` hostname admitted.
- Regression: archived test-plan #E6 (mDNS hostname) and #E16 (plain-LAN pairing) re-run green.

## Risks / Trade-offs

- [Report-only leaves #637 open for one release] → accepted (D4); the log line plus a release-note asking operators to check `server.log` for `[host-gate] would-refuse` is the mitigation. Flip tracked as a follow-up.
- [Reverse proxy that passes `Host` through with a name in none of the sources] → 403 with a hint naming `allowedHosts`; report-only surfaces it first.
- [Reverse proxy that rewrites `Host` to `localhost:<port>`] → the gate is a no-op and the proxy is the gate; unchanged from today.
- [`*.local` suffix broader than the advertised name] → accepted (D3); LAN mDNS spoofing and legacy unicast `local.` zones are the named residuals.
- [Hostnames the positive regex rejects (`_`, e.g. some docker service names) can never be admitted, even via `allowedHosts`] → accepted; the same regex already bounds `isSameOriginByHost`. Widen both together if a real name shows up in `would-refuse` logs.
- [After the enforce flip an operator on a missed name cannot reach Settings or `/api/host-gate` on that name] → the HTML page's first way in is `localhost:<port>`, from which the section is reachable; `config.json` remains the out-of-band fix.
- [Hostname-only match admits any port on an admitted name] → intended; port is not a rebinding degree of freedom.
- [Derived sources widen with `cors.allowedOrigins`] → an operator who allow-lists an origin for CORS already trusts pages at that host; admitting its hostname for `Host` adds nothing an attacker controls.
- [Log flooding by a scanning page] → per-hostname rate limit (D5).

## Migration Plan

1. Ship with report-only default; `allowedHosts` documented; release note asks operators to grep `server.log` for `[host-gate] would-refuse` and add any legitimate name to `allowedHosts` (or the URL to `publicBaseUrls`).
2. Follow-up change flips the default to enforce once a release of report-only logs is clean; `PI_DASHBOARD_HOST_GATE=report` remains as the escape hatch.

No config migration: `allowedHosts` defaults to `[]`; all existing hostname sources are derived.
