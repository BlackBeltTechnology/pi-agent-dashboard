## Why

`trustedNetworks` (and its UI write path `auth.bypassHosts`) admits **any** request whose peer IP falls in a listed range with full access and no identity: every phone, guest laptop, or compromised device on `192.168.16.0/24` can drive pi sessions, spawn agents and read files. It is not per-device, not revocable per device, and the network-denial prompt ("allow always") grows it one IP at a time. It existed because LAN pairing was impossible; once `add-lan-knock-pairing` and `add-electron-server-windows` ship, a per-device, revocable, PIN-approved path covers the same LAN use case.

## What Changes

- **BREAKING (behavioral, security): in `pair` mode a network match no longer authenticates.** A `trustedNetworks` / `auth.bypassHosts` match stops satisfying the network guard, the WS upgrade gate, the auth bypass and the device-tier exemption (the `isTrustedSource` call sites). Genuine-local (loopback, no forwarding headers) and authenticated callers (login session, local proof, paired device) are unaffected.
- **New meaning for the list:** networks allowed to **request access** (knock eligibility), extending the default private ranges of `add-lan-knock-pairing`.
- **Network-denial prompt becomes a pairing prompt.** A denied LAN browser sees "Request access" (knock) instead of the operator being asked to trust its IP; in `pair` mode the network plane raises no prompt and offers no accept-to-trust (allow-always → add-IP survives only under `legacy`).
- **Live previews get a per-preview capability path.** The preview frame is sandboxed (opaque origin), so its images, fetches and HMR socket carry no cookie — verified in a browser; today only network trust makes them work remotely. The viewer mints `/live/<id>/~c/<token>/` from an authenticated `/api` call (`control` tier); the token admits only that preview, expires after 30 min idle / 12 h, dies with the device or session, and is stripped before forwarding. The live proxy also strips dashboard cookies (`pi_dash_device`, `pi_dash_token`) but keeps the app's own. (`/editor/*` is guarded but not served.)
- **Migration, phased:**
  1. *Warn* — keep admitting, but count network-only admissions, surface them in `/api/health` and an Access banner ("N devices reach this dashboard by network trust only — pair them"), log the peer once per window.
  2. *Decide once* — on first boot the server persists `network.trustMode`: `"legacy"` when the list holds a non-loopback entry, else `"pair"` (`trustModeOrigin: "upgrade"`). It is never re-derived from the list, so adding a range can never widen admission.
  3. *Flip* (follow-up change, next minor) — upgrade-origin `legacy` installs move to `pair` once the consumer audit has no blockers.
  4. `network.trustMode: "legacy"` set by the operator (`trustModeOrigin: "operator"`) stays an explicit opt-in and the rollback lever.
- **UX:** Mockup: mockups/network-trust.html (in this change) — Security ▸ Network access, Access migration banner, denied-device Request access bar; plan in `mockups/ui-plan.md`.
- **Non-browser consumers audited first:** bridge WebSocket from other machines, MCP clients, CLI, model-proxy `/v1/*`, and the browser in-page server switch (cross-origin `ServerSelector`). Each must have a pairing/token path before the flip, or is listed as a migration blocker.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `trusted-networks`: network match no longer authenticates under `pair` mode; list re-defined as knock eligibility; network-denial prompt verdict replaced; trust mode + migration phases; reporting of network-only admissions.
- `bearer-device-auth`: no trusted-network tier exemption under `pair`.
- `live-server-preview`: ADDED per-preview capability path (mint, accept, lifetime, forwarding) and dashboard-credential stripping in the live proxy.
- `access-settings-tab`: under `pair` the two network stores are headed "may request access", not grants; network denials are not pending requests.
- `trust-and-credential-boundaries`: WebSocket ticket rule gains one carve-out — a `live`-scope upgrade may be admitted by a live-preview capability path; the device cookie stays `Path=/api/`.
- `lan-knock-pairing` (introduced by `add-lan-knock-pairing`; ADDED requirement): knock eligibility extended by the configured list.
- `auth-bypass-url-list`: the `bypassHosts` source-IP auth skip applies only under `legacy` trust mode.
- `oauth-authentication`: the trusted-host leg of the bypass rule applies only under `legacy` trust mode.
- `settings-panel`: Security ▸ Trusted Networks becomes "Network access" — trust-mode radio, mode-specific copy, consequence/migration callouts, pair-mode refused-peer rows without Trust actions.
- `network-denial-ring-buffer`: accept-to-trust and network-plane prompting apply only under `legacy`; "the denial is the access request" is scoped to the denial ledger so the knock route does not contradict it.
- `connection-status-banner`: the "Network not allowed" surface offers Request access as its primary action and never points at the trusted-networks setting.

## Discipline Skills

- `security-hardening` — changes the authentication boundary of every guarded route and WS upgrade.
- `doubt-driven-review` — breaking, hard-to-reverse trust-model change; review migration and the non-browser consumer audit before it stands.
- `observability-instrumentation` — network-only admission counters in `/api/health`, migration-readiness logging.
- `review-code` — before commit.

## Impact

- **Server:** `packages/server/src/auth/localhost-guard.ts` (`isTrustedSource`, `hasNetworkPassCondition`), `auth/auth-plugin.ts` (bypass + WS upgrade), `server.ts` (unauthenticated WS upgrade branch), `auth/route-tier-gate.ts`, `live-server/live-server-proxy.ts` + `routes/live-server-routes.ts` (capability mint/accept, path + redirect rewriting, credential stripping, HTTP + WS), `access/` (network-plane prompt), `/api/health` posture.
- **Shared:** `packages/shared/src/config.ts` (`network.trustMode`, list semantics).
- **Client:** Security ▸ Network access, Access headings + migration banner, network-denied bar, `LiveServerViewer` (frames the capability path).
- **Docs:** README / `docs/faq.md` LAN-access instructions; release note flagged **BREAKING**.
- **Rollback:** `network.trustMode: "legacy"` restores current behaviour without a downgrade.
- **Sequence:** 4 of 4 — must not ship before `add-lan-knock-pairing` and `add-electron-server-windows`, or LAN users are locked out with no friendly way back in.
