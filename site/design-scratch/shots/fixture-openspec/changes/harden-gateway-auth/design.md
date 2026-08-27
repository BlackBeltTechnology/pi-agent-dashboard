# Design — Harden gateway auth

## Context

The gateway trusts any caller on a trusted network. That is fine on a laptop and wrong the moment a tunnel is open.

## Decision

Threat-model the tunnel path. The alternative — deferring this to the client — was rejected
because every client would have to reimplement the same join and they would
drift.

## Risks

- Back-compat: existing on-disk state must keep loading unchanged.
- Rollback: the change is additive, so reverting the commit is sufficient.
