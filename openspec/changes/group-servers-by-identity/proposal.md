# Proposal

## Why

The server selector and Settings treat an address (`host:port`) as a server. One machine that is reachable on its loopback, its LAN IP, an mDNS `.local` name and a zrok tunnel shows up as several unrelated rows, and the check behind each row (`GET /api/health`) proves nothing about *who* answered. Worse, a server this device has no credential for is a dead row: there is no way to ask for access from the list, and the only "Connect" button lives in Settings and always opens the peer's own page in a new tab. The server already has a stable identity (Ed25519 fingerprint, `POST /api/pair/challenge`, advertised as `fp` in mDNS); the lists should be built on it.

## What Changes

- A server becomes one row/card per identity (fingerprint). Its addresses become **routes** (loopback, LAN IP, mDNS name, tunnel, public URL), each recording where it was learned (saved, mDNS, learned at pairing). A route's kind is derived from its scheme and host by one shared function and is not stored.
- Every route is checked with the identity challenge (signature verified), not `/api/health`. A route that proves a different identity than its group is shown as refused ("different identity"), is never used, and receives no credential. A route that cannot answer the challenge (older server) is shown as "can't prove identity"; old servers that advertise no `fp` stay listable through the existing trust-on-first-use confirmation.
- The best route is the proven one; in lists and browser switching https beats http only when its latency is within 50 ms of the best http route, otherwise lowest latency. Where Electron sends a stored credential it keeps its current order (stored https, stored http, then discovered; latency not compared).
- Header selector and Settings ▸ Servers show one entry per identity with a route table. Settings merges "Known servers" and "Network discovery" into one list; discovery becomes a source and the scan button stays.
- **BREAKING (storage, compatible):** `knownServers` entries become `{ fingerprint?, label?, routes[], addedAt }`. Each entry also always keeps `host`/`port` mirroring its primary route so an older build still reads it; legacy entries are read as single-route entries (a legacy port-443 entry reads as https) and the file is not rewritten until the next write. Rollback notes, including the https-scheme loss on an old-build rewrite, are in design.md.
- **BREAKING (REST shape, additive):** `GET /api/known-servers` returns `routes`; `POST /api/known-servers` accepts `scheme` and attaches a route to the entry that already holds the proven identity (the `409 already_known` refusal goes away and the add wizard is updated to match); `DELETE` can remove one route or a whole identity; the probe takes a route scheme and reports the proven fingerprint. The server's own identity proof becomes scheme-aware (https with normal certificate checks, no redirects, 2 s), and the add-path challenge toward an operator-supplied host is bounded.
- Pair action on a row with no credential on this device. Browser: "Request access…" for any on-link discovered or saved LAN route is a plain new-tab navigation to that server's own `/pair?request` (nothing is sent or proven first, as Settings Connect does today); otherwise "Pair with code…", which checks the pasted code is for this server and opens the pairing landing at the payload's own https origin. Electron: "Request access…" (existing main-process knock + Connecting window, identity proven first), "Verify and request access…" for a server that advertises no fingerprint, and "Pair with code…" as an **in-app redeem** (the user pastes the text into the app-owned Connecting window; the main process checks it, proves identity, redeems, and stores the credential in the keyring). Refusals reuse the existing refusal meanings.
- Route delegation: mDNS keeps carrying only `fp`. A server's other routes reach a device only as part of a successful pairing result: the approved `POST /api/pair/poll` answer now carries `routes` (the same TLS-gated list a QR payload carries). They are never on the public challenge and never in mDNS TXT. The poll answer lists only `https` origins (not the `wss://` or test-harness loopback entries a QR payload may carry). A device keeps a delivered route only after the challenge at that route proves the pinned fingerprint; browsers ignore `routes` (the known-servers store is the operator's config, not the browser's) and only Electron stores them, in its keyring.
- Electron: the main window gets a read-only `listServers` bridge and a `pairWithCode` bridge (same local-origin gate as `openServerWindow`) so the list can show which servers are paired on this device and start an in-app code pairing; host selection keeps its current order; keyring hosts record their source and accept delivered routes after proof (at most 3 per pairing).
- "Paired on this device?" comes from the Electron keyring. A browser tab on another origin shows "Unknown in this tab" (device-key mutual check, a separate change, resolves it).
- Mockup: mockups/server-identity-pairing (in this change)

## Capabilities

### New Capabilities

- `server-identity-routes`: a server is its fingerprint; routes, derived route kinds, route proof states, best-route rule, grouping rule, route delegation at pairing, the pair action per row and client, and the "paired on this device" display rule.

