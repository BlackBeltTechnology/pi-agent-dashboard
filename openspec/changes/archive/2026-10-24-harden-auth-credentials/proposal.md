## Why

This change was split out of `close-residual-audit-findings`, which closes
`security-boundary-audit`. That umbrella carried 19 residual findings; the four
auth and credential items below move here so each ships on its own.

B17 (JWT hardening), B16r (cookie `Secure` behind a TLS tunnel), B18 (auth
audit logging) and B4r (cross-origin bearer storage) all touch the same
credential boundary. They share the `oauth-authentication`,
`trust-and-credential-boundaries`, `bearer-device-auth` and
`cross-origin-client` specs, so one change keeps those MODIFIED blocks coherent
and rebases them once.

B4r is the compatibility-sensitive item (bearer expiry and rotation) and needs
real design. B17, B16r and B18 are small and local. Closing them here removes
four rows from the umbrella and lets the audit close.

B14r (the `requireLocalProof` default) is owned by
`close-container-loopback-impersonation`, not here.

## What Changes

- **B17 · JWT hardening.** Pin `jwt.verify(token, secret, { algorithms: ["HS256"] })`
  (`packages/server/src/auth/auth.ts:179-181`). Mint new HMAC secrets at 32 bytes,
  not 16 (`auth.ts:142`). Design MUST decide what happens to existing 16-byte
  secrets: rotate on upgrade, which invalidates sessions, or accept them with a
  stated rationale. B17 closes only with that decision recorded. Decided (D1):
  keep every existing non-empty secret; a secret shorter than 32 characters
  logs one startup warning.
- **B18 · Auth audit logging (residual).** Pairing deny / lockout / approve
  already log (`pairing/pairing.ts:548-610`). Add audit lines for device revoke
  (`pairing/paired-devices.ts`) and for provider-credential writes
  (`routes/provider-auth-routes.ts` → `auth/provider-auth-storage.ts`). Lines carry
  the device id or actor and the source IP, never the secret.
- **B4r · Cross-origin bearer storage.** Same-origin browsers no longer keep the
  durable bearer in `localStorage` (`packages/client/src/lib/pairing/device-auth.ts:16-20`).
  Cross-origin API bases still do (`:20`). No cookie crosses origins. Decided:
  a short-lived, rotated bearer for cross-origin browsers. The legacy global
  slot is discarded on both paths; the same-origin keep-failed path writes a
  per-origin slot. Rotation authenticates only by `Authorization: Bearer`
  (else 401 `bearer_required`); a legacy row without a browser-holder
  declaration gets 409 `holder_declaration_required` (design D5).
- **B16r · Cookie `Secure` behind a TLS tunnel.** `secure` is keyed on the
  configured base URL (`packages/server/src/auth/auth-plugin.ts:296-298,315-317`),
  not on request TLS. Behind an https tunnel with an http base, it stays off.
  The fix MUST NOT enable Fastify `trustProxy`. The code deliberately avoids it,
  because forwarded headers would drive `request.ip` (`auth-plugin.ts:302-309`).
  Key `Secure` on a server-known https origin instead, e.g. the active tunnel's
  public URL.
- **B14r · moved.** Owned by `close-container-loopback-impersonation`. No B14r
  delta, task or rollback here.

## Capabilities

### Modified Capabilities

- `oauth-authentication` (B17, B16r)
- `trust-and-credential-boundaries` (B4r, B18)
- `bearer-device-auth` (B4r, B16r; route→tier entry for the rotate route)
- `cross-origin-client` (B4r)

## Impact

- Server: `auth/{auth,auth-plugin,bearer-auth}.ts`, `pairing/paired-devices.ts`,
  `routes/pairing-routes.ts`, `routes/provider-auth-routes.ts`,
  `packages/shared/src/route-tiers.ts`.
- Client: `lib/pairing/device-auth.ts`.
- **Overlaps with active changes.**
  - `close-container-loopback-impersonation` owns B14r and MODIFIES
    `bearer-device-auth`, `trust-and-credential-boundaries` and
    `oauth-authentication`. This change is `blocked_by` it and lands after it.
  - `close-loopback-legacy-window` also MODIFIES `bearer-device-auth` and
    `trust-and-credential-boundaries`. No dependency: all MODIFIED blocks here
    are written on baseline text; whichever of the three changes archives
    later rebases the shared requirements on the earlier one's text.
  - `device-key-mutual-check` MODIFIES `bearer-device-auth` "Long-lived opaque
    bearer tokens in a revocable registry" and the tier requirement, which B4r
    also modifies. Whichever archives second re-copies both blocks.
- **Compatibility:**
  - B17 alg pin: the server only mints HS256, so current tokens keep working.
    Existing secrets are kept; no forced logout.
  - B4r: cross-origin browsers re-pair once; browser bearers expire.
- **Rollback:** each item is an independent local revert (see design Migration Plan).
- **Closes (security-boundary-audit):** B17, B18, B4r, B16r. B14r is closed by
  its owner, `close-container-loopback-impersonation`.

## Discipline Skills

- `security-hardening` — every item hardens an auth or credential boundary.
- `observability-instrumentation` — B18 adds auth audit log lines.
- `doubt-driven-review` — B4r bearer expiry and rotation are
  compatibility-affecting; review before it stands.
