# Proposal — Harden gateway auth

## Why

The gateway trusts any caller on a trusted network. That is fine on a laptop and wrong the moment a tunnel is open.

## What Changes

- Threat-model the tunnel path.
- Decide between per-device tokens and mTLS.

## Discipline Skills

- `security-hardening` — the auth surface is the whole point of this change.
