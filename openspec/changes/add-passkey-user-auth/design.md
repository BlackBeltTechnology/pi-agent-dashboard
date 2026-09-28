## Context

See proposal.md, Why. The current state that shapes the approach:

- `packages/server/src/auth/auth-plugin.ts` implements the OAuth2/OIDC code
  flow. `/auth/login?return=<relative>` → provider → `/auth/callback/:provider`
  on the **resolved redirect base**. The base is resolved in this order:
  `auth.redirectBaseUrl`, then `getTunnelUrl()` (the primary provider), then
  `http://localhost:{port}`. The callback redirects to the relative
  `returnUrl`, so a user who starts on a non-primary origin finishes on the
  primary origin.
- The JWT (`pi_dash_token`) carries `{sub, name, username, provider, exp}`.
  It has no tier.
- `route-tier-gate.ts` refuses a request only when `request.principalTier` is
  set and too low. Cookie sessions never set it, so they have full access.
  Tiers: `observe < control < operate` (`packages/shared/src/tiers.ts`).
- The QR pairing ceremony (`qr-device-pairing`) and the app-wide approval
  dialog (`2026-09-28-add-pairing-approval-dialog`) already provide:
  short-lived one-time codes, an operator approval flow, redeemer metadata
  (UA/IP/host), and a content-free WS hint followed by a guarded fetch.
- `tunnel-provider`: exactly one primary. `getTunnelUrl()` returns its URL.
  Switching the primary is a deliberate, confirmed action.
- Research (explore session):
  - **Pocket ID** is passkey-only and OIDC-certified. It ships a Go single
    binary (~60–70 MB) for darwin, linux, and windows on x64 and arm64, with
    SQLite storage. Config is by environment: `APP_URL`, `PORT`,
    `DB_CONNECTION_STRING`, `STATIC_API_KEY`, `UI_CONFIG_DISABLED`,
    `TRUST_PROXY`. It has signup-token links (QR, expiry, usage limit),
    admin login codes, "sign in with another device" (QR or code, 5 min),
    and groups → per-app access.
  - Pocket ID does **not** support sub-path hosting (issue #224, closed with
    no implementation). It needs its own origin.
  - The WebAuthn RP ID is a registrable domain suffix of the page hostname
    and ignores the port.

## Goals / Non-Goals

**Goals:**
- People, not devices, are the unit of access. Users can be invited by QR
  and hold passkeys only.
- A user can sign in on any screen by approving with a phone.
- Every login session carries a tier, and the existing gate enforces it.
- The passkey RP ID is the primary domain.
- The operator never hand-deploys an identity service.

**Non-Goals:**
- Passwords, TOTP, or email magic links (Pocket ID's email one-time access
  stays disabled).
- Cross-origin cookie handoff back to a non-primary origin. The user lands on
  the primary origin, as OIDC already does today.
- SSO for applications other than the dashboard.
- A docker-compose sidecar.
- Migrating `auth.allowedUsers` into the directory. It keeps working for
  OIDC providers.
- Replacing device pairing. Bearer devices and MCP tokens are unchanged.

## Decisions

### D1 — Backend chosen by a time-boxed spike (gate before production code)
Tasks §1 runs two spikes against the same checklist. The outcome is recorded
in this section as **D1-result**, and the losing option's tasks are deleted
via `openspec-update-change`.

