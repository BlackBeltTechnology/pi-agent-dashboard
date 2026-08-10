# Harden Trust and Credential Boundaries

## Why

The audit found five residual trust/credential-boundary weaknesses. None is a
standalone RCE, but each widens the blast radius of the confirmed findings or
weakens a defense the rest of the system relies on.

- **B5 — Login OAuth CSRF + open redirect (`auth-plugin.ts:60,214`).**
  `decodeState` never validates the embedded nonce and no state cookie is set, so
  the dashboard login flow has no CSRF / authorization-code-injection protection;
  `returnUrl` is attacker-controllable and flows unchecked into
  `reply.redirect(returnUrl)` → open redirect.
- **B14 — Bare-loopback trust under a marker-less tunnel
  (`localhost-guard.ts:50`).** A reverse tunnel terminating on loopback **without**
  injecting a forwarding header (`ssh -R`, `socat`) makes the socket peer
  `127.0.0.1` with no `X-Forwarded-*`, so `isGenuinelyLocal` returns true → full
  unauthenticated access to code-exec routes. (zrok injects headers, so the
  primary tunnel is safe; this is the marker-less relay case.)
- **B15 — Arbitrary internal event injection (`bridge.ts:915`).**
  `plugin_emit_event` calls `pi.events.emit(eventType, data)` for **any**
  attacker-supplied event name, firing internal pi/plugin events that bypass the
  typed handlers' own validation.
- **B25 — Auth secret config file not `0600` (`config.ts:948`, `config-api.ts:183`).**
  `config.json` holds the auth HMAC secret but is written with a bare
  `writeFileSync` (no chmod). Under default umask (often `644`) another local user
  can read the secret and forge session JWTs. (Verified V1.)
- **B4 — REST bearer in `localStorage` (`device-auth.ts:24`).** The durable
  paired-device REST bearer is stored in JS-readable `localStorage` and
  auto-attached to every `/api/*` request, so any XSS exfiltrates it. (The WS path
  is already hardened with single-use tickets.)

## What Changes

- **CSRF-protect login + constrain returnUrl.** Persist the OAuth state nonce in a
  short-lived signed cookie and compare it on callback; restrict `returnUrl` to
  same-origin relative paths.
- **Stop trusting bare loopback for dangerous routes.** Require the local-token
  (genuine-local proof) for the code-exec routes (terminal/session/git) rather
  than trusting a bare-loopback socket peer, so a marker-less relay cannot inherit
  host trust. Document that only header-injecting tunnels (zrok) are safe.
- **Allowlist bridge event emission.** Restrict `plugin_emit_event` to an explicit
  allowlist of dashboard-plugin event names; drop unknown types.
- **Write the secret config file `0600`.** chmod `config.json` to `0600` on write
  (parity with `auth.json`, `paired-devices.json`, `identity.key`).
- **Reduce REST-bearer exposure.** Prefer an httpOnly, SameSite cookie for the
  browser REST credential where the deployment allows; where `localStorage` is
  unavoidable, shorten the bearer TTL and rotate. Closing the XSS sites
  (`sanitize-untrusted-rendered-content`) remains the primary mitigation; this
  change reduces the standing exposure.

## Impact

- **Closes / mitigates:** B5, B14, B15, B25, B4.
- **Risk:** the local-token requirement for dangerous routes must not break the
  genuine same-desktop browser flow (which has a local-token path already);
  verify no legitimate loopback user is locked out. The bearer-storage change must
  not break paired-device REST auth.
- **Affected specs:** new capability `trust-and-credential-boundaries`.
- **Affected code:** `packages/server/src/auth-plugin.ts`, `localhost-guard.ts`,
  `packages/shared/src/config.ts` + `packages/server/src/config-api.ts`,
  `packages/extension/src/bridge.ts`, `packages/client/src/lib/device-auth.ts`.

## Discipline Skills

- `security-hardening` — CSRF/open-redirect, trust-boundary tightening, secret
  file perms, credential storage, message-name allowlisting.
- `doubt-driven-review` — the loopback-trust tightening is semi-irreversible for
  local UX; prove the genuine-local desktop flow still works before merge.
- `scenario-design` — state-nonce match/mismatch, marker-less vs header tunnel,
  allowlisted vs unknown event, secret-file mode, cookie vs localStorage bearer.
