## Why

LAN discovery finds peers, but the entries it produces rot. Observed on a two-Mac LAN (2026-10-11):

- `bonjour-service` publishes `A`/`AAAA` records under `os.hostname()` — the machine's **own** `.local` name — listing every non-internal interface address (Tailscale `utun`, docker bridges, stale IPv6). macOS `mDNSResponder` owns that name with a different address set, logs `will deregister … due to multicast conflict`, and renames the host. The iMac drifted `home-imac-75112` → `home-imac-75340`; this Mac carries stale adverts for `-8486`/`-8518` while being `-8559`.
- `knownServers` entries are keyed by `host`. The saved `home-imac-75112.local:8000` no longer resolves, while the same server answers at `home-imac-75340.local:8000` and `192.168.16.220:8000`.
- `ServerSelector` maps **every** transport failure on a LAN/`.local` host to "CORS-blocked — allowlist this origin on the remote" (`isLanHost` → `cors-blocked`). A dead hostname is reported as a CORS problem; the user chases the wrong fix.
- Advertised `version` is always `0.0.0` (`_require("../../package.json")` resolves outside the package).
- `createBrowser` keys `server-up` by `pickBestHost(service)` but `server-down` by `service.host`, so a down event for a non-DNS-safe host never removes the peer.

There is no stable identity in the advert: a renamed server looks like a new one, and a spoofed advert looks like a real one. This change is the foundation for LAN pairing (`add-lan-knock-pairing`) and Electron server windows (`add-electron-server-windows`).

## What Changes

- **Dashboard-owned mDNS hostname.** The SRV target and `A`/`AAAA` records are published under a dashboard-owned name derived from the server identity (e.g. `pi-dashboard-<fp-prefix>.local`), never under `os.hostname()`. The OS hostname is no longer contested, so macOS stops renaming the machine.
- **Identity in the advert.** TXT gains the server identity fingerprint (`fp`, from `identity.ts`) and a display `name` (machine name without the conflict suffix). The real package version is published.
- **Advertised addresses are filtered** to interfaces the server actually serves on, given `bindHost` (consistent with the honest-advertisement rule of `fix-bridge-mdns-migration-hijack`).
- **Peers keyed by fingerprint.** `DiscoveredServer` gains `fingerprint` and `name`; the continuous browser keys up/down by fingerprint when present (fixes the up/down key mismatch). Servers without `fp` (older versions) fall back to `host:port`.
- **Self-healing known servers.** `KnownServer` gains an optional `fingerprint`. When a discovered peer's fingerprint matches a known server and the peer **proves** that identity (`POST /api/pair/challenge`, verified with `challengePinnedServer` from `server-pinning.ts`), the server updates the known entry's `host`/`port` and broadcasts `servers_updated`. An advert whose `fp` fails the challenge never rewrites a known entry.
- **Honest reachability labels.** A server-side probe of **known-server entries only** (no arbitrary URLs) reports `name-not-resolved` / `refused` / `timeout` / `reachable`. The selector shows "CORS-blocked" only when the server-side probe reaches the target but the browser fetch fails; otherwise it shows the real cause (e.g. "Name not found — server may have been renamed").

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `mdns-discovery`: advertisement hostname, TXT identity fields, address filtering, fingerprint-keyed browsing.
- `known-servers`: optional fingerprint on entries, identity-verified host healing, server-side probe of known entries.
- `server-selector`: reachability states distinguish name-not-resolved / refused / timeout / CORS-blocked.

## Discipline Skills

- `security-hardening` — an mDNS advert is untrusted input; healing a known entry from it must require the identity challenge (advert-spoof redirect). The server-side probe is an SSRF surface: restrict to persisted known entries, guard it with `networkGuard`.
- `doubt-driven-review` — changing the advertised hostname affects every consumer of discovery (bridge `server-auto-start`/`instance-verification`, `isLocalService`); review before it stands.
- `observability-instrumentation` — log heal events (`fp`, old → new host) and the advertised hostname at startup.
- `review-code` — before commit.

## Impact

- **Shared:** `packages/shared/src/mdns-discovery.ts` (publish host, TXT, address filter, browser keying, version), `packages/shared/src/config.ts` (`KnownServer.fingerprint?`), `packages/shared/src/rest-api.ts` (`DiscoveredServerInfo` fields, probe result type).
- **Server:** `packages/server/src/server.ts` (advertise with identity, heal on `server-up`), `packages/server/src/routes/known-servers-routes.ts` (probe route, fingerprint field).
- **Client:** `packages/client/src/components/connectivity/ServerSelector.tsx`, `NetworkDiscoverySection.tsx`, `packages/client/src/lib/api/known-servers-api.ts`.
- **Extension:** verify `isLocalService` / bridge discovery still recognise the local server under the new hostname (address match path).
- **Compatibility:** additive TXT keys and config field; old peers without `fp` keep host-keyed behaviour. Old clients resolve the new SRV target normally.
- **Rollback:** revert restores `os.hostname()` publishing; persisted `fingerprint` fields are ignored by older code.
- **Sequence:** 1 of 4 — prerequisite for `add-lan-knock-pairing`, `add-electron-server-windows`, `retire-trusted-networks-bypass`.
