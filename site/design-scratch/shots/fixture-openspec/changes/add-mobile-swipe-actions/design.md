# Design — Add mobile swipe actions

## Context

Every session action needs the overflow menu on a phone, which is three taps for a resume.

## Decision

Swipe right to resume, left to hide. The alternative — deferring this to the client — was rejected
because every client would have to reimplement the same join and they would
drift.

## Risks

- Back-compat: existing on-disk state must keep loading unchanged.
- Rollback: the change is additive, so reverting the commit is sufficient.
