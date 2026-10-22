# Design

## Context

See proposal.md for motivation. What exists today (all verified in source):

- **Rows are addresses.** `buildServerEntries` keys rows by `host:port` (`packages/client/src/components/connectivity/ServerSelector.tsx:63`). The per-row probe is `fetch http://host:port/api/health` on dropdown open (`ServerSelector.tsx:222`), http only, and proves nothing about identity.
- **Settings has two lists.** `KnownServersSection.tsx` (saved list) and `NetworkDiscoverySection.tsx` (mDNS scan), both mounted as separate `Section`s in `SettingsPanel.tsx:3760-3768`. The discovery "Connect" button opens the peer's `http://host:port/pair?request` in a new tab with `noopener`, sends nothing, and builds the URL only after checking it round-trips to the advertised host and port (`NetworkDiscoverySection.tsx:84-90`, `:141`).
- **The saved list is the dashboard server's config, not the device's.** `knownServers` lives in the dashboard's `config.json`; mutations are operator-only (`packages/server/src/routes/known-servers-routes.ts:4-6`). One entry per `host:port`, with an optional pinned `fingerprint` (`packages/shared/src/config.ts:535-546`). `parseKnownServers` keeps only the fields it knows, drops entries without a string `host` and numeric `port` (`config.ts:2406`) and drops a later entry with the same (fingerprint, port) (`config.ts:2413`). Adding an identity that another entry already holds at the same port answers `409 already_known` (`known-servers-routes.ts:206`); a changed identity at a pinned address answers `409 identity_changed` (`:182`). `data.updated: true` is returned today only when a stale holder is moved to the new host (`:210`, `persist(list, reply, true)`).
- **Server-side proof is http only.** The add/backfill/accept-move `prove` helper builds `http://host:port` (`known-servers-routes.ts:130-131`); the probe fetches `http://…/api/health` (`:310`); move suggestions prove `http://` at the stored and the discovered address (`packages/server/src/known-server-moves.ts:137`, `:149`). `proveServerIdentity` itself takes any base URL, uses `redirect: "manual"`, a 4 KiB body cap and a 2 s default timeout (`packages/shared/src/server-pinning.ts:182`, `:201-216`), and Node `fetch` verifies TLS certificates by default.
- **Move suggestions are keyed by (fingerprint, port)** of an entry (`known-server-moves.ts:60`, `:126`) and are applied through `GET /api/known-servers` (`known-servers-routes.ts:141`).
- **Identity challenge.** `POST /api/pair/challenge {nonce}` returns `{fingerprint, publicKey, signature, v}` (`packages/server/src/routes/pairing-routes.ts:257-273`). It is a public route: `PUBLIC_PAIRING_PREFIXES` exempts it from the network guard (`pairing-routes.ts:50-57`), so it answers even where `/api/health` answers `403 network_not_allowed`. Node-side proof: `proveServerIdentity`. Browser-side proof: `challengeIdentity` (WebCrypto, `packages/client/src/lib/pairing/pair-protocol.ts:101`).
- **mDNS TXT** carries `{version, pid, piPort, name}` plus `fp` only when the server has an identity (`packages/shared/src/mdns-discovery.ts:263-267`).
- **Knock.** `POST /api/pair/request` is LAN on-link only and off by default; `POST /api/pair/poll` answers `{status, token?}` and is one-shot for the token (`pairing-routes.ts:496-506`, `packages/server/src/pairing/pairing.ts:611-626`). It carries no addresses today. The knock gate's "private range" is a private function of the server (`packages/server/src/auth/localhost-guard.ts:906-917`); only `isOnLinkPrivate` is exported (`:964`).
- **QR payload urls are TLS-gated.** `PairingManager.reachableUrls()` keeps `https://` and `wss://` URLs and, only under `PI_E2E_SEED`, a loopback `http` origin (`pairing.ts:344-362`). The pairing landing tries `payload.urls[]` in order and uses the first that proves `payload.id` (`packages/client/src/components/connectivity/PairLanding.tsx:41-46`); the copy-string is the same `https://<endpoint>/pair#<payload>` deep link, and `decodePayloadString` also accepts the bare `pi:pair:v1.…` string (`packages/client/src/lib/pairing/pairing-qr.ts:76-95`).
- **Electron** keeps a keyring keyed by fingerprint with `lastHosts` (scheme-aware, capped at `LAST_HOSTS_CAP = 5`, https hosts kept ahead of http, `packages/electron/src/lib/server-keyring.ts:31`, `:408-416`). Host selection challenges all candidates concurrently and prefers stored https, then stored http (list order, most recent first), then at most 3 discovered; the first accepting candidate in that order wins and latency is not compared (`packages/electron/src/lib/server-discovery.ts:104-125`, `server-windows.ts:272-290`). The main-window bridge exposes only `openServerWindow` (`preload-main.ts:136-138`), although the `servers:list` channel already admits the main window (`servers-ipc.ts:201-203`). `openByHostPort` refuses a host/port that matches neither the keyring nor current discovery (`server-windows.ts:684-691`). There is no main-process code redeem today; redeem exists only in the browser landing and the neutral shell (`packages/client/src/components/connectivity/PairLanding.tsx`, `packages/shell/src/components/PairView.tsx`).
- **Neutral mobile shell** is an HTTPS PWA with `connect-src 'self' https: wss:` (`packages/shell/src/index.html:11`), has no mDNS and no knock code (`packages/shell/AGENTS.md`); it only pairs by QR/copy-string.
- **Old readers of `knownServers`.** `local-proof-bootstrap.ts:173` builds allowed navigation origins `http://host:port` from `host`/`port`; `server-lifecycle.ts:390-399` (`loadMinimalConfig`) filters entries with a string `host` and numeric `port` and passes `host`/`port`/`label` on to `main.ts:542` and `resources/loading.html`. Neither reads `routes` or `fingerprint`.
- **Add wizard.** `ensureKnown` posts `{host, port}` and maps `409 already_known` to a `known-elsewhere` outcome that retargets to the holder's address (`packages/client/src/lib/remote-access/connect-machine.ts:55-69`); `ConnectMachine.tsx:125-135` consumes it.

