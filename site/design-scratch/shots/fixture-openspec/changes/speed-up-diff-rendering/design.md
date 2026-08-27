# Design — Speed up diff rendering

## Context

A 4k-line diff blocks the event loop for ~1.2s and the whole shell stops painting mid-scroll.

## Decision

Move hunk parsing off the main thread. The alternative — deferring this to the client — was rejected
because every client would have to reimplement the same join and they would
drift.

## Risks

- Back-compat: existing on-disk state must keep loading unchanged.
- Rollback: the change is additive, so reverting the commit is sufficient.
