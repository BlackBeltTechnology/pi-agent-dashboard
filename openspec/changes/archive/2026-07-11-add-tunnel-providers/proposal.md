# Add tunnel providers (ngrok, Tailscale, ZeroTier) behind a provider abstraction

> UI label: the tunnel feature is presented to users as **"Gateway"**. This is a
> UI-only relabel — internal identifiers (`config.tunnel`, `/api/tunnel-status`,
> `TunnelStatus`, `tunnel.ts`, `createTunnel()`, …) stay `tunnel`. No config
> migration, no API alias, no breaking change. The proposal keeps the `tunnel`
> noun to match the internal vocabulary.

## Why

Today the dashboard can only expose itself beyond localhost via **zrok**. `packages/server/src/tunnel.ts` is not a "tunnel module" — it *is* the zrok module: every function name, the config schema, the REST status shape, the Docker image, and the client UI hardcode zrok. Users who already run **ngrok**, **Tailscale**, or **ZeroTier** cannot use them, and there is no seam to add a second provider.

The four tools are not the same shape, and that is the whole design problem:

- **zrok / ngrok** — public reverse proxies. A long-lived child process the server owns proxies traffic and prints a public `https://…` URL. Near-identical lifecycle.
- **Tailscale** — a private mesh VPN with a **daemon** (`tailscaled`). Its tunnel is daemon *state*, not a child process. Offers **both** a public URL (`funnel`) and private mesh access (`serve` / MagicDNS).
- **ZeroTier** — a private mesh VPN daemon (`zerotier-one`). **Private-only** — no public-URL mode at all; hands out a bare `http://10.x.y.z:port` mesh IP with no TLS and no name.

A single provider (zrok, public, HTTPS) also under-serves the pairing story: the QR device-pairing payload's `urls[]` currently comes from one source. Multi-provider makes "print every address this dashboard answers on" and "encode them in the pairing QR" natural.

## What Changes

