## Why

`add-multi-user-identity-plane` ships the identity plane with a Keycloak resolver. Operators without Keycloak need GitHub/Google sign-in configured from a settings page, and MCP/CLI/Electron clients need sign-in without device pairing. GitHub/Google tokens cannot be verified as dashboard credentials, so the dashboard brokers: upstream login, dashboard-signed token, local verification. Split out of `add-multi-user-identity-plane` (task 18.22, design D26) so that change can ship without it.

## What Changes

- New `social-login` plugin embedding `oidc-provider` as one authorization server over GitHub, Google and generic OIDC upstreams.
- Allowlist-to-tier mapping, JSON-file adapter, settings section with arming guard, resolver + login descriptor reusing the core login page.
- Follow-ups (separate items): Electron RFC 8252 loopback PKCE, CLI device flow, MCP OAuth.

## Prerequisites

`add-multi-user-identity-plane` landed; `harden-trust-and-credential-boundaries` B5 (login CSRF/state + returnUrl) and B25 (config `0600`) landed. Starts with spike 1.a.

## Capabilities

- New: `social-login-broker`.

## Discipline Skills

- `security-hardening` — OAuth authorization server, secrets, allowlists, redirect/issuer origin.
- `observability-instrumentation` — auth/refusal/arming log lines.
- `doubt-driven-review` — spike outcome decides plugin-vs-host mount before production code.
