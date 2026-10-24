# Proposal

## Why

Machines differ in their interfaces and addresses: virtual-machine bridges, Docker, VPNs, Tailscale, IPv6 privacy addresses, corporate subnets. Today a single misleading address can break a working pairing. On 2026-10-22 the iMac's Electron app resolved MacBook 2's mDNS name to `192.168.64.1`. That is the default macOS Virtualization bridge address, present on **both** Macs, so the request reached the iMac's own dashboard. Re-verification proved the iMac's own fingerprint, called it an identity mismatch and blanked the window. MacBook 2's key had never changed. The same address overlap also made the iMac classify MacBook 2's mDNS advert as *local*, hiding it from discovery.

An interface-name blocklist (the hotfix) cannot be complete for every user's network. This change makes correctness depend on proven identity rather than on address layout.

## What Changes

- **Proof is bound to an address literal (http).** Electron resolves a hostname candidate to literals and proves each one. The bearer exchange, the window origin and re-verification use the literal that proved the pin, so a `.local` name can no longer re-resolve to another machine between proof and use.
- **A foreign proof is classified as `self` or `foreign`.**
  - `self` is this machine's own dashboard, a fingerprint proven locally and never taken from an advert. It is a wrong address and never raises an alarm.
  - `foreign` is anything else. It keeps strict handling.
  - mDNS adverts are unauthenticated, so they never downgrade a foreign proof.
- **Locality by fingerprint.** An mDNS advert is local only when its fingerprint equals this machine's own, whenever both are known. Overlapping addresses no longer turn a remote server into "local". This affects Electron and the server. The extension bridge keeps today's heuristic, because it holds no own fingerprint (follow-up).
- **Re-select instead of ending the pairing.** Both re-verification paths (scheduled every 60 s / on focus / on resume, and the credential re-check) run one transition:
  - On any non-ok proof, the window is blanked and every device cookie in the partition is removed (awaited).
  - Host selection then runs again. If a candidate proves the pin, the window is replaced there through the normal open path.
  - Otherwise, a foreign proof raises the identity-mismatch report once; only self or unreachable answers give "not reachable" with retry.
- **Candidate ordering without vetoes.**
  - This machine's own addresses are probed last rather than dropped.
  - On-link addresses come first, using each interface's real prefix.
  - The hard cap of 3 discovered addresses is replaced by ordered batches of 12, run until a proof or the 5 s deadline, with at most 8 literals per hostname. This is bounded, not complete.
- **Pairing tries alternatives.** A pairing target carries the advert's other literals. `self` moves on to the next one, and `foreign` stays a mismatch.
- **Server.**
  - Adding a known server whose address proves this server's own fingerprint returns `409 self_address` (taking precedence over `identity_changed`).
  - Backfill and move suggestions never use a self address.
  - mDNS advertising skips macOS virtual bridges (`bridgeN`, `vmnet`, `vboxnet`). That filter is best-effort noise reduction only.
- **Observability.** Skipped and moved candidates are logged with host, short fingerprint and reason, and never with a credential.
- **Out of scope (documented residual):** on plain `http`, address takeover between proof and use, or an on-path relay, is not closed. That requires TLS key pinning.
- The hotfix already in the working tree is absorbed. Its `probe` self check becomes D2.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `electron-server-windows`: literal binding, proof classification, the re-selection transition, candidate ordering and cap, pairing alternatives, skip logging; existing pairing and takeover scenarios are qualified.
- `mdns-discovery`: locality by fingerprint in browsing; the virtual-bridge advertising exclusion; consumers must not assume advertised addresses are unique.
- `lan-knock-pairing`: the native-knock identity check treats a self proof as a wrong address.
- `known-servers`: add returns `self_address` with precedence over `identity_changed`; backfill and move suggestions skip self.

## Impact

- **Electron:** `packages/electron/src/lib/server-windows.ts` (`probe`, `pickHost`, `reverify`, `recheck`, `blankAfterMismatch`, `loadVerified`, `discoveredRefs`, pairing entry points), `server-discovery.ts` (`buildCandidates`, cap, new `classifyProof` and locality helpers), `pairing-client.ts` (`PairingTarget.alternatives`), `server-windows-main.ts` (lookup, interfaces and `ownFingerprint` ports).
- **Shared:** `packages/shared/src/mdns-discovery.ts` (`BRIDGE_IFACE`, `isLocalService`/`createBrowser` `ownFingerprint`).
- **Server:** `packages/server/src/routes/known-servers-routes.ts` (add, backfill), `known-server-moves.ts` (skip self), and the discovery browser wiring that passes the server fingerprint.
- **Client:** `packages/client/src/lib/remote-access/connect-machine.ts`, plus one i18n key in 3 locales.
- **Coordination:** `group-servers-by-identity` (active, 0 tasks done) gets a coordination task. Its route states must add `self`, and its add delta keeps `self_address` precedence. This change lands first.
- No new dependencies and no storage migration. REST change: new 409 error code `self_address`.

## Discipline Skills

- `security-hardening`: changes when a foreign proof is treated as hostile, and changes cookie lifetime on non-ok proofs.
- `observability-instrumentation`: logs skip and move reasons.
- `doubt-driven-review`: reviews the classification rule before it stands. Ran in planning.
