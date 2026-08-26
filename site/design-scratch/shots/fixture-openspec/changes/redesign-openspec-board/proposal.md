# Proposal — Redesign openspec board

## Why

The board sorts changes by name only, so a reader cannot tell what is actually moving. Grouping exists in the data model but has no UI.

## What Changes

- Add per-repo groups with colour and order.
- Persist manual change ordering per column.
- Join `groupId` server-side so clients never recompute it.

## Discipline Skills

None apply: this change adds UI surface with no new external call, auth path or latency budget.
