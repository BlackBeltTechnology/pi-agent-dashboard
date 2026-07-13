# Design — tunnel providers behind a provider abstraction

## Provider matrix

|            | zrok         | ngrok       | tailscale            | zerotier            |
|------------|--------------|-------------|----------------------|---------------------|
| public     | `share public` | `http`    | `funnel`             | — (unsupported)     |
| private    | —            | —           | `serve` / MagicDNS   | join network → mesh IP |
| lifecycle  | child        | child       | **daemon**           | **daemon**          |
| URL source | child stdout | child stdout| `status --json`      | `zerotier-cli status` |
| URL type   | https        | https       | https (funnel) + name| raw `http://IP:port` |
| enrollment | `~/.zrok2` env | `add-authtoken` | `tailscale up` | `join <netid>` (+ approve) |
| modes      | public       | public      | **both**             | private only        |

zrok is the legacy default. ngrok is the cheap validation case (child model, mirrors zrok, no daemon edge). Tailscale unlocks the daemon path and is the only provider meeting the "both modes" bar. ZeroTier rides Tailscale's daemon work and is private-only with a no-TLS/no-name wrinkle.

## D1: TunnelProvider interface — generic lifecycle up, provider specifics down

```
interface TunnelProvider {
  id: "zrok" | "ngrok" | "tailscale" | "zerotier"
  kind: "child" | "daemon"
  supportsMode(mode): boolean            // ngrok/zrok → public only; zerotier → private only
  detectBinary(): boolean                // via existing ToolResolver
  isEnrolled(): boolean                  // zrok env | ngrok authtoken | tailscale logged-in | zt joined
  connect(port, mode, opts): Promise<ProviderEndpoints>
  disconnect(port): Promise<void>
  status(): ProviderStatus               // endpoints[] + health
}
```

Stays provider-neutral in the core (`tunnel.ts` refactor): PID files, spawn timeout/retry, the health watchdog, orphan scavenge. Moves into each implementation: binary name, spawn args, URL regex/parse, enrollment check, teardown command.

**Child vs daemon is the sharp edge.** zrok/ngrok: the tunnel *is* a child process the server owns and kills; PID file + watchdog apply unchanged. Tailscale/ZeroTier: the tunnel is state on a long-lived daemon; `connect`/`disconnect` are idempotent config commands and there is no PID we own. PID-file/watchdog machinery therefore becomes **provider-optional**, gated on `kind`.

Spawn / control shapes:
```
zrok :   zrok  share public --headless http://localhost:PORT        (+ reserved <tok>)
ngrok:   ngrok http PORT --log stdout --log-format json             (+ --url https://<reserved>)
tsc  :   tailscale serve --set-path=/ --bg localhost:PORT   |  tailscale funnel --bg localhost:PORT
zt   :   zerotier-cli join <netid>   (connect) / zerotier-cli leave <netid> (disconnect — destructive)
```

**`connect()` resolves the URL asynchronously, and the source differs by `kind` — the core must handle both, this is the one place `kind` legitimately branches:**
- **child** — the URL is not known when the process is spawned. ngrok emits it in a structured log line (`--log-format json`, the `msg:"started tunnel"` / `url` field — parsed from stdout, NOT the deprecated `:4040` API assumption); zrok headless prints the reserved share URL to stdout. `connect()` returns a promise that resolves when the URL line is seen or a timeout fires.
- **daemon** — `connect()` issues the idempotent control command, then reads back the serve/funnel URL from **`tailscale serve status --json`** (NOT `tailscale status --json`, which returns peer/identity state and carries no serve/funnel mapping). ZeroTier has **no URL** — see the ZeroTier asymmetry note below.

**Daemon prerequisites (unstated-assumption fix).** Daemon providers assume `tailscaled` / `zerotier-one` is already running and, for ZeroTier, that the node is already **authorized in the controller** (out-of-band; a joined-but-unauthorized node has no IP). The server does **not** start or elevate the daemon; `isEnrolled()` returns false and the UI surfaces a copy-paste remediation when the daemon is down or the node is unauthorized. Runtime `zerotier-cli`/`tailscale` calls require the server user to be in the provider's admin group — a documented host prerequisite, not something the unprivileged server escalates.

