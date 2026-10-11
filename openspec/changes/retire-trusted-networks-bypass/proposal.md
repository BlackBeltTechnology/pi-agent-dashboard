## Why

`trustedNetworks` (and its UI write path `auth.bypassHosts`) admits **any** request whose peer IP falls in a listed range with full access and no identity: every phone, guest laptop, or compromised device on `192.168.16.0/24` can drive pi sessions, spawn agents and read files. It is not per-device, not revocable per device, and the network-denial prompt ("allow always") grows it one IP at a time. It existed because LAN pairing was impossible; once `add-lan-knock-pairing` and `add-electron-server-windows` ship, a per-device, revocable, PIN-approved path covers the same LAN use case.

## What Changes

- **BREAKING (behavioral, security): a network match no longer authenticates.** A `trustedNetworks` / `auth.bypassHosts` match stops satisfying the network guard, the WS upgrade gate, the auth bypass and the device-tier exemption (the `isTrustedSource` call sites). Genuine-local (loopback, no forwarding headers) and authenticated callers (login session, local proof, paired device) are unaffected.
- **New meaning for the list:** networks allowed to **request access** (knock eligibility), extending the default private ranges of `add-lan-knock-pairing`.
- **Network-denial prompt becomes a pairing prompt.** A denied LAN browser sees "Request access" (knock) instead of the operator being asked to trust its IP; the allow-always → add-IP verdict is removed from the network plane.
- **Paired credentials cover every guarded namespace.** The `pi_dash_device` cookie (today `Path=/api/`) is accepted on `/live/*` and `/editor/*` (or an equivalent per-namespace credential), so a paired browser loses nothing that network trust used to grant.
- **Migration, phased:**
  1. *Warn* — keep admitting, but count network-only admissions, surface them in `/api/health` and an Access banner ("N devices reach this dashboard by network trust only — pair them"), log the peer once per window.
  2. *Flip* — new default `network.trustMode: "pair"`; existing installs with a non-empty list stay on `"legacy"` for one minor release with the banner, then flip.
  3. `network.trustMode: "legacy"` remains an explicit operator opt-in (rollback lever).
- **Non-browser consumers audited first:** bridge WebSocket from other machines, MCP clients, CLI, model-proxy `/v1/*`. Each must have a pairing/token path before the flip, or is listed as a migration blocker.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `trusted-networks`: network match no longer authenticates under `pair` mode; list re-defined as knock eligibility; network-denial prompt verdict replaced; trust mode + migration phases; reporting of network-only admissions.
- `bearer-device-auth`: device credential accepted across all guarded namespaces (`/live/*`, `/editor/*`), not only `/api/*`.
- `lan-knock-pairing` (introduced by `add-lan-knock-pairing`): knock eligibility extended by the configured list.

## Discipline Skills

- `security-hardening` — changes the authentication boundary of every guarded route and WS upgrade.
- `doubt-driven-review` — breaking, hard-to-reverse trust-model change; review migration and the non-browser consumer audit before it stands.
- `observability-instrumentation` — network-only admission counters in `/api/health`, migration-readiness logging.
- `review-code` — before commit.

## Impact

- **Server:** `packages/server/src/auth/localhost-guard.ts` (`isTrustedSource`, `hasNetworkPassCondition`), `auth/auth-plugin.ts` (bypass + WS upgrade), `server.ts` (unauthenticated WS upgrade branch), `auth/route-tier-gate.ts`, `auth/bearer-auth.ts` (cookie scope), `access/` (network-plane prompt), `/api/health` posture.
- **Shared:** `packages/shared/src/config.ts` (`network.trustMode`, list semantics).
- **Client:** Access settings (trusted networks UI copy → "may request access"), network-denied surface, migration banner.
- **Docs:** README / `docs/faq.md` LAN-access instructions; release note flagged **BREAKING**.
- **Rollback:** `network.trustMode: "legacy"` restores current behaviour without a downgrade.
- **Sequence:** 4 of 4 — must not ship before `add-lan-knock-pairing` and `add-electron-server-windows`, or LAN users are locked out with no friendly way back in.