- **Provider abstraction.** Extract a `TunnelProvider` interface from the zrok-specific `tunnel.ts`. Generic lifecycle (PID files, spawn/timeout/retry, health watchdog, orphan scavenge) stays in a provider-neutral core; provider specifics (binary name, spawn args, URL regex, enrollment check, teardown) move into per-provider implementations. zrok becomes the first implementation behind the seam, with zero behaviour change.
- **Four providers.** zrok (existing, public) · ngrok (new, public, child model — proves the seam) · Tailscale (new, **both** public funnel + private serve, daemon model) · ZeroTier (new, private-only, daemon model).
- **Config: `provider` + `mode`.** `config.tunnel` gains `provider: "zrok"|"ngrok"|"tailscale"|"zerotier"` and `mode: "public"|"private"`, both required when enabled (no silent default). Per-provider sub-configs (`tunnel.zrok`, `tunnel.ngrok`, `tunnel.tailscale`, `tunnel.zerotier`). Back-compat: a legacy config with bare `reservedToken` and no `provider` resolves to `{ provider: "zrok", mode: "public", zrok: { reservedToken } }`. Keys stay named `tunnel`.
- **Daemon-aware lifecycle.** PID-file / watchdog machinery becomes provider-*optional*. Child-model providers (zrok, ngrok) keep it; daemon-model providers (Tailscale, ZeroTier) treat connect/disconnect as idempotent config commands against a long-lived daemon and derive URLs from `status --json`, not spawned stdout.
- **"Accessible at" — print all endpoints.** A new status surface lists every address the dashboard answers on, tagged by kind (public / mesh / magicdns / lan / local) with a TLS / no-TLS badge. Which kinds appear is provider/mode-driven.
- **Manual HTTPS endpoint entry (migrated from `wire-nonzrok-pairing-view`).** An operator with their own reverse-proxy / funnel / tunnel URL adds a non-provider `https`/`wss` endpoint from the UI **without hand-editing JSON**, reusing the existing authenticated `PUT /api/config` (persists `pairing.publicBaseUrls` via `writeConfigPartial` — no new route). It becomes one more source feeding the multi-sourced `getReachableUrls()`, so it appears in "Accessible at" and the pairing QR alongside provider endpoints. The `https`/`wss` gate stays server-side at read-time in `reachableUrls()` (D4/D14): a plain-http entry is dropped before advertisement regardless of how it was written; client validation is UX feedback only. Caveat: the `pairing` merge is shallow, so the client reads current config and PUTs the full `pairing` object.
- **Trusted-network add/remove from a block event.** The server records recent `localhost-guard` denials (a bounded ring buffer) and exposes them so the UI can surface a "this device was refused — Trust this network?" banner with one-click add, plus remove for existing entries. Maps to the existing `config.trustedNetworks`.
- **Per-provider install + enroll.** Install uses the existing per-platform `InstallHints` (tool-registry) — copy-paste + live ✓ detection; never auto-run (elevation). Enroll/auth/activate steps that need no sudo run **server-side via a whitelisted Recipe** keyed by `(provider, step)` — a token/authkey field + **Authenticate** button, and an **Enable/Connect** action, never a free-form command.
- **QR pairing across providers — two QR kinds by transport (Decision 1, corrected after doubt review).** A **pairing QR** encodes the secure payload `{v,id,code,urls[]}` with **TLS endpoints only** (`https`/`wss`, incl. MagicDNS names carrying a `tailscale cert`) — `qr-device-pairing` D14 stays **intact, no relaxation**. A separate **link QR** serves **no-TLS http** mesh/LAN endpoints by encoding **just the URL** (no pairing payload, no `crypto.subtle`, no bearer over the wire); arrival access is governed by `config.trustedNetworks`. This corrects a session-resolved decision that doubt review disproved: http mesh endpoints cannot run the browser pairing crypto (secure-context rule) and would leak the bearer in clear on a non-enclave mesh (Tailscale Share / ZeroTier guest). Electron consumes the pairing payload as a copy-string.
- **UI: a dedicated "Gateway" page + dialog.** A new **Gateway** settings page under the Network nav group (its own page, not crammed into Servers). Trusted networks are *referenced* from the Security page (where `config.trustedNetworks` already lives), not duplicated. A tabbed **Gateway** dialog (Setup / Access & QR / Security) is the "do it now" surface. Both compose the same reusable section components. All user-facing strings say "Gateway".
- **Docker (Decision 2, resolved): host-first.** The four providers ship for host installs first. Docker daemon support for Tailscale/ZeroTier (`tailscaled` / `zerotier-one` with userspace networking + auth key) is a **follow-up change**, not v1. zrok stays in the image as today.

## Discipline Skills

- **security-hardening** — auth tokens posted to the server, the whitelisted-recipe executor (RCE surface on an internet-exposed dashboard), the D14 mesh relaxation, trusted-network mutation, and the migrated manual `publicBaseUrls` write (auth-gated `PUT /api/config`; read-time D4/D14 filter must prevent plain-http advertisement).
- **observability-instrumentation** — new provider status/endpoints, block-event ring buffer, daemon health surfacing.
- **doubt-driven-review** — the daemon-vs-child lifecycle seam and the D14 relaxation before they stand.

## Capabilities

### New Capabilities
- `tunnel-provider` — the provider abstraction, provider matrix, config `provider`/`mode`, daemon-vs-child lifecycle.

### Modified Capabilities
- `zrok-tunnel` / `zrok-process-tunnel` — zrok recast as one implementation behind the `TunnelProvider` seam.
- `qr-device-pairing` — `urls[]` multi-sourced across providers **plus a manual operator-entered `https`/`wss` endpoint** (`pairing.publicBaseUrls`, migrated from `wire-nonzrok-pairing-view`); **D14 unchanged** (pairing payload stays TLS-only). A separate **link QR** (plain URL, no payload) added for no-TLS http mesh/LAN endpoints.