## Goals / Non-Goals

**Goals:**
- One row per identity everywhere the user picks a server; routes visible and individually proven.
- A pair action on every row that lacks a credential on this device, choosing the one flow that can actually succeed.
- Route delegation without a new unauthenticated surface.
- `config.json` stays readable by the previous build.

**Non-Goals:**
- Anything about device keys or per-device status (change `device-key-mutual-check`).
- Making the neutral mobile shell discover or knock.
- Replacing the move-suggestion feature; it keeps working on an entry's primary route.

## Decisions

### D1. Identity is the key; an entry is one server instance

An entry is `{ fingerprint?, label?, addedAt, routes[], host, port }`. `routes[]` items are `{ host, port, scheme: "http"|"https", source: "saved"|"mdns"|"pairing" }`. There is no `config` source: nothing creates one (legacy entries are `saved`). `host`/`port` mirror the **primary route**: the first `http` route, else the first route. They are always written, because the previous parser drops an entry without them (`config.ts:2406`), so an https-only entry mirrors its https host and its port (443 by default).

Grouping rule (one pure function in `packages/shared`, used by server, client and Electron):

- A route that proves fingerprint F joins the entry that holds F when: the route is `https`; or the entry has no `http` route; or the entry already has an `http` route on the same port.
- Otherwise (an `http` route on a port the entry does not use) it starts a **second entry** with the same fingerprint. Both rows are labelled "same identity as …". This is the existing "two instances sharing one identity on different ports" case (`mdns-discovery` spec, "Two servers on one machine do not collide") and the old `(fingerprint, port)` uniqueness rule, restated per `http` route.
- An https route has no instance port, so it joins the oldest entry holding F; "oldest" is first in stored list order (list order is stable and survives restart, so the choice is deterministic).
- An unpinned entry stays a single-route entry keyed by `host:port` until a challenge proves a fingerprint.

