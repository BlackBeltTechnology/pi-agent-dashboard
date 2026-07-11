# Tasks

## 1. Provider abstraction (no behaviour change)
- [x] 1.1 Define `TunnelProvider` interface + `ProviderEndpoints` / `ProviderStatus` types in shared → verify: types compile, exported
- [x] 1.2 Extract provider-neutral core from `tunnel.ts` (PID files, spawn timeout/retry, watchdog, orphan scavenge) → verify: existing zrok tests pass unchanged
- [x] 1.3 Reimplement zrok as first `TunnelProvider` behind the seam → verify: `/api/tunnel-status` byte-identical output; all `tunnel*.test.ts` green
- [x] 1.4 `kind: "child"|"daemon"` gates PID/watchdog as provider-optional → verify: unit test asserts daemon providers skip PID-file path

## 2. Config: provider + mode
- [x] 2.1 Extend `config.tunnel` with `provider`, `mode`, per-provider sub-configs → verify: schema + defaults compile
- [x] 2.2 Back-compat resolver: bare `reservedToken` → `{provider:"zrok",mode:"public",zrok:{...}}` → verify: test with legacy config.json
- [x] 2.3 Reject connect when `mode` unset or `!supportsMode(mode)` → verify: test each provider/mode pairing

## 3. ngrok provider (child model — proves the seam)
- [x] 3.1 ngrok provider: `http PORT --log stdout --log-format json`, parse `url=`, `--url` reserved domain → verify: mock-spawn test parses URL
- [x] 3.2 Enrollment check (`ngrok.yml` authtoken present) + `InstallHints` (brew/choco/winget/snap/script) → verify: doctor detects ngrok
- [x] 3.3 Reuse child lifecycle (PID/watchdog/scavenge) unchanged → verify: ngrok orphan scavenge test

## 4. Tailscale provider (daemon + both modes)
- [x] 4.1 Daemon-model connect/disconnect: `serve --bg` (private) / `funnel --bg` (public); derive URL from `serve status --json` (corrected per revised D1) → verify: mock status-json test yields endpoints
- [x] 4.2 Enrollment (`tailscale status` logged-in) + `InstallHints` + browser-auth URL capture from `tailscale up` → verify: auth-URL parsed and surfaced
- [x] 4.3 Funnel gates surfaced as detection checks (HTTPS certs, funnel ACL) → verify: gates reported; public mode blocked until met
- [x] 4.4 MagicDNS name + mesh IP both emitted as endpoints → verify: endpoints include `magicdns` + `mesh` kinds

## 5. ZeroTier provider (private-only, rides daemon work)
- [x] 5.1 Daemon connect: `zerotier-cli join <netid>`; mesh IP from `zerotier-cli -j listnetworks` → verify: mock status test yields mesh endpoint
- [x] 5.2 `supportsMode("public") === false`; `InstallHints` (brew cask / choco / install.sh) → verify: public mode rejected; doctor detects zerotier
- [x] 5.3 Emit `mesh` endpoint with `tls:false`, no name → verify: endpoint shape correct

## 6. Endpoints + step-action executor
- [x] 6.1 Multi-source `getReachableUrls()` from all active provider endpoints **and manual `pairing.publicBaseUrls`**, tagged `{kind,url,tls}` → verify: "Accessible at" returns all kinds incl. a hand-added URL (`tunnel-endpoints.ts` + `GET /api/tunnel/endpoints`)
- [x] 6.2 Whitelisted-recipe run endpoint keyed by `(provider, step)`, token as validated param, secret never logged → verify: security test — arbitrary command rejected; token redacted in logs (`tunnel-enroll.ts` + `POST /api/tunnel/enroll`)
- [x] 6.3 Auth/activate steps run server-side via `runner.ts` Recipe; install stays copy-paste + live ✓ → verify: mock enroll succeeds; install not whitelisted
- [x] 6.4 **Manual HTTPS endpoint entry (migrated from `wire-nonzrok-pairing-view`).** "Add HTTPS URL" control: read current config via `GET /api/config`, append to `pairing.publicBaseUrls`, PUT the FULL `pairing` object via existing `PUT /api/config` (no new route; shallow merge caveat); re-fetch endpoints so it appears in "Accessible at" + pairing QR → verify: hand-added `https` URL round-trips without JSON edit
- [x] 6.5 Server-side read-time D4/D14 filter in `reachableUrls()` drops plain-http `publicBaseUrls` + provider-secret redaction; unauthenticated `PUT /api/config` rejected (networkGuard) → verify: security test — `http://` entry never enters `urls[]`; `***` echo preserves secret. (Client-side `https`/`wss` UX validation lands with the form in §9.)

