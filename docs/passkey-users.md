# Passkey users + user management

Native WebAuthn passkeys + local user directory. Backend `@simplewebauthn/server` (design D1 result B; Pocket ID sidecar rejected). See change: add-passkey-user-auth.

## Enable

Config `~/.pi/dashboard/config.json`:

```json
{ "auth": { "passkeys": { "enabled": true } } }
```

- Works with or without OAuth providers.
- No providers configured → restart required after enabling.
- Optional `auth.groupTiers`: `{ "<oidc-group>": "observe|control|operate" }`.
  - Configured → highest matching group tier wins.
  - Configured, no match → login refused (fail closed).
  - Unconfigured → legacy: `allowedUsers`, tier `operate`.
- OIDC groups = `id_token` `groups` claim UNION userinfo `groups` claim.
  - `id_token`: read only if `aud` includes client id. Back-channel token; claims only.
  - Source: `idTokenGroups` (`packages/server/src/auth/auth.ts`); merged in `auth-plugin.ts` callback.
- OIDC tier fixed until JWT expiry (7 d).

## Tiers

- Order: `observe` < `control` < `operate`.
- JWT `pi_dash_token` carries `tier`. Claim-less legacy JWT = `operate`.
- REST: `packages/server/src/auth/route-tier-gate.ts` refuses session below route tier (`ROUTE_TIERS`).
  - `/live/*` live-preview HTTP proxy gated at `LIVE_PREVIEW_TIER` (`control`), matching live WS upgrade.
  - Refusal: `403 insufficient_scope`.
- WS: cookie-admitted browser socket gated per message.
  - Map: `packages/shared/src/ws-message-tiers.ts` (`WS_MESSAGE_TIERS`). Unlisted → `operate`.
  - Dropped message → logged once per socket+type: `auth.tier_refused {"via":"ws",...}`.
  - Terminal WS needs `operate`. Live-preview WS needs `control`.
- Exempt (same as REST): loopback / genuine-local, trusted-network, ticket sockets.

## User directory

File `~/.pi/dashboard/users.json` (0600, locked atomic writes). Source: `packages/server/src/auth/passkey/user-directory.ts`.

- User: `name`, `tier`, `status` (`invited|active|revoked`).
- Credentials: passkeys. Each bound to RP ID it was created under.
- Invites: stored as sha256 of token. Never plaintext.
- Passkey session tier re-read from directory every request.
  - Re-tier / revoke → effective next request.
  - Revoked user open WS → closed on next frame, close code `4401`.

## First operator bootstrap

- Empty directory → only genuine-local caller may create first user:
  - loopback with no proxy-forwarding headers, or valid `X-Pi-Local-Token`.
  - `requireLocalProof` on → loopback path also needs local proof (`isLocallyTrusted(..., localTrust)` in `packages/server/src/routes/user-routes.ts` `isGenuineLocal`).
- First user always `operate`.
- Remote caller → `403 bootstrap_local_only`.
- Then mint invite for that user (Settings ▸ Security ▸ Users).

## Settings ▸ Security ▸ Users

Source: `packages/client/src/components/connectivity/UsersSection.tsx`.

- Add user + tier.
- Re-tier.
- Revoke (two-click confirm).
- "Invite QR" → QR + copy link `<resolved auth base>/auth/invite#<token>`.
  - Resolved auth base = `auth.redirectBaseUrl` when set, else primary tunnel URL (`rp.rpOrigin`, `user-routes.ts`).
  - Token in URL fragment (never sent to server on GET).
  - Default TTL 24 h, single use.
  - API: `ttlHours` 1..168, `maxUses` 1..10.
- Orphaned credentials badge: credential bound to other RP ID.

## Sign-in on `/auth/login`

- "Sign in with passkey": same device or OS hybrid. Discoverable credential. User verification required.
- "Sign in with phone":
  1. Desktop shows QR + short code `XXXX-XXXX`. TTL 5 min.
  2. Phone opens `/auth/phone#<token>` or types code at `/auth/phone`.
  3. Phone sees requester browser / OS / host / IP (sanitised).
  4. Phone approves with its passkey, or denies.
  5. Desktop poll receives cookie. Single use.
- Limits:
  - Client key = `rateKeyOf` = LAST `X-Forwarded-For` hop (proxy-appended), else socket IP.
  - Pending: ≤3 per client key, ≤1000 overall (`phone-signin.ts`).
  - Code lookup fails: 5/min per client key, 50/min global. Same client key.

## Anonymous ceremony DoS resistance

- Challenges stateless HMAC-signed ids (`SignedChallenges`, `packages/server/src/auth/passkey/challenge-store.ts`).
  - Per-process key. TTL 5 min.
  - Consumed only on successful verification. Replay refused.
  - Options flood: no memory growth, no eviction of user's challenge.
- Registration verify body: `{challengeId, token, response}`.
  - Challenge bound to `sha256(invite token)`.

## RP ID + stable origin

- RP ID = hostname of resolved auth base.
- Resolution = `resolveRedirectBase` (same as OAuth redirect):
  1. `auth.redirectBaseUrl` override.
  2. else PRIMARY tunnel URL.
