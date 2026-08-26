# Proposal — Fix flow retry storm

## Why

A failing flow step retries without backoff and can issue hundreds of calls a minute. Needs a repro before any fix.

## What Changes

- Reproduce deterministically.
- Add exponential backoff with a cap.

## Discipline Skills

- `systematic-debugging` — reproduce before proposing a fix.