| Criterion | A — Managed Pocket ID | B — Native (`@simplewebauthn/server`) |
|---|---|---|
| RP ID = primary domain, literally | Tailscale: primary host on a 2nd port ✅. Own domain: `id.` subdomain, which differs from the primary host ⚠️. zrok: a 2nd reserved share, which is a different domain ❌ | ✅ same origin |
| Security code we own | OIDC client + reverse proxy + admin-API calls | Ceremony routes + challenge store (library does the crypto) |
| Moving parts | Binary download, supervisor, extra origin/cert/share, DB upgrades | One npm dependency |
| Reuse of existing pairing, approval, and tiers | Low (Pocket ID's own UI) | High |
| Free extras (audit log, SCIM, recovery) | ✅ | ❌ |

**Spike exit criteria** (both must be answered with evidence):
1. Invite QR → phone enrolls a passkey → phone-approved sign-in on a desktop,
   end to end, with a **zrok reserved** primary and with a **Tailscale**
   primary.
2. The resulting session carries the user's tier.
3. The change is sized (A: supervisor + proxy + API client LOC; B: routes +
   store LOC) and its security-sensitive surface is listed.

Default if the spike is inconclusive: **B**, because it satisfies
"primary domain" without an extra origin. Alternative considered: always
ship both behind a setting. Rejected: it doubles the security surface for
one operator persona.

### D2 — RP ID and origin resolution reuse the redirect base
`rpOrigin = resolvedRedirectBase()`, `rpId = new URL(rpOrigin).hostname`. No
new resolution chain is added, because one source of truth keeps OAuth
redirects, the cookie `Secure` flag, and passkeys on the same origin. (For A,
Pocket ID's `APP_URL` is derived from the same base per D6.)

**Stable-origin predicate:** an `https` base whose hostname is not an IP
literal and not `localhost`, and whose source is one of:
- the override
- a Tailscale primary
- a zrok primary with a reserved name
- any provider flagged `stable` in its readiness state

Otherwise passkey sign-in and invite minting return
`409 {reason:"unstable_origin"}`. The login page shows the passkey option
disabled with the reason (the "unavailable modes shown, not hidden" pattern
from `shared-config`).

Each credential stores the `rpId` it was created under. When the current
`rpId` differs, those credentials are excluded from ceremonies and listed as
**orphaned** in Settings ▸ Users.

### D3 — Primary switch warns with an orphan count
The existing confirmed primary-switch action gains a preflight:
`GET /api/users/credentials/impact?rpId=<new>` → `{orphaned: n, users: m}`.
The confirmation dialog states "N passkeys for M users will stop working;
re-invite or use sign-in-with-phone". Nothing is auto-deleted. Switching back
revives the credentials.

### D4 — Session tier claim and group mapping
- The JWT gains an optional `tier`. The auth plugin sets
  `request.principalTier = claims.tier ?? "operate"`. A missing claim stays at
  `operate` for compatibility, and the gate then applies uniformly.
- Passkey users (B, or A via OIDC): `tier` = directory tier.
- OIDC users: `auth.groupTiers: Record<group, Tier>` read from the `groups`
  claim. The highest matching tier wins. When `groupTiers` is configured and
  nothing matches, login is **refused** (fail closed). When it is not
  configured, today's behaviour applies (`allowedUsers`, else allow;
  `operate`).
- A tier is fixed at login. Changing a user's tier or revoking them takes
  effect at the next request, because the plugin re-reads directory state for
  passkey users on every request (a cheap in-memory lookup keyed by `sub`).
  OIDC tiers are fixed until JWT expiry, which is documented.

### D5 — Sign-in-with-phone reuses the pending/approval pattern
The desktop calls `POST /auth/passkey/phone/start`, which returns
`{requestId, shortCode, url}` with a TTL of 5 min. The desktop renders the QR
for `url` and polls `GET /auth/passkey/phone/:requestId`.

The phone opens `url`, sees the requester's UA, IP, and host (bounded and
sanitised exactly like pairing redeemer metadata), then performs a WebAuthn
**assertion** and posts it with `requestId`. After the server verifies it,
the request becomes `approved{sub}`, and the desktop's next poll receives
`Set-Cookie` on the primary origin. A request is single-use, and a deny
marks it `rejected`.

The `shortCode` is typed on the phone when a QR scan isn't possible. It is
entropy-bounded and rate-limited like pairing codes.

Under A, Pocket ID's built-in "sign in with another device" provides this
flow, so the dashboard only runs the OIDC redirect.

### D6 — (A only) Sidecar lifecycle and origin
- **Tool registry:** a `pocket-id` entry. Its strategy chain is override →
  managed install dir → PATH. It downloads per platform from GitHub releases
  and verifies against `checksums.txt`. Install guidance is modelled on
  `zrok-install-guide`.
- **Supervisor:** spawn on loopback `PORT`, with a PID file and orphan
  scavenge like `zrok-process-tunnel`. `STATIC_API_KEY` is generated once and
  stored `0600`. The process gets `UI_CONFIG_DISABLED=true`,
  `ANALYTICS_DISABLED=true`, and `VERSION_CHECK_DISABLED=true`.
- **Origin:** Pocket ID needs its own origin (no sub-path support).
  - Tailscale → `https://<primary-host>:<idpPort>` (same RP ID).
  - Own domain → `https://id.<primary-host>` via host-routed proxy.
  - zrok → a second **reserved** share.
  The spike must confirm each.
- **Provisioning:** the dashboard registers itself as the OIDC client and maps
  groups `dashboard-observe` / `dashboard-control` / `dashboard-operate` to
  D4 via the admin API.

### D7 — Logging
Log lines use the prefix `[passkey]` and a fixed vocabulary:
`invite_created | enrolled | login | phone_pending | phone_approved | phone_denied | phone_expired | revoked | orphaned`.
Each line carries the first 8 characters of the request or user id only. It
never includes codes, challenges, credential ids, UA, or IP.

## Risks / Trade-offs

- **Primary switch orphans passkeys.** Mitigated by D3 (warning, revival on
  switch-back) and recovery via re-invite.
- **An ephemeral zrok primary makes passkeys unusable.** This is by design
  (D2 gate). The UI says so.
- **(A) A 70 MB download plus a second process and origin** is operational
  weight, and Pocket ID DB upgrades are outside our control. Mitigation: pin
  the version and verify checksums. D1 may reject A on this basis.
- **(B) We own the ceremony code.** Mitigation: the library does all crypto
  and attestation parsing. Challenges are single-use with a TTL.
  `userVerification: "required"`.
- **Adding a tier to cookie sessions** could lock out an operator.
  Mitigation: a missing claim means `operate`, loopback bypass is unchanged,
  and genuine-local access stays exempt.

## Migration Plan

No data migration. Deploy is additive, and the features stay inert until
`auth.passkeys.enabled` or `auth.groupTiers` is set. Rollback: revert the
code. Passkey users lose access, while OAuth, loopback, and bearer paths are
unaffected. (A) also stop the sidecar and delete its data dir.

## Open Questions

- D1-result (filled in after tasks §1).
- Should the first operator be bootstrapped from genuine-local only (loopback
  UI creates the first user)? The proposed default is yes.
