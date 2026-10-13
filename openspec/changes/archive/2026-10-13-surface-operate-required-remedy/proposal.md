## Why

Settings → Vault on a second machine shows only
"Couldn't load the vault: the vault needs an operate-tier credential or a locally
trusted caller". The refusal is correct: the vault's management routes accept only an
`operate` credential, an operator session, or a genuinely local caller
(`credential-vault` spec), and a browser admitted by `trustedNetworks` /
`auth.bypassHosts` is none of these. But the message names neither the cause nor
a way out, and the obvious guess — "pair the device" — does not work today for a
plain-http LAN browser: QR pairing is HTTPS-only (`qr-device-pairing`), and the
LAN "Request access" knock (`add-lan-knock-pairing`, proposal only) is offered
only when the network *denies* a browser.

Observed on 2026-10-13: `GET /api/vault` from `192.168.16.220` to
`192.168.16.204:8000`, no credential, admitted by `bypassHosts`, refused
`operate_required`. Service mutations (`/api/services*`) refuse with the same code
and the same dead end.

## What Changes

- **Machine-readable refusal.** The `operate_required` 403 body keeps `error` and
  status and gains `reason` (`no-credential` | `tier-too-low`) and an ordered
  `remedies` list: `use-host` (open the dashboard on the machine that runs it;
  withheld from a caller already on the host), `re-pair` (this paired device has a
  lower tier; tiers are fixed at pairing), `sign-in` (a usable login method is
  configured). Later changes may add values; clients ignore unknown ones.
  `message` is a fixed string per route and reason; the `no-credential` message is
  today's.
- **One shared server module** builds the body for vault and service routes and
  holds the one `operate` predicate the two routes duplicate today. The earlier
  `network_not_allowed` and `insufficient_scope` refusals are unchanged.
- **No posture leak.** The body has a fixed key set and discloses only the
  caller's own position (its credential and tier) and whether the public login
  page has a usable method. No hosts, addresses, ranges, device ids or labels,
  posture or stored values.
- **Vault callout.** Settings → Vault renders an `operate_required` refusal as an
  explanatory callout ("This device can't open the vault") with one row per
  recognised remedy, instead of the red generic error line. Other load failures
  keep today's error line.
- Mockup: mockups/operate-callout.html (in this change) — as-built vs proposed per
  state; plan, copy and scored rubric in `mockups/ui-plan.md`. Supersedes the
  `load-error` state of the `retro-ux-credential-vault` board.
- Service routes return the same body for CLI/REST callers; they have no web UI
  and are MCP-denylisted.

Non-goals: loosening the vault gate for trusted networks; the
`network_not_allowed` / `insufficient_scope` bodies; the pre-existing tier-blind
session admission at this layer (flagged for a separate fix); pairing or knock changes; a `request-access` remedy (owned by
`add-lan-knock-pairing`, which must gate it by its own disclosure rule);
`retire-trusted-networks-bypass`'s migration.

## Capabilities

### New Capabilities
- `operate-required-remedy`: refusal body shape, reason and remedy derivation,
  disclosure rule for `operate`-gated routes; the Vault settings callout.

### Modified Capabilities
<!-- none: the vault and service gates keep their admission rules unchanged -->

## Discipline Skills

- `security-hardening` — the change adds fields to a refusal on an authorization
  boundary; the disclosure rule (fixed keys, no posture, no host or device data)
  must hold for an unauthenticated, network-admitted caller.
- `doubt-driven-review` — run during planning (fresh-context + cross-model).
- `review-code` — before commit.

## Impact

- **Shared:** new `packages/shared/src/operate-required.ts` (body, reason and
  remedy types).
- **Server:** new `packages/server/src/auth/operate-required.ts`
  (`hasOperateAuthority`, `sendOperateRequired`); a live usable-login accessor
  composed in `server.ts` from the auth plugin, passkeys and identity state; `vault/vault-routes.ts` and `services/routes.ts`
  call the shared module; `server.ts` threads the predicate into both route deps.
  Admission unchanged.
- **Client:** `lib/vault/vault-api.ts` surfaces `code` + `remedies`;
  `components/settings/vault/VaultSection.tsx` renders the new
  `OperateRequiredCallout`.
- **Compatibility:** additive body fields; old clients keep showing the message;
  the new client ignores unknown remedies and shows today's line when `remedies`
  is missing.
- **Rollback:** revert the change; no persisted state, no migration.
- **Sequence:** lands before `retire-trusted-networks-bypass`; after its flip,
  credential-less LAN callers get `network_not_allowed` instead, and retire must
  re-read this change's `no-credential` scenarios. `add-lan-knock-pairing` may add
  `request-access` by a MODIFIED delta of `operate-required-remedy`.
