## Why

Settings → Vault on a second machine shows only
"Couldn't load the vault: the vault needs an operate-tier credential or a locally
trusted caller". The refusal is correct: the vault's management routes accept only an
`operate` credential, an operator session, or a genuinely local caller
(`credential-vault` spec), and a browser admitted by `trustedNetworks` /
`auth.bypassHosts` is none of these. But the message names neither the cause nor
a way out, and the obvious guess — "pair the device" — does not work today for a
plain-http LAN browser: QR pairing is HTTPS-only (`qr-device-pairing`), and the
LAN "Request access" knock (`add-lan-knock-pairing`) is offered only when the
network *denies* a browser, never when it admits it and a single route refuses it.

Observed on 2026-10-13: `GET /api/vault` from `192.168.16.220` to
`192.168.16.204:8000`, no credential, admitted by `bypassHosts`, refused
`operate_required`. Service mutations (`/api/services*`) refuse with the same code
and the same dead end.

## What Changes

- **Machine-readable refusal.** The `operate_required` 403 body keeps `error` and
  `message` unchanged and gains `reason` (`no-credential` | `tier-too-low`) and an
  ordered `remedies` list drawn from a closed set: `use-host` (open the dashboard
  on the machine that runs it), `sign-in` (a login method is configured),
  `raise-tier` (this paired device has a lower tier), `request-access` (the LAN
  knock entry point is available — lights up when `add-lan-knock-pairing` lands).
  One server helper builds the body for both vault and service routes, together
  with the one shared `operate` authority check the two routes duplicate today.
- **No posture leak.** The body discloses only facts the caller can already
  learn: whether its own credential exists and its own tier, whether the public
  login page offers a method, whether the public knock route accepts it. It never
  carries access-grant posture, host names, peer addresses or trusted ranges.
- **Vault callout.** Settings → Vault renders an `operate_required` refusal as an
  explanatory callout ("This device can't open the vault") with one row per
  remedy, instead of the red generic error line. Other load failures keep today's
  error line.
- Service routes return the same body; they have no web UI consumer yet, so API
  callers (CLI, MCP clients) get the remedy as data.

Non-goals: loosening the vault gate for trusted networks; any change to pairing,
the knock route, or `retire-trusted-networks-bypass`'s migration.

## Capabilities

### New Capabilities
- `operate-required-remedy`: refusal body shape, remedy derivation and disclosure
  rule for `operate`-gated routes; the Vault settings callout.

### Modified Capabilities
<!-- none: the vault and service gates keep their admission rules unchanged -->

## Discipline Skills

- `security-hardening` — the change adds fields to a refusal on an authorization
  boundary; the disclosure rule (no posture, no host data) must hold for an
  unauthenticated, network-admitted caller.
- `review-code` — before commit.

## Impact

- **Shared:** new `packages/shared/src/operate-required.ts` (body + remedy types).
- **Server:** new `packages/server/src/auth/operate-required.ts`
  (`hasOperateAuthority`, refusal builder); `vault/vault-routes.ts` and
  `services/routes.ts` call it instead of their private `canManageVault` /
  `canMutateServices` copies. Admission behaviour unchanged.
- **Client:** `lib/vault/vault-api.ts` surfaces `code` + `remedies`;
  `components/settings/vault/VaultSection.tsx` renders the callout.
- **Compatibility:** additive body fields; `error`, `message`, status 403 and
  every admission decision are unchanged. Old clients keep showing the message.
- **Rollback:** revert the change; no persisted state, no migration.
- **Sequence:** independent. `request-access` stays absent from `remedies` until
  `add-lan-knock-pairing` provides the knock entry point; that change's
  "Request access" landing becomes reachable from the callout without edits here.