## 7. Trusted-network block events
- [x] 7.1 Bounded ring buffer of `localhost-guard` denials + auth-gated read endpoint → verify: refused IP appears; buffer capped; anti-poisoning (socket-peer IP only, never-trust-loopback/proxied, dedup) (`tunnel-block-events.ts` + `GET /api/tunnel/block-events`)
- [x] 7.2 One-click Trust (exact IP or mesh subnet) + Remove → `config.trustedNetworks` → verify: add/remove round-trips config

## 8. QR pairing across providers (D1 corrected: two QR kinds by transport)
- [x] 8.1 **Pairing QR** — `urls[]` multi-sourced but TLS-only (`https`/`wss`, incl. `tailscale cert` MagicDNS https); D14 intact → verify: no `http://` endpoint ever enters `urls[]`; existing strict-D14 pairing tests green
- [x] 8.2 **Link QR** — per no-TLS http endpoint (mesh/LAN), encode the plain URL string only (NOT the pairing payload); pairing handshake never invoked → verify: link-QR content is the bare URL; `crypto.subtle` path not reached
- [x] 8.3 Guard: refuse to place any `tls:false` endpoint into the pairing payload → verify: security test asserts http mesh IP excluded from `{v,id,code,urls[]}`
- [x] 8.4 Electron copy-string carries the TLS-only pairing payload → verify: base64url round-trips; no http url in decoded urls[]

## 9. UI — Gateway page + dialog (all strings "Gateway", internals stay tunnel)
- [x] 9.1 Reusable sections: `GatewayProviderSection`, `GatewayEndpoints` (incl. the migrated **Add HTTPS URL** control, task 6.4), `GatewayPairQR`, `GatewaySetupGuide` → verify: render in isolation
- [x] 9.2 New **Gateway** settings page under Network nav; trusted networks cross-referenced from Security (no dupe) → verify: page routes; Security still owns trustedNetworks
- [x] 9.3 Tabbed **Gateway** dialog (Setup / Access & QR — QR first / Security) → verify: tabs switch; matches mockup
- [x] 9.4 UI label map "tunnel"→"Gateway" across strings/i18n/docs; internal identifiers unchanged → verify: grep shows no user-facing "tunnel"; `config.tunnel`/`/api/tunnel-status` intact

## 10. Docs + gates
- [x] 10.1 Update `docs/faq.md` + `docs/architecture.md` Tunnel Lifecycle for providers + Gateway naming (delegate to docs subagent, caveman style) → verify: kb_search finds provider entries
- [x] 10.2 Per-file `AGENTS.md` rows for new provider modules → verify: `kb dox lint` clean
- [x] 10.3 code-review + code-quality gates on the diff → verify: both pass (code-quality: my files biome-clean, 0 new warnings/errors; code-review: CodeRabbit rate-limited → deferred to PR cycle per warn-and-continue policy)

## Out of scope (follow-up changes)
- Docker: `tailscaled` / `zerotier-one` in the all-in-one image (host-first this change).
- Renaming internal identifiers `tunnel` → `gateway` (UI-only relabel this change).
