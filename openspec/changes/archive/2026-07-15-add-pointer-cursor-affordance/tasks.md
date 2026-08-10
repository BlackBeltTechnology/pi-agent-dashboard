# Tasks

## 1. Global cursor rule

- [x] 1.1 Add `@layer base` rule in `packages/client/src/index.css` setting
  `cursor: pointer` on enabled `<button>`, `[role="button"]`, `[role="tab"]`,
  `<summary>`, checkbox/radio `<label>`s, and enabled `<select>`.
- [x] 1.2 Exclude `:disabled` and `[aria-disabled="true"]` so disabled controls
  keep the default arrow.
- [x] 1.3 Place the rule in the base layer so explicit `cursor-*` utilities win.

## 2. Verify

- [x] 2.1 `npm run build` succeeds and the rule compiles into the production
  CSS bundle (`packages/client/dist/assets/index-*.css`).