- Stable origin rule. All must hold:
  - `https`.
  - Not IP, not `localhost`.
  - Source is one of:
    - `auth.redirectBaseUrl` override.
    - Tailscale primary.
    - zrok primary serving its configured persistent reserved name (`tunnel.zrok.reservedName` + `persistent: true`).
- Unstable: ngrok, zerotier, ephemeral zrok.
  - Other providers never stable.
  - Rule above, not provider self-report, decides stability.
  - Ceremony routes + invite mint → `409 unstable_origin`.
  - Login page + Settings show options DISABLED with reason. Not hidden.

Source: `packages/server/src/auth/passkey/rp-context.ts`, `passkey-service.ts`.

```mermaid
flowchart TD
  A[resolveRedirectBase] --> B{https?}
  B -- no --> U[unstable_origin]
  B -- yes --> C{IP or localhost?}
  C -- yes --> U
  C -- no --> D{override OR Tailscale primary OR reserved zrok primary?}
  D -- no --> U
  D -- yes --> S[stable: RP ID = hostname]
```

## Primary switch impact

- "Make primary" confirmation and `auth.redirectBaseUrl` field show:
  `N passkey(s) for M user(s) will stop working`.
- Source: `GET /api/users/credentials/impact`, one of:
  - `?url=` provider switch.
  - `?rpId=`.
  - `?redirectBaseUrl=` draft override.
    - EMPTY = cleared → falls back to primary → can orphan passkeys.
- Settings `auth.redirectBaseUrl` field warns on clearing too (`PasskeyImpactNote`, query `{redirectBaseUrl}`).
- Nothing deleted. Switching back revives credentials.
- Recovery:
  - Re-invite user, or
  - Sign in with phone using a passkey under current RP ID.

## Routes

| Route | Auth | Notes |
|---|---|---|
| `GET /auth/passkey/status` | public | feature + stability state |
| `GET /auth/passkey/webauthn.js` | public | client WebAuthn helper |
| `POST /auth/passkey/register/options` | invite token | |
| `POST /auth/passkey/register/verify` | invite token | body `{challengeId, token, response}`; sets `pi_dash_token` |
| `POST /auth/passkey/login/options` | public | |
| `POST /auth/passkey/login/verify` | WebAuthn assertion | sets `pi_dash_token` |
| `POST /auth/passkey/phone/start` | public | returns code + QR |
| `GET /auth/passkey/phone/poll/:requestId` | request id | sets cookie on approval |
| `POST /auth/passkey/phone/lookup` | short code | returns approval token |
| `POST /auth/passkey/phone/view` | approval token | requester info |
| `POST /auth/passkey/phone/approve` | approval token + passkey | |
| `POST /auth/passkey/phone/deny` | approval token | |
| `GET /auth/invite` | page | |
| `GET /auth/phone` | page | |
| `GET /api/users` | `operate` | |
| `POST /api/users` | `operate` | |
| `PATCH /api/users/:id` | `operate` | re-tier |
| `POST /api/users/:id/revoke` | `operate` | |
| `POST /api/users/:id/invites` | `operate` | mint invite |
| `DELETE /api/users/invites/:inviteId` | `operate` | |
| `GET /api/users/credentials/impact` | `operate` | `?url=`, `?rpId=`, or `?redirectBaseUrl=` |

- `/api/users*`: `operate` in `ROUTE_TIERS`, `operatorGuard` (device bearer refused), MCP-denylisted.
- Source: `packages/server/src/routes/user-routes.ts`, `packages/server/src/auth/passkey/passkey-routes.ts`.
- Cross-site POST with foreign `Origin` to `/auth/passkey/*` → `403 origin_mismatch`.

## Logging

- Format: `[passkey] <event> id=<8 hex>`.
- Events: `invite_created|enrolled|login|phone_pending|phone_approved|phone_denied|phone_expired|revoked|orphaned`.
- Never logged: codes, challenges, credential ids, UA, IP.
- Source: `packages/server/src/auth/passkey/passkey-log.ts`.

## Backend notes

- Native `@simplewebauthn/server`. No sidecar.
- pnpm override pins single `@peculiar/asn1-schema`.
  - Two copies → ES256 verify fails: `Cannot get schema for 'ECDSASigValue'`.
  - Do not remove override.

## Rollback

1. Revert code.
2. Passkey users lose access.
3. OAuth, loopback, bearer unaffected.
4. Purge data: delete `~/.pi/dashboard/users.json`.

## Known limits

- WS sub-tier messages silently dropped. UI may not yet hide controls.
- E2E with virtual authenticator needs HTTPS domain origin. Not available in docker harness.

## Cross-refs

- `docs/architecture.md` §Passkey users
- `docs/faq.md` (passkey FAQ entries)
- `packages/server/src/auth/auth-plugin.ts`
- `packages/shared/src/route-tiers.ts`
- `packages/shared/src/ws-message-tiers.ts`
- `packages/server/src/pairing/ws-tier-gate.ts`
- `openspec/changes/add-passkey-user-auth/`
