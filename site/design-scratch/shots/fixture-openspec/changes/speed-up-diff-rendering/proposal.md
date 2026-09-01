# Proposal — Speed up diff rendering

## Why

A 4k-line diff blocks the event loop for ~1.2s and the whole shell stops painting mid-scroll.

## What Changes

- Move hunk parsing off the main thread.
- Virtualise the hunk list.
- Cache highlight runs per file revision.

## Discipline Skills

- `performance-optimization` — measure before touching the render path.
