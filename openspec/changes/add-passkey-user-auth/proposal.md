## Why

Access to a remote dashboard is managed with third-party OAuth apps (GitHub,
Google, generic OIDC) plus a hand-edited `auth.allowedUsers` list. There is no
way to **add a person** from the dashboard: no invite, no passkey, no
"approve this login from my phone". Every browser that logs in gets full
operator rights, because cookie sessions carry no tier. Paired-device bearer
tokens have tiers, but they cover devices, not people.

The operator wants to manage users from one place:
- invite a person with a QR code
- the person enrolls a **passkey** on their phone
- the person signs in to the remote dashboard on any screen by scanning a QR
  and approving with the phone
- each user is granted a tier
- nothing runs as a separate, hand-deployed identity service

## What Changes

- **User directory with passkey-only accounts.** Operators add users,
  assign a tier (`observe` / `control` / `operate`), and revoke them. Users
  have no password.
- **Invite QR.** The operator mints a short-lived, usage-limited invite. The
  dashboard renders it as a QR code plus a copyable link. Opening it on a phone
  enrolls a passkey and creates or activates the user.
- **Sign in with phone.** The login page shows a QR code plus a short code.
  The phone opens it, shows which device and location is asking, and approves
  with its passkey. The waiting browser receives a session.
- **Passkey login** on the device that holds the passkey (same-device or OS
  hybrid transport).
- **Relying-party ID = the primary domain.** The passkey RP ID is the hostname
  of the resolved auth base: the `auth.redirectBaseUrl` override, else the
  **primary** tunnel provider's URL. This is the same resolution that already
  decides the OAuth redirect base. When that origin is not stable (ephemeral
  zrok, no tunnel), passkey sign-in is **shown disabled with the reason**, not
  hidden. Changing the primary warns how many passkeys it orphans.
- **Session tier.** Login sessions carry a tier in the JWT. Passkey users get
  their directory tier. OIDC users get a tier from a configurable
  `groups`-claim → tier map. The route-tier gate enforces it for cookie
  sessions the same way it does for bearers.
- **Existing OAuth providers stay** and can be used alongside passkeys.
- **Backend chosen by spike.** Two implementations are in scope for
  evaluation. Tasks §1 decides between them before any production code:
  - **A — Managed Pocket ID.** The dashboard downloads the platform binary
    (a tool-registry entry, like zrok), supervises it on loopback, exposes it
    on its own origin next to the primary, drives it through its admin API
    (`STATIC_API_KEY`), and consumes it as an OIDC provider.
  - **B — Native passkeys.** WebAuthn ceremonies run in the dashboard server
    via `@simplewebauthn/server`, reusing the pairing, approval, and tier
    infrastructure.
  The specs describe user-visible behaviour and hold for either backend.
- Not **BREAKING**: with no users and no group map configured, behaviour is
  unchanged. Sessions without a tier claim keep today's full access (`operate`).

## Capabilities

### New Capabilities
- `passkey-user-auth`: user directory, invite QR enrollment, passkey login,
  sign-in-with-phone approval, RP ID derived from the primary domain, gating
  when the origin is unstable, and the warning when the primary changes.

### Modified Capabilities
- `oauth-authentication`: the JWT carries a `tier` claim, and OIDC `groups`
  map to a tier. Cookie sessions are subject to the route-tier gate.

## Discipline Skills

- `security-hardening`: new authentication ceremonies, invite and approval
  tokens, untrusted User-Agent/IP shown to the approver, and a new tier
  boundary for cookie sessions.
- `doubt-driven-review`: the backend choice (spike gate, tasks §1) and the
  RP-ID binding are hard to reverse, because enrolled passkeys cannot move
  origin.
- `observability-instrumentation`: log invite, enroll, approve, deny, and
  expire outcomes, plus sidecar lifecycle (A), without codes or credentials.
- `review-code`: before commit.

## Impact

- **Server:** `packages/server/src/auth/` (auth plugin JWT tier claim, OIDC
  group map, new passkey/user routes). Tier resolution for cookie sessions
  feeds the existing `route-tier-gate.ts`. New user registry under
  `~/.pi/dashboard/` (B) or a Pocket ID data dir plus supervisor (A).
  `getTunnelUrl()` / redirect-base resolution is reused, not changed.
- **Shared:** `route-tiers.ts` entries for the new routes; auth config types
  (`auth.passkeys`, `auth.groupTiers`).
- **Client:** Settings ▸ Users (list, tier, revoke, invite QR), the login page
  (passkey button, sign-in-with-phone QR), a phone-side approval page, and a
  primary-switch warning.
- **Tool registry (A only):** a `pocket-id` binary entry with per-platform
  download and install guidance modelled on the zrok one.
- **Compatibility:** additive config and routes. The JWT `tier` claim is
  optional. Old tokens without it are treated as `operate`.
- **Rollback:** revert. Enrolled passkeys become unusable, and the existing
  OAuth providers and loopback bypass keep working. There is no migration of
  existing data.
