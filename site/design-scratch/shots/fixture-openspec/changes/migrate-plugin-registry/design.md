# Design — Migrate plugin registry

## Context

Plugin metadata is split across three files that drift. A plugin can be installed, listed and still not load.

## Decision

Collapse to a single manifest. The alternative — deferring this to the client — was rejected
because every client would have to reimplement the same join and they would
drift.

## Risks

- Back-compat: existing on-disk state must keep loading unchanged.
- Rollback: the change is additive, so reverting the commit is sufficient.