Merging two entries that turn out to hold the same identity uses one rule, with two triggers. On **load** (no proof event) the first in stored order survives; on **backfill** (the entry that was just proven) the backfilled entry survives, as today (`known-servers-routes.ts:326-343`). In both cases the survivor keeps its own routes in order, then gains the other's routes it does not already hold, keeps its label (else takes the other's), and the other entry is removed. After a backfill no two entries hold F on one port, so a load never sees such a pair again.

*Alternative rejected:* group by fingerprint only. It would merge two instances that share a copied identity file and hide that the second is a different machine state.

### D2. Proof = identity challenge; access check stays separate

Each route is checked by two concurrent calls: the **identity challenge** (proof, latency) and `GET /api/health` (access: it is guarded, so `403 network_not_allowed` still yields "Network not allowed"). The challenge alone cannot replace health because the challenge route is public and answers on a network the server refuses. The per-route double request is a deliberate trade-off. Route outcome:

| Challenge | Health | Route shown as |
| --- | --- | --- |
| proves group fingerprint | ok | proven, usable |
| proves group fingerprint | `403 network_not_allowed` | proven, network not allowed |
| proves a different fingerprint | any | refused: different identity (never used, no credential sent) |
| bad signature / unparseable key | any | refused: invalid identity proof |
| non-200 or no `publicKey`/`signature` | ok | can't prove identity (older server) |
| transport failure | n/a | unreachable (or blocked in this browser, via the existing server-probe explanation) |

Who runs the challenge: Electron main (`proveServerIdentity`, Node crypto) for Electron; the browser (`challengeIdentity`) for a browser tab, subject to the same CORS allow-list and mixed-content limits as the health probe today. When the browser cannot reach a route at all, the existing server-side probe explains why (`cors-blocked`, `name-not-resolved`), and now also returns the fingerprint the dashboard server proved (D6). A browser without WebCrypto Ed25519 falls back to that server-side proof for display only and cannot switch to a route it cannot prove itself.

An advertised `fp` is unauthenticated. It decides which group a discovered route is *shown* in; the route is *used* only after it proves that fingerprint.

**Server-side proof becomes scheme-aware.** The server `prove` helper and the probe take the route's scheme and call `proveServerIdentity("<scheme>://host:port", …)`: normal certificate verification (no override), `redirect: "manual"`, the same 2 s timeout (`known-servers-routes.ts:42`, `:49`), and the existing 4 KiB body cap. The health leg of the probe uses the route's scheme too (`:310`). Move suggestions and backfill prove the entry's **primary route** in its own scheme (`known-server-moves.ts:137`, `known-servers-routes.ts:328`); peers found by mDNS are always `http`, so the discovered-address proof stays `http`. Because suggestions are keyed by (fingerprint, port) and compare the peer's port with the primary route's port, an https primary route (port 443) practically never gets one; that is accepted.

**The add path is bounded.** `POST /api/known-servers` challenges an operator-supplied host, which may now be a public https name. The request admits only `http`/`https` schemes (anything else is `400 invalid_scheme` before any request), the host charset check stays (`known-servers-routes.ts:160`), and the challenge uses the same bounded `proveServerIdentity` call: no redirects, 2 s, 4 KiB response cap, normal TLS verification. A failed challenge stores no fingerprint (existing rule).

### D3. Best route

Shared pure function `rankRoutes(routes, { credentialed })`:

