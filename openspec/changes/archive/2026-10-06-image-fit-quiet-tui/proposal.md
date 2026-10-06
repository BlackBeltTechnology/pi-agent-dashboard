# Route pi-image-fit diagnostics through pi's UI, not the TUI prompt

Implements PR #784 (external contributor @axelbaumlisto) plus the maintainer review follow-ups.

## Why

pi renders an extension's stdio inside the TUI, so `pi-image-fit`'s `console.log`/`console.warn`
lines land in the user's prompt line and must be cleared before typing. The extension prints one
line per screenshot resize, so this happens constantly.

A first fix (PR #784, commit 14cc321) routed every message through `ctx.ui.notify`. The review found:

1. **Print/JSON modes went silent.** pi hands extensions `noOpUIContext` (a no-op `notify`) when
   there is no UI. Checking `typeof ui.notify === "function"` captured the no-op and dropped
   everything, including warnings.
2. **First-wins sink outlived its session.** Since pi 0.84 a ctx goes stale after reload /
   `newSession` / fork / switch. A sink captured once kept emitting through the old session's UI.
3. **Notification noise.** The dashboard bridge forwards every `ctx.ui.notify` as a transcript
   row, so each resize became a visible notification.
4. **Load-time messages still hit the prompt.** Config warnings and the
   `PI_IMAGE_FIT_DISABLE` notice are logged before any ctx exists.

The current `pi-image-fit` spec also still mandates `console.log` for telemetry, which contradicts
the fix.

## What Changes

- **Diagnostics sink** (`src/log.ts`), the extension's single output channel:
  - It adopts the host UI only when `ctx.hasUI === true`; otherwise it uses console. A stale ctx
    (getter throws) is ignored.
  - Latest wins: every event refreshes the channel, so a replacement session's UI supersedes the old one.
  - Info telemetry goes to `ctx.ui.setStatus("pi-image-fit", …)`, a footer line with no transcript
    row. It falls back to `notify(…, "info")` when the host has no `setStatus`.
  - Warnings go to `ctx.ui.notify(…, "warning")`.
  - `PI_IMAGE_FIT_QUIET` truthy drops everything.
  - Load-time messages are buffered (bounded) until the first event's ctx, then delivered through
    that ctx's channel (UI or console).
- **`session_start` hook** delivers buffered load-time messages promptly, including when
  `PI_IMAGE_FIT_DISABLE` short-circuits every other handler.
- **Shared boolean parser:** `parseBool` moves from `policy.ts` to a new `src/env.ts`, so
  `PI_IMAGE_FIT_QUIET` and `PI_IMAGE_FIT_DISABLE` accept the same values (`1`/`true`/`yes`/`on`).
- **Spec:** MODIFY *Resize telemetry* (channel-agnostic); ADD *Diagnostics sink*.

No migration. Rollback means reverting the commit; behaviour returns to console output.

## Discipline Skills

None apply. This is a local logging-channel change with no auth, untrusted input, secrets,
latency budget, new endpoint or irreversible step.

## Impact

- Code: `packages/image-fit-extension/src/{log,env,policy,extension}.ts` + tests.
- Spec: `openspec/specs/pi-image-fit/spec.md`.
- Compatibility: print/JSON/unit-test hosts keep console output; interactive hosts stop writing to stdio.
