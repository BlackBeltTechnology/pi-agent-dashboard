# Tasks

## 1. Login CSRF + open redirect (B5)

- [ ] 1.1 In `auth-plugin.ts`, set a short-lived signed state cookie on `/auth/start` and compare it in `/auth/callback`; reject on mismatch.
- [ ] 1.2 Constrain `returnUrl` to same-origin relative paths before `reply.redirect`.

## 2. Bare-loopback trust tightening (B14)

- [ ] 2.1 Require local-token (not bare loopback) for terminal/session/git routes in the guard path (`localhost-guard.ts` / guard wiring).
- [ ] 2.2 Confirm the genuine-local desktop flow already supplies the local-token; document that only header-injecting tunnels (zrok) are safe.

## 3. Bridge event allowlist (B15)

- [ ] 3.1 Add an allowlist of emittable dashboard-plugin event names; drop unknown types in `bridge.ts:plugin_emit_event`.

## 4. Config file 0600 (B25)

- [ ] 4.1 chmod `config.json` to `0600` on every write (`config.ts:948`, `config-api.ts:183`); parity with `auth.json`.

## 5. REST bearer exposure (B4)

- [ ] 5.1 Prefer an httpOnly SameSite cookie for the REST credential where supported; else shorten the bearer TTL + add rotation in `device-auth.ts`.
- [ ] 5.2 Leave the WS single-use-ticket path unchanged.

## Tests

- [ ] T1 Login: mismatched state rejected; `return=https://evil` not used for redirect; valid same-origin login works.
- [ ] T2 Loopback: marker-less loopback request to a dangerous route without local-token denied; with local-token allowed.
- [ ] T3 Bridge: unknown event name dropped; allowlisted event emitted.
- [ ] T4 Config: `config.json` written `0600`; not world-readable.
- [ ] T5 Bearer: cookie path used when available; else bounded/rotatable TTL; WS ticket path unaffected.

## Discipline checkpoints

- [ ] D1 `doubt-driven-review` — the loopback tightening must not lock out the genuine same-desktop browser; walk that flow before merge.
- [ ] D2 `security-hardening` — STRIDE the state-cookie binding, the returnUrl allowlist, the event allowlist, and the file-mode change.
- [ ] D3 `scenario-design` — state match/mismatch × marker-less/header tunnel × allowlisted/unknown event × cookie/localStorage realized as T1–T5.

## Validate

- [ ] V1 `openspec validate harden-trust-and-credential-boundaries --strict` passes.
- [ ] V2 `npm test` green (auth, localhost-guard, bridge, config suites).
- [ ] V3 Manual: config.json mode is 0600; a crafted `returnUrl` does not redirect cross-origin.