### Modified Capabilities

- `known-servers`: persisted entry shape (routes, legacy mirror, migration), list/add/remove/probe REST contracts, scheme-aware server proof, move suggestion and backfill scoped to the primary route, `parseRouteInput`, merged Settings ▸ Servers section, discovery as a source, UI-contract states.
- `server-selector`: rows per identity, identity-based probe, new states and the pair action inside the menu, Electron behaviour for unpaired rows, APG roles, and the `servers_discovered` message now feeding the merged list.
- `first-run-wizard`: the post-launch remote-attach pointer now names Settings → Network → Servers.
- `lan-knock-pairing`: approved poll carries `routes`; clients store a delivered route only after proving it.
- `mdns-discovery`: the advertisement is explicitly limited to `fp` for identity and carries no routes.
- `electron-server-windows`: keyring hosts record their source and accept delivered routes after proof; the main window can read the servers list and start an in-app code pairing.

## Impact

- Shared: `packages/shared/src/config.ts` (`KnownServer`, `parseKnownServers`), `rest-api.ts`, `server-pinning.ts` (consumers), `pairing-knock-client.ts` (poll `routes`), a new pure route module (`classifyRoute`, grouping, ranking, delegated-route validation, pair action).
- Server: `routes/known-servers-routes.ts` (scheme-aware proof, bounded add challenge), `known-server-moves.ts` (primary-route scheme), `routes/pairing-routes.ts` (poll, https-only `routes`), `config-api.ts` write path.
- Client: `ServerSelector.tsx`, `KnownServersSection.tsx`, `NetworkDiscoverySection.tsx` (merged), `settings/SettingsPanel.tsx` (mounts one section), `lib/api/known-servers-api.ts`, `lib/util/parse-host-input.ts` (new `parseRouteInput` beside it), `lib/remote-access/connect-machine.ts` and `components/remote-access/ConnectMachine.tsx` (no more `already_known`), `lib/pairing/pair-protocol.ts` (challenge reuse), new pairing dialogs, i18n strings.
- Electron: `preload-main.ts`, `lib/servers-ipc.ts`, `lib/server-keyring.ts`, `lib/pairing-client.ts` plus a new in-app code-redeem module and Connecting-window code mode (`lib/connecting-window.ts`), `lib/server-windows.ts`. An Electron rebuild and relaunch is needed to verify.
- Unaffected Electron readers of `knownServers`: `local-proof-bootstrap.ts:173` and `server-lifecycle.ts:390-399` read only `host`/`port`/`label`, which the mirror preserves.
- Compatibility: older server builds read the new `config.json` (host/port mirror; https scheme and secondary routes are lost on their next write, see design D5); older clients ignore `routes`. Mixed fleets: a server without the new poll `routes` simply delivers none; an older add wizard sees success instead of `409 already_known`; a new client treats a server that returns no `routes` as pre-routes and offers no https add.
- Related active change `close-residual-audit-findings` adds audit lines for device revoke in `paired-devices.ts`; this change does not touch that file.
- Follow-up: `device-key-mutual-check` builds on this change (it extends the same `POST /api/pair/challenge` call and the same rows to show per-device status).

## Non-goals

- Device keys, the mutual check, companion keys, revoke-as-state (all in `device-key-mutual-check`).
- Cross-origin browser knock; a browser tab keeps opening the peer's own `/pair?request`.
- Changing knock admission gates (`acceptLanRequests`, LAN on-link, mutation-origin gate).
- Advertising routes in mDNS.
- Pairing or discovery features in the neutral mobile shell (it has no mDNS and no knock today; unchanged).
- Persisting delivered routes in a browser (only Electron's keyring stores them).

## Discipline Skills

- `security-hardening`: untrusted adverts and delegated routes (only `https` DNS-name origins, capped, proven before use), no credential sent to a refused route, probe targets restricted to saved routes, the bounded add-path challenge toward an operator-supplied host (scheme allowlist, no redirects, 2 s, size cap, TLS verification), and the Electron in-app code redeem (pasted payload checked against the pinned fingerprint, identity proven before redeeming, text and credential kept away from renderers and logs).
- `doubt-driven-review`: `config.json` `knownServers` schema migration, `/api/known-servers` and `/api/pair/poll` response shapes, and the new Electron bridge method are hard to undo once shipped.
- `observability-instrumentation`: route attach/refuse/migrate log lines, delivered-route proven/dropped lines (server and Electron), the probe-proved-fingerprint line and the extended probe; no secrets in logs.
- `review-code`: run before commit once tests pass.
