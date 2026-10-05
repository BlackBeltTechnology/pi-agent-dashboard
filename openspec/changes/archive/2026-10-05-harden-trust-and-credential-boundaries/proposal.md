# Harden Trust and Credential Boundaries

## Why

The audit found five residual trust/credential-boundary weaknesses. None is a
standalone RCE, but each widens the blast radius of the confirmed findings or
weakens a defense the rest of the system relies on.

- **B5 — Login OAuth CSRF + open redirect (`packages/server/src/auth/auth-plugin.ts:63-73,189,206,266`).**
  `decodeState` never validates the embedded nonce and no state cookie is set, so
  the dashboard login flow has no CSRF / authorization-code-injection protection;
  `returnUrl` is attacker-controllable and flows unchecked into
  `reply.redirect(returnUrl)` → open redirect.
- **B14 — Bare-loopback trust under a marker-less tunnel
  (`packages/server/src/auth/localhost-guard.ts:75`).** A reverse tunnel terminating on loopback **without**
  injecting a forwarding header (`ssh -R`, `socat`) makes the socket peer
  `127.0.0.1` with no `X-Forwarded-*`, so `isGenuinelyLocal` returns true → full
  unauthenticated access to code-exec routes. (zrok injects headers, so the
  primary tunnel is safe; this is the marker-less relay case.)
- **B15 — Arbitrary internal event injection (`packages/extension/src/bridge.ts:1542`).**
  `plugin_emit_event` calls `pi.events.emit(eventType, data)` for **any**
  attacker-supplied event name, firing internal pi/plugin events that bypass the
  typed handlers' own validation.
- **B25 — Auth secret config file not `0600` (8 write sites — see design.md D4).**
  `config.json` holds the auth HMAC secret but is written with a bare
  `writeFileSync` (no chmod). Under default umask (often `644`) another local user
  can read the secret and forge session JWTs. (Verified: `config.json` is `-rw-r--r--` on a default install.)
- **B4 — REST bearer in `localStorage` (`packages/client/src/lib/pairing/device-auth.ts:24`).** The durable
  paired-device REST bearer is stored in JS-readable `localStorage` and
  auto-attached to every `/api/*` request, so any XSS exfiltrates it. (The WS path
  is already hardened with single-use tickets.)

## What Changes

- **CSRF-protect login + constrain returnUrl.** Persist the OAuth state nonce in a
  short-lived signed cookie and verify it on callback before the code exchange;
  restrict `returnUrl` to same-origin relative paths. Hoist `@fastify/cookie`
  to server level so cookies work with or without OAuth providers.
- **Opt-in strict local proof (B14).** New `auth.requireLocalProof` (default
  `false`, default behavior unchanged). When on, bare loopback admits only
  `observe`-tier routes; `control`/`operate` routes and browser WS need a
  local-proof cookie (bootstrapped by `pi-dashboard open` / Electron via the
  local token), the local token, or an authenticated principal. The same-desktop
  browser has **no** local-token path today, so default-on would lock it out.
  Docs state only header-injecting tunnels (zrok) are safe without strict mode.
- **Constrain plugin event emission (B15).** Automation actions declare
  `emits: string[]`; the engine drops undeclared event types. The core
  `emitEventToSession` seam refuses reserved namespaces (`roles:`, `role:`,
  `model:`, `prompt:`, `dashboard:`, `ui:`), and the raw
  `sendExtensionMessage` lane refuses `plugin_emit_event` (no bypass). The bridge relay stays generic
  (archived `automation-emit-configured-event` design preserved).
- **Write the secret config file `0600`.** One secure-write helper used by all
  eight `config.json` write sites; existing group/world-readable files are
  chmod'ed `0600` at load (parity with `auth.json`, `paired-devices.json`,
  `local/token`).
- **Move the browser device bearer to an httpOnly cookie (B4).** After pairing
  the browser exchanges its bearer once for an httpOnly `SameSite=Strict`
  `pi_dash_device` cookie scoped to `/api/` (same `authVia`/tier); `localStorage` keeps only a
  non-secret paired marker; legacy stored bearers are exchanged and removed on
  next load. WS single-use tickets and the Electron keyring bearer are unchanged.

- **Pairing approval never honors bare loopback (owner decision).** Approve
  routes accept a login session, a local-proof cookie, or the local token — in
  every mode — closing the divergence from `qr-device-pairing`. Launchers always
  bootstrap the local-proof cookie, so Electron users are unaffected; a
  hand-typed `http://localhost:8000` on an auth-off install needs
  `pi-dashboard open` to approve.

## Impact

- **Closes / mitigates:** B5, B14, B15, B25, B4.
- **Risk:** strict local-proof mode (opt-in) breaks local tooling that calls
  `control`/`operate` REST without the local token — documented. The bearer
  cookie exchange must not break paired-device REST auth or WS ticket minting.
  Third-party `buildEvent` automation actions without `emits` are
  de-registered. Under strict mode `/v1/*` model-proxy traffic stays
  bare-loopback-trusted (documented trade-off).
- **Affected specs:** new capability `trust-and-credential-boundaries`; MODIFIED
  `oauth-authentication`, `trusted-networks`, `bearer-device-auth`,
  `dashboard-plugin-loader`, `automation-action-registry`, `flows-plugin`,
  `qr-device-pairing`.
- **Affected code:** `packages/server/src/auth/{auth-plugin,auth,localhost-guard,bearer-auth,route-tier-gate,bridge-ticket-eligibility}.ts`,
  `packages/server/src/routes/pairing-routes.ts`, `packages/server/src/tunnel-providers/zrok.ts`,
  `packages/shared/src/route-tiers.ts`, `packages/client/src/hooks/useWebSocket.ts`,
  `packages/client/src/components/pairing-approval/PairingApprovalHost.tsx`,
  `packages/server/src/cli.ts`, `packages/server/src/server.ts` (`emitEventToSession`),
  `packages/server/src/config-api.ts`, `packages/server/src/routes/plugin-{config,activation}-routes.ts`,
  `packages/shared/src/{config,protocol}.ts`, `packages/automation-plugin/src/server/{action-registry,engine}.ts`,
  `packages/flows-plugin/src/server/automation-actions.ts`, `packages/electron/src/main.ts`,
  `packages/client/src/lib/pairing/device-auth.ts`, `packages/client/src/components/connectivity/PairLanding.tsx`.
- **Compatibility / rollback:** see design.md (Migration / Compatibility / Rollback).

## Discipline Skills

- `security-hardening` — CSRF/open-redirect, trust-boundary tightening, secret
  file perms, credential storage, message-name allowlisting.
- `doubt-driven-review` — strict-mode trust change and the bearer→cookie
  migration are semi-irreversible for users; prove default-off parity and the
  migration path before merge.
- `scenario-design` — state-nonce match/mismatch, marker-less vs header tunnel,
  allowlisted vs unknown event, secret-file mode, cookie vs localStorage bearer.
