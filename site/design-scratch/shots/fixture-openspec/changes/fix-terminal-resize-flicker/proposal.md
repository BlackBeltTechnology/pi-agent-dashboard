# Proposal — Fix terminal resize flicker

## Why

Resizing the inline terminal reflows twice and the cursor jumps a line. Blocked on an upstream xterm fix.

## What Changes

- Debounce the fit call.
- Pin the viewport row during reflow.

## Discipline Skills

- `systematic-debugging` — reproduce before proposing a fix.
