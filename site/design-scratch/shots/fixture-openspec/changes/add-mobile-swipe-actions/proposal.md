# Proposal — Add mobile swipe actions

## Why

Every session action needs the overflow menu on a phone, which is three taps for a resume.

## What Changes

- Swipe right to resume, left to hide.
- Respect prefers-reduced-motion.
- Keep a 44px minimum touch target.

## Discipline Skills

None apply: this change adds UI surface with no new external call, auth path or latency budget.