**ZeroTier asymmetry (contract #4 honesty).** ZeroTier is **private-only and produces no URL** — only a mesh IP. `getReachableUrls()` synthesizes `http://<mesh-ip>:PORT`, which is plain-http and therefore dropped by the read-time gate → **no Pairing QR, no bearer path for ZeroTier**; it is **Link-QR-only** (see D4). This asymmetry is intentional and documented, not a bug to paper over. `disconnect()` maps to `zerotier-cli leave`, which is destructive (removes membership), so the UI labels it accordingly.

**Startup reconciliation + watchdog policy.** On boot the core calls `status()` for the configured provider before any `connect()`: a daemon already serving the port is adopted (no re-connect); a child with a live PID file is adopted or scavenged. Child watchdog restart policy is explicit — exponential backoff, max N retries, then surface a failed state (no silent crash-loop). Note: a child restart mints a **new** public URL for random-URL providers (ngrok free tier), invalidating previously-minted QRs; the UI must re-render the QR on URL change.

## D2: config — provider + mode, keys stay `tunnel`

```jsonc
tunnel: {
  enabled: true,
  provider: "zrok"|"ngrok"|"tailscale"|"zerotier",   // required when enabled
  mode: "public"|"private",                           // required; validated against supportsMode
  zrok:      { reservedToken?: string },
  ngrok:     { authtoken?: string, domain?: string },  // domain = reserved URL
  tailscale: { authKey?: string },
  zerotier:  { networkId?: string },
  watchdog: { ... }                                    // generic, child-model only
}
```
Back-compat resolver: legacy bare `reservedToken` + no `provider` → `{ provider:"zrok", mode:"public", zrok:{reservedToken} }`. Refuse to connect if `provider=tailscale` (or any) and `mode` unset, or if `!supportsMode(mode)`.

**Migration site (contract #1).** Normalization is a **read-time shim** in `loadConfig()` (idempotent, pure), applied on *every* load so no writer needs to know about the legacy shape. It is **not** a silent disk rewrite: the legacy on-disk file stays byte-identical until the operator saves something, at which point the normalized shape is written back through `writeConfigPartial`. This keeps a downgrade to the old build readable (the old build ignores the new keys and still finds `reservedToken` only if we preserve it — so the shim keeps `zrok.reservedToken` and does not delete the legacy top-level key on read). Conflict rule: if both a legacy `reservedToken` and an explicit `provider` are present, `provider` wins and the bare `reservedToken` is ignored (logged once).

## D3: step-action taxonomy (setup guide)

The dashboard server runs **unprivileged**, so what a button may run is gated on sudo/interactivity, not on our preference:

| step type   | button?    | behaviour |
|-------------|------------|-----------|
| install     | ✗ copy     | stays copy-paste + live ✓ detection (needs elevation / slow / streaming) |
| auth-token  | ✓ run      | token field + **Authenticate** → whitelisted Recipe (`ngrok config add-authtoken`, `zrok enable`, `tailscale up --authkey`) |
| activate    | ✓ run      | **Enable funnel** / **Connect** → whitelisted Recipe (no sudo) |
| browser-auth| ⧉ open     | `tailscale up` prints an auth URL; server captures it, UI opens it |
| external    | link only  | admin-console gates (MagicDNS, HTTPS certs, Funnel ACL) we cannot automate |

**Security contract (non-negotiable):** the run endpoint executes a fixed Recipe keyed by `(provider, step)` with the token/netid as a *validated parameter* — never an arbitrary command string. Runs over the authenticated loopback path; the secret is written to the provider's own config and never logged. Uses the existing `platform/runner.ts` Recipe engine (in `packages/shared`).

**Parameter validation is the security boundary — it must be concrete, not "validated" hand-wave (contract #2):**

| provider · step | param | strict validator (reject on mismatch, no partial accept) |
|---|---|---|
| ngrok · auth-token | authtoken | `^[A-Za-z0-9_]{20,60}$` |
| tailscale · auth-token | authkey | `^tskey-auth-[A-Za-z0-9-]+$` |
| zerotier · activate | networkId | `^[0-9a-f]{16}$` |
| zrok · auth-token | token | `^[A-Za-z0-9._-]{20,200}$` |

The param is passed as a **single argv element**, never string-interpolated into a command line. **Windows caveat (verified):** `buildSafeArgv` routes `.cmd`/`.bat` shims (ngrok/zrok on Windows) through `cmd.exe /d /s /c`, which re-interprets `& | ^ % < > "` regardless of Node's `shell:false` argv quoting (CVE-2024-27980 class). The strict allow-list regexes above contain **no** cmd.exe metacharacters, so a value that passes validation cannot break out; a value that would need one is rejected before spawn. Any future recipe whose parameter alphabet includes a metacharacter MUST resolve the real binary (not the `.cmd` shim) or refuse to run on Windows.

**Recipe timeout (verified gap).** `runner.ts` `DEFAULT_TIMEOUT_MS = 5000`; enroll commands are network round-trips (`tailscale up`, `zrok enable`) that routinely exceed 5 s and would be misreported as failure. Each enroll Recipe sets an explicit `timeout` (e.g. 30 s) via the existing per-recipe override.

**Key lifecycle (unstated).** `tailscale --authkey` and reusable/one-time keys expire; on server restart the node re-uses existing daemon registration (no re-`up` needed) — the recipe is a one-time enroll, and an expired/again-unenrolled node falls back to the copy-paste remediation via `isEnrolled()`. ngrok stores the authtoken in a **per-user** `ngrok.yml`; the recipe writes it as the **server process user** (via `--config` pinned to the server's config dir) so a mismatch between the install-step user and the runtime user cannot orphan the token.

## D4: endpoints — "Accessible at" + QR pairing

`getReachableUrls()` becomes multi-sourced from every active provider endpoint. Each endpoint carries `{ kind: public|mesh|magicdns|lan|local, url, tls: boolean }`.

- **Manual operator endpoint (migrated from `wire-nonzrok-pairing-view`).** Beyond provider endpoints, an operator may add a non-provider `https`/`wss` URL (their own reverse-proxy / funnel) via the UI. It persists to `pairing.publicBaseUrls` through the existing auth-gated `PUT /api/config` (`writeConfigPartial` — **no new route**). **Merge precision (verified):** `writeConfigPartial` deep-merges only `auth`, `tunnel`, `memoryLimits`, `openspec`; `pairing` is **not** in that allow-list, so a top-level `pairing` write is a **shallow overwrite** — the client MUST read current config and send the **full** `pairing` object or it clobbers sibling `pairing` fields. (This is a lost-update hazard under concurrent writes; acceptable for a single-operator settings surface, but the save path re-reads immediately before PUT to shrink the window.) The endpoint joins `getReachableUrls()` as a `{ kind: public, tls: true }` source. **The `tls` tag is advisory, not the gate:** the authoritative `https`/`wss` filter stays server-side at **read time** in `reachableUrls()` (D4/D14), so a plain-http entry is dropped before advertisement regardless of the tag or how it was written; client validation is UX feedback only. This closes the JSON-only gap the archived pairing change left, without a bespoke pairing route.
- **Provider-secret redaction (verified gap, contract #3-adjacent).** `readConfigRedacted()` today redacts only `auth.*`. `tunnel.ngrok.authtoken` / `tunnel.tailscale.authKey` / `tunnel.zrok.reservedToken` would otherwise be served in clear by `GET /api/config`. The redaction set is extended to cover the per-provider secret fields (same `REDACTED` sentinel + preserve-on-write path already used for `auth.secret`). Switching providers does not silently retain a prior provider's secret in a served field: the write path clears sibling provider sub-objects the operator did not send.
- **"Accessible at"** lists all, with TLS/no-TLS badge.
- **Two QR kinds, split by transport (Decision 1, corrected after doubt review).**
  - **Pairing QR** — encodes the secure pairing payload `{ v, id, code, urls[] }`. `urls[]` carries **TLS endpoints only** (`https`/`wss`): public tunnel URLs, and MagicDNS names that have a provisioned `tailscale cert` (a real secure context). This is **unchanged D14 — no relaxation.** The crypto challenge/redeem handshake (`crypto.subtle`, secure-context-only) runs and a bearer is issued over TLS. Electron consumes the same payload as a `pi:pair:v1.…` copy-string.
  - **Link QR** — for **no-TLS http endpoints** (mesh `100.x`/`10.x`, LAN). Encodes **just the URL string**, not the pairing payload. Scanning opens the dashboard directly; the pairing handshake is never attempted, so `crypto.subtle`-on-http never fires and **no bearer/secret is transmitted from the QR**. **Arrival UX (gap fix):** the user lands on the SPA over http. If their source IP is in `config.trustedNetworks` (mesh/LAN IP trusted) they get in unauthenticated; otherwise they see the **normal login screen** — not a dead end — and the empty-state copy tells them to either sign in or ask the operator to trust this network (the Link QR is explicitly the "already-on-my-network" convenience, and the UI says so before rendering it). On Tailscale/ZeroTier the WireGuard/mesh underlay encrypts transport regardless.

  **TLS determination per Tailscale mode (was conflated).** `funnel` provides public TLS automatically (Tailscale-managed cert) → its URL is TLS and eligible for the **Pairing QR**. `serve` alone is tailnet-internal and TLS only when the operator has provisioned a `tailscale cert` for the MagicDNS name; without that cert the MagicDNS/mesh URL is treated as no-TLS → **Link QR** only. The provider reports `tls` per endpoint from the actual serve/funnel + cert state, never assumed.

  **Why the split (doubt-review findings):** including http mesh endpoints *in the pairing payload* was disproven — browsers cannot run `crypto.subtle` over a non-secure http origin (W3C secure contexts), so scan-to-connect could not function on the private side; and where it did (Electron), the bearer leaked in clear to a mesh that is NOT a single-owner enclave (Tailscale Share, ZeroTier guest). The link QR gives the private-mesh convenience without either failure mode. Raw http mesh IPs never enter `urls[]`, so distinguishing mesh-IP from plain-LAN by inspection (unimplementable — ZeroTier assigns any RFC1918 range) is moot.

## D5: trusted-network block events

`localhost-guard` records recent denials into a bounded ring buffer (source IP + best-effort provider/network hint), exposed via an auth-gated endpoint. UI surfaces a "refused — Trust this network?" banner → one-click add to `config.trustedNetworks` (exact IP, or offer the mesh subnet), plus remove. Section lives once, on the **Security** page (shared with auth); the Gateway page cross-references it. This is **net-new code**, not reuse: `localhost-guard.ts` has no recording/ring-buffer today — it is the security-sensitive addition of this change and is designed accordingly.

**Blast radius must be stated (contract #7).** A `trustedNetworks` entry **bypasses auth entirely** — `isBypassedHost` short-circuits the guard *before* the `isAuthenticated` check (verified in `localhost-guard.ts`). One trust entry therefore grants the full dashboard API, unauthenticated, to every host that IP/CIDR covers. The UI states this in the confirm step; a `/32`/`/128` single-host add is the default, and the mesh-subnet option is presented as the wider, explicitly-riskier choice.

**Anti-poisoning (the one-click add is the attack surface):**
- **Source IP is derived from the socket peer only** (`request.ip` under the trusted-proxy config), **never** from `X-Forwarded-For`/`Forwarded` headers — an attacker cannot seed the buffer with an IP the operator is nudged to trust.
- **Loopback and proxy-terminated IPs are never offered for trust.** zrok/ngrok/`tailscale serve` terminate at `127.0.0.1`, so their proxied requests present the loopback IP; the buffer tags these and the UI **suppresses** the trust action for them (trusting loopback would trust the entire tunnel). Only a genuine distinct mesh/LAN peer IP is offered.
- **Dedup + rate-limit** the ring buffer per source IP so a flood of spoofed/random source IPs cannot evict a legitimate denial or bury it; entries are coalesced by IP with a last-seen count, and the buffer is capped per-IP as well as globally.
- The banner is **advisory**: it never auto-adds; every entry requires the explicit operator click plus the blast-radius confirm above.

## D6: UI surfaces

Reusable section components (`GatewayProviderSection`, `GatewayEndpoints`, `GatewayPairQR`, `GatewaySetupGuide`) composed into two hosts:
- **Gateway settings page** (own page under Network nav) — persist/configure; full-width; Save footer. Trusted networks referenced from Security (no dupe).
- **Gateway dialog** (tabbed: Setup / Access & QR / Security) — do-it-now, from a button.

All user-facing strings say **"Gateway"**; internal identifiers stay `tunnel`. A UI label map, nothing on the wire.

## Decisions resolved
- **Second doubt-review pass (single-model + cross-model DeepSeek v4 Pro).** Hardened before implementation: D3 concrete per-provider validators + Windows `.cmd`/cmd.exe metachar rule + recipe timeout override + key lifecycle; D5 anti-poisoning (socket-peer IP only, never-trust-loopback, dedup/rate-limit) + explicit auth-bypass blast radius; D1 async `connect()→url` split, corrected Tailscale commands (`serve status --json`, not `status --json`) + daemon prerequisites + ZeroTier no-URL/link-QR-only asymmetry + startup reconciliation/watchdog policy; D2 read-time migration shim + conflict rule; D4 exact `writeConfigPartial` merge semantics (`pairing` shallow) + provider-secret redaction + Tailscale serve-vs-funnel TLS + Link-QR arrival UX. Approach unchanged — gaps closed.
- **D1 (QR endpoints):** two QR kinds by transport — **pairing QR** carries TLS-only `urls[]` (D14 intact, incl. `tailscale cert` MagicDNS https); **link QR** carries a plain URL for no-TLS http endpoints (no pairing payload, no crypto, no bearer over the wire). Corrected after doubt review disproved mesh-in-payload (crypto.subtle-on-http impossible; clear-text bearer leak on non-enclave mesh).
- **D2 (Docker):** host-first; Tailscale/ZeroTier daemon-in-container is a follow-up change. zrok stays in the image.

## Sequencing rationale
Land the abstraction + zrok-behind-seam (no behaviour change), then **ngrok** (like-for-like, proves the seam cheaply), then **Tailscale** (daemon + both modes + Funnel gates), then **ZeroTier** (private-only, rides the daemon work). QR/pairing wiring and the Gateway UI relabel come after providers work. The Gateway relabel is a mechanical UI-string pass, sequenced last.
