## Why

`loopback-credential-proof` stops current-version clients from ever sending the
raw local token, but it keeps ACCEPTING the deprecated raw `X-Pi-Local-Token`
(`acceptLegacyToken: true`) and the tokenless loopback bridge grace
(`requireTicketOnLoopback: false`) until the 1.0.0 horizon. Until both close, an
old client still leaks the token to a port squatter, and a token already
harvested from one remains a valid proof key (it forges proofs for ANY binding)
until the token is rotated.

This stub records the follow-up that `loopback-credential-proof` D9 promises, so
the 1.0.0 closing step has an owner. It is a placeholder: scope is fixed here,
design and tasks are written when the 1.0.0 horizon is scheduled.

## What Changes

- Flip `acceptLegacyToken` to `false` (`server.ts`, next to
  `requireTicketOnLoopback`) so a raw `X-Pi-Local-Token` no longer admits.
- Flip `requireTicketOnLoopback` to `true`: no tokenless loopback bridge grace.
- **Rotate the local token in the same step.** Rotation is part of closing the
  window, not a follow-up: a token harvested from a legacy client stays a valid
  proof key until it changes.
- Amend the specs that name the raw header as admitting:
  `trust-and-credential-boundaries`, `bearer-device-auth`, `qr-device-pairing`.

**BREAKING:** pre-proof bridges, CLIs and Electron builds are refused; users run
`npm run reload` / update after the server.

## Capabilities

### Modified Capabilities

- `pi-gateway-auth`: legacy raw-token acceptance and the tokenless loopback grace end.
- `local-ipc-allowlist-token`: the raw token header no longer verifies.
- `trust-and-credential-boundaries`, `bearer-device-auth`, `qr-device-pairing`:
  drop the raw-header admission wording.
- `cross-site-request-gate`: the Origin refusal no longer names the retired grace.

## Impact

- `packages/server/src/server.ts` (the two switches + live-peer check), `auth/local-token.ts`
  (locked one-shot rotation), `cli.ts` (never rotates), `auth/local-credential.ts`
  (retired-header log), plus the listed specs and the docs Auth model section.
- Test harnesses that send the raw header: `tests/e2e/**` helpers/specs and
  `server/src/test-support/local-credential-stamp.ts`.

## Discipline Skills

- `security-hardening` — closes a credential-exposure window; token rotation.
- `doubt-driven-review` — the irreversible 1.0.0 cut-over before it stands.
