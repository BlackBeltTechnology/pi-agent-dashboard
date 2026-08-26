# Design — Redesign openspec board

## Context

The board sorts changes by name only, so a reader cannot tell what is actually moving. Grouping exists in the data model but has no UI.

## Decision

Add per-repo groups with colour and order. The alternative — deferring this to the client — was rejected
because every client would have to reimplement the same join and they would
drift.

## Risks

- Back-compat: existing on-disk state must keep loading unchanged.
- Rollback: the change is additive, so reverting the commit is sufficient.