1. Only routes proven for the group are candidates.
2. `credentialed: false` (list marker, browser switching): https wins over http when its latency is within 50 ms of the best http latency; otherwise lowest latency wins. 50 ms is a named constant.
3. `credentialed: true` (Electron opening a server window sends the stored bearer): order is stored https, then stored http, then discovered, each group in input order (the keyring's most-recent-first order); the first route in that order that is proven wins. Latency is **not** compared. This is exactly what Electron does today (`server-discovery.ts:110-125`, `server-windows.ts:272-290`), so the list's "used" marker agrees with the real open and a faster plain-http route can never downgrade a bearer-carrying open to cleartext.

Decision (human-confirmed): Electron keeps https-first for any open that sends a stored credential. The agreed "https beats http only at similar latency" applies only where the app does not send a stored credential itself.

### D4. Route kind is derived, not stored

One pure function in `packages/shared`, `classifyRoute({ host, scheme }) → "loopback" | "lan" | "mdns" | "tunnel" | "public"` (no context argument is needed: the result depends on host and scheme only):

- `loopback`: `127.0.0.0/8`, `::1`, `localhost`.
- `lan`: IP literals in `10/8`, `172.16/12`, `192.168/16`, CGNAT `100.64/10`, link-local `169.254/16`, IPv6 `fc00::/7` and `fe80::/10`, plus internal names (single-label, `.lan`, `.home.arpa`, `.internal`; the same suffix idea as `packages/shared/src/preview-egress.ts:88`). The knock gate's private-range predicate is not exported (`localhost-guard.ts:906-917`), so the shared function carries its own copy and a boundary-table test pins it to the same ranges.
- `mdns`: a name ending `.local`.
- `tunnel`: an `https` DNS name equal to or under `zrok.io` (the only tunnel host the code names, `packages/client/src/lib/gateway/reserved-name.ts:111`, `<name>.shares.zrok.io`). Other providers' hosts (ngrok, tailscale) are not listed in code, so they classify as `public`.
- `public`: everything else.

Nothing new is persisted. "On-link" (a knock may be possible) means kind `lan` or `mdns` over `http`. The kind only picks a label and a pair action; `tunnel` and `public` behave identically, so a missing tunnel suffix has no functional effect, and the server alone decides whether a knock is admitted.

### D5. Persistence, migration, compatibility

- Read: a legacy entry `{host, port, label?, addedAt, fingerprint?}` is read as one route `{host, port, scheme, source: "saved"}` with scheme `http`, or `https` when the port is 443. Entries holding the same fingerprint and the same `http` port collapse as in D1 (previously the later duplicate was dropped, `config.ts:2413`).
- Write: every write emits `routes[]` plus the `host`/`port` mirror (D1). Startup never rewrites the file; the first mutation does. Old file bytes stay valid until then.
- **Rollback:** the previous build's `parseKnownServers` reads `host`, `port`, `label`, `addedAt`, `fingerprint` and ignores `routes` (`config.ts:2401-2425`), so every entry stays listed under its mirror. Its next write drops `routes`. Consequences, stated plainly: secondary routes are lost (mDNS and pairing re-learn them); an `https` route is read by the old build as `http` at the same host and port, so it shows unreachable there and, once rewritten, loses its scheme. Re-upgrading restores the scheme for the default case because a legacy entry on port 443 reads as `https` (above); an https route on another port (for example 8443) comes back as `http` and the operator re-adds it. No entry is lost. A test pins this with a snapshot of the previous parser.
- Electron mirror readers are unaffected: `local-proof-bootstrap.ts:173` and `server-lifecycle.ts:390-399` read only `host`/`port` (`label`), which the mirror keeps valid; an https-only entry yields one extra unused `http://host:443` navigation origin and `loadMinimalConfig` still keeps the entry. Neither reads `routes`.
- Entry order is stable so the mirror does not flap.

### D6. REST shape (additive, one removal)

- `GET /api/known-servers`: entries include `routes[]`; `movedTo` is evaluated for the primary route exactly as today.
- `POST /api/known-servers {host, port, scheme?, label?, fingerprint?}`: `scheme` defaults to `http`. After the bounded challenge proves F, the route is attached by the D1 rule. The `409 already_known` refusal and the holder re-probe before it disappear because attaching is no longer ambiguous; `409 identity_changed` stays for a route already stored under a different pin. `data.updated: true` is returned exactly when the add **attached a route that was not stored before to an existing entry** (whether or not the entry's other routes still prove F); creating a new entry, or re-adding a route that is already stored (label refresh, pin), returns plain `{success: true}`. This widens today's `updated` (stale-holder move only).
- `DELETE /api/known-servers {host, port, scheme?}` removes that route and the entry when it was the last route (idempotent, as today); `{fingerprint}` removes the whole entry.
- `POST /api/known-servers/probe {host, port, scheme?}`: the target must still match a stored route (SSRF guard unchanged); result adds `fingerprint` when the dashboard server's own challenge proved one.
- Mutations stay operator-only; GET keeps the network guard and `canManage`.
- Stale routes are not auto-removed; the operator removes them (Risks).
- **Wizard consumer.** With no `already_known`, `ensureKnown` (`connect-machine.ts:55-69`) maps a success carrying `data.updated` to the existing no-removal outcome using the address as typed (the `known-elsewhere` outcome and its holder-address retarget go away, since the typed address is now a route of the identity), and `ConnectMachine.tsx:125-135` follows. `SettingsPanel.tsx:3760-3768` stops mounting the two sections separately and mounts the merged Servers section.
- **Mixed fleet.** A client older than this change posting an add to a new server sees success where it used to see `409 already_known`: its wizard targets the address it typed and offers "Remove" only when it created the entry, and that DELETE removes just the route. A new client talking to a server older than this change sees list entries with no `routes` and treats the server as pre-routes: it offers no `https` add (the old server would store it as `http`). The new `parseRouteInput` is a client-only helper; `parseHostInput` is unchanged.

### D7. Delegation (D1-C): routes ride the pairing result only

`POST /api/pair/poll` answers `{status: "approved", token, routes}` where `routes` is `pairing.reachableUrls()` restricted by the poll handler to entries whose scheme is `https:`, normalised to their origin. `reachableUrls()` also admits `wss://` URLs and the `PI_E2E_SEED` loopback `http` origin (`pairing.ts:344-362`); those stay in the QR payload `urls` but are never put in `routes`. `routes` is present only on the one `approved` answer that also carries the token (the token is one-shot, `pairing.ts:615-620`), never on `pending`/`rejected`/`unknown`, never on `/api/pair/challenge`, never in TXT. The change is in the route layer, not `PairingManager.poll`, so both knock and QR redemption get it.

Receiving devices validate each delivered route before storing: `https` only, origin only (no userinfo, path, query), host a DNS name (no IP literal, not `localhost`, not `*.local`), at most 8 routes, each at most 253 host characters. A route is kept only after the challenge at that route proves the pinned fingerprint, then recorded with source `pairing`. This bounds what a proven-but-hostile server can make a device contact.

Who persists delivered routes: only a client with its own server store. **A browser ignores `routes`**: the known-servers store is the dashboard operator's config, not the browser's, and a browser on `/pair?request` has nowhere of its own to keep an address. The existing "Browser Request access landing" requirement (`lan-knock-pairing`) says nothing about routes and keeps holding unchanged: it stores the bearer and loads the dashboard. Electron (keyring) is the client that stores them; the neutral shell is unchanged here. The keyring keeps at most 3 delivered routes per pairing (the first delivered, in delivery order) and then applies its existing 5-host cap with https first and most recent first (`server-keyring.ts:31`, `:408-416`), so delivery cannot fill the list with a hostile server's hosts.

*Alternatives rejected:* `urls=` in TXT (unauthenticated, leaks the tunnel to the whole LAN, 255-byte limit); signed `routes[]` on the public challenge (leaks the tunnel URL to any caller). Both were weighed in the mockup board S6/D1.

The LAN/mDNS chips in the board's S3 "approved" panel are routes the device discovered itself; only https routes are delivered. (Brief said LAN addresses are delivered; the code's https-only gate says otherwise.)

### D8. Pair action per row

One pure function (shared with the board's `pairAction`), inputs: entry routes with kind, client kind (browser or Electron), whether this device holds a credential, and for Electron which on-link routes are currently discovered or in the keyring.

**Browser** (nothing proven, nothing sent by the current page):

- On-link route, discovered or saved: "Request access…" = `window.open("http://<host>:<port>/pair?request", "_blank", "noopener")`, the URL built only from the route's host and port and refused if it does not round-trip (the guard the Connect button has today, `NetworkDiscoverySection.tsx:84-90`). This keeps parity with today's Settings Connect and the landing knocks same-origin (`lan-knock-pairing`, "Browser Request access landing"), so the mutation-origin gate is not involved. A server with no advertised fingerprint gets the same navigation; the fingerprint comparison belongs only to Electron.
- Otherwise "Pair with code…": a dialog takes the pasted text (`decodePayloadString`), refuses a payload whose `id` is not the entry's fingerprint (a local check, no network), and navigates a new tab with `noopener` to `<first https origin named by the payload>/pair#<payload>`. The route is the payload's own URL, not a route proven beforehand: the existing landing at that origin runs `challengeIdentity` against `payload.id` and refuses on mismatch before redeeming (`PairLanding.tsx:41-46`). The exposure is the same as scanning that QR, and the code travels in the URL fragment, which is not sent to any server.

**Electron** (proof required before anything is sent):

- No advertised or pinned fingerprint and an on-link route that is currently discovered: "Verify and request access…" (existing trust-on-first-use compare in the Connecting window, `pairing-client.ts` `tofu`/`fullFp`).
- On-link route currently discovered or in the keyring: "Request access…" → `piDashboard.openServerWindow({host, port})`, which already starts the main-process knock for an unpaired server; the Connecting window proves identity first (`lan-knock-pairing`, "Native knocking clients verify the discovered identity first"). `openByHostPort` refuses a host the app cannot currently see (`server-windows.ts:684-691`), hence the "discovered or in keyring" condition.
- Otherwise "Pair with code…" (below).

**Knock refusals** reuse the existing codes: `knock_disabled` → remedy text; `knock_not_lan` → offer "Pair with code instead"; `knock_pending`, `knock_busy` as today.

**Electron "Pair with code…" is an in-app redeem (decision, human-confirmed).** A second main-window bridge method `piDashboard.pairWithCode({fingerprint})`, on the same local-origin gate as `openServerWindow`, opens the app-owned Connecting window in a code mode. The user pastes the text there, so the text and the credential never touch the dashboard page. The main process: decodes the text; refuses a payload whose fingerprint is not the entry's pinned fingerprint; proves identity at the first of the payload's `https` URLs that proves it; redeems the code (`POST /api/pair/redeem`, the call the landing makes in `PairLanding.tsx`); polls for the operator's approval with the same compare-code display as a knock; stores the bearer in the keyring under the same storage rules (encrypted via `safeStorage`, memory-only when unavailable); and records routes named by the payload and delivered with the approval through D7 validation and proof. Nothing sensitive is logged. This is new main-process code (a sibling to `lib/pairing-client.ts`), which is why the Electron bridge and keyring changes are listed in Impact and tasks.

### D9. "Paired on this device?"

- Electron: main-window bridge `piDashboard.listServers()` → existing `servers:list` handler (already allowed for the main window, `servers-ipc.ts:201-203`) returning only the renderer-safe state (`pairedRow`, `discovered`: no bearer). Exposed under the same local-origin gate as `openServerWindow` (`preload-main.ts:136`), together with `pairWithCode` (D8).
- Neutral shell: out of scope (no list).
- Browser: "Unknown in this tab" for any origin but the current one.

### D10. Observability

One log line each, no secrets, short fingerprints (`sha256:` + first 16 chars): route attached, route refused (different identity), config migrated on first write, delegated route stored/dropped (server and Electron, whichever decides), probe proved fingerprint. No bearer, pairing code, confirm code or payload ever appears in a line; tests assert this.

### D11. Clarifications from scenario design

- **50 ms window is inclusive** (D3): `https − http ≤ 50`; `SIMILAR_LATENCY_MS = 50`.
- **Concurrency**: at most 6 route checks in flight (the browser's per-host HTTP/1.1 limit), each request 2 s, so N requests settle within 2 s × ⌈N ÷ 6⌉.
- **Malformed `routes` on load** (D5): drop invalid routes; none left → read the `host`/`port` mirror as one legacy route; routes win over a disagreeing mirror; never drop an entry that has a valid mirror.
- **Delivered routes** (D7): keep the first 8 valid in delivery order; the trailing-slash origin is accepted and normalised.
- **No fingerprint and no on-link route** (D8): no pair action (state text only); no trust-on-first-use by code.
- **Browser "Pair with code…"** (D8): the payload's https origin must pass the same origin validation as a delivered route; none passes → refuse.
- **Host normalisation** (D4): lower-case, one trailing dot, brackets, zone id removed, IPv4-mapped IPv6 as IPv4; used by `classifyRoute` and grouping.
- **Packaged Electron** is verified by the manual pass (tasks 10.3); its main-process logic is covered at L1.

## Risks / Trade-offs

- [Per-route challenge cost: N routes × 2 requests per dropdown open] → at most 6 concurrent route checks, 2 s timeout (as today), results cached for the open menu. Accepted trade-off; health stays because the public challenge answers on networks the server refuses.
- [Stale routes accumulate because attach replaces the old "move the holder" behaviour] → Settings shows a refused/offline route with a "Remove address" action; move suggestions still fix the primary route.
- [Https-only entry mirrors an https host as `host:443`; an old build reads it as http and, once it rewrites the file, loses the scheme] → documented rollback loss (D5); port-443 legacy entries read back as https.
- [Browser tab cannot prove routes it can't reach] → shows the existing "Blocked in this browser" explanation; server-side proof is display only.
- [Browser "Request access" is unproven navigation to an LAN address the list believes is the server] → it sends nothing; the landing at that origin shows the origin's own address and the operator approves with a typed code, as for today's Connect.
- [Plain-http knock/relay] → unchanged: an on-path relay can still forward a challenge; the check defeats an impostor at the address, as the existing specs already state.
- [Electron downgrade to cleartext bearer] → D3 rule 3.
- [Entries with the same identity and different ports are two rows] → intended, labelled.
- [Server challenges an operator-supplied public host (SSRF-ish)] → mutations are operator-only, scheme allowlist, no redirects, 2 s, 4 KiB cap, normal TLS verification, no response body is echoed to the caller.

## Migration Plan

1. Ship code that reads both shapes and writes the new shape with the host/port mirror (no startup rewrite).
2. First mutation (add/remove/accept-move/backfill) rewrites `knownServers` in the new shape. Log one line.
3. Rollback: deploy the previous build; it reads the mirror. Secondary routes vanish on its next write and are re-learned; https scheme loss as in D5. No migration script, no data deletion.
4. Electron keyring: `lastHosts[].source` is optional; absent means unknown source. Previous build keeps extra fields on read (`isHostRef` filters by shape, not by exact keys, `server-keyring.ts:135`).
5. Mixed versions: a server without `routes` in the poll delivers none; a client that does not know `routes` ignores the field; see D6 for add compatibility.
6. Electron changes need an Electron rebuild and relaunch (`npm run electron:start` for a dev run, `npm run electron:build` for an installer); `npm run reload` only reloads pi sessions and does not reload the app.

## Open Questions

None blocking. Decisions recorded above: Electron "Pair with code…" is an in-app redeem (D8); Electron keeps https-first for credentialed opens (D3).
