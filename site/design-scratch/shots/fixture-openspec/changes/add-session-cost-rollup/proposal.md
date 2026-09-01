# Proposal — Add session cost rollup

## Why

Per-session cost is visible on a card but there is no folder or workspace total, so spend is impossible to reason about.

## What Changes

- Sum cost per folder and per workspace.
- Surface a rollup pill on the folder header.
- Break the total down by model in a popover.

## Discipline Skills

None apply: this change adds UI surface with no new external call, auth path or latency budget.
