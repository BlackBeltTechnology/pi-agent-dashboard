# Design — Add session cost rollup

## Context

Per-session cost is visible on a card but there is no folder or workspace total, so spend is impossible to reason about.

## Decision

Sum cost per folder and per workspace. The alternative — deferring this to the client — was rejected
because every client would have to reimplement the same join and they would
drift.

## Risks

- Back-compat: existing on-disk state must keep loading unchanged.
- Rollback: the change is additive, so reverting the commit is sufficient.
