# add-pointer-cursor-affordance

## Why

Tailwind CSS v4 (the client runs `tailwindcss ^4.1.0`) dropped the v3
Preflight default of `cursor: pointer` on `<button>`. Native buttons across
the dashboard therefore rendered the default arrow cursor on hover, weakening
the click affordance (NN/g: interactive controls SHOULD signal clickability).

A repo scan found 280 `<button>`-bearing files but only 147 lines carrying an
ad-hoc `cursor-pointer` class — the remainder inherited the arrow. Because the
client, every plugin client bundle, and all dialogs/modals render into the same
DOM under one shared stylesheet (`packages/client/src/index.css`), the fix is a
single global base-layer rule rather than per-file edits.

## What Changes

- Add one `@layer base` rule to `packages/client/src/index.css` restoring
  `cursor: pointer` on every enabled push-target: `<button>`, `[role="button"]`,
  `[role="tab"]`, `<summary>`, checkbox/radio `<label>`s, and enabled `<select>`.
- Disabled controls (`:disabled` / `[aria-disabled="true"]`) keep the default
  arrow. The rule lives in the base layer so explicit `cursor-*` utilities
  (e.g. `cursor-not-allowed` on a loading button) still override it.

## Impact

- Affected specs: `interactive-cursor-affordance` (new capability).
- Affected code: `packages/client/src/index.css` (single global rule).
- No behavior change for disabled controls; no per-component edits; covers
  current and future plugins automatically (element/role-based, not class-based).
