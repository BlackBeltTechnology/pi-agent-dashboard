## Why

LAN discovery finds peers, but the entries it produces rot. Observed on a two-Mac LAN (2026-10-11):

- `bonjour-service` publishes `A`/`AAAA` records under `os.hostname()` — the machine's **own** `.local` name — listing every non-internal interface address (Tailscale `utun`, docker bridges, stale IPv6). macOS `mDNSResponder` owns that name with a different address set, logs `will deregister … due to multicast conflict`, and renames the host. The iMac drifted `home-imac-75112` → `home-imac-75340`; this Mac carries stale adverts for `-8486`/`-8518` while being `-8559`.
- `knownServers` entries are keyed by `host`. The saved `home-imac-75112.local:8000` no longer resolves, while the same server answers at `home-imac-75340.local:8000` and `192.168.16.220:8000`.
- `ServerSelector` maps **every** transport failure on a LAN/`.local` host to "CORS-blocked — allowlist this origin on the remote" (`isLanHost` → `cors-blocked`). A dead hostname is reported as a CORS problem; the user chases the wrong fix.
- Advertised `version` is always `0.0.0` (`_require("../../package.json")` resolves outside the package).
- `createBrowser` keys `server-up` by `pickBestHost(service)` but `server-down` by `service.host`, so a down event for a non-DNS-safe host never removes the peer.

There is no stable identity in the advert: a renamed server looks like a new one, and a spoofed advert looks like a real one. This change is the foundation for LAN pairing (`add-lan-knock-pairing`) and Electron server windows (`add-electron-server-windows`).

## What Changes

- **Dashboard-owned mDNS names.** Service instance name and SRV target/`A`/`AAAA` records use names derived from the server identity and port (`pi-dashboard-<id12>-<port>[.local]`), never `os.hostname()`. The OS hostname is no longer contested, so macOS stops renaming the machine, and a rename no longer changes the advert.
- **Identity in the advert.** TXT gains the server identity fingerprint (`fp`, from `identity.ts`) and a display `name` (current OS hostname, display only). The real package version is published.
- **Advertised addresses are limited** to addresses the server serves on and peers can use (specific/hostname `bindHost` honoured; IPv6 link-local dropped) — consistent with the honest-advertisement rule of `fix-bridge-mdns-migration-hijack`.
- **Peers keyed by service instance**, symmetric for up/down (fixes the mismatch), with advert updates and a periodic re-browse refreshing addresses and removing peers that vanished without a goodbye. `DiscoveredServer` gains `fingerprint`, `name`, `addresses`; a local peer's `host` is an IPv4 literal (never an IPv6 literal).
- **Pinned known servers with move suggestions.** `KnownServer` gains an optional `fingerprint` (unique per fingerprint + port), pinned only after the server **proves** it (`POST /api/pair/challenge`) — on operator add or backfill at the stored address; an add never clears a pin. When the stored address stops proving the identity and a discovered peer at a new address proves it, the entry gets a **verified move suggestion** ("home-imac moved to X \u2014 Update"); only an operator click rewrites `host`/`port` (re-verified, logged). An advert alone never writes config; adding an address that proves a different identity than pinned is refused (`409 identity_changed`).
- **BREAKING (behavioral): known-server mutations are operator-only.** `POST`/`DELETE /api/known-servers`, accept-move and the probe require an operator credential (login, local proof, local token); network-trusted browsers can still list entries.
- **Honest reachability labels.** An operator-only server-side probe of **known-server entries only** reports `name-not-resolved` / `refused` / `timeout` / `reachable`. The selector shows the CORS/network-blocked hint only when the server reaches the target but the browser cannot; otherwise the real cause (e.g. "Name not found — server may have been renamed").

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `mdns-discovery`: identity-derived names, TXT identity fields, address filtering, instance-keyed browsing with periodic refresh, probe-conflict retry.
- `known-servers`: pinned fingerprint on entries, operator-only mutations, backfill, verified move suggestion + operator accept, server-side probe, fingerprint-aware Network Discovery.
- `server-selector`: reachability states distinguish name-not-resolved / moved / refused / timeout / CORS-blocked.

## Discipline Skills

- `security-hardening` — an mDNS advert is untrusted input; a move suggestion requires the identity challenge, a dead stored address and an operator click (advert-spoof / LAN relay). The server-side probe and the add-time challenge are outbound-request surfaces: operator-only, persisted entries only, fixed URL, no redirects.
- `doubt-driven-review` — changing the advertised hostname affects every consumer of discovery (bridge `server-auto-start`/`instance-verification`, `isLocalService`); review before it stands.
- `observability-instrumentation` — log move suggestions/accepts (`fp`, old → new host) and the advertised hostname at startup.
- `review-code` — before commit.

## Impact

- **Shared:** `packages/shared/src/mdns-discovery.ts` (names, TXT, address filter, browser keying + update events, `formatHostPort`), `packages/shared/src/server-pinning.ts` (new `proveServerIdentity`; `challengePinnedServer` unchanged), `packages/shared/src/config.ts` (`KnownServer.fingerprint?`, `parseKnownServers` pass-through + duplicate collapse), `packages/shared/src/rest-api.ts` (`DiscoveredServerInfo` fields, probe result type).
- **Server:** `packages/server/src/server.ts` (advertise with identity + version + pre-resolved addresses, shared peer key, self-exclusion by fingerprint, move-suggestion wiring), `packages/server/src/routes/known-servers-routes.ts` (operator-only mutations, challenge on add, `409 identity_changed`, probe, accept-move, serialized writes), new move-suggestion unit.
- **Client:** `packages/client/src/components/connectivity/ServerSelector.tsx`, `NetworkDiscoverySection.tsx`, `packages/client/src/lib/api/known-servers-api.ts`.
- **Extension:** no code change expected; verify bridge auto-start adopts the local server via its IPv4 literal.
- **Compatibility:** additive TXT keys and config field; peers from older versions are still discovered (keyed by their own instance). Old clients resolve the new SRV target where mDNS name resolution exists. Non-operator browsers lose add/remove of known servers (breaking, release note).
- **Rollback:** revert restores `os.hostname()` publishing; older code drops `fingerprint` on the next write; entries moved to a `pi-dashboard-*.local` host must be re-added (release note).
- **Sequence:** 1 of 4 — prerequisite for `add-lan-knock-pairing`, `add-electron-server-windows`, `retire-trusted-networks-bypass`.
