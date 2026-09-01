# Proposal — Migrate plugin registry

## Why

Plugin metadata is split across three files that drift. A plugin can be installed, listed and still not load.

## What Changes

- Collapse to a single manifest.
- Validate on load with a clear error.
- Keep a back-compat read path for one release.

## Discipline Skills

None apply: this change adds UI surface with no new external call, auth path or latency budget.
