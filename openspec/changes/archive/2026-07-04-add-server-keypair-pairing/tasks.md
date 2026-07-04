## 1. Server identity keypair

- [x] 1.1 Add `identity.ts`: ensure/load persistent Ed25519 keypair at `~/.pi/dashboard/identity.key` (0600); export fingerprint. Unit test generate + reuse-across-restart.
- [x] 1.2 Add nonce challenge-response: sign client nonce with private key; route/wire format per design open sub-decision. Unit test valid-sign + impostor-detect.

## 2. Pairing (QR + copy-string)

- [x] 2.1 Add `pairing.ts`: mint short-lived (~60s) one-time codes with rate limiting; redemption exchanges code → bearer token; version `v` in payload.
- [x] 2.2 Compute `urls[]` = currently wss-reachable endpoints (active tunnel, configured TLS LAN); omit plain-http. Handle no-reachable-endpoint case.
- [x] 2.3 Server `/pair/*` routes (create payload, redeem code, challenge) — additive, backward-compatible, versioned.
- [x] 2.4 **(F3/D12)** Redemption creates a PENDING device; consume the code on APPROVAL not redemption (no lockout DoS); approve via a server-generated numeric compare-code shown on BOTH dashboard + device (never a client label); approval requires an authenticated browser session, never loopback/tunnel; rate-limit + lockout.
- [x] 2.5 **(F5/D14)** Emit only publicly-trusted wss endpoints in `urls[]`; never advertise self-signed LAN TLS as reachable from the neutral shell.

## 3. Bearer device auth

- [x] 3.1 Add paired-devices registry (`~/.pi/dashboard/paired-devices.json`, 0600): label, created-at, last-seen; add/list/revoke.
- [x] 3.2 Add bearer branch to auth/network guard feeding `isAuthenticated`: `Authorization: Bearer` (REST) + `Sec-WebSocket-Protocol` (WS). Do not touch loopback/trusted-network/cookie paths.
- [x] 3.3 Regression tests: loopback-only and cookie-only auth unchanged; invalid/revoked bearer → 401.
- [x] 3.4 **(F1/D10)** — narrowed per user decision: keep loopback trust for genuine same-host requests (loopback AND no proxy-forwarding header); tunnel-as-127.0.0.1 (forwarding header present) no longer trusted at all 3 sites; affirmative local-IPC token allowlist added. NB: marker-less `ssh -R` not caught by the header heuristic (accepted narrowing); local token is the affirmative defense. Replace network-loopback auth-exemption with an IPC allowlist (dedicated Unix domain socket or explicit local token) at ALL three call sites (guard, `onRequest`, WS upgrade `server.ts:1630`). Regression test: tunnel/`ssh -R`/marker-less proxy as `127.0.0.1` is NOT trusted; local IPC still works.
- [x] 3.5 **(F4/F6/D11)** WS auth via short-lived single-use ticket from an authenticated REST endpoint; refuse upgrade unless ticket validates (no TOCTOU); `Origin` check as defense-in-depth only (absent-Origin not trusted). Durable bearer never in WS URL/header/logs.
- [x] 3.6 **(cycle3/D10 Critical)** — local-IPC token (`~/.pi/dashboard/local/token`, dir 0700, file 0600) available to process callers. Verified: pi bridge connects to pi-gateway `piPort` (no auth gate, not tunneled) and model-proxy is `/v1/*`-exempt + `secondPort` binds 127.0.0.1 — neither traverses the newly-gated main-server path, so no client migration needed to keep working after D10. BEFORE removing loopback trust: migrate same-host callers off bare TCP-loopback — pi bridge (`bridge.ts:662` `ws://localhost:${piPort}`), terminal, editor, model-proxy — onto the Unix-socket/local-token allowlist. Perms: socket `0600`, token dir `0700`. Gate: local integrations still work after D10.
- [x] 3.7 **(cycle3/D11)** WS ticket = high-entropy, in-memory, deleted on first upgrade; client refetches per reconnect; ticket bound to WS route scope, mismatched route refused.
- [x] 3.8 **(F2/D13)** — resolved in specs to opaque long-lived bearer (bearer-device-auth spec); WebCrypto non-extractable client key deferred. Implemented: opaque token, only SHA-256 hash persisted (0600), revoke = row delete. Decide + implement token model: opaque-bearer + SRI/pinned deploy + short TTL, OR non-extractable WebCrypto client key (private key never leaves device). Resolve in specs before build.

## 4. CORS default

- [x] 4.1 Add `https://pi-dashboard.dev` as built-in CORS default in `server.ts` origin callback (beside `*.share.zrok.io`). Test allowed-without-config.

## 5. Neutral shell client + keyring

- [x] 5.1 New static build target for the neutral shell (hash/404 routing, CSP via meta, no server dependency).
- [x] 5.2 IndexedDB keyring store: `{ urls[], pinnedPubkey, bearerToken, label }`; add/list/remove; survives reload.
- [x] 5.3 Pairing UI: QR scan + copy-string paste; parse payload; complete pairing; store entry.
- [x] 5.4 On connect: nonce → verify signature vs pinnedPubkey; race `urls[]` per network; refuse pin-mismatch with warning. Reuse `ServerSelector`/`server-switch`.

## 6. Settings — device management

- [x] 6.1 Settings section: list paired devices (label, last-seen); revoke per device (deletes registry row).

## 7. Deploy + docs

- [x] 7.1 GitHub Pages publish pipeline — `deploy-site.yml` builds `packages/shell` into `site/dist/app/`. NB: GitHub Pages allows one site per repo and `site/` owns the `pi-dashboard.dev` apex, so shell published at subpath `/app/` (same web origin → `https://pi-dashboard.dev` CORS default covers it unchanged). for `pi-dashboard.dev` (neutral shell artifact).
- [x] 7.2 Docs: architecture entry (delegated per Rule 6, caveman style) + per-file rows in `packages/server/src`, `routes`, `client/src/lib`, `client/src/components`, `packages/shell` AGENTS.md trees. (Topology 3, secure-context constraint, Model-1 pairing, bearer keyring, versioned protocol); per-file rows in directory AGENTS.md trees.

## 8. Gates

- [x] 8.1 `security-hardening` pass: secrets 0600 (explicit chmod), token entropy 256-bit (confirm code 8-digit + 5-attempt lockout), only SHA-256 hashes persisted, constant-time compares, 60s code TTL + rate-limit, CORS bearer-gated, revoke = row delete. See project memory for residual notes. secrets at rest (0600), token entropy, pairing-code TTL/rate-limit, CORS surface, revocation.
- [x] 8.2 `doubt-driven-review` on versioned protocol + cross-origin auth. 2 residual non-blocking notes recorded (bearer-device can approve/mint-ticket; challenge signing-oracle is safe). Cross-origin auth CSRF-safe (bearer not ambient); durable bearer never on WS (ticket only). on the versioned pairing protocol + cross-origin auth before they stand.
- [x] 8.3 quality gate: biome 0 errors (warnings Tier B/C only — `any` matches codebase convention), tsc clean for changed files, tests green (server 2830, client 2980, shell 4). CodeRabbit advisory gate exit 0 (warn-and-continue). NOT yet committed — awaiting user.
