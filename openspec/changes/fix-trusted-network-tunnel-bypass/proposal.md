## Why

A trusted-network entry that covers loopback (`"127.0.0.1"`, `127.0.0.0/8`, `::1`) silently exempts **every tunnel visitor** from authentication. Tunnel agents (zrok, ngrok, `tailscale serve`) relay traffic from a `127.0.0.1` socket peer and inject `X-Forwarded-*`. `isGenuinelyLocal` correctly refuses such requests (D10, narrowed), but the next pass condition — `isBypassedHost(request.ip, trusted)` — matches the raw peer IP and never looks at the forwarding headers. Result: a public zrok URL grants unauthenticated access to session, terminal and git routes.

Reproduced on a live instance with `trustedNetworks: ["192.168.16.0/24", "127.0.0.1"]`: `GET /api/sessions` with a loopback peer and `X-Forwarded-For: 203.0.113.9` returned **200 with session data**.

This is distinct from B14 in `harden-trust-and-credential-boundaries` (marker-less tunnel with **no** forwarding header → `isGenuinelyLocal` true). The audit there marks zrok "safe because it injects headers" — this change closes the path where header injection does not help. It is a prerequisite for the welcome tutorial's zrok + device-pairing chapter, which instructs users to open a public URL.

## What Changes

- Introduce one shared predicate, `isTrustedSource(ip, headers, trusted)`: a trusted-network match SHALL NOT apply when the peer is in the loopback **range** (`127.0.0.0/8`, `::1`, `::ffff:127.0.0.0/104` — new leaf helper `isLoopbackRange`, not the 3-address `isLoopback` set) **and** the request carries a proxy-forwarding header. Loopback entries therefore never admit relayed traffic; genuine local traffic is already admitted by `isGenuinelyLocal`.
- Route every peer-IP trust decision through it — the five sites that currently call `isBypassedHost(peerIp, …)` directly:
  - `auth/localhost-guard.ts` `hasNetworkPassCondition` (HTTP network guard + universal hook)
  - `auth/auth-plugin.ts` `onRequest` `bypassHosts` skip (OAuth bypass)
  - `auth/auth-plugin.ts` `validateWsUpgrade` (WS upgrade, auth configured)
  - `server.ts` WS upgrade branch (auth not configured)
  - `auth/route-tier-gate.ts` `tierRefusalFor` (device-tier exemption)
- A network denial from a relayed-loopback peer SHALL NOT raise a network-plane grant prompt (today the prompt offers "trust `127.0.0.1`?" — one click trusts the whole tunnel; after this change that entry would be inert, a grant→deny loop). The block-event ring buffer already marks such peers `trustable: false`; the prompt path is brought in line.
- Warn once per distinct set of loopback-covering entries — and surface as an additive `/api/health` field `trustPosture: { trustedHasLoopback } | null` (disclosed only via `canDiscloseAccessPosture`) — when `trustedNetworks` or `auth.bypassHosts` contains a loopback entry, stating it is ineffective for tunnel traffic and redundant for local traffic.
- **BREAKING (behavioral, security):** a deployment that relied on a loopback trusted entry to reach the dashboard through a tunnel without signing in (typically `tailscale serve` in private mode) will now receive the `network_not_allowed` 403 / login redirect. Same for a same-host reverse proxy that injects `X-Forwarded-*` (nginx/Caddy/Traefik TLS front) admitted today only by a loopback entry. Remedy: pair the device (bearer) or sign in (OAuth). No config migration; the entry becomes inert, not removed.

Not in scope: marker-less tunnels (B14, owned by `harden-trust-and-credential-boundaries`); `cors-origin.ts` trusted-host check (matches the Origin host, not the peer IP); honoring the forwarded client IP for trust decisions (see design D2).

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `trusted-networks`: the network guard, WS upgrade and auth-bypass requirements gain the "relayed loopback is never trusted" rule; the guard factory's outdated "any loopback IP allowed" clause is corrected to genuine-local.

## Impact

- **Server code:** `packages/server/src/auth/loopback.ts` (new `isLoopbackRange`), `auth/localhost-guard.ts` (new `isTrustedSource`, used by `hasNetworkPassCondition`; denial observer skipped for relayed loopback), `auth/auth-plugin.ts` (two sites), `auth/route-tier-gate.ts`, `server.ts` (WS no-auth branch), warning memoized on the trusted-array reference in `localhost-guard.ts`, `routes/system-routes.ts` (`trustPosture`).
- **APIs:** additive `/api/health` field `trustPosture` (nullable, disclosure-gated). Affected requests move from 200 to the existing 403 `network_not_allowed` / 401 WS / OAuth redirect.
- **Client:** none required; the existing denial banner already renders `network_not_allowed` with its hint.
- **Compatibility / rollback:** pure server logic, no persisted-state change — rollback is a revert + `POST /api/restart`. Local same-host use is unaffected (genuine-local path untouched).

## Discipline Skills

- `security-hardening` — trust-boundary tightening on untrusted (tunnel) input; every peer-IP trust site must go through the one predicate.
- `doubt-driven-review` — semi-irreversible local-UX change: prove genuine-local desktop, LAN trusted-CIDR, and paired-device-over-tunnel flows still work before merge.
- `scenario-design` — matrix of peer (loopback / LAN / public) × forwarding header (none / present) × trusted entry (none / loopback / LAN CIDR) × auth (off / on / bearer).
