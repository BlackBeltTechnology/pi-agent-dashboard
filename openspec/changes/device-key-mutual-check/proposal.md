# Proposal

Mockup: ../archive/2026-10-22-group-servers-by-identity/mockups/server-identity-pairing (S7–S10; the board predates the "Access expired" state, which reuses the "Access removed" layout)

## Why

`group-servers-by-identity` makes the server list prove each server's identity, but a list row still cannot say whether *this* device is already paired there: a browser tab on one dashboard cannot see the credential another origin holds, and a revoked or purged device only finds out when a request fails. Today revoking a device deletes its registry row, so a mis-click cannot be undone and the revoked device cannot be told apart from one that never paired.

The server already answers an identity challenge. Letting the client answer a server-issued nonce with a per-server device key, once the server has proven itself, gives a two-step check that proves the server to the client and the client to the server, and makes "paired / not paired / access removed" an answer the server gives instead of a guess.

## What Changes

- **Device key per server.** Each client holds one Ed25519 key per server fingerprint (unlinkable across servers): browser = WebCrypto non-extractable key in IndexedDB (only where Ed25519 WebCrypto exists, i.e. secure contexts); Electron = main process, private key under `safeStorage` in the keyring entry; mobile shell = its keyring store. A key is created only when the user asks to pair, never for every server seen in a list.
- **Mutual check, in two steps.** The identity challenge reply gains one field, a server-issued `deviceNonce` (single-use, 60 s, bounded store). Only after the client has verified the challenge against the pin or advert does it send `POST /api/pair/device-status {deviceNonce, pub, sig}`, so a device proof is never sent to an unproven route and cannot be replayed. For an `http` route the client resolves to address literals (the Electron main process), the proof, bind and knock key go only to the literal whose challenge proved the pin in that same selection (`harden-peer-address-identity`). The reply is `{status: paired | expired | unknown | revoked, tier?, scope?}` (`expired`: the device is known but its browser bearer can no longer authenticate; `revoked` wins over `expired`); an invalid proof, an unknown or used nonce, or a peer over the limit (60 per minute per peer address, bounded map) all give `{status: "unverified"}`, and the identity answer is never affected.
- **Key registration.** Knock and QR pairing submit the key with a proof over a fresh `deviceNonce`; approval binds it to the new device row. A key may belong to only one record (primary or companion, active or revoked). Devices paired before this change bind a key once with `POST /api/pair/device-key`, authenticated by their existing credential, from an environment that can hold a key (not a plain-http browser tab).
- **Companion key (opt-in).** A browser opened from another dashboard carries a status-only key in the request-link fragment `#companion=<pub>.<ts>.<sig>&from=<origin>` (time-bound, replay inside 300 s accepted because it only works in an operator-approved knock). The approval dialog shows it unticked ("Allow this status check"); ticked, the other dashboard can see that the device is paired and nothing else. A companion can be removed alone.
- **Revoke becomes a state. BREAKING (registry semantics).** Revoking moves the device to a held `revoked` list instead of deleting it: every bearer (including one still in a rotation grace window) and the cookie are refused, live sockets are closed, the check answers `revoked`. The operator can Undo (the record returns with its id, bearer hash, tier, label, keys, companions and its original expiry; Undo never extends a bearer's life, so a browser device that expired while held comes back `expired`); it is deleted for good after 90 days or on "Delete now". Revoked rows live in a separate file so an older build that is rolled back still treats them as deleted.
- **Device side.** On `revoked` the device shows "Access removed" with "Pair again" and keeps its credential so an Undo needs no re-pairing; it rotates its key when pairing again. A client never discards its credential because of a status answer, including `unknown`; only a refused credential at a proven route discards it. On `expired` it shows "Access expired" with "Pair again"; a `401 bearer_expired` at a proven route discards the credential and the device key together, because the old key is still held by the expired record and a new pairing makes a new key. Row states: Paired · tier, Paired · status only, Access removed, Access expired, Not paired, Paired · key pending, Status unknown.
- **UI.** Approval dialog: Device key row + companion checkbox. Settings ▸ Security ▸ Paired devices: Device key and "Status checks from" columns, 10 s "revoked · Undo" toast, a "Revoked devices" list with Undo revoke / Delete now / "Deleted for good in N days" and the lost-or-stolen warning. Restore, Delete now and the 90-day purge write audit lines in the shape of the existing revoke line.

## Capabilities

### New Capabilities

- `device-key-mutual-check`: per-server device keys, the signed device proof on the identity challenge and its reply (`paired | expired | unknown | revoked`), key registration at pairing and for existing devices, the status-only companion key, and the device-side row states derived from the answer.

### Modified Capabilities

- `bearer-device-auth`: revoke becomes a held, restorable state that keeps the record's expiry and rotation fields (MODIFIED); the tier requirement lists `POST /api/pair/challenge`, `device-status` and `device-key` at `observe` so no paired device is refused for its tier (MODIFIED); held/refused/restorable semantics (Undo never extends expiry, no grace-window restart), audit lines for restore, delete-now and purge, operator-only restore and delete-now, and the Paired devices settings additions (ADDED).
- `server-identity-keypair`: the challenge reply gains the single-use `deviceNonce`; the identity answer is unchanged.
- `lan-knock-pairing`: the knock body and the browser request landing carry the device key and the companion fragment (whole-block copy of the current main text plus the key and companion edits).
- `qr-device-pairing`: the approval dialog shows the device key and the opt-in companion choice.
- `electron-server-windows`: the "Server keyring" entry holds the device key (private part under `safeStorage`); the main-process knock generates it in memory and persists it only on approval; a `revoked` answer keeps the credential and shows "Access removed"; a refused exchange with an `expired` answer discards the dead credential and key and shows "Access expired"; a refused exchange with a `paired` answer keeps everything and loads nothing (display-only "network not allowed" on `403 network_not_allowed`); the device check goes only to the address literal that proved the pin.
- `device-keyring-client`: neutral-shell keyring entry carries the device key.
- `neutral-shell-device-keyring`: "Paired-server entry persistence" retains the device key.
- `server-identity-routes`, `server-selector`, `known-servers` (text from the archived `group-servers-by-identity`, now in main): whole-block MODIFIED copies so the current text no longer contradicts this change: the browser "Request access…" link may carry the companion fragment (only for an entry with a fingerprint and a browser with Ed25519), and the paired-state labels become one set of seven with "Status unknown" replacing "Unknown in this tab".

## Impact

- **Server:** `packages/server/src/pairing/paired-devices.ts` (key/companion fields, revoked store keeping expiry and grace fields, restore/purge/sweep, the shared expired judgement), `pairing.ts` (pending device carries key + companion; approve binds), `routes/pairing-routes.ts` (challenge reply, `device-status`, knock/redeem bodies, `device-key`, restore, revoked list, delete-now, companion removal, `PUBLIC_PAIRING_PREFIXES`), a new device-proof verifier with the nonce store and the per-peer limiter, `server.ts` (browser tickets carry the device id so revoke can close sockets), `pairing/ws-tier-gate.ts` (close code), `packages/shared/src/route-tiers.ts` (new routes; the challenge moves from `operate` to `observe`).
- **Shared:** proof message builders and key-id helper used by browser, Electron and server; `pairing-knock-client.ts` carries the key.
- **Client:** device-key store, `PairRequestLanding`, `PairingApprovalDialog`, `PairedDevicesSection`, and the grouped server row from `group-servers-by-identity` (row state + action).
- **Electron / shell:** `packages/electron/src/lib/server-keyring.ts`, main-process signing and check; `packages/shell/src/lib/keyring.ts`.
- **Persistence / compatibility:** `paired-devices.json` rows gain optional `keys` / `companions` (older readers preserve unknown fields); revoked rows go to a new `revoked-devices.json` (0600). Rollback: older code ignores the new file, so revoked devices stay refused; only the Undo option is lost.
- **Related changes:** builds on `group-servers-by-identity` (grouped rows, challenge-based route check), `harden-auth-credentials` (browser bearer expiry, rotation grace window, audit lines; archived) and `harden-peer-address-identity` (per-literal proof for `http` routes; archived), whose text is in `openspec/specs/`. `close-residual-audit-findings` is only an umbrella and carries no deltas. Active changes `add-plugin-isolation-and-public-routes` and `close-loopback-legacy-window` carry MODIFIED copies of two `bearer-device-auth` requirements this change also modifies, written against older bases: whichever archives second must re-copy the block to merge both.
- **Wire compatibility:** old clients ignore the extra `deviceNonce` reply field; old servers send none, so a new client makes no step 2 and shows "Status unknown". An unrecognised `status` value also reads "Status unknown". Rollback of an Electron build drops the stored `deviceKey` field on its next save (no credential loss; it binds again after re-upgrade).

## Non-goals

- Replacing the bearer with the device key as the login credential (later change).
- Cross-origin browser knock, storage-access or iframe tricks to share state between origins.
- Changing knock admission gates (`knock_not_lan`, `knock_disabled`, rate limits).
- A pure-JS Ed25519 fallback for plain-http origins; those origins get no device key.
- Making the 90-day retention configurable.

## Discipline Skills

- `security-hardening`: new unauthenticated input (`device-status`, knock/redeem `deviceKey`, `companion`), nonce store and rate-limit bounds, length/charset/origin validation, key binding routes, domain-separated signed messages, opt-in companion that must never reach a credential route, secrets kept out of logs.
- `doubt-driven-review`: irreversible steps — changing revoke from delete to a held state in `paired-devices.json` (storage layout and rollback), and the 90-day purge.
- `observability-instrumentation`: new endpoints and revoke/restore/purge/bind events need secret-free log lines.
- `review-code`: non-trivial change across server, client, Electron and shell before commit.
